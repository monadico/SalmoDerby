# derby_server.py
import asyncio
import json
import os
import sys
import time
import traceback
import uvicorn
from contextlib import asynccontextmanager
from collections import defaultdict, deque
from typing import List, Dict, Any

import hypersync
from hypersync import BlockField, TransactionField, TransactionSelection, ClientConfig, Query, FieldSelection
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# --- Configuration ---
load_dotenv()
MONAD_HYPERSYNC_URL = "https://monad-testnet.hypersync.xyz"
POLLING_INTERVAL_SECONDS = 1.0
ERROR_RETRY_DELAY_SECONDS = 5
INITIAL_BOOTSTRAP_BLOCK_COUNT = 200
TPS_MEMORY_SECONDS = 10

# --- Global State ---
hypersync_client: hypersync.HypersyncClient | None = None

# --- Helper Print Functions ---
def print_general_red(msg, file=sys.stderr): print(f"\033[91mERROR: {msg}\033[0m", file=file, flush=True)
def print_general_yellow(msg, file=sys.stderr): print(f"\033[93mWARNING: {msg}\033[0m", file=file, flush=True)
def print_general_info(msg_prefix, message, file=sys.stderr): print(f"{msg_prefix.upper()} INFO: {message}", file=file, flush=True)


# ==========================================================
# === DYNAMIC QUERY & POLLING LOGIC
# ==========================================================

async def get_contracts_deployed_by(deployer_address: str) -> List[str]:
    """
    Performs a pre-query to find all contract addresses created by a deployer.
    """
    print_general_info("DEPLOYER_QUERY", f"Fetching contracts deployed by {deployer_address}...")
    try:
        query = Query(
            from_block=0,
            transactions=[TransactionSelection(from_=[deployer_address])],
            field_selection=FieldSelection(
                transaction=[TransactionField.FROM, TransactionField.TO, TransactionField.RECEIPT_CONTRACT_ADDRESS]
            )
        )
        response = await hypersync_client.get(query)
        
        # A contract creation tx is one where the 'to' field is null, and a contract address is in the receipt.
        deployed_contracts = [
            tx.receipt_contract_address
            for tx in response.data.transactions
            if tx.to is None and tx.receipt_contract_address
        ]
        print_general_info("DEPLOYER_QUERY", f"Found {len(deployed_contracts)} contracts for {deployer_address}.")
        return deployed_contracts
    except Exception as e:
        print_general_red(f"Failed to get deployed contracts for {deployer_address}: {e}")
        return []

async def build_dynamic_query(config: List[Dict[str, Any]]) -> List[TransactionSelection]:
    """
    Builds a list of TransactionSelection objects based on the user's config.
    """
    tx_selections = []
    for entity in config:
        addresses_str = entity.get("addresses", "")
        # Sanitize addresses: split by comma/space, trim whitespace, and filter out empty strings.
        addresses = [addr.strip().lower() for addr in addresses_str.replace(",", " ").split() if addr.strip()]
        if not addresses:
            continue

        criteria = entity.get("criteria")
        
        if criteria == "to":
            tx_selections.append(TransactionSelection(to=addresses))
        elif criteria == "from":
            tx_selections.append(TransactionSelection(from_=addresses))
        elif criteria == "both":
            tx_selections.append(TransactionSelection(to=addresses))
            tx_selections.append(TransactionSelection(from_=addresses))
        elif criteria == "deployer":
            # This assumes the user inputs ONE deployer address for this option.
            if addresses:
                deployed_contracts = await get_contracts_deployed_by(addresses[0])
                if deployed_contracts:
                    tx_selections.append(TransactionSelection(to=deployed_contracts))

    return tx_selections

