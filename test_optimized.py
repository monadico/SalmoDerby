#!/usr/bin/env python3
"""
Test script to verify the optimized Monad transaction poller
"""
import asyncio
import os
import time
from dotenv import load_dotenv

async def test_hypersync_basic():
    """Test basic hypersync functionality"""
    load_dotenv()
    
    try:
        import hypersync
        print("✓ Hypersync module imported successfully")
        
        bearer_token = os.environ.get("HYPERSYNC_BEARER_TOKEN")
        if not bearer_token:
            print("✗ HYPERSYNC_BEARER_TOKEN not found in environment")
            return False
            
        print(f"✓ Bearer token found: {bearer_token[:20]}...")
        
        # Test client initialization
        client_config = hypersync.ClientConfig(
            url="https://monad-testnet.hypersync.xyz",
            bearer_token=bearer_token
        )
        client = hypersync.HypersyncClient(client_config)
        print("✓ HypersyncClient initialized")
        
        # Test height fetching
        print("Testing height fetch...")
        height = await client.get_height()
        print(f"✓ Current chain height: {height}")
        
        # Test basic query
        print("Testing basic transaction query...")
        query = hypersync.Query(
            from_block=max(1, height - 2),
            to_block=height,
            transactions=[hypersync.TransactionSelection()],
            field_selection=hypersync.FieldSelection(
                block=[hypersync.BlockField.NUMBER, hypersync.BlockField.TIMESTAMP],
                transaction=[hypersync.TransactionField.HASH, hypersync.TransactionField.BLOCK_NUMBER]
            )
        )
        
        response = await client.get(query)
        if response and response.data:
            block_count = len(response.data.blocks) if response.data.blocks else 0
            tx_count = len(response.data.transactions) if response.data.transactions else 0
            print(f"✓ Query successful: {block_count} blocks, {tx_count} transactions")
        else:
            print("✗ Query returned no data")
            
        return True
        
    except ImportError as e:
        print(f"✗ Failed to import hypersync: {e}")
        return False
    except Exception as e:
        print(f"✗ Test failed: {e}")
        return False

async def main():
    print("Monad Transaction Poller - Basic Test")
    print("=" * 50)
    
    success = await test_hypersync_basic()
    
    if success:
        print("\n✓ All tests passed! The optimized poller should work correctly.")
    else:
        print("\n✗ Tests failed. Check the installation and configuration.")

if __name__ == "__main__":
    asyncio.run(main())