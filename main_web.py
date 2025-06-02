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
TIP_QUERY_RANGE = 5 

TRANSACTION_QUEUE = asyncio.Queue(maxsize=5000)
PROCESSED_TX_HASHES = set()

SSE_EVENT_NAME = "new_transactions_batch" # Matching previous successful frontend setup
SSE_BATCH_MAX_SIZE = 100  
SSE_BATCH_MAX_WAIT_SECONDS = 0.1 
SSE_KEEP_ALIVE_TIMEOUT = 25.0 

hypersync_client: hypersync.HypersyncClient | None = None
poller_start_block = 0

async def poll_for_monad_transactions():
    global PROCESSED_TX_HASHES, poller_start_block
    current_query_from_block = poller_start_block 

    if not hypersync_client:
        print("BACKGROUND POLLER ERROR: Client not initialized. Poller cannot start.", file=sys.stderr, flush=True)
        return

    print(f"BACKGROUND POLLER: Starting polling from block {current_query_from_block}.", file=sys.stderr, flush=True)

    query_obj = Query(
        from_block=max(1, current_query_from_block), # Ensure from_block is at least 1 for initial Query
        to_block=None, 
        transactions=[TransactionSelection()],
        field_selection=FieldSelection(
            block=[BlockField.NUMBER, BlockField.TIMESTAMP, BlockField.HASH],
            transaction=[ 
                TransactionField.HASH, 
                TransactionField.VALUE, 
                TransactionField.BLOCK_NUMBER,
                TransactionField.FROM, 
                TransactionField.TO, 
                TransactionField.GAS
            ]
        )
    )
    
    server_latest_known_block = current_query_from_block 
    last_successful_get_height_time = time.time()
    loop_iteration_count = 0

    while True:
        loop_iteration_count += 1
        print(f"BG POLLER LOOP START (Iter: {loop_iteration_count}): QueryFrom={current_query_from_block}, ServerKnownTip={server_latest_known_block}", file=sys.stderr, flush=True)
        try:
            # Refresh server tip height periodically
            if current_query_from_block > server_latest_known_block + TIP_QUERY_RANGE or \
               (current_query_from_block >= server_latest_known_block -1 and \
                time.time() - last_successful_get_height_time > (TIP_POLL_INTERVAL_SECONDS * 5)): # Check height if at tip and some time has passed
                try:
                    print(f"BG POLLER ACTION (Iter: {loop_iteration_count}): Refreshing height. Old server tip: {server_latest_known_block}", file=sys.stderr, flush=True)
                    new_height = await hypersync_client.get_height()
                    if new_height is not None:
                        print(f"BG POLLER INFO (Iter: {loop_iteration_count}): Height refreshed. New server tip: {new_height}", file=sys.stderr, flush=True)
                        server_latest_known_block = new_height
                        last_successful_get_height_time = time.time()
                        current_query_from_block = max(current_query_from_block, server_latest_known_block - BLOCK_CATCH_UP_OFFSET)
                    else:
                        print(f"BG POLLER WARNING (Iter: {loop_iteration_count}): get_height() returned None.", file=sys.stderr, flush=True)
                except Exception as e_gh:
                    print(f"BG POLLER WARNING (Iter: {loop_iteration_count}): Error during get_height(): {type(e_gh).__name__} - {e_gh}", file=sys.stderr, flush=True)

            query_obj.from_block = max(1, current_query_from_block) # Ensure from_block sent is at least 1
            
            is_at_tip = current_query_from_block >= server_latest_known_block - BLOCK_CATCH_UP_OFFSET

            if is_at_tip:
                query_obj.to_block = query_obj.from_block + TIP_QUERY_RANGE # Query a specific small range
                sleep_after_fetch = TIP_POLL_INTERVAL_SECONDS
                # print(f"BG POLLER DEBUG (Iter: {loop_iteration_count}): Polling tip. Query: from={query_obj.from_block}, to={query_obj.to_block}", file=sys.stderr, flush=True)
            else:
                query_obj.to_block = None # Let Hypersync return a default batch for backlog
                sleep_after_fetch = BACKLOG_POLL_INTERVAL_SECONDS
                # print(f"BG POLLER DEBUG (Iter: {loop_iteration_count}): Catching up. Query: from={query_obj.from_block}, to=None", file=sys.stderr, flush=True)
            
            print(f"BG POLLER ACTION (Iter: {loop_iteration_count}): Executing client.get() for query: from_block={query_obj.from_block}, to_block={query_obj.to_block}", file=sys.stderr, flush=True)
            response = await hypersync_client.get(query_obj)
            print(f"BG POLLER INFO (Iter: {loop_iteration_count}): client.get() returned.", file=sys.stderr, flush=True)
            
            new_tx_count_this_batch = 0
            if response and response.data:
                print(f"BG POLLER INFO (Iter: {loop_iteration_count}): Response data received. Blocks: {len(response.data.blocks)}, Transactions: {len(response.data.transactions)}", file=sys.stderr, flush=True)
                if response.data.transactions:
                    for tx_idx, tx in enumerate(response.data.transactions):
                        tx_hash = getattr(tx, 'hash', None)
                        # print(f"BG POLLER TRACE: Processing TX {tx_idx+1}/{len(response.data.transactions)}, Hash: {tx_hash}", file=sys.stderr, flush=True)
                        if tx_hash and tx_hash not in PROCESSED_TX_HASHES:
                            PROCESSED_TX_HASHES.add(tx_hash)
                            tx_event_data = {
                                "hash": tx_hash, "value": getattr(tx, 'value', '0x0'), 
                                "block_number": getattr(tx, 'block_number', 'N/A'),
                                "from": getattr(tx, 'from_', 'N/A'), 
                                "to": getattr(tx, 'to', 'N/A'),
                                "gas": getattr(tx, 'gas', 'N/A')
                            }
                            try:
                                await asyncio.wait_for(TRANSACTION_QUEUE.put(tx_event_data), timeout=1.0)
                                new_tx_count_this_batch +=1
                                print(f"BG POLLER INFO (Iter: {loop_iteration_count}): Added TX to queue: {tx_hash[:12]}... (Queue size: {TRANSACTION_QUEUE.qsize()})", file=sys.stderr, flush=True)
                            except asyncio.TimeoutError:
                                print(f"BG POLLER WARNING (Iter: {loop_iteration_count}): Timeout putting TX {tx_hash[:12]} to queue. Queue size: {TRANSACTION_QUEUE.qsize()}", file=sys.stderr, flush=True)
                
                if new_tx_count_this_batch > 0:
                   print(f"BG POLLER INFO (Iter: {loop_iteration_count}): Queued {new_tx_count_this_batch} new unique TXs from this Hypersync batch.", file=sys.stderr, flush=True)
                elif response.data.transactions: # Transactions received but none were new
                    print(f"BG POLLER INFO (Iter: {loop_iteration_count}): All {len(response.data.transactions)} TXs in batch were already processed or had no hash.", file=sys.stderr, flush=True)

            elif response:
                print(f"BG POLLER WARNING (Iter: {loop_iteration_count}): Hypersync response has no 'data' field. Response: {vars(response) if hasattr(response, '__dict__') else response}", file=sys.stderr, flush=True)
            else:
                print(f"BG POLLER WARNING (Iter: {loop_iteration_count}): No response object from client.get()", file=sys.stderr, flush=True)


            if response and hasattr(response, 'next_block') and response.next_block > current_query_from_block:
                current_query_from_block = response.next_block
                if response.archive_height is not None: server_latest_known_block = response.archive_height
                print(f"BG POLLER INFO (Iter: {loop_iteration_count}): Advancing. Next query from: {current_query_from_block}. Server tip: {server_latest_known_block}", file=sys.stderr, flush=True)
            else: 
                old_from_block = query_obj.from_block 
                current_query_from_block = (query_obj.to_block if is_at_tip and query_obj.to_block and query_obj.to_block > current_query_from_block 
                                            else current_query_from_block + 1)
                print(f"BG POLLER INFO (Iter: {loop_iteration_count}): No next_block progression or empty response. Old query_from: {old_from_block}. Advancing to query from: {current_query_from_block}. Server tip: {server_latest_known_block}", file=sys.stderr, flush=True)
                if not (response and hasattr(response, 'next_block')):
                    print(f"BG POLLER WARNING (Iter: {loop_iteration_count}): No valid 'next_block' in response.", file=sys.stderr, flush=True)
                    sleep_after_fetch = ERROR_RETRY_DELAY_SECONDS 
            
            print(f"BG POLLER DEBUG (Iter: {loop_iteration_count}): Sleeping for {sleep_after_fetch:.2f}s", file=sys.stderr, flush=True)
            await asyncio.sleep(sleep_after_fetch)

        except KeyboardInterrupt:
            print("\nBACKGROUND POLLER: Stopping due to KeyboardInterrupt.", file=sys.stderr, flush=True)
            break
        except Exception as e:
            print(f"BACKGROUND POLLER ERROR (Iter: {loop_iteration_count}): {type(e).__name__}: {e}", file=sys.stderr, flush=True)
            traceback.print_exc(file=sys.stderr)
            print(f"BACKGROUND POLLER INFO (Iter: {loop_iteration_count}): Retrying loop in {ERROR_RETRY_DELAY_SECONDS}s...", file=sys.stderr, flush=True)
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)

