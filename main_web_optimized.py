import asyncio
import json
import os
import sys
import time
import traceback
from contextlib import asynccontextmanager
from collections import defaultdict, deque
from typing import List, Dict, Any, AsyncGenerator, Tuple

import hypersync
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from hypersync import BlockField, TransactionField, TransactionSelection, ClientConfig, Query, FieldSelection
from dotenv import load_dotenv
from pydantic import BaseModel

# --- Configuration ---
load_dotenv()
MONAD_HYPERSYNC_URL = os.getenv("MONAD_HYPERSYNC_URL", "https://monad-testnet.hypersync.xyz")
HYPERSYNC_BEARER_TOKEN = os.getenv("HYPERSYNC_BEARER_TOKEN")
# This is now the interval for fetching large batches
CITYSCAPE_POLLING_INTERVAL = 5.0
DERBY_POLLING_INTERVAL = 2.0
ERROR_RETRY_DELAY_SECONDS = 5
TPS_MEMORY_SECONDS = 10 
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))

# --- Preset DEX Contract Information (for the Derby Tracker) ---
DEX_CONTRACTS = {
    "LFJ": "0x45A62B090DF48243F12A21897e7ed91863E2c86b",
    "PancakeSwap": "0x94D220C58A23AE0c2eE29344b00A30D1c2d9F1bc",
    "Bean Exchange": "0xCa810D095e90Daae6e867c19DF6D9A8C56db2c89",
    "Ambient Finance": "0x88B96aF200c8a9c35442C8AC6cd3D22695AaE4F0",
    "Izumi Finance": "0xf6ffe4f3fdc8bbb7f70ffd48e61f17d1e343ddfd",
    "Octoswap": "0xb6091233aAcACbA45225a2B2121BBaC807aF4255",
    "Uniswap": "0x3aE6D8A282D67893e17AA70ebFFb33EE5aa65893",
}

# This will now be our dynamic configuration, initialized with the defaults.
# The structure is { "entityName": ["0xaddress1", "0xaddress2", ...], ... }
DERBY_TRACKER_CONFIG: Dict[str, List[str]] = {
    name: [address] for name, address in DEX_CONTRACTS.items()
}

# --- Pydantic Models for API ---
class DerbyEntity(BaseModel):
    name: str
    addresses: List[str]

class UpdateDerbyConfigRequest(BaseModel):
    entities: List[DerbyEntity]

# --- Global State & Application Lifespan ---
app_state: Dict[str, Any] = {"hypersync_client": None, "derby_connections": set()}

@asynccontextmanager
async def lifespan(app: FastAPI):
    print_info("SYSTEM", "Application starting up...")
    bearer_token = os.environ.get("HYPERSYNC_BEARER_TOKEN")
    if not bearer_token:
        print_red("STARTUP: HYPERSYNC_BEARER_TOKEN environment variable not found.")
        sys.exit(1)
    try:
        client_config = ClientConfig(url=MONAD_HYPERSYNC_URL, bearer_token=bearer_token)
        app_state["hypersync_client"] = hypersync.HypersyncClient(client_config)
        print_info("SYSTEM", "HypersyncClient initialized.")
        yield
    finally:
        if app_state["hypersync_client"]:
            print_info("SYSTEM", "Closing HypersyncClient.")
        print_info("SYSTEM", "Application shutdown complete.")

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# --- Helper Print Functions ---
def print_red(msg, file=sys.stderr): print(f"\033[91mERROR: {msg}\033[0m", file=file, flush=True)
def print_yellow(msg, file=sys.stderr): print(f"\033[93mWARNING: {msg}\033[0m", file=file, flush=True)
def print_green(msg, file=sys.stdout): print(f"\033[92m{msg}\033[0m", file=file, flush=True)
def print_cyan(msg, file=sys.stdout): print(f"\033[96m{msg}\033[0m", file=file, flush=True)
def print_info(msg_prefix, message, file=sys.stderr): print(f"{msg_prefix.upper()} INFO: {message}", file=file, flush=True)

