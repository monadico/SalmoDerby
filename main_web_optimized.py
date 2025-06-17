import asyncio
import json
import os
import sys
import time
import traceback
from contextlib import asynccontextmanager
from collections import defaultdict, deque
from typing import List, Dict, Any

import hypersync
from hypersync import BlockField, TransactionField, TransactionSelection, ClientConfig, Query, FieldSelection
from dotenv import load_dotenv

# --- Configuration ---
load_dotenv()
MONAD_HYPERSYNC_URL = "https://monad-testnet.hypersync.xyz"
POLLING_INTERVAL_SECONDS = 2.0 
ERROR_RETRY_DELAY_SECONDS = 5
INITIAL_BOOTSTRAP_BLOCK_COUNT = 50
TPS_MEMORY_SECONDS = 10 # <-- THIS LINE WAS MISSING. IT IS NOW FIXED.

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

# --- Global State ---
hypersync_client: hypersync.HypersyncClient | None = None

# --- Helper Print Functions ---
def print_red(msg, file=sys.stderr): print(f"\033[91mERROR: {msg}\033[0m", file=file, flush=True)
def print_yellow(msg, file=sys.stderr): print(f"\033[93mWARNING: {msg}\033[0m", file=file, flush=True)
def print_green(msg, file=sys.stdout): print(f"\033[92m{msg}\033[0m", file=file, flush=True)
def print_cyan(msg, file=sys.stdout): print(f"\033[96m{msg}\033[0m", file=file, flush=True)
def print_info(msg_prefix, message, file=sys.stderr): print(f"{msg_prefix.upper()} INFO: {message}", file=file, flush=True)


# ==========================================================
# === PROCESS 1: Cityscape Firehose
# ==========================================================

async def run_cityscape_firehose():
    """
    Fetches ALL new transactions and prints a one-line summary for each.
    """
    print_info("CITYSCAPE", "Starting firehose stream...")
    
    try:
        current_height = await hypersync_client.get_height()
        start_block = max(0, current_height - 10)
    except Exception as e:
        print_red(f"CITYSCAPE ERROR: Failed to get initial block height: {e}")
        return

    query = Query(
        from_block=start_block, 
        transactions=[TransactionSelection()],
        field_selection=FieldSelection(
            transaction=[TransactionField.HASH, TransactionField.FROM, TransactionField.TO, TransactionField.VALUE]
        )
    )
    print_info("CITYSCAPE", f"Starting stream from block {start_block}")

    while True:
        try:
            response = await hypersync_client.get(query)
            if response.data and response.data.transactions:
                for tx in response.data.transactions:
                    value_in_eth = int(tx.value, 16) / 1e18 if tx.value else 0
                    print_cyan(f"[Cityscape TX] Hash: {tx.hash} | Value: {value_in_eth:.4f} MON")

            if response.next_block:
                query.from_block = response.next_block
            
            await asyncio.sleep(POLLING_INTERVAL_SECONDS)

        except Exception as e:
            print_red(f"CITYSCAPE ERROR: {e}")
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)


# ==========================================================
# === PROCESS 2: Derby Tracker
# ==========================================================

def print_derby_update(payload: dict):
    report = "\n" + "="*60 + "\n"
    report += "--- PERPETUAL MONAD DERBY (Live Terminal View) ---\n"
    report += f"Last updated: {time.strftime('%H:%M:%S')}\n"
    report += "-"*60 + "\n"
    
    total_tps = 0
    sorted_dexs = sorted(DEX_CONTRACTS.keys())
    for dex_name in sorted_dexs:
        dex_key = dex_name.lower().replace(' ', '-')
        data = payload.get(dex_key, {"tps": 0})
        tps = data["tps"]
        report += f"{dex_name:<20}: {tps} TPS\n"
        total_tps += tps

    report += "-"*60 + "\n"
    report += f"{'TOTAL':<20}: {total_tps} TPS\n"
    report += "="*60
    print_green(report)


