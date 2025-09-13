#!/usr/bin/env python3
"""
Stock Market Simulator Backend Test Suite
Tests all REST API endpoints and WebSocket functionality
Usage: python test_backend.py
"""

import asyncio
import json
import time
import sys
import threading
from datetime import datetime
from typing import List, Dict, Any
import argparse

# Required packages - install with: pip install requests socketio colorama
try:
    import requests
    import socketio
    from colorama import Fore, Back, Style, init
except ImportError as e:
    print(f"Missing required package: {e}")
    print("Install with: pip install requests python-socketio colorama")
    sys.exit(1)

# Initialize colorama for cross-platform colored output
init(autoreset=True)

class BackendTester:
    def __init__(self, base_url="http://localhost:3001", timeout=10):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.timeout = timeout
        self.test_results = []
        self.websocket_messages = []
        
        # Test statistics
        self.tests_run = 0
        self.tests_passed = 0
        self.tests_failed = 0
        
        # WebSocket client
        self.sio = socketio.Client(
            reconnection=True,
            reconnection_attempts=3,
            reconnection_delay=1
        )
        self.setup_websocket_handlers()
        
    def log_success(self, message):
        """Print success message in green"""
        print(f"{Fore.GREEN}✅ {message}{Style.RESET_ALL}")
        
    def log_error(self, message):
        """Print error message in red"""
        print(f"{Fore.RED}❌ {message}{Style.RESET_ALL}")
        
    def log_warning(self, message):
        """Print warning message in yellow"""
        print(f"{Fore.YELLOW}⚠️ {message}{Style.RESET_ALL}")
        
    def log_info(self, message):
        """Print info message in blue"""
        print(f"{Fore.BLUE}ℹ️ {message}{Style.RESET_ALL}")

    def record_test_result(self, test_name, success, message="", data=None):
        """Record test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            self.log_success(f"{test_name}: {message}")
        else:
            self.tests_failed += 1
            self.log_error(f"{test_name}: {message}")
            
        self.test_results.append({
            "test": test_name,
            "success": success,
            "message": message,
            "timestamp": datetime.now().isoformat(),
            "data": data
        })

    def setup_websocket_handlers(self):
        """Setup WebSocket event handlers"""
        
        @self.sio.event
        def connect():
            self.log_success("WebSocket connected successfully")
            
        @self.sio.event
        def disconnect():
            self.log_warning("WebSocket disconnected")
            
        @self.sio.event
        def connect_error(data):
            self.log_error(f"WebSocket connection error: {data}")
            
        @self.sio.on('tick')
        def on_tick(data):
            self.websocket_messages.append({
                "event": "tick",
                "data": data,
                "timestamp": datetime.now().isoformat()
            })
            
        @self.sio.on('historical_data')
        def on_historical_data(data):
            self.websocket_messages.append({
                "event": "historical_data", 
                "data": data,
                "timestamp": datetime.now().isoformat()
            })

    # REST API Tests
    def test_health_endpoint(self):
        """Test the health check endpoint"""
        try:
            response = requests.get(f"{self.api_url}/health", timeout=self.timeout)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ["status", "connectedUsers", "activeSymbols", "uptime"]
                
                missing_fields = [field for field in required_fields if field not in data]
                if missing_fields:
                    self.record_test_result(
                        "Health Endpoint", 
                        False, 
                        f"Missing fields: {missing_fields}"
                    )
                else:
                    self.record_test_result(
                        "Health Endpoint", 
                        True, 
                        f"Status: {data['status']}, Users: {data['connectedUsers']}, Uptime: {data['uptime']}s"
                    )
            else:
                self.record_test_result(
                    "Health Endpoint", 
                    False, 
                    f"HTTP {response.status_code}: {response.text}"
                )
                
        except requests.exceptions.RequestException as e:
            self.record_test_result("Health Endpoint", False, f"Connection error: {e}")

    def test_symbols_endpoint(self):
        """Test the symbols endpoint"""
        try:
            response = requests.get(f"{self.api_url}/symbols", timeout=self.timeout)
            
            if response.status_code == 200:
                symbols = response.json()
                
                if isinstance(symbols, list) and len(symbols) > 0:
                    self.record_test_result(
                        "Symbols Endpoint", 
                        True, 
                        f"Retrieved {len(symbols)} symbols: {symbols[:3]}{'...' if len(symbols) > 3 else ''}"
                    )
                    return symbols
                else:
                    self.record_test_result(
                        "Symbols Endpoint", 
                        False, 
                        "No symbols returned or invalid format"
                    )
            else:
                self.record_test_result(
                    "Symbols Endpoint", 
                    False, 
                    f"HTTP {response.status_code}: {response.text}"
                )
                
        except requests.exceptions.RequestException as e:
            self.record_test_result("Symbols Endpoint", False, f"Connection error: {e}")
        
        return []

    def test_history_endpoint(self, symbol):
        """Test the history endpoint"""
        try:
            # Test basic history request
            response = requests.get(f"{self.api_url}/history/{symbol}", timeout=self.timeout)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ["symbol", "data", "pagination"]
                
                if all(field in data for field in required_fields):
                    records_count = len(data["data"])
                    pagination = data["pagination"]
                    
                    self.record_test_result(
                        f"History Endpoint ({symbol})", 
                        True, 
                        f"Retrieved {records_count} records, Page {pagination.get('page', 1)}"
                    )
                    
                    # Test pagination
                    if records_count > 0:
                        self.test_history_pagination(symbol)
                    
                    return data["data"]
                else:
                    missing_fields = [field for field in required_fields if field not in data]
                    self.record_test_result(
                        f"History Endpoint ({symbol})", 
                        False, 
                        f"Missing fields: {missing_fields}"
                    )
            else:
                self.record_test_result(
                    f"History Endpoint ({symbol})", 
                    False, 
                    f"HTTP {response.status_code}: {response.text}"
                )
                
        except requests.exceptions.RequestException as e:
            self.record_test_result(f"History Endpoint ({symbol})", False, f"Connection error: {e}")
        
        return []

    def test_history_pagination(self, symbol):
        """Test pagination functionality"""
        try:
            # Test with specific page and limit
            response = requests.get(
                f"{self.api_url}/history/{symbol}?page=1&limit=50", 
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                data = response.json()
                pagination = data.get("pagination", {})
                
                if len(data["data"]) <= 50 and "totalRecords" in pagination:
                    self.record_test_result(
                        "History Pagination", 
                        True, 
                        f"Pagination working: {len(data['data'])}/50 records, Total: {pagination['totalRecords']}"
                    )
                else:
                    self.record_test_result(
                        "History Pagination", 
                        False, 
                        "Pagination not working correctly"
                    )
            else:
                self.record_test_result(
                    "History Pagination", 
                    False, 
                    f"HTTP {response.status_code}"
                )
                
        except requests.exceptions.RequestException as e:
            self.record_test_result("History Pagination", False, f"Error: {e}")

    def test_candlestick_endpoint(self, symbol):
        """Test the candlestick endpoint"""
        intervals = ["1m", "5m", "15m", "1h"]
        
        for interval in intervals:
            try:
                response = requests.get(
                    f"{self.api_url}/candlestick/{symbol}?interval={interval}", 
                    timeout=self.timeout
                )
                
                if response.status_code == 200:
                    data = response.json()
                    required_fields = ["symbol", "interval", "data"]
                    
                    if all(field in data for field in required_fields):
                        candlesticks = data["data"]
                        
                        # Verify candlestick data structure
                        if candlesticks and len(candlesticks) > 0:
                            candle = candlesticks[0]
                            candle_fields = ["time", "open", "high", "low", "close", "volume"]
                            
                            if all(field in candle for field in candle_fields):
                                self.record_test_result(
                                    f"Candlestick ({symbol}, {interval})", 
                                    True, 
                                    f"Retrieved {len(candlesticks)} candlesticks"
                                )
                            else:
                                self.record_test_result(
                                    f"Candlestick ({symbol}, {interval})", 
                                    False, 
                                    "Invalid candlestick data structure"
                                )
                        else:
                            self.record_test_result(
                                f"Candlestick ({symbol}, {interval})", 
                                False, 
                                "No candlestick data returned"
                            )
                    else:
                        self.record_test_result(
                            f"Candlestick ({symbol}, {interval})", 
                            False, 
                            "Missing required fields"
                        )
                else:
                    self.record_test_result(
                        f"Candlestick ({symbol}, {interval})", 
                        False, 
                        f"HTTP {response.status_code}"
                    )
                    
            except requests.exceptions.RequestException as e:
                self.record_test_result(
                    f"Candlestick ({symbol}, {interval})", 
                    False, 
                    f"Error: {e}"
                )

    # WebSocket Tests
    def test_websocket_connection(self):
        """Test WebSocket connection"""
        try:
            self.sio.connect(self.base_url, wait_timeout=self.timeout)
            
            if self.sio.connected:
                self.record_test_result(
                    "WebSocket Connection", 
                    True, 
                    "Successfully connected to WebSocket server"
                )
                return True
            else:
                self.record_test_result(
                    "WebSocket Connection", 
                    False, 
                    "Failed to connect to WebSocket server"
                )
                return False
                
        except Exception as e:
            self.record_test_result(
                "WebSocket Connection", 
                False, 
                f"Connection error: {e}"
            )
            return False

    def test_websocket_symbol_subscription(self, symbol, duration=5):
        """Test WebSocket symbol subscription and real-time data"""
        if not self.sio.connected:
            self.record_test_result(
                "WebSocket Subscription", 
                False, 
                "WebSocket not connected"
            )
            return
            
        try:
            # Clear previous messages
            self.websocket_messages = []
            
            # Join symbol room
            self.sio.emit('join_symbol', symbol)
            self.log_info(f"Subscribed to {symbol}, waiting {duration}s for data...")
            
            # Wait for messages
            time.sleep(duration)
            
            # Check received messages
            tick_messages = [msg for msg in self.websocket_messages if msg["event"] == "tick"]
            historical_messages = [msg for msg in self.websocket_messages if msg["event"] == "historical_data"]
            
            success = len(tick_messages) > 0 or len(historical_messages) > 0
            
            if success:
                self.record_test_result(
                    f"WebSocket Subscription ({symbol})", 
                    True, 
                    f"Received {len(tick_messages)} ticks, {len(historical_messages)} historical updates"
                )
            else:
                self.record_test_result(
                    f"WebSocket Subscription ({symbol})", 
                    False, 
                    f"No real-time data received in {duration}s"
                )
                
            # Leave symbol room
            self.sio.emit('leave_symbol', symbol)
            
        except Exception as e:
            self.record_test_result(
                f"WebSocket Subscription ({symbol})", 
                False, 
                f"Error: {e}"
            )

    def test_multiple_symbol_subscriptions(self, symbols, duration=10):
        """Test multiple symbol subscriptions simultaneously"""
        if not self.sio.connected:
            self.record_test_result(
                "Multiple Symbol Subscriptions", 
                False, 
                "WebSocket not connected"
            )
            return
            
        try:
            self.websocket_messages = []
            
            # Subscribe to multiple symbols
            for symbol in symbols[:3]:  # Test with first 3 symbols
                self.sio.emit('join_symbol', symbol)
                time.sleep(0.5)  # Small delay between subscriptions
            
            self.log_info(f"Subscribed to {len(symbols[:3])} symbols, waiting {duration}s...")
            time.sleep(duration)
            
            # Analyze received messages
            unique_symbols = set()
            for msg in self.websocket_messages:
                if msg["event"] == "tick":
                    unique_symbols.add(msg["data"]["symbol"])
                elif msg["event"] == "historical_data":
                    unique_symbols.add(msg["data"]["symbol"])
            
            success = len(unique_symbols) >= 2  # At least 2 symbols should send data
            
            if success:
                self.record_test_result(
                    "Multiple Symbol Subscriptions", 
                    True, 
                    f"Received data from {len(unique_symbols)} symbols: {list(unique_symbols)}"
                )
            else:
                self.record_test_result(
                    "Multiple Symbol Subscriptions", 
                    False, 
                    f"Expected data from multiple symbols, got {len(unique_symbols)}"
                )
                
            # Clean up subscriptions
            for symbol in symbols[:3]:
                self.sio.emit('leave_symbol', symbol)
                
        except Exception as e:
            self.record_test_result(
                "Multiple Symbol Subscriptions", 
                False, 
                f"Error: {e}"
            )

    # Performance Tests
    def test_api_response_times(self, symbol):
        """Test API response times"""
        endpoints = [
            ("Health", f"{self.api_url}/health"),
            ("Symbols", f"{self.api_url}/symbols"),
            ("History", f"{self.api_url}/history/{symbol}?limit=100"),
            ("Candlestick", f"{self.api_url}/candlestick/{symbol}?interval=1m")
        ]
        
        for endpoint_name, url in endpoints:
            response_times = []
            
            for _ in range(3):  # Test 3 times for each endpoint
                start_time = time.time()
                try:
                    response = requests.get(url, timeout=self.timeout)
                    end_time = time.time()
                    
                    if response.status_code == 200:
                        response_times.append((end_time - start_time) * 1000)  # Convert to ms
                except:
                    pass
            
            if response_times:
                avg_time = sum(response_times) / len(response_times)
                max_time = max(response_times)
                
                success = avg_time < 2000  # Less than 2 seconds average
                
                self.record_test_result(
                    f"Response Time ({endpoint_name})", 
                    success, 
                    f"Avg: {avg_time:.1f}ms, Max: {max_time:.1f}ms"
                )
            else:
                self.record_test_result(
                    f"Response Time ({endpoint_name})", 
                    False, 
                    "No successful requests"
                )

    def test_concurrent_connections(self, num_connections=5):
        """Test multiple concurrent WebSocket connections"""
        def connect_and_test():
            client = socketio.Client()
            try:
                client.connect(self.base_url, wait_timeout=5)
                time.sleep(2)
                client.disconnect()
                return True
            except:
                return False
        
        # Create multiple threads for concurrent connections
        threads = []
        results = []
        
        for i in range(num_connections):
            thread = threading.Thread(target=lambda: results.append(connect_and_test()))
            threads.append(thread)
            thread.start()
        
        # Wait for all threads to complete
        for thread in threads:
            thread.join()
        
        successful_connections = sum(results)
        success = successful_connections >= num_connections * 0.8  # At least 80% success
        
        self.record_test_result(
            "Concurrent Connections", 
            success, 
            f"{successful_connections}/{num_connections} connections successful"
        )

    # Main test runner
    def run_all_tests(self, symbols_limit=3, websocket_duration=5):
        """Run all tests"""
        self.log_info(f"🚀 Starting Backend Test Suite for {self.base_url}")
        self.log_info(f"Timeout: {self.timeout}s, Symbols Limit: {symbols_limit}, WebSocket Duration: {websocket_duration}s")
        print("=" * 60)
        
        # 1. Basic API Tests
        self.log_info("Testing REST API Endpoints...")
        self.test_health_endpoint()
        symbols = self.test_symbols_endpoint()
        
        if symbols:
            test_symbol = symbols[0]
            self.test_history_endpoint(test_symbol)
            self.test_candlestick_endpoint(test_symbol)
            
            # 2. Performance Tests
            self.log_info("Testing API Performance...")
            self.test_api_response_times(test_symbol)
        
        # 3. WebSocket Tests
        self.log_info("Testing WebSocket Functionality...")
        if self.test_websocket_connection():
            if symbols:
                self.test_websocket_symbol_subscription(symbols[0], websocket_duration)
                
                if len(symbols) > 1:
                    self.test_multiple_symbol_subscriptions(symbols[:symbols_limit], websocket_duration)
            
            # 4. Concurrent Connection Test
            self.test_concurrent_connections(3)
            
            # Disconnect WebSocket
            self.sio.disconnect()
        
        # 5. Print Results Summary
        self.print_test_summary()

    def print_test_summary(self):
        """Print detailed test results"""
        print("\n" + "=" * 60)
        self.log_info("📊 TEST RESULTS SUMMARY")
        print("=" * 60)
        
        # Overall statistics
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        
        print(f"{Fore.CYAN}Total Tests: {self.tests_run}")
        print(f"{Fore.GREEN}Passed: {self.tests_passed}")
        print(f"{Fore.RED}Failed: {self.tests_failed}")
        print(f"{Fore.YELLOW}Success Rate: {success_rate:.1f}%{Style.RESET_ALL}")
        
        # Detailed results
        print(f"\n{Fore.CYAN}DETAILED RESULTS:{Style.RESET_ALL}")
        for result in self.test_results:
            status = "✅" if result["success"] else "❌"
            color = Fore.GREEN if result["success"] else Fore.RED
            print(f"{status} {color}{result['test']}: {result['message']}{Style.RESET_ALL}")
        
        # WebSocket message summary
        if self.websocket_messages:
            print(f"\n{Fore.CYAN}WEBSOCKET ACTIVITY:{Style.RESET_ALL}")
            tick_count = len([msg for msg in self.websocket_messages if msg["event"] == "tick"])
            hist_count = len([msg for msg in self.websocket_messages if msg["event"] == "historical_data"])
            print(f"📈 Tick Messages: {tick_count}")
            print(f"📊 Historical Messages: {hist_count}")
        
        # Final verdict
        print(f"\n{'=' * 60}")
        if success_rate >= 80:
            self.log_success(f"🎉 BACKEND TESTS PASSED! ({success_rate:.1f}% success rate)")
        elif success_rate >= 60:
            self.log_warning(f"⚠️ BACKEND PARTIALLY WORKING ({success_rate:.1f}% success rate)")
        else:
            self.log_error(f"💥 BACKEND TESTS FAILED! ({success_rate:.1f}% success rate)")
        print("=" * 60)

    def save_test_report(self, filename=None):
        """Save detailed test report to JSON file"""
        if filename is None:
            filename = f"test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        report = {
            "test_summary": {
                "timestamp": datetime.now().isoformat(),
                "backend_url": self.base_url,
                "total_tests": self.tests_run,
                "tests_passed": self.tests_passed,
                "tests_failed": self.tests_failed,
                "success_rate": (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
            },
            "test_results": self.test_results,
            "websocket_messages": self.websocket_messages[-50:]  # Last 50 messages
        }
        
        with open(filename, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        
        self.log_info(f"📄 Test report saved to: {filename}")

def main():
    parser = argparse.ArgumentParser(description='Test Stock Market Simulator Backend')
    parser.add_argument('--url', default='http://localhost:3001', 
                       help='Backend URL (default: http://localhost:3001)')
    parser.add_argument('--timeout', type=int, default=10, 
                       help='Request timeout in seconds (default: 10)')
    parser.add_argument('--symbols-limit', type=int, default=3, 
                       help='Number of symbols to test (default: 3)')
    parser.add_argument('--websocket-duration', type=int, default=5, 
                       help='WebSocket test duration in seconds (default: 5)')
    parser.add_argument('--save-report', action='store_true', 
                       help='Save detailed test report to JSON file')
    
    args = parser.parse_args()
    
    # Create and run tester
    tester = BackendTester(base_url=args.url, timeout=args.timeout)
    tester.run_all_tests(
        symbols_limit=args.symbols_limit, 
        websocket_duration=args.websocket_duration
    )
    
    if args.save_report:
        tester.save_test_report()

if __name__ == "__main__":
    main()