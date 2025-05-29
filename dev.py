import hypersync
import asyncio
import os
from dotenv import load_dotenv
import time
import traceback
from hypersync import TransactionField, BlockField


MONAD_HYPERSYNC_URL = "https://monad-testnet.hypersync.xyz"
POLL_INTERVAL_SECONDS = 0.04

async def poll_live_monad_transactions():
    load_dotenv()
    print("Monad Live Transaction Poller (Tip-of-Chain Correctness)")
    print(f"Targeting URL: {MONAD_HYPERSYNC_URL}")

    bearer_token = os.environ.get("HYPERSYNC_BEARER_TOKEN")
    if not bearer_token:
        print("\033[91mCRITICAL: HYPERSYNC_BEARER_TOKEN is not set. Please set it in your .env file.\033[0m")
        return

    try:
        client_config = hypersync.ClientConfig(
            url=MONAD_HYPERSYNC_URL,
            bearer_token=bearer_token
        )
        client = hypersync.HypersyncClient(client_config)
        print("HypersyncClient initialized.")
    except Exception as e:
        print(f"Fatal Error during HypersyncClient initialization: {type(e).__name__}: {e}")
        traceback.print_exc()
        return

    last_block_number = None
    last_block_hash = None

    while True:
        try:
            latest_block_number = await client.get_height()
            if last_block_number is not None and latest_block_number <= last_block_number:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                continue
            
            query = hypersync.Query(
                  from_block=latest_block_number,
                  blocks=[{}], # selects all blocks
                  transactions=[{}], # selects all transactions // NOTE: instead of this, we could just select all blocks and use `join_mode: "JoinAll"` (see docs: https://docs.envio.dev/docs/HyperSync/hypersync-query#joinall-mode)
                  field_selection=hypersync.FieldSelection(
                      transaction=[
                          TransactionField.HASH,
                          TransactionField.FROM,
                          TransactionField.TO,
                          TransactionField.VALUE,
                          TransactionField.INPUT,
                          TransactionField.BLOCK_NUMBER,
                      ],
                      block=[
                          BlockField.NUMBER,
                          BlockField.TIMESTAMP,
                          BlockField.HASH,
                      ]
                  ),
                  # join_mode="JoinAll" # Can be used instead of `transactions=[{}]` - depends on your usecase.
              )

            # Fetch the latest block (replace with correct SDK method if needed)
            res = await client.get(query)

            print(res.data.blocks)
            print(res.data.transactions)

            # Group all transactions and blocks together into a single object (each block should have an array of transactions in it)
            blocks_with_transactions = {}
            
            # First, create a dictionary of blocks indexed by block number
            for block in res.data.blocks:
                block_number = int(block.number, 16) if isinstance(block.number, str) else block.number
                blocks_with_transactions[block_number] = {
                    'block': block,
                    'transactions': []
                }
            
            # Then, add transactions to their respective blocks
            for tx in res.data.transactions:
                tx_block_number = int(tx.block_number, 16) if isinstance(tx.block_number, str) else tx.block_number
                if tx_block_number in blocks_with_transactions:
                    blocks_with_transactions[tx_block_number]['transactions'].append(tx)

            # Process each block with its transactions
            for block_number, data in blocks_with_transactions.items():
                block = data['block']
                transactions = data['transactions']
                
                if block is None:
                    print(f"\033[93mNo block found at height {latest_block_number}\033[0m")
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)
                    continue

                # Rollback detection: compare parent hash
                if last_block_hash is not None and hasattr(block, 'parent_hash') and block.parent_hash != last_block_hash:
                    print(f"\033[91mChain reorg detected at block {block_number}!\033[0m")
                    # Handle rollback logic here (e.g., reprocess previous block)
                    # For now, just warn and proceed

                # Convert hex timestamp to int if needed
                timestamp = int(block.timestamp, 16) if isinstance(block.timestamp, str) else block.timestamp
                block_hash = block.hash
                
                print(f"--- Block {block_number} (Timestamp: {timestamp}) ---")
                last_block_number = block_number
                last_block_hash = block_hash

                # Process transactions in the block
                if transactions:
                    for tx in transactions:
                        print(f"  Hash: {tx.hash}, Value: {tx.value} (block {tx.block_number})")
                else:
                    print("  No transactions in this block.")

        except Exception as e:
            print(f"\033[91mError in polling loop: {type(e).__name__}: {e}\033[0m")
            traceback.print_exc()

        await asyncio.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    print("Monad Live Transaction Poller (Tip-of-Chain Correctness)")
    asyncio.run(poll_live_monad_transactions())
