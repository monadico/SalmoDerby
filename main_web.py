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
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse # Added FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# --- Configuration ---
load_dotenv()
MONAD_HYPERSYNC_URL = "https://monad-testnet.hypersync.xyz" # Or your preferred working URL

CHAIN_ADVANCE_POLL_INTERVAL_SECONDS = 0.7
ERROR_RETRY_DELAY_SECONDS = 5
BLOCK_CATCH_UP_OFFSET = 5
POLL_INTERVAL_SECONDS = 0.04

TRANSACTION_QUEUE = asyncio.Queue(maxsize=2000)
PROCESSED_TX_HASHES = set()

hypersync_client: hypersync.HypersyncClient | None = None
initial_poller_from_block = 0

# --- poll_for_monad_transactions function (Same as before) ---
async def poll_for_monad_transactions():
    global PROCESSED_TX_HASHES, initial_poller_from_block
    current_query_from_block = initial_poller_from_block 

    if not hypersync_client:
        print("BACKGROUND POLLER ERROR: Client not initialized.", file=sys.stderr, flush=True)
        return

    print(f"BACKGROUND POLLER: Starting from block {current_query_from_block}.", file=sys.stderr, flush=True)

    query_template = Query(
        from_block=current_query_from_block, 
        transactions=[TransactionSelection()],
        field_selection=FieldSelection(
            block=[BlockField.NUMBER],
            transaction=[
                TransactionField.HASH, TransactionField.VALUE, TransactionField.BLOCK_NUMBER
                #TransactionField.FROM, TransactionField.TO,
            ]
        )
    )
    server_latest_known_block = current_query_from_block 
    while True:
        try:
            query_template.from_block = current_query_from_block 
            response = await hypersync_client.get(query_template)
            
            new_tx_count_in_batch = 0
            if response and response.data and response.data.transactions:
                for tx in response.data.transactions:
                    tx_hash = getattr(tx, 'hash', None)
                    if tx_hash and tx_hash not in PROCESSED_TX_HASHES:
                        PROCESSED_TX_HASHES.add(tx_hash)
                        tx_event_data = {
                            "hash": tx_hash, "value": getattr(tx, 'value', 'N/A'),
                            "block_number": getattr(tx, 'block_number', 'N/A')
                            #"from": getattr(tx, 'from_', 'N/A'), "to": getattr(tx, 'to', 'N/A')
                        }
                        try:
                            TRANSACTION_QUEUE.put_nowait(tx_event_data) 
                            new_tx_count_in_batch +=1
                        except asyncio.QueueFull:
                            print("BACKGROUND POLLER WARNING: Transaction queue is full. Events may be lost.", file=sys.stderr, flush=True)
            
            sleep_duration = POLL_INTERVAL_SECONDS

            if response and hasattr(response, 'next_block'):
                if response.archive_height is not None:
                    server_latest_known_block = response.archive_height
                
                if response.next_block > current_query_from_block:
                    current_query_from_block = response.next_block
                    if current_query_from_block <= server_latest_known_block + BLOCK_CATCH_UP_OFFSET: 
                         sleep_duration = 0.05 
                else: 
                    current_query_from_block = max(current_query_from_block + 1, server_latest_known_block - BLOCK_CATCH_UP_OFFSET + 1)
                
                if current_query_from_block > server_latest_known_block:
                    sleep_duration = CHAIN_ADVANCE_POLL_INTERVAL_SECONDS
                    try:
                        new_height = await hypersync_client.get_height()
                        if new_height is not None: 
                            server_latest_known_block = new_height
                            current_query_from_block = max(current_query_from_block, new_height - BLOCK_CATCH_UP_OFFSET)
                    except Exception: pass 
            else: 
                print(f"BACKGROUND POLLER WARNING: No valid 'next_block'. Retrying from {current_query_from_block + 1}", file=sys.stderr, flush=True)
                current_query_from_block += 1
                sleep_duration = ERROR_RETRY_DELAY_SECONDS
            
            await asyncio.sleep(sleep_duration)

        except Exception as e:
            print(f"BACKGROUND POLLER ERROR: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
            traceback.print_exc(file=sys.stderr)
            print(f"BACKGROUND POLLER INFO: Retrying loop in {ERROR_RETRY_DELAY_SECONDS}s...", file=sys.stderr, flush=True)
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)

app = FastAPI(title="Monad Live Transaction Feed API")

# Mount static directory to serve CSS, JS, video, and index.html (if requested directly)
# The main path "/" will serve index.html via FileResponse explicitly
app.mount("/static", StaticFiles(directory="static"), name="static")

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    print("STARTUP INFO: FastAPI application starting up...", file=sys.stderr, flush=True)
    global hypersync_client, initial_poller_from_block
    bearer_token = os.environ.get("HYPERSYNC_BEARER_TOKEN")
    if not bearer_token:
        print("STARTUP ERROR: HYPERSYNC_BEARER_TOKEN not found.", file=sys.stderr, flush=True)
        hypersync_client = None; yield
        print("SHUTDOWN INFO: FastAPI application shutting down (no client).", file=sys.stderr, flush=True); return
    try:
        client_config = ClientConfig(url=MONAD_HYPERSYNC_URL, bearer_token=bearer_token)
        hypersync_client = hypersync.HypersyncClient(client_config) 
        print("STARTUP INFO: HypersyncClient initialized.", file=sys.stderr, flush=True)
        temp_initial_height = 0
        try:
            fetched_height = await hypersync_client.get_height()
            if fetched_height is not None: temp_initial_height = max(0, fetched_height - BLOCK_CATCH_UP_OFFSET)
            else: print("STARTUP WARNING: Could not fetch initial height.", file=sys.stderr, flush=True)
        except Exception as e_gh: print(f"STARTUP WARNING: Error fetching initial height: {e_gh}.", file=sys.stderr, flush=True)
        initial_poller_from_block = max(1, temp_initial_height) 
        print(f"STARTUP INFO: Poller will start from block {initial_poller_from_block}.", file=sys.stderr, flush=True)
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
        if await request.is_disconnected(): print("SSE INFO: Client disconnected.", file=sys.stderr, flush=True); break
        try:
            tx_data = await asyncio.wait_for(TRANSACTION_QUEUE.get(), timeout=30.0)
            sse_event = f"event: new_transaction\ndata: {json.dumps(tx_data)}\n\n"
            yield sse_event; TRANSACTION_QUEUE.task_done()
        except asyncio.TimeoutError: yield ": keep-alive\n\n" 
        except Exception as e: print(f"SSE ERROR: {e}", file=sys.stderr, flush=True); await asyncio.sleep(1)

@app.get("/transaction-stream")
async def transaction_stream(request: Request):
    if hypersync_client is None: return HTMLResponse("Backend client not initialized.", status_code=503)
    return StreamingResponse(sse_transaction_generator(request), media_type="text/event-stream")

# --- MODIFIED Root endpoint to serve static/index.html ---
@app.get("/", response_class=FileResponse)
async def read_index():
    # Path to the index.html file within the 'static' directory
    # os.path.dirname(__file__) gives the directory of the current script (main_web.py)
    html_file_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if not os.path.exists(html_file_path):
        return HTMLResponse(content="<html><body><h1>Error: index.html not found in static folder.</h1><p>Ensure 'static/index.html' exists.</p></body></html>", status_code=404)
    return FileResponse(html_file_path)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"INFO:     Will run Uvicorn on http://127.0.0.1:{port}")
    uvicorn.run("main_web:app", host="0.0.0.0", port=port, reload=True)