import asyncio
import json
import os
import time
import traceback
import sys
from contextlib import asynccontextmanager
from collections import deque 

import hypersync
from hypersync import TransactionField, BlockField, TransactionSelection, ClientConfig, Query, FieldSelection
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
# --- Add this for CORS ---
from fastapi.middleware.cors import CORSMiddleware

# --- Configuration (from your "Optimization Report" based script) ---
load_dotenv()
MONAD_HYPERSYNC_URL = "https://monad-testnet.hypersync.xyz"

# Adaptive Polling Constants
TIP_POLL_INTERVAL_BASE = 0.2  
TIP_POLL_INTERVAL_FAST = 0.1  
TIP_POLL_INTERVAL_SLOW = 0.5  
BACKLOG_POLL_INTERVAL_SECONDS = 0.03  
ERROR_RETRY_DELAY_SECONDS = 3  

# Block management
BLOCK_CATCH_UP_OFFSET = 2  
TIP_QUERY_RANGE_ACTIVE = 3  
TIP_QUERY_RANGE_INACTIVE = 2  
MAX_CATCH_UP_BATCH_SIZE = 50  

# Height refresh strategy
GET_HEIGHT_REFRESH_FAST_INTERVAL = 1.0  
GET_HEIGHT_REFRESH_SLOW_INTERVAL = 3.0  
GET_HEIGHT_REFRESH_ON_EMPTY_QUERIES = 2  # Corrected constant name from user's script

# Queue configuration
TRANSACTION_QUEUE_MAX_SIZE = 8000
TRANSACTION_QUEUE = asyncio.Queue(maxsize=TRANSACTION_QUEUE_MAX_SIZE) 

# Processed Hashes Cache
PROCESSED_TX_HASHES = set()
MAX_PROCESSED_TX_HASHES_SIZE = 50000  # Corrected constant name from user's script
PROCESSED_TX_HASHES_ORDER_DEQUE = deque() 

# SSE Configuration
SSE_EVENT_NAME = "new_transactions_batch"
SSE_BATCH_MAX_SIZE = 150  
SSE_BATCH_MAX_WAIT_SECONDS = 0.05  
SSE_KEEP_ALIVE_TIMEOUT = 20.0

hypersync_client: hypersync.HypersyncClient | None = None
poller_start_block = 0
loop_iteration_count = 0 # Define globally for print_poller_log

# Helper print functions
def print_general_red(msg, file=sys.stderr): print(f"\033[91mERROR: {msg}\033[0m", file=file, flush=True)
def print_general_yellow(msg, file=sys.stderr): print(f"\033[93mWARNING: {msg}\033[0m", file=file, flush=True)
def print_general_info(msg_prefix, message, file=sys.stderr): print(f"{msg_prefix.upper()} INFO: {message}", file=file, flush=True)
def print_poller_log(log_type, iter_count, message, file=sys.stderr):
    color_code = ""
    if log_type.upper() == "ERROR": color_code = "\033[91m" 
    elif log_type.upper() == "WARNING": color_code = "\033[93m" 
    end_color_code = "\033[0m" if color_code else ""
    print(f"{color_code}BG POLLER {log_type.upper()} (Iter: {iter_count}): {message}{end_color_code}", file=file, flush=True)


