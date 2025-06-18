import asyncio
import json
import os
import time
import traceback
import sys
from contextlib import asynccontextmanager
from collections import defaultdict, deque

import hypersync
from hypersync import TransactionField, BlockField, TransactionSelection, ClientConfig, Query, FieldSelection
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
# Removed FileResponse and StaticFiles as this is a pure API backend
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

# --- Configuration ---
load_dotenv()
MONAD_HYPERSYNC_URL = "https://monad-testnet.hypersync.xyz"

# Polling Configuration
PRE_FETCH_INTERVAL_SECONDS = 5.0
PRE_FETCH_BLOCK_COUNT = 100
ERROR_RETRY_DELAY_SECONDS = 5
INITIAL_BOOTSTRAP_BLOCK_COUNT = 50
CATCH_UP_BATCH_SIZE = 100

# --- Queues, Caches, and Events for DUAL STREAMING ---
BLOCK_SUMMARY_QUEUE = asyncio.Queue(maxsize=5000)
LATEST_TRANSACTIONS_CACHE = deque(maxlen=15)
LATEST_TX_UPDATE_EVENT = asyncio.Event()

# --- SSE Configuration ---
SSE_EVENT_NAME_BLOCKS = "new_block_summary"
SSE_EVENT_NAME_TXS = "latest_transactions"
SSE_KEEP_ALIVE_TIMEOUT = 20.0

hypersync_client: hypersync.HypersyncClient | None = None

# --- Helper Print Functions ---
def print_general_red(msg, file=sys.stderr): print(f"\033[91mERROR: {msg}\033[0m", file=file, flush=True)
def print_general_yellow(msg, file=sys.stderr): print(f"\033[93mWARNING: {msg}\033[0m", file=file, flush=True)
def print_general_info(msg_prefix, message, file=sys.stderr): print(f"{msg_prefix.upper()} INFO: {message}", file=file, flush=True)

# --- Poller and SSE Generators (No Changes Needed) ---
async def poll_for_new_blocks():
    if not hypersync_client:
        print_general_red("POLLER: Client not initialized.")
        return

    latest_chain_tip = await hypersync_client.get_height()
    current_block = max(1, latest_chain_tip - INITIAL_BOOTSTRAP_BLOCK_COUNT if latest_chain_tip else 1)
    
    print_general_info("POLLER", f"Starting block polling from block {current_block}.")

    query_obj = Query(
        from_block=1, to_block=None,
        transactions=[TransactionSelection()],
        field_selection=FieldSelection(
            block=[BlockField.NUMBER, BlockField.TIMESTAMP],
            transaction=[
                TransactionField.BLOCK_NUMBER, TransactionField.HASH,
                TransactionField.FROM, TransactionField.TO, TransactionField.VALUE
            ]
        )
    )

    while True:
        try:
            await asyncio.sleep(PRE_FETCH_INTERVAL_SECONDS)
            new_latest_tip = await hypersync_client.get_height()
            if not new_latest_tip or new_latest_tip <= current_block:
                continue

            query_obj.from_block = current_block
            query_obj.to_block = min(current_block + PRE_FETCH_BLOCK_COUNT, new_latest_tip + 1)
            
            response = await hypersync_client.get(query_obj)
            
            if not response or not response.data:
                current_block += 1
                continue

            tx_counts = defaultdict(int)
            newly_fetched_txs = []

            if response.data.transactions:
                for tx in reversed(response.data.transactions):
                    if tx.block_number is not None:
                        tx_counts[tx.block_number] += 1
                        newly_fetched_txs.append({
                            "hash": getattr(tx, 'hash', 'N/A'),
                            "from": getattr(tx, 'from_', 'N/A'),
                            "to": getattr(tx, 'to', 'N/A'),
                            "value": getattr(tx, 'value', '0')
                        })
            
            if newly_fetched_txs:
                LATEST_TRANSACTIONS_CACHE.extendleft(newly_fetched_txs)
                LATEST_TX_UPDATE_EVENT.set()
                LATEST_TX_UPDATE_EVENT.clear()

            sorted_blocks = sorted(response.data.blocks, key=lambda b: b.number or -1)
            if sorted_blocks:
                for block in sorted_blocks:
                    block_num = block.number
                    if block_num is None: continue
                    block_summary = {
                        "block_number": block_num,
                        "transaction_count": tx_counts.get(block_num, 0),
                        "timestamp": getattr(block, 'timestamp', None)
                    }
                    await BLOCK_SUMMARY_QUEUE.put(block_summary)
                
            current_block = (response.next_block if response.next_block and response.next_block > current_block 
                             else (sorted_blocks[-1].number + 1 if sorted_blocks else current_block + 1))

        except KeyboardInterrupt:
            print_general_yellow("\nPOLLER: Stopping.")
            break
        except Exception as e:
            print_general_red(f"POLLER ERROR: {type(e).__name__}: {e}")
            traceback.print_exc(file=sys.stderr)
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)