app = FastAPI(title="Monad Live Transaction Feed API")

if os.path.isdir("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")
else:
    # Create static directory if it doesn't exist, useful for first run
    try:
        os.makedirs("static", exist_ok=True)
        print("INFO:     Created 'static' directory.", file=sys.stderr, flush=True)
        app.mount("/static", StaticFiles(directory="static"), name="static")
        print("INFO:     Mounted static directory at /static", file=sys.stderr, flush=True)
    except Exception as e_mkdir:
        print(f"WARNING:  Could not create 'static' directory: {e_mkdir}. Frontend files may not load.", file=sys.stderr, flush=True)


@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    print("STARTUP INFO: FastAPI application starting up...", file=sys.stderr, flush=True)
    global hypersync_client, poller_start_block
    bearer_token = os.environ.get("HYPERSYNC_BEARER_TOKEN")
    if not bearer_token:
        print("STARTUP ERROR: HYPERSYNC_BEARER_TOKEN not found.", file=sys.stderr, flush=True)
        hypersync_client = None; yield
        print("SHUTDOWN INFO: FastAPI application shutting down (no client).", file=sys.stderr, flush=True); return
    try:
        client_config = ClientConfig(url=MONAD_HYPERSYNC_URL, bearer_token=bearer_token)
        hypersync_client = hypersync.HypersyncClient(client_config) 
        print(f"STARTUP INFO: HypersyncClient initialized for {MONAD_HYPERSYNC_URL}.", file=sys.stderr, flush=True)
        temp_initial_height = 0
        try:
            fetched_height = await hypersync_client.get_height()
            if fetched_height is not None: 
                temp_initial_height = max(0, fetched_height - BLOCK_CATCH_UP_OFFSET)
                print(f"STARTUP INFO: Current chain height fetched: {fetched_height}", file=sys.stderr, flush=True)
            else: 
                print("STARTUP WARNING: Could not fetch initial height from Hypersync.", file=sys.stderr, flush=True)
        except Exception as e_gh: 
            print(f"STARTUP WARNING: Error fetching initial height: {e_gh}. Defaulting...", file=sys.stderr, flush=True)
        
        poller_start_block = max(1, temp_initial_height) 
        print(f"STARTUP INFO: Poller will start from block {poller_start_block}.", file=sys.stderr, flush=True)
        app_instance.state.poller_task = asyncio.create_task(poll_for_monad_transactions())
        print("STARTUP INFO: Monad transaction poller task started.", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"STARTUP ERROR: Failed to initialize client/poller: {e}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr); hypersync_client = None 
    
    yield 
    
    if hasattr(app_instance.state, 'poller_task') and app_instance.state.poller_task:
        print("SHUTDOWN INFO: Cancelling poller task...", file=sys.stderr, flush=True)
        app_instance.state.poller_task.cancel()
        try: await app_instance.state.poller_task
        except asyncio.CancelledError: print("SHUTDOWN INFO: Poller task cancelled.", file=sys.stderr, flush=True)
        except Exception as e_shutdown: print(f"SHUTDOWN ERROR: Poller task: {e_shutdown}", file=sys.stderr, flush=True)
    print("SHUTDOWN INFO: FastAPI application shutdown complete.", file=sys.stderr, flush=True)

app.router.lifespan_context = lifespan

async def sse_transaction_generator(request: Request):
    while True:
        if await request.is_disconnected():
            print("SSE INFO: Client disconnected.", file=sys.stderr, flush=True)
            break
        
        batch_to_send = []
        first_item_received_time = None
        try:
            first_tx_data = await asyncio.wait_for(TRANSACTION_QUEUE.get(), timeout=SSE_KEEP_ALIVE_TIMEOUT)
            # print(f"SSE DEBUG: Got first item from queue for batch: {first_tx_data.get('hash')[:10] if first_tx_data else 'None'}", file=sys.stderr, flush=True)
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
                print(f"SSE DEBUG: Yielding batch of {len(batch_to_send)} transactions to client.", file=sys.stderr, flush=True)
                sse_event = f"event: {SSE_EVENT_NAME}\ndata: {json.dumps(batch_to_send)}\n\n"
                yield sse_event
        
        except asyncio.TimeoutError: 
            yield ": keep-alive\n\n" 
        except Exception as e:
            print(f"SSE ERROR: Error in sse_transaction_generator: {type(e).__name__} - {e}", file=sys.stderr, flush=True)
            traceback.print_exc(file=sys.stderr)
            await asyncio.sleep(1)

@app.get("/transaction-stream")
async def transaction_stream(request: Request):
    if hypersync_client is None: 
        return HTMLResponse("Backend Hypersync client not initialized. Check server logs.", status_code=503)
    
    sse_headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*", 
    }
    return StreamingResponse(
        sse_transaction_generator(request),
        media_type="text/event-stream",
        headers=sse_headers
    )

