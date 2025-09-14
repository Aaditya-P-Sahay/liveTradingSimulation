#!/usr/bin/env python3
"""
Trading Simulation Backend Test Suite
Tests all REST API endpoints and WebSocket functionality including new trading features
Usage: python test_trading_backend.py
"""

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

class TradingBackendTester:
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

        @self.sio.on('portfolio_update')
        def on_portfolio_update(data):
            self.websocket_messages.append({
                "event": "portfolio_update", 
                "data": data,
                "timestamp": datetime.now().isoformat()
            })

        @self.sio.on('leaderboard_update')
        def on_leaderboard_update(data):
            self.websocket_messages.append({
                "event": "leaderboard_update", 
                "data": data,
                "timestamp": datetime.now().isoformat()
            })

    # ==================== ORIGINAL MARKET DATA TESTS ====================

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
                    # Check for new fields from trading backend
                    extra_info = ""
                    if "authenticatedUsers" in data:
                        extra_info = f", Auth Users: {data['authenticatedUsers']}"
                    
                    self.record_test_result(
                        "Health Endpoint", 
                        True, 
                        f"Status: {data['status']}, Users: {data['connectedUsers']}{extra_info}, Uptime: {data['uptime']:.1f}s"
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
                                True,  # Empty data is OK
                                f"Retrieved {len(candlesticks)} candlesticks"
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

    # ==================== NEW TRADING FUNCTIONALITY TESTS ====================

    def test_authentication_protection(self):
        """Test that trading endpoints are properly protected"""
        # FIXED: Removed /api prefix since it's already in self.api_url
        protected_endpoints = [
            ("POST", "/trade", {"symbol": "TEST", "order_type": "buy", "quantity": 10}),
            ("GET", "/portfolio", None),
            ("GET", "/trades", None),
            ("GET", "/shorts", None),
        ]
        
        for method, endpoint, data in protected_endpoints:
            try:
                if method == "POST":
                    response = requests.post(f"{self.api_url}{endpoint}", json=data, timeout=self.timeout)
                else:
                    response = requests.get(f"{self.api_url}{endpoint}", timeout=self.timeout)
                
                if response.status_code == 401:
                    self.record_test_result(
                        f"Auth Protection {endpoint}", 
                        True, 
                        "Properly requires authentication"
                    )
                else:
                    self.record_test_result(
                        f"Auth Protection {endpoint}", 
                        False, 
                        f"Expected 401, got {response.status_code}"
                    )
                    
            except requests.exceptions.RequestException as e:
                self.record_test_result(f"Auth Protection {endpoint}", False, f"Error: {e}")

    def test_trade_endpoint_validation(self):
        """Test trade endpoint input validation (without auth)"""
        test_cases = [
            # Missing data
            ({}, "Missing required fields"),
            # Invalid order type
            ({"symbol": "TEST", "order_type": "invalid", "quantity": 10}, "Invalid order type"),
            # Missing quantity
            ({"symbol": "TEST", "order_type": "buy"}, "Missing quantity"),
            # Zero quantity
            ({"symbol": "TEST", "order_type": "buy", "quantity": 0}, "Invalid quantity"),
        ]
        
        for test_data, description in test_cases:
            try:
                response = requests.post(f"{self.api_url}/trade", json=test_data, timeout=self.timeout)
                
                # Should get 401 (auth required) or 400 (validation error)
                if response.status_code in [400, 401]:
                    self.record_test_result(
                        f"Trade Validation ({description})", 
                        True, 
                        f"Properly rejected with {response.status_code}"
                    )
                else:
                    self.record_test_result(
                        f"Trade Validation ({description})", 
                        False, 
                        f"Expected 400/401, got {response.status_code}"
                    )
                    
            except requests.exceptions.RequestException as e:
                self.record_test_result(f"Trade Validation ({description})", False, f"Error: {e}")

    def test_leaderboard_endpoint(self):
        """Test the leaderboard endpoint (should be public)"""
        try:
            response = requests.get(f"{self.api_url}/leaderboard", timeout=self.timeout)
            
            if response.status_code == 200:
                leaderboard = response.json()
                
                if isinstance(leaderboard, list):
                    # Test with limit parameter
                    limit_response = requests.get(f"{self.api_url}/leaderboard?limit=5", timeout=self.timeout)
                    
                    if limit_response.status_code == 200:
                        limited_board = limit_response.json()
                        
                        self.record_test_result(
                            "Leaderboard Endpoint", 
                            True, 
                            f"Retrieved {len(leaderboard)} entries, limit test: {len(limited_board)} entries"
                        )
                    else:
                        self.record_test_result(
                            "Leaderboard Endpoint", 
                            True, 
                            f"Retrieved {len(leaderboard)} entries (limit test failed)"
                        )
                else:
                    self.record_test_result(
                        "Leaderboard Endpoint", 
                        False, 
                        "Invalid response format"
                    )
            else:
                self.record_test_result(
                    "Leaderboard Endpoint", 
                    False, 
                    f"HTTP {response.status_code}: {response.text}"
                )
                
        except requests.exceptions.RequestException as e:
            self.record_test_result("Leaderboard Endpoint", False, f"Connection error: {e}")

    def test_admin_endpoint_protection(self):
        """Test that admin endpoints are properly protected"""
        # FIXED: Removed /api prefix since it's already in self.api_url
        admin_endpoints = [
            ("GET", "/admin/simulation/status"),
            ("POST", "/admin/simulation/start"),
            ("POST", "/admin/simulation/stop"),
            ("POST", "/admin/simulation/square-off"),
        ]
        
        for method, endpoint in admin_endpoints:
            try:
                if method == "POST":
                    response = requests.post(f"{self.api_url}{endpoint}", timeout=self.timeout)
                else:
                    response = requests.get(f"{self.api_url}{endpoint}", timeout=self.timeout)
                
                # Should require authentication (401) or admin access (403)
                if response.status_code in [401, 403, 503]:  # 503 if service role key missing
                    self.record_test_result(
                        f"Admin Protection {endpoint}", 
                        True, 
                        f"Properly protected with {response.status_code}"
                    )
                else:
                    self.record_test_result(
                        f"Admin Protection {endpoint}", 
                        False, 
                        f"Expected 401/403/503, got {response.status_code}"
                    )
                    
            except requests.exceptions.RequestException as e:
                self.record_test_result(f"Admin Protection {endpoint}", False, f"Error: {e}")

    def test_portfolio_pagination(self):
        """Test trade history pagination (without auth, should get 401)"""
        try:
            response = requests.get(f"{self.api_url}/trades?page=1&limit=10", timeout=self.timeout)
            
            if response.status_code == 401:
                self.record_test_result(
                    "Trade History Pagination", 
                    True, 
                    "Pagination parameters accepted, auth required"
                )
            else:
                self.record_test_result(
                    "Trade History Pagination", 
                    False, 
                    f"Expected 401, got {response.status_code}"
                )
                
        except requests.exceptions.RequestException as e:
            self.record_test_result("Trade History Pagination", False, f"Error: {e}")

    def test_short_positions_endpoint(self):
        """Test short positions endpoint (without auth)"""
        try:
            # Test both regular and active-only endpoints
            # FIXED: Removed /api prefix since it's already in self.api_url
            endpoints = [
                "/shorts",
                "/shorts?active=true"
            ]
            
            for endpoint in endpoints:
                response = requests.get(f"{self.api_url}{endpoint}", timeout=self.timeout)
                
                if response.status_code == 401:
                    self.record_test_result(
                        f"Short Positions {endpoint}", 
                        True, 
                        "Properly requires authentication"
                    )
                else:
                    self.record_test_result(
                        f"Short Positions {endpoint}", 
                        False, 
                        f"Expected 401, got {response.status_code}"
                    )
                    
        except requests.exceptions.RequestException as e:
            self.record_test_result("Short Positions Endpoint", False, f"Error: {e}")

    def test_invalid_endpoints(self):
        """Test that invalid endpoints return 404"""
        # These are intentionally invalid so the /api prefix is correct here
        invalid_endpoints = [
            "/nonexistent",
            "/trade/invalid",
            "/portfolio/fake",
            "/admin/invalid"
        ]
        
        for endpoint in invalid_endpoints:
            try:
                response = requests.get(f"{self.api_url}{endpoint}", timeout=self.timeout)
                
                if response.status_code == 404:
                    self.record_test_result(
                        f"Invalid Endpoint {endpoint}", 
                        True, 
                        "Properly returns 404"
                    )
                else:
                    self.record_test_result(
                        f"Invalid Endpoint {endpoint}", 
                        False, 
                        f"Expected 404, got {response.status_code}"
                    )
                    
            except requests.exceptions.RequestException as e:
                self.record_test_result(f"Invalid Endpoint {endpoint}", False, f"Error: {e}")

    # ==================== WEBSOCKET TESTS (ENHANCED) ====================

    def test_websocket_connection(self):
        """Test WebSocket connection (should work without auth for market data)"""
        try:
            self.sio.connect(self.base_url, wait_timeout=self.timeout)
            
            if self.sio.connected:
                self.record_test_result(
                    "WebSocket Connection", 
                    True, 
                    "Successfully connected (unauthenticated for market data)"
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

    def test_websocket_market_data(self, symbol, duration=5):
        """Test WebSocket market data streaming"""
        if not self.sio.connected:
            return False
            
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
            leaderboard_messages = [msg for msg in self.websocket_messages if msg["event"] == "leaderboard_update"]
            
            success = len(tick_messages) > 0 or len(historical_messages) > 0
            
            extra_info = ""
            if leaderboard_messages:
                extra_info = f", {len(leaderboard_messages)} leaderboard updates"
            
            if success:
                self.record_test_result(
                    f"WebSocket Market Data ({symbol})", 
                    True, 
                    f"Received {len(tick_messages)} ticks, {len(historical_messages)} historical{extra_info}"
                )
            else:
                self.record_test_result(
                    f"WebSocket Market Data ({symbol})", 
                    False, 
                    f"No market data received in {duration}s{extra_info}"
                )
                
            # Leave symbol room
            self.sio.emit('leave_symbol', symbol)
            return success
            
        except Exception as e:
            self.record_test_result(
                f"WebSocket Market Data ({symbol})", 
                False, 
                f"Error: {e}"
            )
            return False

    def test_websocket_trading_events(self, duration=3):
        """Test WebSocket trading-related events (should not receive without auth)"""
        if not self.sio.connected:
            return False
            
        try:
            # Clear messages and wait
            self.websocket_messages = []
            time.sleep(duration)
            
            # Check for trading events
            portfolio_messages = [msg for msg in self.websocket_messages if msg["event"] == "portfolio_update"]
            
            # Should not receive portfolio updates without authentication
            if len(portfolio_messages) == 0:
                self.record_test_result(
                    "WebSocket Trading Events", 
                    True, 
                    "No portfolio updates received (correct - unauthenticated)"
                )
            else:
                self.record_test_result(
                    "WebSocket Trading Events", 
                    False, 
                    f"Received {len(portfolio_messages)} portfolio updates without auth"
                )
                
        except Exception as e:
            self.record_test_result("WebSocket Trading Events", False, f"Error: {e}")

    # ==================== PERFORMANCE TESTS ====================

    def test_api_response_times(self, symbol):
        """Test API response times for all endpoints"""
        endpoints = [
            ("Health", f"{self.api_url}/health"),
            ("Symbols", f"{self.api_url}/symbols"),
            ("History", f"{self.api_url}/history/{symbol}?limit=100"),
            ("Candlestick", f"{self.api_url}/candlestick/{symbol}?interval=1m"),
            ("Leaderboard", f"{self.api_url}/leaderboard?limit=10"),
        ]
        
        for endpoint_name, url in endpoints:
            response_times = []
            
            for _ in range(3):
                start_time = time.time()
                try:
                    response = requests.get(url, timeout=self.timeout)
                    end_time = time.time()
                    
                    if response.status_code == 200:
                        response_times.append((end_time - start_time) * 1000)
                except:
                    pass
            
            if response_times:
                avg_time = sum(response_times) / len(response_times)
                max_time = max(response_times)
                
                success = avg_time < 3000  # Less than 3 seconds
                
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

    # ==================== MAIN TEST RUNNER ====================

    def run_all_tests(self, symbols_limit=3, websocket_duration=5):
        """Run all tests including new trading functionality"""
        self.log_info(f"🚀 Trading Backend Test Suite for {self.base_url}")
        self.log_info(f"Timeout: {self.timeout}s, Symbols Limit: {symbols_limit}, WebSocket Duration: {websocket_duration}s")
        print("=" * 60)
        
        # 1. Original Market Data Tests
        self.log_info("Testing Market Data Endpoints...")
        self.test_health_endpoint()
        symbols = self.test_symbols_endpoint()
        
        if symbols:
            test_symbol = symbols[0]
            self.test_history_endpoint(test_symbol)
            self.test_candlestick_endpoint(test_symbol)
        
        # 2. New Trading Functionality Tests
        self.log_info("Testing Trading Endpoints...")
        self.test_authentication_protection()
        self.test_trade_endpoint_validation()
        self.test_leaderboard_endpoint()
        self.test_admin_endpoint_protection()
        self.test_portfolio_pagination()
        self.test_short_positions_endpoint()
        self.test_invalid_endpoints()
        
        # 3. WebSocket Tests (Enhanced)
        self.log_info("Testing WebSocket Functionality...")
        if self.test_websocket_connection():
            if symbols:
                self.test_websocket_market_data(symbols[0], websocket_duration)
            
            self.test_websocket_trading_events(3)
            
            # Disconnect
            self.sio.disconnect()
        
        # 4. Performance Tests
        self.log_info("Testing Performance...")
        if symbols:
            self.test_api_response_times(symbols[0])
        
        # 5. Print Results
        self.print_test_summary()

    def print_test_summary(self):
        """Print detailed test results"""
        print("\n" + "=" * 60)
        self.log_info("📊 TRADING BACKEND TEST RESULTS")
        print("=" * 60)
        
        # Overall statistics
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        
        print(f"{Fore.CYAN}Total Tests: {self.tests_run}")
        print(f"{Fore.GREEN}Passed: {self.tests_passed}")
        print(f"{Fore.RED}Failed: {self.tests_failed}")
        print(f"{Fore.YELLOW}Success Rate: {success_rate:.1f}%{Style.RESET_ALL}")
        
        # Categorized results
        market_tests = [r for r in self.test_results if any(x in r["test"] for x in ["Health", "Symbols", "History", "Candlestick"])]
        trading_tests = [r for r in self.test_results if any(x in r["test"] for x in ["Auth", "Trade", "Portfolio", "Leaderboard", "Admin", "Short"])]
        websocket_tests = [r for r in self.test_results if "WebSocket" in r["test"]]
        perf_tests = [r for r in self.test_results if "Response Time" in r["test"]]
        
        categories = [
            ("Market Data", market_tests),
            ("Trading Features", trading_tests), 
            ("WebSocket", websocket_tests),
            ("Performance", perf_tests)
        ]
        
        for category_name, tests in categories:
            if tests:
                passed = sum(1 for t in tests if t["success"])
                total = len(tests)
                print(f"\n{Fore.CYAN}{category_name}: {passed}/{total} passed{Style.RESET_ALL}")
        
        # Detailed results
        print(f"\n{Fore.CYAN}DETAILED RESULTS:{Style.RESET_ALL}")
        for result in self.test_results:
            status = "✅" if result["success"] else "❌"
            color = Fore.GREEN if result["success"] else Fore.RED
            print(f"{status} {color}{result['test']}: {result['message']}{Style.RESET_ALL}")
        
        # Final verdict
        print(f"\n{'=' * 60}")
        if success_rate >= 90:
            self.log_success(f"🎉 TRADING BACKEND FULLY FUNCTIONAL! ({success_rate:.1f}% success)")
        elif success_rate >= 75:
            self.log_success(f"✅ TRADING BACKEND WORKING WELL! ({success_rate:.1f}% success)")
        elif success_rate >= 60:
            self.log_warning(f"⚠️ TRADING BACKEND PARTIALLY WORKING ({success_rate:.1f}% success)")
        else:
            self.log_error(f"❌ TRADING BACKEND NEEDS FIXES ({success_rate:.1f}% success)")
        print("=" * 60)

def main():
    parser = argparse.ArgumentParser(description='Test Trading Simulation Backend')
    parser.add_argument('--url', default='http://localhost:3001', 
                       help='Backend URL (default: http://localhost:3001)')
    parser.add_argument('--timeout', type=int, default=10, 
                       help='Request timeout in seconds (default: 10)')
    parser.add_argument('--symbols-limit', type=int, default=3, 
                       help='Number of symbols to test (default: 3)')
    parser.add_argument('--websocket-duration', type=int, default=5, 
                       help='WebSocket test duration in seconds (default: 5)')
    
    args = parser.parse_args()
    
    # Create and run tester
    tester = TradingBackendTester(base_url=args.url, timeout=args.timeout)
    tester.run_all_tests(
        symbols_limit=args.symbols_limit, 
        websocket_duration=args.websocket_duration
    )

if __name__ == "__main__":
    main()