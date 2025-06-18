import asyncio
import json
import os
import sys
import time
import traceback
import uvicorn
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Dict, Any, List
from collections import defaultdict, deque

import hypersync
from hypersync import BlockField, TransactionField, TransactionSelection, ClientConfig, Query, FieldSelection
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# --- Configuration ---
load_dotenv()
MONAD_HYPERSYNC_URL = os.getenv("MONAD_HYPERSYNC_URL", "https://monad-testnet.hypersync.xyz")
HYPERSYNC_BEARER_TOKEN = os.getenv("HYPERSYNC_BEARER_TOKEN")
POLLING_INTERVAL_SECONDS = float(os.getenv("POLLING_INTERVAL_SECONDS", 2.0))
ERROR_RETRY_DELAY_SECONDS = int(os.getenv("ERROR_RETRY_DELAY_SECONDS", 5))
TPS_MEMORY_SECONDS = 10

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
# === DATA STREAM GENERATOR 1: Cityscape Firehose (UNCHANGED)
# ==========================================================
async def cityscape_data_generator(request: Request) -> AsyncGenerator[str, None]:
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
            block=[BlockField.NUMBER, BlockField.TIMESTAMP]
        )
    )
    print_info("CITYSCAPE", f"Starting new firehose stream from block {start_block}")

    while True:
        try:
            if await request.is_disconnected():
                print_yellow("Client disconnected from cityscape.")
                break

            response = await hypersync_client.get(query)

            if response.data:
                latest_block_info = {"number": 0, "timestamp": 0, "transaction_count": 0}
                tx_counts_per_block = defaultdict(int)

                if response.data.transactions:
                    for tx in response.data.transactions:
                        if tx.block_number is not None:
                            tx_counts_per_block[tx.block_number] += 1
                
                if response.data.blocks:
                    latest_block_in_batch = max(response.data.blocks, key=lambda b: b.number)
                    latest_block_info["number"] = latest_block_in_batch.number
                    latest_block_info["timestamp"] = int(latest_block_in_batch.timestamp, 16)
                    latest_block_info["transaction_count"] = tx_counts_per_block.get(latest_block_in_batch.number, 0)
                
                transactions_in_batch = []
                total_fee_in_batch = 0
                if response.data.transactions:
                    for tx in response.data.transactions:
                        value_in_eth = int(tx.value, 16) / 1e18 if tx.value else 0
                        gas_used = int(tx.gas_used, 16) if tx.gas_used else 0
                        gas_price = int(tx.gas_price, 16) if tx.gas_price else 0
                        total_fee_in_batch += (gas_used * gas_price) / 1e18
                        transactions_in_batch.append({"hash": tx.hash, "value": f"{value_in_eth:.4f}"})

                tps = len(transactions_in_batch) / POLLING_INTERVAL_SECONDS

                sse_payload = {
                    "transactions": transactions_in_batch,
                    "latest_block": latest_block_info,
                    "tps": tps,
                    "total_fees_in_batch": total_fee_in_batch,
                }
                
                print_cyan(
                    f"[CITYSCAPE BATCH] Latest Block: {latest_block_info['number']} | "
                    f"TXs in Latest Block: {latest_block_info['transaction_count']:<3} | "
                    f"Total TXs in this Batch: {len(transactions_in_batch):<4}"
                )
                yield f"data: {json.dumps(sse_payload)}\n\n"

            if response.next_block:
                query.from_block = response.next_block
            
            await asyncio.sleep(POLLING_INTERVAL_SECONDS)
        except Exception as e:
            print_red(f"CITYSCAPE GEN_ERROR: {e}\n{traceback.format_exc()}")
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)


# ==========================================================
# === DATA STREAM GENERATOR 2: Perpetual Derby (NEW)
# ==========================================================

async def get_contracts_deployed_by(deployer_address: str) -> List[str]:
    hypersync_client = app_state["hypersync_client"]
    print_info("DERBY", f"Querying for contracts deployed by {deployer_address}")
    try:
        query = Query(
            from_block=0,
            transactions=[TransactionSelection(from_=[deployer_address])],
            field_selection=FieldSelection(transaction=[TransactionField.FROM, TransactionField.TO, TransactionField.RECEIPT_CONTRACT_ADDRESS])
        )
        response = await hypersync_client.get(query)
        deployed_contracts = [tx.receipt_contract_address for tx in response.data.transactions if tx.to is None and tx.receipt_contract_address]
        print_info("DERBY", f"Found {len(deployed_contracts)} contracts for deployer {deployer_address}.")
        return deployed_contracts
    except Exception as e:
        print_red(f"Failed to get deployed contracts for {deployer_address}: {e}")
        return []

