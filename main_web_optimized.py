import asyncio
import json
import os
import sys
import time
import traceback
import uvicorn
from contextlib import asynccontextmanager
from collections import defaultdict, deque

import hypersync
from hypersync import BlockField, TransactionField, TransactionSelection, ClientConfig, Query, FieldSelection
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

# --- Configuration ---
load_dotenv()
MONAD_HYPERSYNC_URL = "https://monad-testnet.hypersync.xyz"
POLLING_INTERVAL_SECONDS = 1.0
ERROR_RETRY_DELAY_SECONDS = 5
INITIAL_BOOTSTRAP_BLOCK_COUNT = 200
TPS_MEMORY_SECONDS = 10

# --- DEX Contract Information ---
DEX_CONTRACTS = {
    "LFJ": "0x45A62B090DF48243F12A21897e7ed91863E2c86b",
    "PancakeSwap": "0x94D220C58A23AE0c2eE29344b00A30D1c2d9F1bc",
    "Bean Exchange": "0xCa810D095e90Daae6e867c19DF6D9A8C56db2c89",
    "Ambient Finance": "0x88B96aF200c8a9c35442C8AC6cd3D22695AaE4F0",
    "Izumi Finance": "0xf6ffe4f3fdc8bbb7f70ffd48e61f17d1e343ddfd",
    "Octoswap": "0xb6091233aAcACbA45225a2B2121BBaC807aF4255",
    "Uniswap": "0x3aE6D8A282D67893e17AA70ebFFb33EE5aa65893",
}

# --- Data Structures & Communication ---
DEX_TX_TIMESTAMPS = {dex_name: deque() for dex_name in DEX_CONTRACTS}
DEX_SAMPLE_HASHES = {dex_name: "N/A" for dex_name in DEX_CONTRACTS}
ADDRESS_TO_DEX = {v.lower(): k for k, v in DEX_CONTRACTS.items()}
DATA_QUEUE = asyncio.Queue(maxsize=10)

# --- Global State ---
hypersync_client: hypersync.HypersyncClient | None = None

# --- Helper Print Functions ---
def print_general_red(msg, file=sys.stderr): print(f"\033[91mERROR: {msg}\033[0m", file=file, flush=True)
def print_general_yellow(msg, file=sys.stderr): print(f"\033[93mWARNING: {msg}\033[0m", file=file, flush=True)
def print_general_info(msg_prefix, message, file=sys.stderr): print(f"{msg_prefix.upper()} INFO: {message}", file=file, flush=True)


# NEW: Re-added the display function for terminal output
def display_dex_tps(payload: dict):
    """
    Clears the terminal and displays the live data from the payload.
    """
    os.system('cls' if os.name == 'nt' else 'clear')
    
    # --- TPS Section ---
    print("--- Live Monad DEX Transactions Per Second (TPS) ---")
    print(f"Tracking {len(DEX_CONTRACTS)} DEXs. Last updated: {time.strftime('%H:%M:%S')}")
    print("--------------------------------------------------")

    total_tps = 0
    # Sort by the original DEX name for consistent order
    sorted_dexs = sorted(DEX_CONTRACTS.keys())

    for dex_name in sorted_dexs:
        dex_key = dex_name.lower().replace(' ', '-')
        data = payload.get(dex_key, {"tps": 0})
        tps = data["tps"]
        print(f"{dex_name:<20}: {tps} TPS")
        total_tps += tps

    print("--------------------------------------------------")
    print(f"{'TOTAL':<20}: {total_tps} TPS")

    # --- Sample Hashes Section ---
    print("\n--- Latest Sample Transaction Hashes ---")
    for dex_name in sorted_dexs:
        dex_key = dex_name.lower().replace(' ', '-')
        data = payload.get(dex_key, {"hash": "N/A"})
        sample_hash = data["hash"]
        print(f"{dex_name:<20}: {sample_hash}")
        
    print("\n(FastAPI server is running. Press Ctrl+C to stop)")