@app.get("/", response_class=FileResponse)
async def read_index():
    # This should point to your WebGL frontend's HTML file if you are using the "optimized" set
    html_file_name = "index_optimized.html" # Assuming this is your WebGL HTML file
    html_file_path = os.path.join(os.path.dirname(__file__), "static", html_file_name)
    
    if not os.path.exists(html_file_path):
        # Fallback if primary HTML is not found, or provide a more generic error
        html_file_path_fallback = os.path.join(os.path.dirname(__file__), "static", "index.html")
        if not os.path.exists(html_file_path_fallback):
            return HTMLResponse(content=f"<html><body><h1>Error 404: {html_file_name} or index.html not found.</h1><p>Ensure your main HTML file is in the 'static' folder.</p></body></html>", status_code=404)
        print(f"WARNING: '{html_file_name}' not found, serving 'index.html' as fallback.", file=sys.stderr, flush=True)
        return FileResponse(html_file_path_fallback)
    return FileResponse(html_file_path)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    # This will be "main_web_optimized" if you save this file as main_web_optimized.py
    module_name = os.path.splitext(os.path.basename(__file__))[0] 
    print(f"INFO:     Will run Uvicorn on http://127.0.0.1:{port} for {module_name}:app", file=sys.stderr, flush=True)
    uvicorn.run(f"{module_name}:app", host="0.0.0.0", port=port, reload=True)