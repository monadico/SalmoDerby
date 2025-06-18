import asyncio
import json
import os
import random
import string
import time
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

# --- Configuration ---
TARGET_TPS = 10000
# How often to send a batch of data, in seconds.
# A smaller interval means smaller batches but more frequent updates.
SEND_INTERVAL = 0.1 
# Number of transactions to include in each batch to meet the target TPS
TRANSACTIONS_PER_BATCH = int(TARGET_TPS * SEND_INTERVAL)

##: Configuration for the web server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8001)) # Running on a different port to avoid conflict

# --- FastAPI App Initialization ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all origins for easy testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Helper Functions ---
def generate_fake_hash() -> str:
    """Generates a random 66-character hex string to mimic a transaction hash."""
    return "0x" + ''.join(random.choices(string.hexdigits.lower(), k=64))

def print_cyan(msg: str):
    print(f"\033[96m{msg}\033[0m", flush=True)

# ==========================================================
# === 10k TPS Stress Test Generator
# ==========================================================
async def tps_stress_test_generator(request: Request) -> AsyncGenerator[str, None]:
    """
    This generator continuously creates and sends batches of fake transaction data
    at a rate that simulates 10,000 TPS.
    """
    print(f"Starting 10k TPS stress test.")
    print(f"Sending {TRANSACTIONS_PER_BATCH} transactions every {SEND_INTERVAL} seconds.")
    
    block_number = 22000000 # Starting block number
    
    while True:
        try:
            if await request.is_disconnected():
                print("Client disconnected. Stopping stress test.")
                break

            start_time = time.monotonic()

            transactions_payload = [
                {"hash": generate_fake_hash(), "value": f"{random.uniform(0.1, 100):.4f}"}
                for _ in range(TRANSACTIONS_PER_BATCH)
            ]

            sse_payload = {
                "transactions": transactions_payload,
                "latest_block": {
                    "number": block_number,
                    "timestamp": int(time.time()),
                    "transaction_count": TRANSACTIONS_PER_BATCH
                },
                "tps": float(TARGET_TPS),
                "total_fees_in_batch": random.uniform(0.01, 0.5)
            }

            yield f"data: {json.dumps(sse_payload)}\n\n"
            
            block_number += 1
            
            end_time = time.monotonic()
            elapsed_time = end_time - start_time
            sleep_duration = max(0, SEND_INTERVAL - elapsed_time)
            
            await asyncio.sleep(sleep_duration)

        except asyncio.CancelledError:
            print("Stress test generator cancelled."); break
        except Exception as e:
            print(f"An error occurred in the stress test generator: {e}"); break

# ==========================================================
# === FastAPI Endpoint
# ==========================================================
@app.get("/tps-stress-test")
async def tps_stress_test_endpoint(request: Request):
    """The endpoint your frontend will connect to for the test."""
    return StreamingResponse(tps_stress_test_generator(request), media_type="text/event-stream")

# This will serve your index.html and other frontend files
app.mount("/", StaticFiles(directory="static", html=True), name="static")

# ==========================================================
# === Main Runner
# ==========================================================
if __name__ == "__main__":
    print(f"Starting TPS Stress Test Simulator on http://{HOST}:{PORT}")
    print("Connect your frontend to the /tps-stress-test endpoint.")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