async def derby_data_generator(request: Request):
    """
    This is the main, per-client worker. It parses the config, builds a query,
    and runs an independent polling loop for this specific client.
    """
    # 1. Parse config from URL
    config_str = request.query_params.get('config', '[]')
    try:
        config = json.loads(config_str)
        if not isinstance(config, list): raise ValueError("Config must be a list.")
    except (json.JSONDecodeError, ValueError) as e:
        print_general_red(f"Invalid config provided: {e}")
        return

    # 2. Build the dynamic hypersync query
    tx_selections = await build_dynamic_query(config)
    if not tx_selections:
        print_general_yellow("No valid entities to track in the provided config.")
        return

    # 3. Set up state for THIS client's race
    entity_timestamps = {f"entity-{i}": deque() for i in range(len(config))}
    entity_hashes = {f"entity-{i}": "N/A" for i in range(len(config))}
    
    # Create a reverse mapping from address to entity index for this specific config
    address_to_entity_map = {}
    for i, entity in enumerate(config):
        entity_id = f"entity-{i}"
        addresses = [addr.strip().lower() for addr in entity.get("addresses", "").replace(",", " ").split() if addr.strip()]
        for addr in addresses:
            # This simple map might have collisions if addresses are in multiple entities, but it's okay for this purpose.
            address_to_entity_map[addr] = entity_id

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
            transaction=[TransactionField.FROM, TransactionField.TO, TransactionField.BLOCK_NUMBER, TransactionField.HASH]
        )
    )

    # 4. Start the polling loop for this client
    while True:
        if await request.is_disconnected():
            print_general_yellow("Client disconnected, stopping their polling loop.")
            break
        
        try:
            response = await hypersync_client.get(query)
            
            latest_block_time = int(time.time())
            if response.data and response.data.blocks:
                timestamps_in_batch = [int(b.timestamp, 16) for b in response.data.blocks if b.timestamp]
                if timestamps_in_batch:
                    latest_block_time = max(timestamps_in_batch)

                block_timestamp_map = {b.number: int(b.timestamp, 16) for b in response.data.blocks if b.number and b.timestamp}

                for tx in response.data.transactions:
                    if tx.block_number in block_timestamp_map:
                        # Determine which entity this transaction belongs to
                        # This is a simplified check; a tx could match multiple entities.
                        # We just assign it to the first one it matches.
                        matched_entity_id = None
                        if tx.to and tx.to.lower() in address_to_entity_map:
                            matched_entity_id = address_to_entity_map[tx.to.lower()]
                        elif tx.from_ and tx.from_.lower() in address_to_entity_map:
                            matched_entity_id = address_to_entity_map[tx.from_.lower()]
                        
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

            sse_message = f"data: {json.dumps(payload)}\n\n"
            yield sse_message

            if response.next_block:
                query.from_block = response.next_block
            await asyncio.sleep(POLLING_INTERVAL_SECONDS)

        except Exception as e:
            print_general_red(f"Error in client polling loop: {e}")
            break

# ==========================================================
# === FASTAPI APP SETUP
# ==========================================================
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
        # The client is shared across all requests
        client_config = ClientConfig(url=MONAD_HYPERSYNC_URL, bearer_token=bearer_token)
        hypersync_client = hypersync.HypersyncClient(client_config)
        print_general_info("STARTUP", "HypersyncClient initialized.")
    except Exception as e:
        print_general_red(f"STARTUP: Failed to initialize client: {e}")
    yield
    print_general_info("SHUTDOWN", "FastAPI application shutdown complete.")

app = FastAPI(title="Monad DEX Derby API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_root():
    return FileResponse('static/index.html')

@app.get("/derby-data")
async def sse_derby_data(request: Request):
    """
    Streams live data based on the 'config' query parameter.
    """
    config = request.query_params.get('config')
    if not config:
        raise HTTPException(status_code=400, detail="Missing 'config' query parameter.")
    return StreamingResponse(derby_data_generator(request), media_type="text/event-stream")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    module_name = os.path.splitext(os.path.basename(__file__))[0]
    print_general_info("SYSTEM", f"Starting Uvicorn server on http://127.0.0.1:{port}")
    uvicorn.run(f"{module_name}:app", host="0.0.0.0", port=port, reload=True)
