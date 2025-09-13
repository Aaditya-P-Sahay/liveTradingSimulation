import React, { useState, useEffect, useCallback } from 'react';
import { StockChart } from './components/StockChart';
import { StockSelector } from './components/StockSelector';
import { DataTable } from './components/DataTable';
import { ConnectionStatus } from './components/ConnectionStatus';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PerformanceMonitor, usePerformanceMonitoring } from './components/PerformanceMonitor';
import { Watchlist } from './components/Watchlist';
import { Activity, RefreshCw, Wifi, WifiOff, Settings, BarChart3, List } from 'lucide-react';
import { apiService, StockData } from './services/api';
import { webSocketService, StockTick } from './services/websocket';

function App() {
  const [stockData, setStockData] = useState<StockData[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [liveUpdates, setLiveUpdates] = useState<boolean>(true);
  const [realtimeTicks, setRealtimeTicks] = useState<StockTick[]>([]);

  // UI state
  const [showWatchlist, setShowWatchlist] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'chart' | 'table' | 'both'>('both');

  // Performance monitoring
  const { isMonitoring, toggleMonitoring } = usePerformanceMonitoring();

  // Initialize WebSocket connection
  useEffect(() => {
    webSocketService.connect();

    const unsubscribeConnection = webSocketService.subscribeToConnection((connected) => {
      setIsConnected(connected);
      if (!connected) {
        setError('Lost connection to server. Attempting to reconnect...');
      } else {
        setError('');
      }
    });

    return () => {
      unsubscribeConnection();
      webSocketService.disconnect();
    };
  }, []);

  // Fetch available symbols
  useEffect(() => {
    const fetchSymbols = async () => {
      try {
        setLoading(true);
        const symbolList = await apiService.getSymbols();
        setSymbols(symbolList);
        
        if (symbolList.length > 0 && !selectedSymbol) {
          // Try to load last selected symbol from localStorage
          const lastSymbol = localStorage.getItem('lastSelectedSymbol');
          if (lastSymbol && symbolList.includes(lastSymbol)) {
            setSelectedSymbol(lastSymbol);
          } else {
            setSelectedSymbol(symbolList[0]);
          }
        }
      } catch (err) {
        setError('Failed to fetch symbols: ' + (err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchSymbols();
  }, [selectedSymbol]);

  // Save selected symbol to localStorage
  useEffect(() => {
    if (selectedSymbol) {
      localStorage.setItem('lastSelectedSymbol', selectedSymbol);
    }
  }, [selectedSymbol]);

  // Handle real-time tick updates
  const handleRealtimeTick = useCallback((tick: StockTick) => {
    if (!liveUpdates) return;

    // Add to realtime ticks array (keep last 100 ticks)
    setRealtimeTicks(prev => {
      const updated = [...prev, tick];
      return updated.slice(-100);
    });

    // Update main stock data with the new tick
    setStockData(prev => {
      const existingIndex = prev.findIndex(item => item.unique_id === tick.data.unique_id);
      
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = tick.data;
        return updated;
      } else {
        return [...prev, tick.data].sort((a, b) => a.unique_id - b.unique_id);
      }
    });
  }, [liveUpdates]);

  // Subscribe to real-time updates for selected symbol
  useEffect(() => {
    if (!selectedSymbol || !isConnected) return;

    console.log(`Subscribing to real-time updates for ${selectedSymbol}`);
    
    const unsubscribeTicks = webSocketService.subscribeToTicks(selectedSymbol, handleRealtimeTick);
    
    const unsubscribeHistorical = webSocketService.subscribeToHistoricalData(selectedSymbol, (data) => {
      console.log(`Received historical data for ${selectedSymbol}: ${data.data.length} points`);
      setStockData(data.data);
      setRealtimeTicks([]);
    });

    return () => {
      unsubscribeTicks();
      unsubscribeHistorical();
    };
  }, [selectedSymbol, isConnected, handleRealtimeTick]);

  // Fetch historical data for selected symbol (fallback when WebSocket is not connected)
  useEffect(() => {
    if (!selectedSymbol || isConnected) return;

    const fetchStockData = async () => {
      try {
        setLoading(true);
        setError('');
        
        const data = await apiService.getAllHistory(selectedSymbol);
        setStockData(data);
        setRealtimeTicks([]);
        
        console.log(`Loaded ${data.length} historical data points for ${selectedSymbol}`);
      } catch (err) {
        setError('Failed to fetch stock data: ' + (err as Error).message);
        console.error('Error fetching stock data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStockData();
  }, [selectedSymbol, isConnected]);

  const refreshData = async () => {
    if (!selectedSymbol) return;
    
    setLoading(true);
    try {
      const data = await apiService.getAllHistory(selectedSymbol);
      setStockData(data);
      setRealtimeTicks([]);
      setError('');
    } catch (err) {
      setError('Failed to refresh data: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggleLiveUpdates = () => {
    setLiveUpdates(!liveUpdates);
    if (!liveUpdates && selectedSymbol && isConnected) {
      webSocketService.joinSymbol(selectedSymbol);
    }
  };

  const handleSymbolChange = (symbol: string) => {
    setSelectedSymbol(symbol);
    setStockData([]);
    setRealtimeTicks([]);
    setError('');
  };

  // Combine historical and real-time data
  const allStockData = React.useMemo(() => {
    if (!liveUpdates) return stockData;
    
    const realtimeData = realtimeTicks.map(tick => tick.data);
    const combined = [...stockData];
    
    realtimeData.forEach(tick => {
      const existingIndex = combined.findIndex(item => item.unique_id === tick.unique_id);
      if (existingIndex >= 0) {
        combined[existingIndex] = tick;
      } else {
        combined.push(tick);
      }
    });
    
    return combined.sort((a, b) => a.unique_id - b.unique_id);
  }, [stockData, realtimeTicks, liveUpdates]);

  return (
    <ErrorBoundary>
      <div className={`min-h-screen bg-gray-50 transition-all duration-300 ${showWatchlist ? 'ml-80' : ''}`}>
        {/* Watchlist */}
        <Watchlist
          isVisible={showWatchlist}
          onToggleVisibility={() => setShowWatchlist(!showWatchlist)}
          onSymbolSelect={handleSymbolChange}
          selectedSymbol={selectedSymbol}
        />

        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center">
              <Activity className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-3xl font-bold text-gray-800">Live Market Simulator</h1>
                <p className="text-gray-600">
                  Real-time stock data with WebSocket • {allStockData.length.toLocaleString()} data points
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              {/* View Mode Toggle */}
              <div className="flex bg-gray-100 rounded-lg p-1">
                {[
                  { mode: 'chart' as const, icon: BarChart3, label: 'Chart' },
                  { mode: 'table' as const, icon: List, label: 'Table' },
                  { mode: 'both' as const, icon: Activity, label: 'Both' }
                ].map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center ${
                      viewMode === mode
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                    title={label}
                  >
                    <Icon className="w-4 h-4 mr-1" />
                    <span className="hidden md:inline">{label}</span>
                  </button>
                ))}
              </div>

              {/* Connection Status Indicator */}
              <div className="flex items-center">
                {isConnected ? (
                  <Wifi className="w-5 h-5 text-green-600 mr-2" />
                ) : (
                  <WifiOff className="w-5 h-5 text-red-600 mr-2" />
                )}
                <span className={`text-sm font-medium ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
                  {isConnected ? 'Live' : 'Offline'}
                </span>
              </div>
              
              {/* Live Updates Toggle */}
              <button
                onClick={toggleLiveUpdates}
                disabled={!isConnected}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  liveUpdates
                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title={liveUpdates ? 'Pause live updates' : 'Resume live updates'}
              >
                {liveUpdates ? 'Live' : 'Paused'}
              </button>

              {/* Performance Monitor Toggle */}
              <button
                onClick={toggleMonitoring}
                className={`p-2 rounded-lg transition-colors ${
                  isMonitoring ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600 hover:text-gray-800'
                }`}
                title="Toggle performance monitor"
              >
                <Settings className="w-5 h-5" />
              </button>

              {/* Refresh Button */}
              <button
                onClick={refreshData}
                disabled={loading}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                title="Refresh data"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden md:inline">Refresh</span>
              </button>
            </div>
          </div>

          {/* Connection Status Component */}
          <ConnectionStatus 
            isConnected={isConnected}
            selectedSymbol={selectedSymbol}
            dataCount={allStockData.length}
            realtimeCount={realtimeTicks.length}
          />

          {/* Error Message */}
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center">
              <div className="flex-1">{error}</div>
              <button
                onClick={() => setError('')}
                className="ml-4 text-red-500 hover:text-red-700"
              >
                ×
              </button>
            </div>
          )}

          {/* Stock Selector */}
          <StockSelector
            symbols={symbols}
            selectedSymbol={selectedSymbol}
            onSymbolChange={handleSymbolChange}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />

          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mr-3" />
              <div>
                <p className="text-gray-600">Loading stock data...</p>
                <p className="text-sm text-gray-500">Please wait while we fetch the latest data</p>
              </div>
            </div>
          )}

          {/* Main Content */}
          {!loading && allStockData.length > 0 && (
            <div className="space-y-6">
              {/* Stock Chart */}
              {(viewMode === 'chart' || viewMode === 'both') && (
                <div className="animate-fade-in">
                  <StockChart 
                    data={allStockData} 
                    symbol={selectedSymbol}
                    isRealTime={liveUpdates && isConnected}
                    realtimeCount={realtimeTicks.length}
                  />
                </div>
              )}

              {/* Data Table */}
              {(viewMode === 'table' || viewMode === 'both') && (
                <div className="animate-fade-in">
                  <DataTable 
                    data={allStockData} 
                    highlightRecent={liveUpdates && realtimeTicks.length > 0}
                  />
                </div>
              )}
            </div>
          )}

          {/* No Data Message */}
          {!loading && allStockData.length === 0 && selectedSymbol && (
            <div className="text-center py-12">
              <Activity className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-600 mb-2">No Data Available</h3>
              <p className="text-gray-500 mb-4">No stock data found for {selectedSymbol}</p>
              <button
                onClick={refreshData}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {/* No Symbol Selected */}
          {!selectedSymbol && symbols.length > 0 && (
            <div className="text-center py-12">
              <BarChart3 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-600 mb-2">Select a Stock</h3>
              <p className="text-gray-500">Choose a stock symbol from above to view real-time data</p>
            </div>
          )}
        </div>

        {/* Performance Monitor */}
        <PerformanceMonitor 
          isVisible={isMonitoring} 
          onToggle={toggleMonitoring}
        />

        {/* Custom Styles */}
        <style jsx>{`
          @keyframes fade-in {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          
          .animate-fade-in {
            animation: fade-in 0.5s ease-out;
          }
        `}</style>
      </div>
    </ErrorBoundary>
  );
}

export default App;