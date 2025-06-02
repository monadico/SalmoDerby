
import asyncio
import json
import time
import requests
import sys
import aiohttp
import statistics
from datetime import datetime

class MonadVisualizerTester:
    def __init__(self, base_url="http://localhost:8000"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.transaction_batches = []
        self.transaction_timestamps = []
        self.transaction_gaps = []
        self.test_duration_seconds = 180  # 3 minutes

    async def test_sse_stream(self):
        """Test the SSE transaction stream endpoint"""
        print(f"\n🔍 Testing SSE Transaction Stream...")
        self.tests_run += 1
        
        url = f"{self.base_url}/transaction-stream"
        print(f"Connecting to SSE stream at {url}")
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as response:
                    if response.status != 200:
                        print(f"❌ Failed - Expected 200, got {response.status}")
                        return False
                    
                    print(f"✅ Connected to SSE stream with status {response.status}")
                    
                    # Set up counters and timers
                    start_time = time.time()
                    batch_count = 0
                    transaction_count = 0
                    last_batch_time = None
                    
                    # Process the SSE stream
                    async for line in response.content:
                        line = line.decode('utf-8').strip()
                        
                        # Check for end of test duration
                        if time.time() - start_time > self.test_duration_seconds:
                            print(f"✅ Test duration of {self.test_duration_seconds} seconds reached")
                            break
                            
                        # Skip empty lines and keep-alive comments
                        if not line or line.startswith(':'):
                            continue
                            
                        # Check for event line
                        if line.startswith('event:'):
                            event_name = line.split(':', 1)[1].strip()
                            if event_name != "new_transactions_batch":
                                print(f"⚠️ Unexpected event name: {event_name}")
                                
                        # Check for data line
                        elif line.startswith('data:'):
                            current_time = time.time()
                            data_content = line.split(':', 1)[1].strip()
                            
                            try:
                                batch_data = json.loads(data_content)
                                
                                if not isinstance(batch_data, list):
                                    print(f"⚠️ Expected batch data to be a list, got {type(batch_data)}")
                                    continue
                                    
                                batch_count += 1
                                transaction_count += len(batch_data)
                                
                                # Record timestamp for TPS calculation
                                self.transaction_timestamps.append((current_time, len(batch_data)))
                                
                                # Calculate gap between batches
                                if last_batch_time:
                                    gap = current_time - last_batch_time
                                    self.transaction_gaps.append(gap)
                                    
                                    # Alert on large gaps (potential stalls)
                                    if gap > 1.0:  # 1 second gap threshold
                                        print(f"⚠️ Gap of {gap:.2f}s detected between batches")
                                        
                                last_batch_time = current_time
                                
                                # Validate transaction data format for the first transaction in each batch
                                if batch_count <= 3 and batch_data:  # Only log first 3 batches
                                    first_tx = batch_data[0]
                                    print(f"Sample transaction data (batch {batch_count}):")
                                    print(f"  - hash: {first_tx.get('hash', 'MISSING')}")
                                    print(f"  - value: {first_tx.get('value', 'MISSING')}")
                                    print(f"  - block_number: {first_tx.get('block_number', 'MISSING')}")
                                    print(f"  - from: {first_tx.get('from', 'MISSING')}")
                                    print(f"  - to: {first_tx.get('to', 'MISSING')}")
                                    print(f"  - gas: {first_tx.get('gas', 'MISSING')}")
                                    print(f"  - transaction_index: {first_tx.get('transaction_index', 'MISSING')}")
                                
                                # Check required fields in all transactions
                                for tx in batch_data:
                                    required_fields = ['hash', 'value', 'block_number', 'from', 'to', 'gas', 'transaction_index']
                                    missing_fields = [field for field in required_fields if field not in tx]
                                    if missing_fields:
                                        print(f"⚠️ Transaction missing required fields: {missing_fields}")
                                
                                # Store batch for later analysis
                                self.transaction_batches.append(batch_data)
                                
                                # Print progress every 10 batches
                                if batch_count % 10 == 0:
                                    elapsed = current_time - start_time
                                    tps = transaction_count / elapsed if elapsed > 0 else 0
                                    print(f"Progress: {batch_count} batches, {transaction_count} transactions, {tps:.1f} TPS")
                                    
                            except json.JSONDecodeError as e:
                                print(f"❌ Failed to parse JSON data: {e}")
                                print(f"Raw data: {data_content[:100]}...")
                    
                    # Calculate final statistics
                    end_time = time.time()
                    total_time = end_time - start_time
                    
                    if batch_count == 0:
                        print("❌ No transaction batches received")
                        return False
                        
                    print("\n📊 SSE Stream Test Results:")
                    print(f"  - Test duration: {total_time:.2f} seconds")
                    print(f"  - Total batches: {batch_count}")
                    print(f"  - Total transactions: {transaction_count}")
                    print(f"  - Average TPS: {transaction_count / total_time:.2f}")
                    
                    if self.transaction_gaps:
                        avg_gap = sum(self.transaction_gaps) / len(self.transaction_gaps)
                        max_gap = max(self.transaction_gaps)
                        print(f"  - Average gap between batches: {avg_gap:.3f}s")
                        print(f"  - Maximum gap between batches: {max_gap:.3f}s")
                        
                        # Count gaps over thresholds
                        gaps_over_500ms = sum(1 for gap in self.transaction_gaps if gap > 0.5)
                        gaps_over_1s = sum(1 for gap in self.transaction_gaps if gap > 1.0)
                        print(f"  - Gaps > 500ms: {gaps_over_500ms} ({gaps_over_500ms/len(self.transaction_gaps)*100:.1f}%)")
                        print(f"  - Gaps > 1s: {gaps_over_1s} ({gaps_over_1s/len(self.transaction_gaps)*100:.1f}%)")
                    
                    # Calculate batch sizes
                    batch_sizes = [len(batch) for batch in self.transaction_batches]
                    if batch_sizes:
                        avg_batch_size = sum(batch_sizes) / len(batch_sizes)
                        max_batch_size = max(batch_sizes)
                        print(f"  - Average batch size: {avg_batch_size:.1f} transactions")
                        print(f"  - Maximum batch size: {max_batch_size} transactions")
                    
                    # Test is successful if we received transactions and there were no major gaps
                    success = transaction_count > 0 and (not self.transaction_gaps or max(self.transaction_gaps) < 5.0)
                    if success:
                        self.tests_passed += 1
                        print("✅ SSE Stream Test PASSED")
                    else:
                        print("❌ SSE Stream Test FAILED")
                    
                    return success
                    
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False

    def test_main_page(self):
        """Test the main page endpoint"""
        print(f"\n🔍 Testing Main Page...")
        self.tests_run += 1
        
        url = f"{self.base_url}/"
        
        try:
            response = requests.get(url)
            
            if response.status_code != 200:
                print(f"❌ Failed - Expected 200, got {response.status_code}")
                return False
                
            content = response.text
            
            # Check for key HTML elements
            required_elements = [
                'id="starCanvas"',
                'id="tps-counter"',
                'id="performance-counter"',
                'src="/static/script.js"'
            ]
            
            missing_elements = [elem for elem in required_elements if elem not in content]
            
            if missing_elements:
                print(f"❌ Missing required HTML elements: {missing_elements}")
                return False
                
            print(f"✅ Main page loaded successfully with all required elements")
            self.tests_passed += 1
            return True
            
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False

async def main():
    tester = MonadVisualizerTester("http://localhost:8000")
    
    # Test the main page
    main_page_success = tester.test_main_page()
    
    # Test the SSE stream
    sse_success = await tester.test_sse_stream()
    
    # Print overall results
    print(f"\n📊 Tests passed: {tester.tests_passed}/{tester.tests_run}")
    
    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    asyncio.run(main())
