import asyncio
import json
import os
import sys
import time
import traceback
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Dict, Any, List, Tuple
from collections import defaultdict, deque

import hypersync
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from hypersync import (BlockField, ClientConfig, FieldSelection, Query,
                       TransactionField, TransactionSelection)

# --- Configuration ---
load_dotenv()
MONAD_HYPERSYNC_URL = os.getenv("MONAD_HYPERSYNC_URL", "https://monad-testnet.hypersync.xyz")
HYPERSYNC_BEARER_TOKEN = os.getenv("HYPERSYNC_BEARER_TOKEN")
POLLING_INTERVAL_SECONDS = float(os.getenv("POLLING_INTERVAL_SECONDS", 1.0)) # Polling more frequently for responsiveness
ERROR_RETRY_DELAY_SECONDS = int(os.getenv("ERROR_RETRY_DELAY_SECONDS", 5))
TPS_CALCULATION_INTERVAL = 5.0 # The window in seconds for calculating TPS

##: Configuration for the web server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))

##: CORS Configuration
origins = [
    "http://localhost",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:5173", 
    "http://127.0.0.1:5173",
]


# --- NEW: State for Accurate TPS Calculation ---
# This deque will store tuples of (timestamp, transaction_count) for recent blocks.
block_data_history: deque[Tuple[int, int]] = deque(maxlen=200) # Store ~100 seconds of blocks
last_tps_update_time = time.time()
current_tps = 0.0