async def poll_and_produce_data():
    if not hypersync_client:
        print_general_red("POLLER: Client not initialized.")
        return

    tx_selections = [TransactionSelection(to=[address]) for address in DEX_CONTRACTS.values()]

    try:
        current_height = await hypersync_client.get_height()
        start_block = max(0, current_height - INITIAL_BOOTSTRAP_BLOCK_COUNT)
    except Exception as e:
        print_general_red(f"POLLER ERROR: Failed to get current block height: {e}")
        return

    query = Query(
        from_block=start_block,
        transactions=tx_selections,
        field_selection=FieldSelection(
            block=[BlockField.NUMBER, BlockField.TIMESTAMP],
            transaction=[TransactionField.TO, TransactionField.BLOCK_NUMBER, TransactionField.HASH]
        )
    )

    print_general_info("POLLER", f"Starting data polling from block {query.from_block}.")

    while True:
        try:
            response = await hypersync_client.get(query)

            if response.data and response.data.blocks and response.data.transactions:
                block_timestamp_map = {
                    block.number: int(block.timestamp, 16)
                    for block in response.data.blocks if block.number is not None and block.timestamp
                }

                for tx in response.data.transactions:
                    if tx.to and tx.block_number in block_timestamp_map:
                        dex_name = ADDRESS_TO_DEX.get(tx.to.lower())
                        if dex_name:
                            timestamp = block_timestamp_map[tx.block_number]
                            DEX_TX_TIMESTAMPS[dex_name].append(timestamp)
                            if tx.hash:
                                DEX_SAMPLE_HASHES[dex_name] = tx.hash

            # Calculate TPS and format payload
            payload = {}
            current_unix_time = int(time.time())

            for dex_name, timestamps in DEX_TX_TIMESTAMPS.items():
                while timestamps and timestamps[0] < current_unix_time - TPS_MEMORY_SECONDS:
                    timestamps.popleft()
                tps = sum(1 for ts in timestamps if ts >= current_unix_time - 1)
                dex_key = dex_name.lower().replace(' ', '-')
                payload[dex_key] = {"tps": tps, "hash": DEX_SAMPLE_HASHES[dex_name]}

            # NEW: Call the display function to update the terminal
            display_dex_tps(payload)
            
            # Put the payload into the queue for the API
            if not DATA_QUEUE.full():
                await DATA_QUEUE.put(payload)

            if response.next_block:
                query.from_block = response.next_block
            
            await asyncio.sleep(POLLING_INTERVAL_SECONDS)

        except KeyboardInterrupt:
            print_general_yellow("\nPOLLER: Stopping.")
            break
        except Exception as e:
            print_general_red(f"POLLER ERROR: {type(e).__name__}: {e}")
            traceback.print_exc(file=sys.stderr)
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)

async def derby_data_generator(request: Request):
    while True:
        if await request.is_disconnected():
            print_general_yellow("SSE: Client disconnected.")
            break
        try:
            payload = await asyncio.wait_for(DATA_QUEUE.get(), timeout=20.0)
            sse_message = f"data: {json.dumps(payload)}\n\n"
            yield sse_message
        except asyncio.TimeoutError:
            yield ": keep-alive\n\n"

# --- FastAPI App Setup ---
@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    print_general_info("SYSTEM", "FastAPI application starting up...")
    global hypersync_client
    bearer_token = os.environ.get("HYPERSYNC_BEARER_TOKEN")
    if not bearer_token:
        print_general_red("STARTUP: HYPERSYNC_BEARER_TOKEN environment variable not found.")
        yield
        return

    try:
        client_config = ClientConfig(url=MONAD_HYPERSYNC_URL, bearer_token=bearer_token)
        hypersync_client = hypersync.HypersyncClient(client_config)
        print_general_info("STARTUP", f"HypersyncClient initialized for {MONAD_HYPERSYNC_URL}.")
        app_instance.state.poller_task = asyncio.create_task(poll_and_produce_data())
        print_general_info("STARTUP", "Data polling task started.")
    except Exception as e:
        print_general_red(f"STARTUP: Failed to initialize client or start poller: {e}")

    yield

    if hasattr(app_instance.state, 'poller_task') and app_instance.state.poller_task:
        app_instance.state.poller_task.cancel()
        try:
            await app_instance.state.poller_task
        except asyncio.CancelledError:
            print_general_info("SHUTDOWN", "Poller task successfully cancelled.")
    print_general_info("SHUTDOWN", "FastAPI application shutdown complete.")


app = FastAPI(title="Monad DEX Derby API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def read_root():
    return {"message": "Monad DEX Derby API is running."}

@app.get("/derby-data")
async def sse_derby_data(request: Request):
    return StreamingResponse(derby_data_generator(request), media_type="text/event-stream")

# --- Uvicorn runner ---
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    module_name = os.path.splitext(os.path.basename(__file__))[0]
    print_general_info("SYSTEM", f"Starting Uvicorn server on http://127.0.0.1:{port}")
    uvicorn.run(f"{module_name}:app", host="0.0.0.0", port=port, reload=True)
