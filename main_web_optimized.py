import asyncio
import json
import os
import sys
import time
import traceback
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Dict, Any

import hypersync
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from hypersync import (BlockField, ClientConfig, FieldSelection, Query,
                       TransactionField, TransactionSelection)

# --- Configuration ---
load_dotenv()
MONAD_HYPERSYNC_URL = os.getenv("MONAD_HYPERSYNC_URL", "https://monad-testnet.hypersync.xyz")
HYPERSYNC_BEARER_TOKEN = os.getenv("HYPERSYNC_BEARER_TOKEN")
POLLING_INTERVAL_SECONDS = float(os.getenv("POLLING_INTERVAL_SECONDS", 2.0))
ERROR_RETRY_DELAY_SECONDS = int(os.getenv("ERROR_RETRY_DELAY_SECONDS", 5))

##: Configuration for the web server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))

##: CORS Configuration for allowing frontend connections
##: This is set up to be easily adaptable for production
origins = [
    "http://localhost",
    "http://localhost:8080", # Default local dev server
    "http://127.0.0.1:8080",
    # "https://your-vercel-frontend-url.vercel.app" #TODO: Add your Vercel frontend URL here
]


# --- Global State & Application Lifespan ---
# We use a dictionary for app state to avoid global variables
app_state: Dict[str, Any] = {
    "hypersync_client": None
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    ##: This context manager handles startup and shutdown logic
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
def print_green(msg, file=sys.stdout): print(f"\033[92m{msg}\033[0m", file=file, flush=True)
def print_cyan(msg, file=sys.stdout): print(f"\033[96m{msg}\033[0m", file=file, flush=True)
def print_info(msg_prefix, message, file=sys.stderr): print(f"{msg_prefix.upper()} INFO: {message}", file=file, flush=True)


# ==========================================================
# === DATA STREAM GENERATOR 1: Cityscape Firehose
# ==========================================================

async def cityscape_data_generator(request: Request) -> AsyncGenerator[str, None]:
    """
    This is an asynchronous generator that fetches all new transactions from Hypersync
    and yields them in the Server-Sent Events (SSE) format. It also prints a summary
    of the data to the terminal for verification.
    """
    hypersync_client = app_state["hypersync_client"]
    
    try:
        current_height = await hypersync_client.get_height()
        start_block = max(0, current_height - 10)
    except Exception as e:
        print_red(f"CITYSCAPE GEN_ERROR: Failed to get initial block height: {e}")
        error_payload = json.dumps({"error": "Could not connect to blockchain data source."})
        yield f"data: {error_payload}\n\n"
        return

    query = Query(
        from_block=start_block, 
        transactions=[TransactionSelection()], # Wildcard to get ALL transactions
        field_selection=FieldSelection(
            transaction=[
                TransactionField.HASH, 
                TransactionField.FROM, 
                TransactionField.TO, 
                TransactionField.VALUE,
                TransactionField.GAS_USED,
                TransactionField.GAS_PRICE,
            ],
            block=[BlockField.NUMBER, BlockField.TIMESTAMP]
        )
    )
    print_info("CITYSCAPE", f"Starting new firehose stream from block {start_block}")

    latest_block_info = {"number": start_block, "timestamp": int(time.time())}
    tx_count_for_tps = 0
    last_tps_calc_time = time.time()
    
    while True:
        try:
            if await request.is_disconnected():
                print_yellow("Client disconnected. Stopping cityscape stream.")
                break

            response = await hypersync_client.get(query)

            if response.data and response.data.blocks:
                latest_block = max(response.data.blocks, key=lambda b: b.number)
                latest_block_info["number"] = latest_block.number
                latest_block_info["timestamp"] = int(latest_block.timestamp, 16)

            transactions_in_batch = []
            total_fee_in_batch = 0
            if response.data and response.data.transactions:
                for tx in response.data.transactions:
                    value_in_eth = int(tx.value, 16) / 1e18 if tx.value else 0
                    gas_used = int(tx.gas_used, 16) if tx.gas_used else 0
                    gas_price = int(tx.gas_price, 16) if tx.gas_price else 0
                    fee_in_eth = (gas_used * gas_price) / 1e18
                    total_fee_in_batch += fee_in_eth
                    
                    transactions_in_batch.append({
                        "hash": tx.hash,
                        "value": f"{value_in_eth:.4f}"
                    })
                tx_count_for_tps += len(transactions_in_batch)

            current_time = time.time()
            time_diff = current_time - last_tps_calc_time
            tps = 0
            if time_diff >= 1:
                tps = tx_count_for_tps / time_diff
                tx_count_for_tps = 0
                last_tps_calc_time = current_time

            sse_payload = {
                "transactions": transactions_in_batch,
                "latest_block": latest_block_info,
                "tps": tps,
                "total_fees_in_batch": total_fee_in_batch,
            }
            
            ##: ADDED FOR VERIFICATION: Print a summary of the data being sent to the terminal
            print_cyan(
                f"[STREAMING BATCH] Block: {latest_block_info['number']} | "
                f"Transactions: {len(transactions_in_batch):<3} | "
                f"TPS: {tps:<6.2f}"
            )

            # Format and yield the data as an SSE message
            yield f"data: {json.dumps(sse_payload)}\n\n"

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

app.mount("/", StaticFiles(directory="static", html=True), name="static")

# ==========================================================
# === MAIN EXECUTION SCRIPT
# ==========================================================
if __name__ == "__main__":
    print_info("SYSTEM", f"Starting server on http://{HOST}:{PORT}")
    # MODIFIED: Changed log_level to "info" to ensure all print statements are visible.
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")