# --- Global State & Application Lifespan ---
app_state: Dict[str, Any] = {
    "hypersync_client": None
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    print_info("SYSTEM", "Application starting up...")
    if not HYPERSYNC_BEARER_TOKEN:
        print_red("STARTUP ERROR: HYPERSYNC_BEARER_TOKEN environment variable not found.")
        sys.exit(1)

    try:
        client_config = ClientConfig(url=MONAD_HYPERSYNC_URL, bearer_token=HYPERSYNC_BEARER_TOKEN)
        app_state["hypersync_client"] = hypersync.HypersyncClient(client_config)
        print_info("SYSTEM", "HypersyncClient initialized.")
        yield
    finally:
        if app_state["hypersync_client"]:
            print_info("SYSTEM", "Closing HypersyncClient.")
        print_info("SYSTEM", "Application shutdown complete.")

# --- FastAPI App Initialization ---
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Helper Print Functions ---
def print_red(msg, file=sys.stderr): print(f"\033[91mERROR: {msg}\033[0m", file=file, flush=True)
def print_yellow(msg, file=sys.stderr): print(f"\033[93mWARNING: {msg}\033[0m", file=file, flush=True)
def print_cyan(msg, file=sys.stdout): print(f"\033[96m{msg}\033[0m", file=file, flush=True)
def print_info(msg_prefix, message, file=sys.stderr): print(f"{msg_prefix.upper()} INFO: {message}", file=file, flush=True)


# ==========================================================
# === DATA STREAM GENERATOR 1: Cityscape Firehose
# ==========================================================

async def cityscape_data_generator(request: Request) -> AsyncGenerator[str, None]:
    global last_tps_update_time, current_tps
    hypersync_client = app_state["hypersync_client"]
    
    try:
        current_height = await hypersync_client.get_height()
        start_block = max(0, current_height - 10)
    except Exception as e:
        print_red(f"CITYSCAPE GEN_ERROR: Failed to get initial block height: {e}")
        yield f"data: {json.dumps({'error': 'Could not connect to data source.'})}\n\n"
        return

    query = Query(
        from_block=start_block, 
        transactions=[TransactionSelection()],
        field_selection=FieldSelection(
            transaction=[
                TransactionField.HASH, TransactionField.VALUE,
                TransactionField.GAS_USED, TransactionField.GAS_PRICE,
                TransactionField.BLOCK_NUMBER,
            ],
            block=[BlockField.NUMBER, BlockField.TIMESTAMP, BlockField.HASH] # Added HASH to uniquely identify blocks
        )
    )
    print_info("CITYSCAPE", f"Starting new firehose stream from block {start_block}")

    processed_block_hashes = set()

    while True:
        try:
            if await request.is_disconnected():
                print_yellow("Client disconnected. Stopping cityscape stream.")
                break

            response = await hypersync_client.get(query)

            if response.data and response.data.blocks:
                latest_block_info = {"number": 0, "timestamp": 0, "transaction_count": 0}
                
                # --- NEW: Accurate Block-based Data Processing ---
                tx_counts_per_block = defaultdict(int)
                if response.data.transactions:
                    for tx in response.data.transactions:
                        if tx.block_number is not None:
                            tx_counts_per_block[tx.block_number] += 1
                
                # Add new, unprocessed block data to our history
                for block in response.data.blocks:
                    if block.hash not in processed_block_hashes:
                        processed_block_hashes.add(block.hash)
                        block_number = block.number
                        timestamp = int(block.timestamp, 16)
                        tx_count = tx_counts_per_block.get(block_number, 0)
                        block_data_history.append((timestamp, tx_count))

                # Find the latest block from the response to use as a reference
                latest_block_in_batch = max(response.data.blocks, key=lambda b: b.number)
                latest_block_info["number"] = latest_block_in_batch.number
                latest_block_info["timestamp"] = int(latest_block_in_batch.timestamp, 16)
                latest_block_info["transaction_count"] = tx_counts_per_block.get(latest_block_in_batch.number, 0)
                
                # --- NEW: TPS Calculation Logic ---
                if (time.time() - last_tps_update_time) >= TPS_CALCULATION_INTERVAL:
                    now = time.time()
                    five_seconds_ago = now - TPS_CALCULATION_INTERVAL
                    
                    # Sum transactions from blocks within the 5-second window
                    total_tx_in_window = sum(count for ts, count in block_data_history if ts >= five_seconds_ago)
                    
                    # Calculate TPS
                    current_tps = total_tx_in_window / TPS_CALCULATION_INTERVAL
                    last_tps_update_time = now

                    print_info("TPS_UPDATE", f"Calculated TPS: {current_tps:.2f} over the last {TPS_CALCULATION_INTERVAL} seconds.")

                # --- Payload Preparation (visuals and other data) ---
                transactions_in_batch = []
                total_fee_in_batch = 0
                if response.data.transactions:
                    for tx in response.data.transactions:
                        value_in_eth = int(tx.value, 16) / 1e18 if tx.value else 0
                        gas_used = int(tx.gas_used, 16) if tx.gas_used else 0
                        gas_price = int(tx.gas_price, 16) if tx.gas_price else 0
                        total_fee_in_batch += (gas_used * gas_price) / 1e18
                        transactions_in_batch.append({"hash": tx.hash, "value": f"{value_in_eth:.4f}"})

                sse_payload = {
                    "transactions": transactions_in_batch,
                    "latest_block": latest_block_info,
                    "tps": current_tps, # Use the new, stable TPS value
                    "total_fees_in_batch": total_fee_in_batch,
                }
                
                print_cyan(
                    f"[STREAMING BATCH] Latest Block: {latest_block_info['number']} | "
                    f"TXs in Batch: {len(transactions_in_batch):<4} | "
                    f"Current Stable TPS: {current_tps:<6.2f}"
                )

                yield f"data: {json.dumps(sse_payload)}\n\n"

            # Use the simple, robust polling method
            if response.next_block:
                query.from_block = response.next_block
            
            await asyncio.sleep(POLLING_INTERVAL_SECONDS)

        except Exception as e:
            print_red(f"CITYSCAPE GEN_ERROR: {e}\n{traceback.format_exc()}")
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)

# ==========================================================
# === FASTAPI ENDPOINTS
# ==========================================================
@app.get("/firehose-stream")
async def firehose_stream_endpoint(request: Request):
    return StreamingResponse(cityscape_data_generator(request), media_type="text/event-stream")

@app.get("/derby-stream")
async def derby_stream_endpoint(request: Request):
    return {"message": "Derby stream not implemented yet."}

# This serves index.html at the root ("/") and handles other files like CSS and JS.
app.mount("/", StaticFiles(directory="static", html=True), name="static")


# ==========================================================
# === MAIN EXECUTION SCRIPT
# ==========================================================
if __name__ == "__main__":
    print_info("SYSTEM", f"Starting server on http://{HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