async def build_dynamic_query(config: List[Dict[str, Any]]) -> List[TransactionSelection]:
    tx_selections = []
    for entity in config:
        addresses_str = entity.get("addresses", "")
        addresses = [addr.strip().lower() for addr in addresses_str.replace(",", " ").split() if addr.strip()]
        if not addresses: continue

        criteria = entity.get("criteria")
        if criteria == "to":
            tx_selections.append(TransactionSelection(to=addresses))
        elif criteria == "from":
            tx_selections.append(TransactionSelection(from_=addresses))
        elif criteria == "both":
            tx_selections.append(TransactionSelection(to=addresses))
            tx_selections.append(TransactionSelection(from_=addresses))
        elif criteria == "deployer" and addresses:
            deployed_contracts = await get_contracts_deployed_by(addresses[0])
            if deployed_contracts:
                tx_selections.append(TransactionSelection(to=deployed_contracts))
    return tx_selections

async def derby_data_generator(request: Request) -> AsyncGenerator[str, None]:
    hypersync_client = app_state["hypersync_client"]
    config_str = request.query_params.get('config', '[]')
    try:
        config = json.loads(config_str)
        if not isinstance(config, list): raise ValueError("Config must be a list.")
    except (json.JSONDecodeError, ValueError) as e:
        print_red(f"DERBY GEN_ERROR: Invalid config provided: {e}")
        return

    tx_selections = await build_dynamic_query(config)
    if not tx_selections:
        print_yellow("DERBY: No valid entities to track in the provided config.")
        return

    entity_timestamps = {f"entity-{i}": deque() for i in range(len(config))}
    entity_hashes = {f"entity-{i}": "N/A" for i in range(len(config))}
    
    address_to_entity_map = {}
    for i, entity in enumerate(config):
        entity_id = f"entity-{i}"
        addresses = [addr.strip().lower() for addr in entity.get("addresses", "").replace(",", " ").split() if addr.strip()]
        for addr in addresses:
            address_to_entity_map[addr] = entity_id

    try:
        current_height = await hypersync_client.get_height()
        start_block = max(0, current_height - 100)
    except Exception as e:
        print_red(f"DERBY GEN_ERROR: Failed to get initial block height: {e}")
        return

    query = Query(
        from_block=start_block,
        transactions=tx_selections,
        field_selection=FieldSelection(
            block=[BlockField.NUMBER, BlockField.TIMESTAMP],
            transaction=[TransactionField.FROM, TransactionField.TO, TransactionField.BLOCK_NUMBER, TransactionField.HASH]
        )
    )
    print_info("DERBY", f"Starting new derby stream from block {start_block}")

    while True:
        try:
            if await request.is_disconnected():
                print_yellow("Client disconnected from derby.")
                break

            response = await hypersync_client.get(query)
            
            latest_block_time = int(time.time())
            if response.data and response.data.blocks:
                timestamps_in_batch = [int(b.timestamp, 16) for b in response.data.blocks if b.timestamp]
                if timestamps_in_batch:
                    latest_block_time = max(timestamps_in_batch)

                block_timestamp_map = {b.number: int(b.timestamp, 16) for b in response.data.blocks if b.number and b.timestamp}

                for tx in response.data.transactions:
                    if tx.block_number in block_timestamp_map:
                        matched_entity_id = address_to_entity_map.get(tx.to.lower()) if tx.to else None
                        if not matched_entity_id and tx.from_:
                            matched_entity_id = address_to_entity_map.get(tx.from_.lower())
                        
                        if matched_entity_id:
                            timestamp = block_timestamp_map[tx.block_number]
                            entity_timestamps[matched_entity_id].append(timestamp)
                            if tx.hash:
                                entity_hashes[matched_entity_id] = tx.hash
            
            payload = {}
            for entity_id, timestamps in entity_timestamps.items():
                while timestamps and timestamps[0] < latest_block_time - TPS_MEMORY_SECONDS:
                    timestamps.popleft()
                tps = sum(1 for ts in timestamps if ts >= latest_block_time - 1)
                payload[entity_id] = {"tps": tps, "hash": entity_hashes[entity_id]}

            yield f"data: {json.dumps(payload)}\n\n"

            if response.next_block:
                query.from_block = response.next_block
            await asyncio.sleep(POLLING_INTERVAL_SECONDS)

        except Exception as e:
            print_red(f"DERBY GEN_ERROR: {e}\n{traceback.format_exc()}")
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)


# ==========================================================
# === FASTAPI ENDPOINTS
# ==========================================================

@app.get("/firehose-stream")
async def firehose_stream_endpoint(request: Request):
    return StreamingResponse(cityscape_data_generator(request), media_type="text/event-stream")

@app.get("/derby-stream")
async def derby_stream_endpoint(request: Request):
    config = request.query_params.get('config')
    if not config:
        raise HTTPException(status_code=400, detail="Missing 'config' query parameter.")
    return StreamingResponse(derby_data_generator(request), media_type="text/event-stream")

app.mount("/", StaticFiles(directory="static", html=True), name="static")


# ==========================================================
# === MAIN EXECUTION SCRIPT
# ==========================================================
if __name__ == "__main__":
    print_info("SYSTEM", f"Starting server on http://{HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
