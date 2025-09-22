import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts';
import { useMarket } from '../../contexts/MarketContext';
import { apiService } from '../../services/api';
import TimeframeSelector from './TimeframeSelector';
import { useTimeframes } from '../../hooks/useTimeframes';

interface LiveStockChartProps {
  symbol: string;
  chartType: 'line' | 'candlestick';
}

export const LiveStockChart: React.FC<LiveStockChartProps> = ({ symbol, chartType }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [candleCount, setCandleCount] = useState(0);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
  const [isChartReady, setIsChartReady] = useState(false);
  
  const { socket, isConnected, marketState } = useMarket();
  const { selectedTimeframe, setSelectedTimeframe, getTimeframeLabel } = useTimeframes();
  
  // Store current candles
  const currentCandlesRef = useRef<any[]>([]);

  // Initialize chart with proper configuration
  const initializeChart = useCallback(() => {
    if (!chartContainerRef.current || chartRef.current) return;

    console.log(`🎯 Initializing ${chartType} chart for ${symbol} (${selectedTimeframe})`);
    
    try {
      const container = chartContainerRef.current;
      const rect = container.getBoundingClientRect();
      
      const chart = createChart(container, {
        width: Math.max(rect.width || 800, 400),
        height: 500,
        layout: {
          background: { color: '#000000' },
          textColor: '#ffffff',
        },
        grid: {
          vertLines: { color: '#1e1e1e' },
          horzLines: { color: '#1e1e1e' },
        },
        crosshair: {
          mode: 1,
          vertLine: { color: '#758696', width: 1, style: 1 },
          horzLine: { color: '#758696', width: 1, style: 1 },
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: true,
          borderColor: '#2e2e2e',
          rightOffset: 12,
          barSpacing: 6,
          fixLeftEdge: false,
          lockVisibleTimeRangeOnResize: false,
          rightBarStaysOnScroll: true,
        },
        rightPriceScale: {
          borderColor: '#2e2e2e',
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
      });

      chartRef.current = chart;

      if (chartType === 'line') {
        const lineSeries = chart.addLineSeries({
          color: '#00ff88',
          lineWidth: 2,
          priceLineVisible: true,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
        });
        seriesRef.current = lineSeries;
      } else {
        const candlestickSeries = chart.addCandlestickSeries({
          upColor: '#00ff88',
          downColor: '#ff4444',
          borderUpColor: '#00ff88',
          borderDownColor: '#ff4444',
          wickUpColor: '#00ff88',
          wickDownColor: '#ff4444',
          priceLineVisible: true,
          lastValueVisible: true,
        });
        seriesRef.current = candlestickSeries;
      }

      // Handle resize
      const resizeObserver = new ResizeObserver((entries) => {
        if (chartRef.current) {
          const entry = entries[0];
          if (entry) {
            const { width: newWidth, height: newHeight } = entry.contentRect;
            chartRef.current.applyOptions({ 
              width: Math.max(newWidth, 400), 
              height: Math.max(newHeight, 400) 
            });
          }
        }
      });
      
      resizeObserver.observe(container);
      setIsChartReady(true);
      
      console.log(`✅ Chart initialized for ${symbol} (${selectedTimeframe})`);

    } catch (error) {
      console.error('❌ Chart initialization error:', error);
      setError('Failed to initialize chart');
      setIsChartReady(false);
    }
  }, [chartType, symbol, selectedTimeframe]);

  // Update chart data
  const updateChartData = useCallback((candles: any[]) => {
    if (!seriesRef.current || !isChartReady || !candles || candles.length === 0) {
      return;
    }

    try {
      if (chartType === 'candlestick') {
        const formattedCandles = candles.map(candle => ({
          time: candle.time as UTCTimestamp,
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
        }));
        
        seriesRef.current.setData(formattedCandles);
        
      } else {
        const lineData = candles.map(candle => ({
          time: candle.time as UTCTimestamp,
          value: Number(candle.close),
        }));
        
        seriesRef.current.setData(lineData);
      }

      setCandleCount(candles.length);
      setLastUpdateTime(Date.now());
      setError('');
      
      console.log(`📊 Chart updated: ${candles.length} candles for ${symbol} (${selectedTimeframe})`);
      
    } catch (error) {
      console.error('❌ Chart update error:', error);
      setError('Failed to update chart');
    }
  }, [chartType, selectedTimeframe, symbol, isChartReady]);

  // Handle timeframe changes
  const handleTimeframeChange = useCallback((newTimeframe: string) => {
    console.log(`🔄 Changing timeframe to ${newTimeframe} for ${symbol}`);
    
    // Clear current data
    currentCandlesRef.current = [];
    setCandleCount(0);
    setLastUpdateTime(0);
    
    // Clear chart
    if (seriesRef.current) {
      seriesRef.current.setData([]);
    }
    
    setSelectedTimeframe(newTimeframe);
  }, [setSelectedTimeframe, symbol]);

  // Initialize chart when dependencies change
  useEffect(() => {
    // Clean up existing chart
    if (chartRef.current) {
      try {
        chartRef.current.remove();
      } catch (e) {
        console.debug('Chart cleanup:', e);
      }
      chartRef.current = null;
      seriesRef.current = null;
      setIsChartReady(false);
    }
    
    // Clear data
    currentCandlesRef.current = [];
    setCandleCount(0);
    setLastUpdateTime(0);
    setError('');
    
    // Initialize new chart
    const initTimeout = setTimeout(() => {
      initializeChart();
    }, 100);
    
    return () => clearTimeout(initTimeout);
  }, [chartType, selectedTimeframe, initializeChart]);

  // Setup WebSocket and load initial data
  useEffect(() => {
    if (!symbol || !socket || !isChartReady) return;

    let mounted = true;
    console.log(`🔄 Setting up progressive data for ${symbol} (${selectedTimeframe})`);

    // Load initial data
    const loadInitialData = async () => {
      try {
        setLoading(true);
        
        const response = await apiService.getCandlestick(symbol, selectedTimeframe);
        
        if (response.data && mounted) {
          console.log(`📊 Initial data loaded: ${response.data.length} candles`);
          currentCandlesRef.current = [...response.data];
          updateChartData(response.data);
        }
      } catch (error: any) {
        console.error(`❌ Failed to load initial data:`, error);
        if (mounted) {
          setError(error.message || 'Failed to load data');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    // Subscribe to WebSocket updates
    socket.emit('subscribe_timeframe', { symbol, timeframe: selectedTimeframe });
    socket.emit('join_symbol', symbol);

    // Handle progressive candle updates
    const handleProgressiveCandleUpdate = (data: any) => {
      if (data.symbol === symbol && data.timeframe === selectedTimeframe && data.candle && mounted) {
        console.log(`🔔 Progressive update: ${symbol} (${selectedTimeframe}) - ${data.isNew ? 'NEW' : 'UPDATE'} candle`);
        
        const existingCandles = [...currentCandlesRef.current];
        const candleIndex = existingCandles.findIndex(c => c.time === data.candle.time);
        
        if (candleIndex >= 0) {
          // Update existing candle
          existingCandles[candleIndex] = data.candle;
        } else {
          // Add new candle
          existingCandles.push(data.candle);
          existingCandles.sort((a, b) => a.time - b.time);
        }
        
        currentCandlesRef.current = existingCandles;
        updateChartData(existingCandles);
        
        // Auto-scroll to show new candles
        if (data.isNew && chartRef.current) {
          chartRef.current.timeScale().scrollToRealTime();
        }
      }
    };

    // Handle initial progressive candles
    const handleInitialProgressiveCandles = (data: any) => {
      if (data.symbol === symbol && data.timeframe === selectedTimeframe && mounted) {
        console.log(`📊 Initial progressive candles: ${data.candles?.length || 0}`);
        
        if (data.candles) {
          currentCandlesRef.current = [...data.candles];
          updateChartData(data.candles);
        }
      }
    };

    // Handle progressive contest data
    const handleProgressiveContestData = (data: any) => {
      if (data.symbol === symbol && data.timeframes && mounted) {
        const timeframeCandles = data.timeframes[selectedTimeframe] || [];
        console.log(`📊 Progressive contest data: ${timeframeCandles.length} candles`);
        
        currentCandlesRef.current = [...timeframeCandles];
        updateChartData(timeframeCandles);
      }
    };

    // Register event listeners
    socket.on('progressive_candle_update', handleProgressiveCandleUpdate);
    socket.on('initial_progressive_candles', handleInitialProgressiveCandles);
    socket.on('progressive_contest_data', handleProgressiveContestData);

    // Load initial data
    loadInitialData();

    return () => {
      mounted = false;
      if (socket) {
        socket.off('progressive_candle_update', handleProgressiveCandleUpdate);
        socket.off('initial_progressive_candles', handleInitialProgressiveCandles);
        socket.off('progressive_contest_data', handleProgressiveContestData);
        socket.emit('unsubscribe_timeframe', { symbol, timeframe: selectedTimeframe });
      }
    };
  }, [symbol, selectedTimeframe, socket, isChartReady, updateChartData]);

  const timeSinceLastUpdate = lastUpdateTime > 0 ? Date.now() - lastUpdateTime : 0;
  const isLiveUpdating = timeSinceLastUpdate < 10000; // Live if updated within 10 seconds

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      {/* Header */}
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              {symbol} - Progressive {chartType === 'line' ? 'Line' : 'Candlestick'} Chart
              {isLiveUpdating && <span className="text-green-400 animate-pulse">🔴 LIVE</span>}
            </h3>
            <div className="flex items-center gap-4 mt-2 text-sm">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${
                  isConnected && isLiveUpdating ? 'bg-green-500 animate-pulse' : 
                  isConnected ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className={`${isLiveUpdating ? 'text-green-400' : 'text-gray-400'}`}>
                  {isConnected ? (isLiveUpdating ? 'LIVE STREAMING' : 'Connected') : 'Disconnected'}
                </span>
              </div>
              
              {marketState.isRunning && (
                <span className="text-blue-400 font-medium">
                  {marketState.isPaused ? '⏸️ PAUSED' : '🚀 PROGRESSIVE'} @ {marketState.speed}x
                </span>
              )}
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-2xl font-bold text-green-400">
              {candleCount} Candles
            </div>
            <div className="text-sm text-gray-400">
              {getTimeframeLabel(selectedTimeframe)}
            </div>
            {lastUpdateTime > 0 && (
              <div className="text-xs text-gray-500 mt-1">
                Last: {Math.floor(timeSinceLastUpdate / 1000)}s ago
              </div>
            )}
          </div>
        </div>

        {/* Timeframe Selector */}
        <TimeframeSelector
          selectedTimeframe={selectedTimeframe}
          onTimeframeChange={handleTimeframeChange}
          className="justify-center"
        />
      </div>

      {/* Contest Progress */}
      {marketState.isRunning && (
        <div className="mb-4">
          <div className="w-full bg-gray-800 rounded-full h-3">
            <div 
              className="bg-gradient-to-r from-blue-500 via-green-500 to-yellow-500 h-3 rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${marketState.progress || 0}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-sm">
            <span className="text-blue-400 font-medium">
              Progress: {(marketState.progress || 0).toFixed(2)}%
            </span>
            <span className="text-green-400 font-medium">
              Elapsed: {Math.floor((marketState.elapsedTime || 0) / 60000)}m {Math.floor(((marketState.elapsedTime || 0) % 60000) / 1000)}s
            </span>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
          ⚠️ {error}
          <button 
            onClick={() => window.location.reload()} 
            className="ml-3 px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-xs"
          >
            Reload
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="mb-4 p-3 bg-blue-900/20 border border-blue-700 rounded-lg text-blue-200 text-sm flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
          Loading progressive chart data...
        </div>
      )}
      
      {/* Chart Container */}
      <div 
        ref={chartContainerRef} 
        className="w-full bg-black rounded-lg"
        style={{ 
          height: '500px',
          minHeight: '500px'
        }} 
      />
      
      {/* Status Panel */}
      <div className="mt-4 p-4 bg-gradient-to-r from-green-900/20 to-blue-900/20 border border-green-700/50 rounded-lg">
        <h4 className="text-green-400 font-bold mb-3 flex items-center gap-2">
          ✨ Progressive Chart Status
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-green-300">Chart:</span>
            <span className="text-white ml-2 font-semibold">
              {isChartReady ? '✅ Ready' : '⏳ Loading'}
            </span>
          </div>
          <div>
            <span className="text-green-300">Candles:</span>
            <span className="text-yellow-400 ml-2 font-semibold">{candleCount}</span>
          </div>
          <div>
            <span className="text-green-300">Type:</span>
            <span className="text-blue-400 ml-2 font-semibold">{chartType}</span>
          </div>
          <div>
            <span className="text-green-300">Status:</span>
            <span className={`ml-2 font-semibold ${
              isLiveUpdating ? 'text-green-400' : 'text-gray-400'
            }`}>
              {isLiveUpdating ? '🟢 LIVE' : '⚫ Idle'}
            </span>
          </div>
        </div>
        
        {marketState.isRunning && candleCount === 0 && (
          <div className="mt-3 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600/20 border border-blue-500 rounded-full text-blue-300 text-sm">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
              Building candles progressively... Watch them appear!
            </div>
          </div>
        )}

        {!marketState.isRunning && (
          <div className="mt-3 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-gray-600/20 border border-gray-500 rounded-full text-gray-300 text-sm">
              <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
              Start contest to see progressive candle formation
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveStockChart;