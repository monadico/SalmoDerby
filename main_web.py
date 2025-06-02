import asyncio
import json
import os
import time
import traceback
import sys
from contextlib import asynccontextmanager

import hypersync
from hypersync import TransactionField, BlockField, TransactionSelection, ClientConfig, Query, FieldSelection
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# --- Configuration ---
load_dotenv()
MONAD_HYPERSYNC_URL = "https://monad-testnet.hypersync.xyz"

TIP_POLL_INTERVAL_SECONDS = 0.4 
BACKLOG_POLL_INTERVAL_SECONDS = 0.05 
ERROR_RETRY_DELAY_SECONDS = 5
BLOCK_CATCH_UP_OFFSET = 3 
TIP_QUERY_RANGE = 5 # How many blocks to query when at the tip
# How often to forcefully call get_height() if we seem to be at the tip but getting no data
GET_HEIGHT_REFRESH_AT_TIP_INTERVAL_SECONDS = 2.0 

TRANSACTION_QUEUE = asyncio.Queue(maxsize=5000)
PROCESSED_TX_HASHES = set()

SSE_EVENT_NAME = "new_transactions_batch" # Matching your last working frontend JS for batched events
SSE_BATCH_MAX_SIZE = 100  
SSE_BATCH_MAX_WAIT_SECONDS = 0.1 
SSE_KEEP_ALIVE_TIMEOUT = 25.0 

hypersync_client: hypersync.HypersyncClient | None = None
poller_start_block = 0

# Helper print functions
def print_general_red(msg, file=sys.stderr): print(f"\033[91mERROR: {msg}\033[0m", file=file, flush=True)
def print_general_yellow(msg, file=sys.stderr): print(f"\033[93mWARNING: {msg}\033[0m", file=file, flush=True)
def print_general_info(msg_prefix, message, file=sys.stderr): print(f"{msg_prefix.upper()} INFO: {message}", file=file, flush=True)
def print_poller_log(log_type, iter_count, message, file=sys.stderr):
    color_code = ""
    if log_type == "ERROR": color_code = "\033[91m"
    elif log_type == "WARNING": color_code = "\033[93m"
    end_color_code = "\033[0m" if color_code else ""
    print(f"{color_code}BG POLLER {log_type.upper()} (Iter: {iter_count}): {message}{end_color_code}", file=file, flush=True)


async def poll_for_monad_transactions():
    global PROCESSED_TX_HASHES, poller_start_block
    current_query_from_block = poller_start_block 

    if not hypersync_client:
        print_general_red("BACKGROUND POLLER: Client not initialized.")
        return

    print_general_info("POLLER", f"Starting polling from block {current_query_from_block}.")

    query_obj = Query(
        from_block=max(1, current_query_from_block),
        to_block=None, 
        transactions=[TransactionSelection()],
        field_selection=FieldSelection(
            block=[BlockField.NUMBER, BlockField.TIMESTAMP, BlockField.HASH],
            transaction=[ 
                TransactionField.HASH, TransactionField.VALUE, TransactionField.BLOCK_NUMBER,
                TransactionField.FROM, TransactionField.TO, TransactionField.GAS,
                TransactionField.TRANSACTION_INDEX
            ]
        )
    )
    
    server_latest_known_block = current_query_from_block 
    last_successful_get_height_time = time.time() - GET_HEIGHT_REFRESH_AT_TIP_INTERVAL_SECONDS # Ensure first check happens sooner
    loop_iteration_count = 0

    while True:
        loop_iteration_count += 1
        try:
            # --- More strategic height refresh ---
            force_height_refresh = False
            if current_query_from_block > server_latest_known_block: # If we think we are ahead of known tip
                force_height_refresh = True
            elif time.time() - last_successful_get_height_time > GET_HEIGHT_REFRESH_AT_TIP_INTERVAL_SECONDS:
                force_height_refresh = True

            if force_height_refresh:
                try:
                    # print_poller_log("ACTION", loop_iteration_count, f"Refreshing height. Old server tip: {server_latest_known_block}")
                    new_height = await hypersync_client.get_height()
                    if new_height is not None:
                        if new_height != server_latest_known_block:
                             print_poller_log("INFO", loop_iteration_count, f"Height refreshed. Server tip: {new_height} (was {server_latest_known_block})")
                        server_latest_known_block = new_height
                        last_successful_get_height_time = time.time()
                        # Pull current_query_from_block back if it has overshot significantly
                        current_query_from_block = max(1, min(current_query_from_block, server_latest_known_block + 1)) 
                except Exception as e_gh:
                    print_poller_log("WARNING", loop_iteration_count, f"Error during get_height(): {type(e_gh).__name__} - {e_gh}")

            query_obj.from_block = max(1, current_query_from_block)
            
            # Determine if we are catching up or at the tip
            # If current_query_from_block is much less than server_latest_known_block, we are catching up.
            if current_query_from_block < server_latest_known_block - BLOCK_CATCH_UP_OFFSET:
                is_at_tip = False
                query_obj.to_block = None # Fetch a larger batch to catch up
                sleep_after_fetch = BACKLOG_POLL_INTERVAL_SECONDS
            else: # We are at or near the tip
                is_at_tip = True
                query_obj.to_block = query_obj.from_block + TIP_QUERY_RANGE 
                sleep_after_fetch = TIP_POLL_INTERVAL_SECONDS
            
            # print_poller_log("DEBUG", loop_iteration_count, f"Query: from={query_obj.from_block}, to={query_obj.to_block}, TipKnown={server_latest_known_block}, IsAtTip={is_at_tip}")
            response = await hypersync_client.get(query_obj)
            
            new_tx_count_this_iteration = 0
            processed_up_to_block = query_obj.from_block -1 # Track highest block actually processed from this response

            if response and response.data:
                if response.data.blocks:
                    for b in response.data.blocks:
                        b_num = getattr(b, 'number', None)
                        if b_num is not None and b_num > processed_up_to_block:
                            processed_up_to_block = b_num
                
                if response.data.transactions:
                    # print_poller_log("INFO", loop_iteration_count, f"Response: {len(response.data.blocks)} blocks, {len(response.data.transactions)} TXs")
                    for tx in response.data.transactions:
                        tx_hash = getattr(tx, 'hash', None)
                        if tx_hash and tx_hash not in PROCESSED_TX_HASHES:
                            PROCESSED_TX_HASHES.add(tx_hash)
                            tx_event_data = {
                                "hash": tx_hash, "value": getattr(tx, 'value', '0x0'), 
                                "block_number": getattr(tx, 'block_number', 'N/A'),
                                "from": getattr(tx, 'from_', 'N/A'), "to": getattr(tx, 'to', 'N/A'),
                                "gas": getattr(tx, 'gas', 'N/A'),
                                "transaction_index": getattr(tx, 'transaction_index', 0)
                            }
                            try:
                                await asyncio.wait_for(TRANSACTION_QUEUE.put(tx_event_data), timeout=1.0)
                                new_tx_count_this_iteration += 1
                            except asyncio.TimeoutError:
                                print_poller_log("WARNING", loop_iteration_count, f"Timeout putting TX {tx_hash[:10]} to Q. Qsize: {TRANSACTION_QUEUE.qsize()}")
                
                if new_tx_count_this_iteration > 0:
                   print_poller_log("INFO", loop_iteration_count, f"Queued {new_tx_count_this_iteration} new unique TXs.")

            # --- Refined Advancement Logic ---
            if response and hasattr(response, 'next_block') and response.next_block > query_obj.from_block:
                current_query_from_block = response.next_block
                if response.archive_height is not None and response.archive_height > server_latest_known_block:
                     server_latest_known_block = response.archive_height
            elif response and processed_up_to_block >= query_obj.from_block : 
                # We processed blocks from the query, but next_block didn't advance us further than that.
                # Start next query from one after the highest block we saw in this response.
                current_query_from_block = processed_up_to_block + 1
            else: 
                # No useful next_block, and didn't process any blocks from this query_obj.from_block.
                # This might happen if querying too far ahead or if there was an issue.
                # Advance cautiously by 1 from where we started this query, or align with server tip.
                current_query_from_block = max(query_obj.from_block + 1, server_latest_known_block - BLOCK_CATCH_UP_OFFSET + 1)
                print_poller_log("WARNING", loop_iteration_count, f"No progress or empty/bad response. Next query from {current_query_from_block}")
                if not response: # If response object itself was None
                    sleep_after_fetch = ERROR_RETRY_DELAY_SECONDS 
            
            current_query_from_block = max(1, current_query_from_block) # Ensure it's at least 1
            await asyncio.sleep(sleep_after_fetch)

        except KeyboardInterrupt:
            print_general_yellow("\nBACKGROUND POLLER: Stopping.")
            break
        except Exception as e:
            print_poller_log("ERROR", loop_iteration_count, f"Unhandled exception: {type(e).__name__}", e)
            traceback.print_exc(file=sys.stderr)
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)

# --- FastAPI app, lifespan, SSE generator, routes (Same as "Attempt 58") ---
app = FastAPI(title="Monad Live Transaction Visualizer")

static_dir_path = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir_path):
    app.mount("/static", StaticFiles(directory=static_dir_path), name="static")