async def run_derby_tracker():
    """
    Fetches transactions for the preset DEXs, calculates TPS, and prints a summary.
    """
    print_info("DERBY", "Starting tracker for preset DEXs...")

    dex_tx_timestamps = {dex_name: deque() for dex_name in DEX_CONTRACTS}
    dex_sample_hashes = {dex_name: "N/A" for dex_name in DEX_CONTRACTS}
    address_to_dex = {v.lower(): k for k, v in DEX_CONTRACTS.items()}
    
    tx_selections = [TransactionSelection(to=list(DEX_CONTRACTS.values()))]
    
    try:
        current_height = await hypersync_client.get_height()
        start_block = max(0, current_height - INITIAL_BOOTSTRAP_BLOCK_COUNT)
    except Exception as e:
        print_red(f"DERBY ERROR: Failed to get initial block height: {e}")
        return

    query = Query(
        from_block=start_block,
        transactions=tx_selections,
        field_selection=FieldSelection(
            block=[BlockField.NUMBER, BlockField.TIMESTAMP],
            transaction=[TransactionField.TO, TransactionField.BLOCK_NUMBER, TransactionField.HASH]
        )
    )
    print_info("DERBY", f"Starting tracker from block {start_block}")

    while True:
        try:
            response = await hypersync_client.get(query)
            
            latest_block_time = int(time.time())
            if response.data and response.data.blocks:
                timestamps_in_batch = [int(b.timestamp, 16) for b in response.data.blocks if b.timestamp]
                if timestamps_in_batch:
                    latest_block_time = max(timestamps_in_batch)

                block_timestamp_map = {b.number: int(b.timestamp, 16) for b in response.data.blocks if b.number and b.timestamp}

                for tx in response.data.transactions:
                    if tx.to and tx.block_number in block_timestamp_map:
                        dex_name = address_to_dex.get(tx.to.lower())
                        if dex_name:
                            timestamp = block_timestamp_map[tx.block_number]
                            dex_tx_timestamps[dex_name].append(timestamp)
                            if tx.hash:
                                dex_sample_hashes[dex_name] = tx.hash
            
            payload = {}
            for dex_name, timestamps in dex_tx_timestamps.items():
                while timestamps and timestamps[0] < latest_block_time - TPS_MEMORY_SECONDS:
                    timestamps.popleft()
                tps = sum(1 for ts in timestamps if ts >= latest_block_time - 1)
                dex_key = dex_name.lower().replace(' ', '-')
                payload[dex_key] = {"tps": tps, "hash": dex_sample_hashes[dex_name]}
            
            print_derby_update(payload)

            if response.next_block:
                query.from_block = response.next_block
            
            await asyncio.sleep(POLLING_INTERVAL_SECONDS)

        except Exception as e:
            print_red(f"DERBY ERROR: {e}")
            await asyncio.sleep(ERROR_RETRY_DELAY_SECONDS)


# ==========================================================
# === MAIN APPLICATION RUNNER
# ==========================================================
async def main():
    """
    Initializes the hypersync client and runs all processes concurrently.
    """
    print_info("SYSTEM", "Application starting up...")
    global hypersync_client
    bearer_token = os.environ.get("HYPERSYNC_BEARER_TOKEN")
    if not bearer_token:
        print_red("STARTUP: HYPERSYNC_BEARER_TOKEN environment variable not found.")
        return

    try:
        client_config = ClientConfig(url=MONAD_HYPERSYNC_URL, bearer_token=bearer_token)
        hypersync_client = hypersync.HypersyncClient(client_config)
        print_info("SYSTEM", "HypersyncClient initialized.")

        cityscape_task = asyncio.create_task(run_cityscape_firehose())
        derby_task = asyncio.create_task(run_derby_tracker())

        await asyncio.gather(cityscape_task, derby_task)

    except Exception as e:
        print_red(f"An error occurred during startup or while running tasks: {e}")
        traceback.print_exc()
    finally:
        if hypersync_client:
            print_info("SYSTEM", "Closing HypersyncClient.")
        print_info("SYSTEM", "Application shutdown complete.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print_yellow("\nSYSTEM: Keyboard interrupt received. Shutting down.")