class AdaptivePollingState:
    """Manages adaptive polling state for optimized performance"""
    def __init__(self):
        self.consecutive_empty_queries = 0 
        self.last_activity_time = time.monotonic() 
        self.last_height_refresh = 0 

    def record_activity(self, tx_count: int, was_tip_query: bool = True): 
        """Record transaction activity"""
        if tx_count > 0:
            self.last_activity_time = time.monotonic()
            self.consecutive_empty_queries = 0
        elif was_tip_query: 
            self.consecutive_empty_queries += 1
            
    def is_active_period(self) -> bool:
        """Determine if we're in an active period"""
        time_since_activity = time.monotonic() - self.last_activity_time
        return (time_since_activity < 5.0) or \
               (self.consecutive_empty_queries < CONSECUTIVE_EMPTY_QUERIES_FOR_SLOW_POLL // 2)
        
    def get_optimal_poll_interval(self) -> float:
        """Get optimal polling interval based on current state"""
        if self.is_active_period():
            return TIP_POLL_INTERVAL_FAST
        elif self.consecutive_empty_queries >= CONSECUTIVE_EMPTY_QUERIES_FOR_SLOW_POLL: 
            return TIP_POLL_INTERVAL_SLOW
        else:
            return TIP_POLL_INTERVAL_BASE
            
    def get_optimal_query_range(self) -> int:
        """Get optimal query range based on activity for tip polling"""
        return TIP_QUERY_RANGE_ACTIVE if self.is_active_period() else TIP_QUERY_RANGE_INACTIVE
            
    def should_refresh_height(self) -> bool: 
        """Determine if height should be refreshed"""
        time_since_refresh = time.monotonic() - self.last_height_refresh
        if self.consecutive_empty_queries >= GET_HEIGHT_REFRESH_ON_EMPTY_QUERIES: 
            return True
        refresh_interval = GET_HEIGHT_REFRESH_FAST_INTERVAL if self.is_active_period() else GET_HEIGHT_REFRESH_SLOW_INTERVAL
        return time_since_refresh > refresh_interval
            
    def mark_height_refreshed(self):
        """Mark that height was refreshed"""
        self.last_height_refresh = time.monotonic()


async def poll_for_monad_transactions():
    """OPTIMIZED polling function for Monad transactions"""
    global PROCESSED_TX_HASHES, poller_start_block, PROCESSED_TX_HASHES_ORDER_DEQUE, loop_iteration_count
    
    current_query_from_block = poller_start_block
    polling_state = AdaptivePollingState()

    if not hypersync_client:
        print_general_red("BACKGROUND POLLER: Client not initialized.")
        return

    print_general_info("POLLER", f"Starting optimized polling from block {current_query_from_block}.")

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
    polling_state.mark_height_refreshed() 

    while True:
        loop_iteration_count += 1
        try:
            if polling_state.should_refresh_height() or current_query_from_block > server_latest_known_block:
                try:
                    new_height = await hypersync_client.get_height()
                    if new_height is not None:
                        if new_height != server_latest_known_block:
                            print_poller_log("INFO", loop_iteration_count, 
                                           f"Height updated: {server_latest_known_block} -> {new_height}")
                        server_latest_known_block = new_height
                        polling_state.mark_height_refreshed()
                        if current_query_from_block > server_latest_known_block + BLOCK_CATCH_UP_OFFSET:
                            current_query_from_block = max(1, server_latest_known_block - BLOCK_CATCH_UP_OFFSET)
                            print_poller_log("INFO", loop_iteration_count, 
                                           f"Realigned query from block to {current_query_from_block}")
                except Exception as e_gh:
                    print_poller_log("WARNING", loop_iteration_count, f"Height refresh failed: {type(e_gh).__name__} - {e_gh}")


            query_obj.from_block = max(1, current_query_from_block)
            blocks_behind = max(0, server_latest_known_block - current_query_from_block)
            is_catching_up = blocks_behind > BLOCK_CATCH_UP_OFFSET
            
            if is_catching_up:
                query_obj.to_block = min(
                    current_query_from_block + MAX_CATCH_UP_BATCH_SIZE - 1, 
                    server_latest_known_block  
                )
                sleep_after_fetch = BACKLOG_POLL_INTERVAL_SECONDS
            else: # At tip
                query_range = polling_state.get_optimal_query_range()
                query_obj.to_block = current_query_from_block + query_range - 1
                sleep_after_fetch = polling_state.get_optimal_poll_interval()

            if query_obj.to_block is not None and query_obj.from_block > query_obj.to_block:
                await asyncio.sleep(sleep_after_fetch) 
                continue

            response = await hypersync_client.get(query_obj)
            
            new_tx_count_this_iteration = 0
            processed_up_to_block = current_query_from_block - 1

            if response and response.data:
                if response.data.blocks:
                    for b in response.data.blocks:
                        b_num = getattr(b, 'number', None)
                        if b_num is not None and b_num > processed_up_to_block:
                            processed_up_to_block = b_num
                
                if response.data.transactions:
                    for tx in response.data.transactions:
                        tx_hash = getattr(tx, 'hash', None)
                        if tx_hash and tx_hash not in PROCESSED_TX_HASHES:
                            if len(PROCESSED_TX_HASHES_ORDER_DEQUE) >= MAX_PROCESSED_TX_HASHES_SIZE:
                                for _ in range(len(PROCESSED_TX_HASHES_ORDER_DEQUE) - MAX_PROCESSED_TX_HASHES_SIZE + (MAX_PROCESSED_TX_HASHES_SIZE // 20)): 
                                    if PROCESSED_TX_HASHES_ORDER_DEQUE:
                                        old_hash = PROCESSED_TX_HASHES_ORDER_DEQUE.popleft()
                                        PROCESSED_TX_HASHES.discard(old_hash)
                                    else: break
                            PROCESSED_TX_HASHES.add(tx_hash)
                            PROCESSED_TX_HASHES_ORDER_DEQUE.append(tx_hash)
                                        
                            tx_event_data = {
                                "hash": tx_hash, "value": getattr(tx, 'value', '0x0'), 
                                "block_number": getattr(tx, 'block_number', 'N/A'),
                                "from": getattr(tx, 'from_', 'N/A'), "to": getattr(tx, 'to', 'N/A'),
                                "gas": getattr(tx, 'gas', 'N/A'),
                                "transaction_index": getattr(tx, 'transaction_index', 0)
                            }
                            try:
                                # --- USING BLOCKING PUT WITH TIMEOUT ---
                                await asyncio.wait_for(TRANSACTION_QUEUE.put(tx_event_data), timeout=1.0)
                                new_tx_count_this_iteration += 1
                            except asyncio.TimeoutError: 
                                print_poller_log("WARNING", loop_iteration_count, 
                                               f"Timeout (1s) putting TX {tx_hash[:10]} to Q. Qsize: {TRANSACTION_QUEUE.qsize()}. Poller may be blocked.")
                
                polling_state.record_activity(new_tx_count_this_iteration, not is_catching_up)
                if new_tx_count_this_iteration > 0:
                   print_poller_log("INFO", loop_iteration_count, 
                                    f"Queued {new_tx_count_this_iteration} new TXs. Qsize: {TRANSACTION_QUEUE.qsize()}. Processed up to ~{processed_up_to_block}")

            if response and hasattr(response, 'next_block') and response.next_block and response.next_block > query_obj.from_block:
                current_query_from_block = response.next_block
                if hasattr(response, 'archive_height') and response.archive_height and response.archive_height > server_latest_known_block:
                    server_latest_known_block = response.archive_height
            elif processed_up_to_block >= query_obj.from_block:
                current_query_from_block = processed_up_to_block + 1
            else: 
                current_query_from_block = query_obj.from_block + 1
                if not is_catching_up and new_tx_count_this_iteration == 0 :
                    sleep_after_fetch = polling_state.get_optimal_poll_interval() 
                elif not response:
                    sleep_after_fetch = ERROR_RETRY_DELAY_SECONDS

            current_query_from_block = max(1, current_query_from_block)
            await asyncio.sleep(sleep_after_fetch)

        except KeyboardInterrupt:
            print_general_yellow("\nBACKGROUND POLLER: Stopping.")
            break
        except Exception as e:
            print_poller_log("ERROR", loop_iteration_count, f"Unhandled exception: {type(e).__name__}: {e}") # Corrected to pass e
            traceback.print_exc(file=sys.stderr)
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)

# --- FastAPI app ---
app = FastAPI(title="Monad Live Transaction Visualizer - OPTIMIZED")

# --- ADD CORS MIDDLEWARE ---
origins = [
    "http://localhost",         # For local testing if frontend is served on a different port
    "http://localhost:3000",    # Common for local React/Vue dev servers
    "http://localhost:8000",    # If you serve frontend locally on same port as backend for testing
    "https://your-vercel-frontend-name.vercel.app",  # REPLACE THIS with your actual Vercel URL
    # Add any other origins you need to allow
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"], # Allows all methods (GET, POST, etc.)
    allow_headers=["*"], # Allows all headers
)
# --- END CORS MIDDLEWARE ---


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
                temp_initial_height = max(0, fetched_height - INITIAL_CATCH_UP_OFFSET) 
                print_general_info("STARTUP", f"Current chain height fetched: {fetched_height}")
            else:
                print_general_yellow("STARTUP: Could not fetch initial height from Hypersync.")
        except Exception as e_gh:
            print_general_yellow(f"STARTUP: Error fetching initial height: {e_gh}. Defaulting...")

        poller_start_block = max(1, temp_initial_height)
        print_general_info("STARTUP", f"Poller will start from block {poller_start_block}.")
        app_instance.state.poller_task = asyncio.create_task(poll_for_monad_transactions())
        print_general_info("STARTUP", "Optimized Monad transaction poller task started.")
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
    """OPTIMIZED SSE generator with improved batching"""
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
                time_elapsed = time.monotonic() - first_item_received_time
                if time_elapsed > SSE_BATCH_MAX_WAIT_SECONDS:
                    break
                try:
                    tx_data = TRANSACTION_QUEUE.get_nowait()
                    batch_to_send.append(tx_data)
                    TRANSACTION_QUEUE.task_done()
                except asyncio.QueueEmpty:
                    await asyncio.sleep(0.001)
                    try:
                        tx_data = TRANSACTION_QUEUE.get_nowait()
                        batch_to_send.append(tx_data)
                        TRANSACTION_QUEUE.task_done()
                    except asyncio.QueueEmpty:
                        break
                        
            if batch_to_send:
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
    html_file_name = "index.html" 
    html_file_path = os.path.join(os.path.dirname(__file__), "static", html_file_name)

    if not os.path.exists(html_file_path):
        html_file_name_fallback = "index_optimized.html"
        html_file_path_fallback = os.path.join(os.path.dirname(__file__), "static", html_file_name_fallback)
        if not os.path.exists(html_file_path_fallback):
            return HTMLResponse(content=f"<html><body><h1>Error 404: {html_file_name} or {html_file_name_fallback} not found.</h1></body></html>", status_code=404)
        return FileResponse(html_file_path_fallback)
    return FileResponse(html_file_path)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    module_name = os.path.splitext(os.path.basename(__file__))[0]
    print_general_info("SYSTEM", f"Will run Uvicorn on http://127.0.0.1:{port} for {module_name}:app")
    uvicorn.run(f"{module_name}:app", host="0.0.0.0", port=port, reload=False)