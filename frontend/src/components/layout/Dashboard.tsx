import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useMarket } from '../../contexts/MarketContext';
import { LiveStockChart } from '../charts/LiveStockChart';
import { TradingPanel } from '../trading/TradingPanel';
import { Portfolio } from '../trading/Portfolio';
import { AdminControls } from '../admin/AdminControls';
import { apiService } from '../../services/api';
import { 
  LogOut, 
  TrendingUp, 
  BarChart3, 
  Wallet, 
  Clock,
  Users,
  Award,
  Activity,
  RefreshCw,
  Play,
  Pause,
  Square,
  Zap,
  AlertCircle,
  Eye,
  Settings
} from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { selectedSymbol, setSelectedSymbol, marketState, subscribeToMultipleSymbols, lastTickData } = useMarket();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'line' | 'candlestick'>('candlestick');
  const [activeTab, setActiveTab] = useState<'trade' | 'portfolio'>('trade');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingLeaderboard, setRefreshingLeaderboard] = useState(false);
  const [showAllSymbols, setShowAllSymbols] = useState(false);
  const [chartKey, setChartKey] = useState(0); // Force chart remount

  useEffect(() => {
    loadInitialData();
  }, []);

  // Subscribe to symbols for live updates
  useEffect(() => {
    if (symbols.length > 0) {
      subscribeToMultipleSymbols(symbols.slice(0, 10)); // Subscribe to first 10 symbols
    }
  }, [symbols, subscribeToMultipleSymbols]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      
      console.log('📊 Loading initial dashboard data...');
      
      // Load symbols and leaderboard in parallel
      const [symbolsData, leaderboardData] = await Promise.all([
        apiService.getSymbols().catch((err) => {
          console.error('Failed to load symbols:', err);
          return ['ADANIENT', 'TCS', 'RELIANCE', 'HDFC', 'ICICIBANK'];
        }),
        apiService.getLeaderboard(20).catch((err) => {
          console.error('Failed to load leaderboard:', err);
          return [];
        })
      ]);
      
      if (Array.isArray(symbolsData) && symbolsData.length > 0) {
        setSymbols(symbolsData);
        console.log(`✅ Loaded ${symbolsData.length} symbols:`, symbolsData.slice(0, 5).join(', '), '...');
        
        // Set initial symbol if not already set
        if (!selectedSymbol || !symbolsData.includes(selectedSymbol)) {
          setSelectedSymbol(symbolsData[0]);
          console.log(`📈 Selected initial symbol: ${symbolsData[0]}`);
        }
      }
      
      setLeaderboard(leaderboardData);
      console.log(`🏆 Loaded ${leaderboardData.length} leaderboard entries`);
      
    } catch (error) {
      console.error('❌ Failed to load initial data:', error);
      // Use fallback values
      if (!selectedSymbol) {
        setSelectedSymbol('ADANIENT');
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshLeaderboard = async () => {
    try {
      setRefreshingLeaderboard(true);
      const data = await apiService.getLeaderboard(20);
      setLeaderboard(data);
      console.log('🔄 Leaderboard refreshed');
    } catch (error) {
      console.error('Failed to refresh leaderboard:', error);
    } finally {
      setRefreshingLeaderboard(false);
    }
  };

  // FIXED: Chart type switching with proper cleanup
  const handleChartTypeChange = (newType: 'line' | 'candlestick') => {
    console.log(`🔄 Switching chart type from ${chartType} to ${newType}`);
    setChartType(newType);
    setChartKey(prev => prev + 1); // Force chart remount
  };

  // Get live price for selected symbol
  const getCurrentPrice = (symbol: string) => {
    const price = lastTickData.get(symbol)?.price || 0;
    return price;
  };

  // Get price change data
  const getPriceChangeData = (symbol: string) => {
    const currentPrice = getCurrentPrice(symbol);
    const tickData = lastTickData.get(symbol);
    
    // Simple mock calculation - in real app you'd track opening prices
    const mockChange = (currentPrice * 0.001) * (Math.random() - 0.5) * 4;
    const mockChangePercent = currentPrice ? (mockChange / currentPrice) * 100 : 0;
    
    return {
      price: currentPrice,
      change: mockChange,
      changePercent: mockChangePercent,
      isPositive: mockChange >= 0
    };
  };

  // Safety check - if user is not logged in, show loading
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <div className="text-white">Loading dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* ENHANCED Header */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-30 shadow-lg">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            {/* Left side - Title and Status */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-8 h-8 text-blue-500" />
                <div>
                  <h1 className="text-2xl font-bold text-white">Trading Contest</h1>
                  <div className="text-xs text-gray-400">Real-time Stock Trading Simulation</div>
                </div>
              </div>
              
              {/* Enhanced Contest Status Badge */}
              <div className="flex items-center gap-3">
                {marketState.isRunning ? (
                  <div className="flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-700 rounded-lg">
                    {marketState.isPaused ? (
                      <>
                        <Pause className="w-4 h-4 text-yellow-500" />
                        <span className="text-yellow-400 font-medium">Contest Paused</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 text-green-500 animate-pulse" />
                        <span className="text-green-400 font-medium">Live Trading</span>
                      </>
                    )}
                    <div className="flex items-center gap-1 ml-2 text-xs">
                      <Zap className="w-3 h-3" />
                      <span className="text-gray-300">{marketState.speed}x</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-4 py-2 bg-red-900/30 border border-red-700 rounded-lg">
                    <Square className="w-4 h-4 text-red-500" />
                    <span className="text-red-400 font-medium">Contest Stopped</span>
                  </div>
                )}
                
                {/* Progress Info */}
                {marketState.isRunning && (
                  <div className="hidden lg:flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      <span className="text-gray-400">
                        {marketState.progress.toFixed(1)}% Complete
                      </span>
                    </div>
                    <div className="text-gray-500">
                      {Math.floor((marketState.elapsedTime || 0) / 60000)}m elapsed
                    </div>
                  </div>
                )}
              </div>
              
              {/* Time Info */}
              {marketState.contestStartTime && (
                <div className="hidden xl:flex items-center gap-2 text-sm text-gray-400 bg-gray-800 px-3 py-2 rounded-lg">
                  <Clock className="w-4 h-4" />
                  <div>
                    <div className="text-xs text-gray-500">Contest Started</div>
                    <div className="text-white">{new Date(marketState.contestStartTime).toLocaleTimeString()}</div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Right side - User info and logout */}
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-sm font-medium text-white">{user.name || 'User'}</div>
                <div className="text-xs text-gray-400">{user.email}</div>
                {user.role === 'admin' && (
                  <div className="text-xs bg-yellow-900/30 text-yellow-400 px-2 py-1 rounded mt-1 flex items-center gap-1">
                    <Settings className="w-3 h-3" />
                    Admin
                  </div>
                )}
              </div>
              <button
                onClick={logout}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Admin Controls */}
        {user?.role === 'admin' && <AdminControls />}

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center h-64">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <div className="text-gray-400">Loading dashboard...</div>
            </div>
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
            {/* Main Content - Charts and Trading */}
            <div className="xl:col-span-3">
              {/* Stock Selector - FIXED */}
              <div className="mb-6 bg-gray-900 rounded-lg p-6 shadow-lg">
                <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center">
                  <div className="flex-1 min-w-0">
                    <label className="block text-sm font-medium text-gray-300 mb-3">
                      Select Stock Symbol
                    </label>
                    <select
                      value={selectedSymbol || ''}
                      onChange={(e) => {
                        const newSymbol = e.target.value;
                        console.log(`📈 Changing symbol from ${selectedSymbol} to ${newSymbol}`);
                        setSelectedSymbol(newSymbol);
                        // Force chart reload by changing key
                        setChartKey(prev => prev + 1);
                      }}
                      className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg font-medium"
                    >
                      <option value="" disabled>Select a symbol</option>
                      {symbols.map((sym) => (
                        <option key={sym} value={sym}>
                          {sym}
                        </option>
                      ))}
                    </select>
                    <div className="text-xs text-gray-500 mt-1">
                      {symbols.length} symbols available
                    </div>
                  </div>
                  
                  {/* ENHANCED Live Price Display */}
                  {selectedSymbol && getCurrentPrice(selectedSymbol) > 0 && (
                    <div className="text-center lg:text-right bg-gray-800 p-4 rounded-lg">
                      <div className="text-sm text-gray-400 mb-1">Current Price</div>
                      <div className="text-3xl font-bold text-white mb-2">
                        ₹{getCurrentPrice(selectedSymbol).toFixed(2)}
                      </div>
                      {(() => {
                        const changeData = getPriceChangeData(selectedSymbol);
                        return (
                          <div className={`text-sm font-medium px-3 py-1 rounded-full ${
                            changeData.isPositive ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
                          }`}>
                            {changeData.isPositive ? '+' : ''}₹{changeData.change.toFixed(2)} 
                            ({changeData.isPositive ? '+' : ''}{changeData.changePercent.toFixed(2)}%)
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  
                  {/* Progress Info Card */}
                  {marketState.isRunning && (
                    <div className="text-center bg-blue-900/20 border border-blue-700 p-4 rounded-lg">
                      <div className="text-sm text-blue-400 mb-2">Contest Progress</div>
                      <div className="text-2xl font-bold text-white mb-1">
                        {marketState.progress.toFixed(1)}%
                      </div>
                      <div className="text-xs text-gray-400">
                        Tick {marketState.currentDataTick} / {marketState.totalDataTicks}
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${marketState.progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Chart Section - FIXED */}
              {selectedSymbol && (
                <div className="mb-6">
                  {/* Chart Type Buttons */}
                  <div className="flex gap-3 mb-6">
                    <button
                      onClick={() => handleChartTypeChange('line')}
                      className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                        chartType === 'line'
                          ? 'bg-blue-600 text-white shadow-lg transform scale-105'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                      }`}
                    >
                      <Activity className="w-5 h-5" />
                      Line Chart
                    </button>
                    <button
                      onClick={() => handleChartTypeChange('candlestick')}
                      className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                        chartType === 'candlestick'
                          ? 'bg-blue-600 text-white shadow-lg transform scale-105'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                      }`}
                    >
                      <BarChart3 className="w-5 h-5" />
                      Candlesticks
                    </button>
                  </div>
                  
                  {/* CRITICAL Fix: Unique key forces chart remount on symbol change */}
                  <LiveStockChart 
                    symbol={selectedSymbol} 
                    chartType={chartType}
                    key={`chart-${selectedSymbol}-${chartType}-${chartKey}`}
                  />
                </div>
              )}

              {/* ENHANCED Trading/Portfolio Tabs */}
              <div className="bg-gray-900 rounded-lg shadow-lg">
                <div className="flex border-b border-gray-800">
                  <button
                    onClick={() => setActiveTab('trade')}
                    className={`flex items-center gap-3 flex-1 px-6 py-4 font-medium transition-all duration-200 ${
                      activeTab === 'trade'
                        ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                        : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
                    }`}
                  >
                    <TrendingUp className="w-5 h-5" />
                    <span className="text-lg">Trade {selectedSymbol}</span>
                    {marketState.isRunning && (
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('portfolio')}
                    className={`flex items-center gap-3 flex-1 px-6 py-4 font-medium transition-all duration-200 ${
                      activeTab === 'portfolio'
                        ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                        : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
                    }`}
                  >
                    <Wallet className="w-5 h-5" />
                    <span className="text-lg">Portfolio</span>
                  </button>
                </div>
                
                <div className="p-6">
                  {activeTab === 'trade' && selectedSymbol ? (
                    <TradingPanel symbol={selectedSymbol} />
                  ) : activeTab === 'portfolio' ? (
                    <Portfolio />
                  ) : (
                    <div className="text-center py-12 text-gray-400">
                      <TrendingUp className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                      <p className="text-lg">Select a symbol to start trading</p>
                      <p className="text-sm">Choose from {symbols.length} available stocks</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ENHANCED Right Sidebar */}
            <div className="xl:col-span-1 space-y-6">
              {/* Market Status Card */}
              <div className="bg-gray-900 rounded-lg p-6 shadow-lg">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Market Status
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Status</span>
                    <span className={`font-bold px-3 py-1 rounded-full text-sm ${
                      marketState.isRunning 
                        ? marketState.isPaused 
                          ? 'bg-yellow-900/30 text-yellow-400' 
                          : 'bg-green-900/30 text-green-400'
                        : 'bg-red-900/30 text-red-400'
                    }`}>
                      {marketState.isRunning 
                        ? marketState.isPaused ? 'Paused' : 'Live'
                        : 'Stopped'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Speed</span>
                    <span className="text-white font-semibold">{marketState.speed}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Progress</span>
                    <span className="text-white font-semibold">{marketState.progress.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Elapsed</span>
                    <span className="text-white font-semibold">
                      {Math.floor((marketState.elapsedTime || 0) / 60000)}m {Math.floor(((marketState.elapsedTime || 0) % 60000) / 1000)}s
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Active Symbols</span>
                    <span className="text-white font-semibold">{marketState.symbols.length}</span>
                  </div>
                </div>
                
                {/* Progress Bar */}
                {marketState.isRunning && (
                  <div className="mt-4">
                    <div className="w-full bg-gray-800 rounded-full h-3">
                      <div 
                        className="bg-gradient-to-r from-blue-600 to-blue-500 h-3 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${marketState.progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* ENHANCED Live Prices */}
              <div className="bg-gray-900 rounded-lg p-6 shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    Live Prices
                  </h3>
                  <button
                    onClick={() => setShowAllSymbols(!showAllSymbols)}
                    className="text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    {showAllSymbols ? 'Show Less' : 'Show All'}
                  </button>
                </div>
                
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {(showAllSymbols ? symbols : symbols.slice(0, 8)).map(symbol => {
                    const price = getCurrentPrice(symbol);
                    const changeData = getPriceChangeData(symbol);
                    
                    return (
                      <div 
                        key={symbol}
                        className={`flex justify-between items-center p-3 rounded-lg cursor-pointer transition-all duration-200 ${
                          selectedSymbol === symbol 
                            ? 'bg-blue-900/30 border border-blue-700 shadow-md' 
                            : 'hover:bg-gray-800 border border-transparent'
                        }`}
                        onClick={() => {
                          setSelectedSymbol(symbol);
                          setChartKey(prev => prev + 1);
                        }}
                      >
                        <div className="flex flex-col">
                          <span className="text-white font-medium">{symbol}</span>
                          <div className={`text-xs px-2 py-1 rounded ${
                            changeData.isPositive ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
                          }`}>
                            {changeData.isPositive ? '+' : ''}{changeData.changePercent.toFixed(2)}%
                          </div>
                        </div>
                        
                        <div className="text-right">
                          {price > 0 ? (
                            <>
                              <div className="text-white font-semibold">₹{price.toFixed(2)}</div>
                              <div className="flex items-center gap-1">
                                <div className="text-xs text-green-400">LIVE</div>
                                <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse"></div>
                              </div>
                            </>
                          ) : (
                            <div className="text-gray-500">--</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ENHANCED Leaderboard */}
              <div className="bg-gray-900 rounded-lg p-6 shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Award className="w-5 h-5" />
                    Leaderboard
                  </h3>
                  <button
                    onClick={refreshLeaderboard}
                    disabled={refreshingLeaderboard}
                    className="text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${refreshingLeaderboard ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                
                {leaderboard.length > 0 ? (
                  <div className="space-y-3">
                    {leaderboard.slice(0, 10).map((entry, index) => (
                      <div 
                        key={entry.user_email}
                        className={`flex items-center justify-between p-3 rounded-lg transition-all duration-200 ${
                          entry.user_email === user.email 
                            ? 'bg-blue-900/30 border border-blue-700 shadow-md' 
                            : 'bg-gray-800 hover:bg-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            index === 0 ? 'bg-yellow-500 text-black' :
                            index === 1 ? 'bg-gray-400 text-black' :
                            index === 2 ? 'bg-orange-600 text-white' :
                            'bg-gray-700 text-white'
                          }`}>
                            {index + 1}
                          </div>
                          <div>
                            <div className="text-white text-sm font-medium">
                              {entry.user_name === user.name ? '👤 You' : entry.user_name}
                            </div>
                            <div className="text-xs text-gray-400">
                              {entry.user_email === user.email ? 'Your Position' : 'Participant'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-white font-semibold">
                            ₹{entry.total_wealth.toLocaleString()}
                          </div>
                          <div className={`text-xs font-medium ${
                            entry.return_percentage >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {entry.return_percentage >= 0 ? '+' : ''}{entry.return_percentage.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    <Users className="w-12 h-12 mx-auto mb-3" />
                    <p className="text-sm">No participants yet</p>
                    <p className="text-xs">Start trading to join the leaderboard!</p>
                  </div>
                )}
              </div>

              {/* Contest Info Card */}
              {marketState.contestStartTime && (
                <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-700 rounded-lg p-6">
                  <h4 className="text-blue-400 font-semibold mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Contest Timeline
                  </h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Started:</span>
                      <span className="text-white">
                        {new Date(marketState.contestStartTime).toLocaleString()}
                      </span>
                    </div>
                    {marketState.contestEndTime && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Ended:</span>
                        <span className="text-white">
                          {new Date(marketState.contestEndTime).toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div className="pt-3 border-t border-blue-800">
                      <div className="text-xs text-blue-300 flex items-center gap-2">
                        <AlertCircle className="w-3 h-3" />
                        All data shown from Time 0 regardless of when you joined
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* System Status */}
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">System Status</span>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-green-400">Online</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