# ==========================================================
# === Generator 1: Cityscape Firehose Stream (TPS LOGIC FIXED)
# ==========================================================
async def cityscape_stream_generator(request: Request) -> AsyncGenerator[str, None]:
    hypersync_client = app_state["hypersync_client"]
    query = Query(
        from_block=0, # This will be set dynamically in the loop
        transactions=[TransactionSelection()],
        field_selection=FieldSelection(
            transaction=[TransactionField.HASH, TransactionField.VALUE, TransactionField.BLOCK_NUMBER, TransactionField.GAS_USED, TransactionField.GAS_PRICE],
            block=[BlockField.NUMBER, BlockField.TIMESTAMP]
        )
    )
    
    print_info("CITYSCAPE", "Starting stream with dynamic TPS calculation.")

    while True:
        try:
            if await request.is_disconnected():
                print_yellow("Cityscape client disconnected."); break
            
            # Dynamically set the block range for the query to get the last ~5 seconds of blocks
            current_height = await hypersync_client.get_height()
            # Assuming ~0.5s block times, 10 blocks is ~5 seconds.
            query.from_block = max(0, current_height - 10)
            query.to_block = current_height + 1 # +1 to make it inclusive

            response = await hypersync_client.get(query)
            
            tps = 0.0 # Default value
            if response.data and response.data.transactions and response.data.blocks and len(response.data.blocks) > 1:
                # --- NEW DYNAMIC TPS CALCULATION LOGIC ---
                total_transactions = len(response.data.transactions)
                
                # Get the timestamps of the first and last block in the batch
                timestamps = [int(b.timestamp, 16) for b in response.data.blocks if b.timestamp]
                min_ts = min(timestamps)
                max_ts = max(timestamps)
                
                # Calculate the actual time duration of the batch
                duration = max_ts - min_ts

                # Calculate TPS, avoiding division by zero
                if duration > 0:
                    tps = total_transactions / duration
                else:
                    # If all transactions happened in the same second, we can't get a rate,
                    # so we just show the count as the "rate" for that one second.
                    tps = total_transactions

                print_info("TPS_CALC", f"Batch TXs: {total_transactions}, Duration: {duration}s, Dynamic TPS: {tps:.2f}")

                # --- PAYLOAD PREPARATION (UNCHANGED) ---
                transactions_payload = [{"hash": tx.hash, "value": f"{(int(tx.value, 16) / 1e18):.4f}"} for tx in response.data.transactions]
                latest_block = max(response.data.blocks, key=lambda b: b.number)
                total_fees = sum((int(tx.gas_used, 16) * int(tx.gas_price, 16)) / 1e18 for tx in response.data.transactions if tx.gas_used and tx.gas_price)
                
                sse_payload = {
                    "transactions": transactions_payload,
                    "latest_block": {"number": latest_block.number, "timestamp": int(latest_block.timestamp, 16)},
                    "tps": tps, # Using the new dynamically calculated TPS
                    "total_fees_in_batch": total_fees
                }
                yield f"data: {json.dumps(sse_payload)}\n\n"

            # Sleep for the 5-second polling interval
            await asyncio.sleep(CITYSCAPE_POLLING_INTERVAL)

        except Exception as e:
            print_red(f"CITYSCAPE ERROR: {e}"); await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)