else:
    try:
        os.makedirs(static_dir_path, exist_ok=True)
        app.mount("/static", StaticFiles(directory=static_dir_path), name="static")
    except Exception as e_mkdir:
        print_general_yellow(f"Could not create/mount 'static' directory: {e_mkdir}.")

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    print_general_info("SYSTEM", "FastAPI application starting up...")
    global hypersync_client, poller_start_block
    bearer_token = os.environ.get("HYPERSYNC_BEARER_TOKEN")
    if not bearer_token:
        print_general_red("STARTUP: HYPERSYNC_BEARER_TOKEN not found.")
        hypersync_client = None; yield
        print_general_info("SYSTEM","FastAPI application shutting down (no client)."); return
    try:
        client_config = ClientConfig(url=MONAD_HYPERSYNC_URL, bearer_token=bearer_token)
        hypersync_client = hypersync.HypersyncClient(client_config) 
        print_general_info("STARTUP", f"HypersyncClient initialized for {MONAD_HYPERSYNC_URL}.")
        temp_initial_height = 0
        try:
            fetched_height = await hypersync_client.get_height()
            if fetched_height is not None: 
                temp_initial_height = max(0, fetched_height - BLOCK_CATCH_UP_OFFSET)
                print_general_info("STARTUP", f"Current chain height fetched: {fetched_height}")
            else: 
                print_general_yellow("STARTUP: Could not fetch initial height from Hypersync.")
        except Exception as e_gh: 
            print_general_yellow(f"STARTUP: Error fetching initial height: {e_gh}. Defaulting...")
        
        poller_start_block = max(1, temp_initial_height) 
        print_general_info("STARTUP", f"Poller will start from block {poller_start_block}.")
        app_instance.state.poller_task = asyncio.create_task(poll_for_monad_transactions())
        print_general_info("STARTUP", "Monad transaction poller task started.")
    except Exception as e:
        print_general_red(f"STARTUP: Failed to initialize Hypersync client or start poller: {e}")
        traceback.print_exc(file=sys.stderr); hypersync_client = None 
    yield 
    if hasattr(app_instance.state, 'poller_task') and app_instance.state.poller_task:
        print_general_info("SHUTDOWN", "Cancelling poller task...")
        app_instance.state.poller_task.cancel()
        try: await app_instance.state.poller_task
        except asyncio.CancelledError: print_general_info("SHUTDOWN","Poller task successfully cancelled.")
        except Exception as e_shutdown: print_general_red(f"SHUTDOWN: Error during poller task: {e_shutdown}")
    print_general_info("SHUTDOWN","FastAPI application shutdown complete.")

app.router.lifespan_context = lifespan

async def sse_transaction_generator(request: Request):
    # Using batched SSE as per user's report and our last setup
    while True:
        if await request.is_disconnected():
            break
        batch_to_send = []
        first_item_received_time = None
        try:
            first_tx_data = await asyncio.wait_for(TRANSACTION_QUEUE.get(), timeout=SSE_KEEP_ALIVE_TIMEOUT)
            batch_to_send.append(first_tx_data)
            TRANSACTION_QUEUE.task_done()
            first_item_received_time = time.monotonic()
            while len(batch_to_send) < SSE_BATCH_MAX_SIZE:
                if (time.monotonic() - first_item_received_time) > SSE_BATCH_MAX_WAIT_SECONDS:
                    break 
                try:
                    tx_data = TRANSACTION_QUEUE.get_nowait() 
                    batch_to_send.append(tx_data)
                    TRANSACTION_QUEUE.task_done()
                except asyncio.QueueEmpty:
                    break 
            if batch_to_send:
                # print_general_info("SSE", f"Yielding batch of {len(batch_to_send)} transactions.") # Can be verbose
                sse_event = f"event: {SSE_EVENT_NAME}\ndata: {json.dumps(batch_to_send)}\n\n"
                yield sse_event
        except asyncio.TimeoutError: 
            yield ": keep-alive\n\n" 
        except Exception as e:
            print_general_red(f"SSE ERROR: {type(e).__name__} - {e}")
            await asyncio.sleep(1)

@app.get("/transaction-stream")
async def transaction_stream(request: Request):
    if hypersync_client is None: 
        return HTMLResponse("Backend Hypersync client not initialized. Check server logs.", status_code=503)
    sse_headers = {
        "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*", 
    }
    return StreamingResponse(sse_transaction_generator(request), media_type="text/event-stream", headers=sse_headers)

@app.get("/", response_class=FileResponse)
async def read_index():
    html_file_name = "index_optimized.html" 
    html_file_path = os.path.join(os.path.dirname(__file__), "static", html_file_name)
    if not os.path.exists(html_file_path):
        html_file_path_fallback = os.path.join(os.path.dirname(__file__), "static", "index.html")
        if not os.path.exists(html_file_path_fallback):
            return HTMLResponse(content=f"<html><body><h1>Error 404: {html_file_name} or index.html not found.</h1></body></html>", status_code=404)
        return FileResponse(html_file_path_fallback)
    return FileResponse(html_file_path)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    module_name = os.path.splitext(os.path.basename(__file__))[0] 
    print_general_info("SYSTEM", f"Will run Uvicorn on http://127.0.0.1:{port} for {module_name}:app")
    uvicorn.run(f"{module_name}:app", host="0.0.0.0", port=port, reload=True)