async def sse_drip_feed_generator(request: Request):
    last_sent_timestamp = None
    while True:
        if await request.is_disconnected(): break
        try:
            block_summary = await asyncio.wait_for(BLOCK_SUMMARY_QUEUE.get(), timeout=SSE_KEEP_ALIVE_TIMEOUT)
            current_timestamp_str = block_summary.get("timestamp")
            if current_timestamp_str:
                try:
                    current_timestamp = int(current_timestamp_str, 16)
                    if last_sent_timestamp is not None:
                        delay = current_timestamp - last_sent_timestamp
                        if delay > 0 and delay < 5: await asyncio.sleep(delay)
                    last_sent_timestamp = current_timestamp
                except (ValueError, TypeError):
                    last_sent_timestamp = None 
            sse_event = f"event: {SSE_EVENT_NAME_BLOCKS}\ndata: {json.dumps([block_summary])}\n\n"
            yield sse_event
            BLOCK_SUMMARY_QUEUE.task_done()
        except asyncio.TimeoutError: yield ": keep-alive\n\n"
        except Exception as e: print_general_red(f"SSE (Blocks) ERROR: {type(e).__name__}: {e}"); await asyncio.sleep(1)

async def sse_latest_tx_generator(request: Request):
    while True:
        if await request.is_disconnected(): break
        try:
            await asyncio.wait_for(LATEST_TX_UPDATE_EVENT.wait(), timeout=SSE_KEEP_ALIVE_TIMEOUT)
            latest_txs = list(LATEST_TRANSACTIONS_CACHE)
            sse_event = f"event: {SSE_EVENT_NAME_TXS}\ndata: {json.dumps(latest_txs)}\n\n"
            yield sse_event
        except asyncio.CancelledError:
            break
        except Exception as e:
            print_general_red(f"SSE (Latest TX) ERROR: {type(e).__name__}: {e}")
            await asyncio.sleep(1)

# --- FastAPI App Setup ---
app = FastAPI(title="Monad Transaction Data API")

# --- CORRECTED CORS MIDDLEWARE FOR PRODUCTION ---
origins = [
    "https://monadview.vercel.app", # Your production frontend URL
    # Add any other frontend URLs you might have (e.g., preview deployments)
    # "https://your-preview-deployment.vercel.app", 
] 
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file serving is removed as this is a pure API backend

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    print_general_info("SYSTEM", "FastAPI application starting up...")
    global hypersync_client
    bearer_token = os.environ.get("HYPERSYNC_BEARER_TOKEN")
    if not bearer_token:
        print_general_red("STARTUP: HYPERSYNC_BEARER_TOKEN not found."); yield; return
    try:
        client_config = ClientConfig(url=MONAD_HYPERSYNC_URL, bearer_token=bearer_token)
        hypersync_client = hypersync.HypersyncClient(client_config) 
        print_general_info("STARTUP", f"HypersyncClient initialized for {MONAD_HYPERSYNC_URL}.")
        
        app_instance.state.poller_task = asyncio.create_task(poll_for_new_blocks())
        print_general_info("STARTUP", "Monad block poller task started.")
    except Exception as e:
        print_general_red(f"STARTUP: Failed to initialize client or start poller: {e}"); yield
    
    yield 
    
    if hasattr(app_instance.state, 'poller_task') and app_instance.state.poller_task:
        app_instance.state.poller_task.cancel()
        try: await app_instance.state.poller_task
        except asyncio.CancelledError: print_general_info("SHUTDOWN", "Poller task successfully cancelled.")
    print_general_info("SHUTDOWN", "FastAPI application shutdown complete.")

app.router.lifespan_context = lifespan

# --- API Endpoints ---
@app.get("/")
async def read_root():
    return {"message": "Monad Visualizer Backend is running."}

@app.get("/transaction-stream")
async def transaction_stream(request: Request):
    return StreamingResponse(sse_drip_feed_generator(request), media_type="text/event-stream")

@app.get("/latest-tx-feed")
async def latest_tx_feed(request: Request):
    return StreamingResponse(sse_latest_tx_generator(request), media_type="text/event-stream")

# --- Uvicorn runner (for local testing only) ---
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    module_name = os.path.splitext(os.path.basename(__file__))[0]
    print_general_info("SYSTEM", f"Will run Uvicorn on http://127.0.0.1:{port} for {module_name}:app")
    uvicorn.run(f"{module_name}:app", host="0.0.0.0", port=port, reload=True)