# ==========================================================
# === Generator 2: Derby Tracker Stream (UNCHANGED)
# ==========================================================
async def derby_stream_generator(request: Request) -> AsyncGenerator[str, None]:
    hypersync_client = app_state["hypersync_client"]
    
    # Register this connection
    connection_id = id(request)
    app_state["derby_connections"].add(connection_id)
    
    last_config_check = 0
    CONFIG_CHECK_INTERVAL = 10  # Check for config changes every 10 seconds
    
    try:
        while True:
            # Periodically refresh the configuration
            current_time = time.time()
            if current_time - last_config_check > CONFIG_CHECK_INTERVAL:
                current_config = DERBY_TRACKER_CONFIG.copy()
                last_config_check = current_time
                print_info("DERBY", f"Refreshed config. Now tracking: {list(current_config.keys())}")
            else:
                # Use the existing config for this iteration
                if 'current_config' not in locals():
                    current_config = DERBY_TRACKER_CONFIG.copy()
            
            all_addresses = [addr for entity_addrs in current_config.values() for addr in entity_addrs]
            address_to_dex = {addr.lower(): name for name, addrs in current_config.items() for addr in addrs}
            
            # No need for persistent timestamp tracking - we calculate TPS from each batch

            if not all_addresses:
                print_yellow("DERBY WARNING: No addresses to track. Stream will yield empty updates.")
                if await request.is_disconnected(): 
                    break
                yield f"data: {json.dumps({})}\\n\\n"
                await asyncio.sleep(DERBY_POLLING_INTERVAL)
                continue

            try:
                current_height = await hypersync_client.get_height()
                # Use a smaller window to avoid double-counting transactions
                # Get only the last ~4 seconds of blocks (about 8 blocks at 0.5s per block)
                start_block = max(0, current_height - 8)
            except Exception as e:
                print_red(f"DERBY ERROR: Failed to get initial block height: {e}")
                await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)
                continue

            query = Query(
                from_block=start_block,
                to_block=current_height + 1,  # Make it inclusive
                transactions=[TransactionSelection(to=all_addresses)],
                field_selection=FieldSelection(
                    block=[BlockField.NUMBER, BlockField.TIMESTAMP],
                    transaction=[TransactionField.TO, TransactionField.BLOCK_NUMBER]
                )
            )

            try:
                if await request.is_disconnected():
                    print_yellow("Derby client disconnected."); break
                
                response = await hypersync_client.get(query)
                
                payload = {}
                # Initialize all entities with 0 TPS
                for dex_name in current_config.keys():
                    payload[dex_name] = {"tps": 0.0}
                
                if response.data and response.data.transactions and response.data.blocks:
                    # Count transactions in this specific batch for each DEX
                    current_batch_counts = {}
                    for dex_name in current_config.keys():
                        current_batch_counts[dex_name] = 0
                    
                    block_timestamp_map = {b.number: int(b.timestamp, 16) for b in response.data.blocks if b.number and b.timestamp}
                    
                    # Count transactions to each DEX in this batch
                    for tx in response.data.transactions:
                        if tx.to and tx.block_number in block_timestamp_map:
                            dex_name = address_to_dex.get(tx.to.lower())
                            if dex_name:
                                current_batch_counts[dex_name] += 1
                    
                    # Calculate time span of this batch
                    if response.data.blocks and len(response.data.blocks) > 0:
                        timestamps = [int(b.timestamp, 16) for b in response.data.blocks if b.timestamp]
                        if len(timestamps) > 1:
                            time_span = max(timestamps) - min(timestamps)
                            if time_span > 0:
                                # Calculate TPS for this batch: transactions / time_span
                                for dex_name in current_config.keys():
                                    tx_count = current_batch_counts[dex_name]
                                    tps = tx_count / time_span
                                    payload[dex_name] = {"tps": tps}
                            else:
                                # All transactions in same second, use count as rate
                                for dex_name in current_config.keys():
                                    payload[dex_name] = {"tps": float(current_batch_counts[dex_name])}
                        else:
                            # Single block, use transaction count as approximation
                            for dex_name in current_config.keys():
                                payload[dex_name] = {"tps": float(current_batch_counts[dex_name])}
                
                # This will print the report for the entities in this specific connection
                print_derby_update(payload, list(current_config.keys()))
                yield f"data: {json.dumps(payload)}\n\n"

                # Don't use response.next_block - always query recent blocks
                
                await asyncio.sleep(DERBY_POLLING_INTERVAL)
            except Exception as e:
                print_red(f"DERBY ERROR: {e}"); await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)
    finally:
        app_state["derby_connections"].discard(connection_id)

def print_derby_update(payload: dict, entity_names: List[str]):
    report = "\n" + "="*60 + "\n--- PERPETUAL MONAD DERBY (Live Terminal View) ---\n"
    total_tps = 0
    # Sort by the provided entity names to maintain order
    for dex_name in sorted(entity_names):
        data = payload.get(dex_name, {"tps": 0})
        tps = data["tps"]
        report += f"{dex_name:<20}: {tps:.2f} TPS\n"; total_tps += tps
    report += "-"*60 + f"\n{'TOTAL':<20}: {total_tps:.2f} TPS\n" + "="*60
    print_green(report)

# ==========================================================
# === FastAPI Endpoints
# ==========================================================
@app.post("/update-derby-config")
async def update_derby_config(config_request: UpdateDerbyConfigRequest):
    global DERBY_TRACKER_CONFIG
    
    new_config = {entity.name: entity.addresses for entity in config_request.entities}
    
    if not new_config:
        print_yellow("DERBY_CONFIG: Received empty config. Resetting to default DEX contracts.")
        DERBY_TRACKER_CONFIG = {name: [address] for name, address in DEX_CONTRACTS.items()}
    else:
        DERBY_TRACKER_CONFIG = new_config

    print_info("DERBY_CONFIG", f"Updated Derby tracker config. Now tracking {len(DERBY_TRACKER_CONFIG)} entities.")
    # You might want to add validation for addresses here in a real application
    print_cyan(json.dumps(DERBY_TRACKER_CONFIG, indent=2))

    return {"status": "success", "message": "Derby configuration updated."}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "monad-visualizer"}

@app.get("/firehose-stream")
async def firehose_stream_endpoint(request: Request):
    return StreamingResponse(cityscape_stream_generator(request), media_type="text/event-stream")

@app.get("/derby-stream")
async def derby_stream_endpoint(request: Request):
    return StreamingResponse(derby_stream_generator(request), media_type="text/event-stream")

app.mount("/", StaticFiles(directory="static", html=True), name="static")

# ==========================================================
# === Main Runner (UNCHANGED)
# ==========================================================
if __name__ == "__main__":
    print_info("SYSTEM", f"Starting Uvicorn server on http://{HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
