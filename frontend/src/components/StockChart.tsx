import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { useMarket } from '../../contexts/MarketContext';
import { socket } from '../../lib/socket';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

interface LiveStockChartProps {
  symbol: string;
  chartType: 'line' | 'candlestick';
}

export const LiveStockChart: React.FC<LiveStockChartProps> = ({ symbol, chartType }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line' | 'Candlestick'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const { marketState } = useMarket();
  
  // Store raw data and candles
  const rawDataRef = useRef<any[]>([]);
  const candlesRef = useRef<Map<number, any>>(new Map());
  const lastProcessedTick = useRef<number>(-1);
  const currentCandleRef = useRef<any>(null);

  // Parse timestamp
  const parseTimestamp = (timestamp: string): number => {
    const date = new Date(timestamp);
    return Math.floor(date.getTime() / 1000);
  };

  // Create 30-second candles from raw data
  const create30SecondCandles = useCallback((data: any[]) => {
    const candles: any[] = [];
    let currentCandle: any = null;
    const interval = 30; // 30 seconds

    data.forEach((tick) => {
      const time = parseTimestamp(tick.timestamp || tick.normalized_timestamp);
      const candleTime = Math.floor(time / interval) * interval;

      if (!currentCandle || currentCandle.time !== candleTime) {
        if (currentCandle) {
          candles.push(currentCandle);
        }
        currentCandle = {
          time: candleTime as Time,
          open: tick.last_traded_price,
          high: tick.last_traded_price,
          low: tick.last_traded_price,
          close: tick.last_traded_price,
        };
      } else {
        currentCandle.high = Math.max(currentCandle.high, tick.last_traded_price);
        currentCandle.low = Math.min(currentCandle.low, tick.last_traded_price);
        currentCandle.close = tick.last_traded_price;
      }
    });

    if (currentCandle) {
      candles.push(currentCandle);
    }

    return candles;
  }, []);

  // Update chart with new data
  const updateChartData = useCallback(() => {
    if (!seriesRef.current || !rawDataRef.current.length) return;

    if (chartType === 'candlestick') {
      const candles = create30SecondCandles(rawDataRef.current);
      seriesRef.current.setData(candles);
    } else {
      const lineData = rawDataRef.current.map((d: any) => ({
        time: parseTimestamp(d.timestamp || d.normalized_timestamp) as Time,
        value: d.last_traded_price,
      }));
      seriesRef.current.setData(lineData);
    }
  }, [chartType, create30SecondCandles]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean up existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { color: '#1a1a1a' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2a2a2a' },
        horzLines: { color: '#2a2a2a' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Create series based on chart type
    if (chartType === 'line') {
      const lineSeries = chart.addLineSeries({
        color: '#2962FF',
        lineWidth: 2,
      });
      seriesRef.current = lineSeries as any;
    } else {
      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#10b981',
        downColor: '#ef4444',
        borderUpColor: '#10b981',
        borderDownColor: '#ef4444',
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      });
      seriesRef.current = candlestickSeries as any;
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    // Update chart with existing data if we have any
    if (rawDataRef.current.length > 0) {
      updateChartData();
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [chartType, updateChartData]);

  // Load initial data and set up WebSocket listeners
  useEffect(() => {
    if (!symbol) return;

    let mounted = true;

    const loadInitialData = async () => {
      try {
        setLoading(true);
        
        // Get historical data up to current tick
        const { data } = await axios.get(
          `${API_URL}/history/${symbol}/range?from=0&to=${marketState.currentTickIndex || 0}`
        );
        
        if (data.data && data.data.length > 0 && mounted) {
          rawDataRef.current = data.data;
          lastProcessedTick.current = marketState.currentTickIndex || 0;
          updateChartData();
        }
      } catch (error) {
        console.error('Failed to load initial data:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    // Socket event handlers
    const handleConnect = () => {
      console.log('✅ Connected to market');
      setIsConnected(true);
      socket.emit('join_symbol', symbol);
    };

    const handleDisconnect = () => {
      console.log('❌ Disconnected from market');
      setIsConnected(false);
    };

    const handleHistoricalData = (data: any) => {
      if (data.symbol === symbol && data.data && mounted) {
        console.log(`Received historical data for ${symbol}: ${data.data.length} points`);
        rawDataRef.current = data.data;
        lastProcessedTick.current = data.currentMarketTick || 0;
        updateChartData();
      }
    };

    const handleSymbolTick = (data: any) => {
      if (data.symbol === symbol && data.data && mounted) {
        // Add new tick to raw data
        rawDataRef.current.push(data.data);
        lastProcessedTick.current = data.tickIndex;
        
        // Update chart immediately
        updateChartData();
        
        console.log(`New tick for ${symbol} at index ${data.tickIndex}: $${data.data.last_traded_price}`);
      }
    };

    const handleMarketTick = (data: any) => {
      if (mounted && data.prices && data.prices[symbol]) {
        // Update last price if we have it
        const lastItem = rawDataRef.current[rawDataRef.current.length - 1];
        if (lastItem) {
          lastItem.last_traded_price = data.prices[symbol];
          updateChartData();
        }
      }
    };

    // Load initial data
    loadInitialData();

    // Set up socket listeners
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('historical_data', handleHistoricalData);
    socket.on('symbol_tick', handleSymbolTick);
    socket.on('market_tick', handleMarketTick);

    // Check connection status
    if (socket.connected) {
      handleConnect();
    }

    return () => {
      mounted = false;
      socket.emit('leave_symbol', symbol);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('historical_data', handleHistoricalData);
      socket.off('symbol_tick', handleSymbolTick);
      socket.off('market_tick', handleMarketTick);
    };
  }, [symbol, marketState.currentTickIndex, updateChartData]);

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-white">
            {symbol} - {chartType === 'line' ? 'Line Chart' : 'Candlestick Chart'}
          </h3>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
            }`} />
            <span className="text-xs text-gray-400">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          
          {marketState.isRunning && (
            <>
              <span className="text-xs text-blue-400">
                {marketState.isPaused ? '⏸️ Paused' : '▶️ Live'} @ {marketState.speed}x
              </span>
              <span className="text-xs text-gray-500">
                Tick: {marketState.currentTickIndex}/{marketState.totalTicks}
              </span>
            </>
          )}
        </div>
      </div>

      {marketState.isRunning && (
        <div className="mb-4">
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${marketState.progress || 0}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-400">
              Progress: {(marketState.progress || 0).toFixed(1)}%
            </span>
            <span className="text-xs text-gray-400">
              Elapsed: {Math.floor((marketState.elapsedTime || 0) / 60000)}m
            </span>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center items-center h-[400px]">
          <div className="text-gray-400">Loading chart data...</div>
        </div>
      )}
      
      <div ref={chartContainerRef} style={{ display: loading ? 'none' : 'block' }} />
      
      {!marketState.isRunning && !loading && (
        <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
          <p className="text-yellow-400 text-sm">
            ⚠️ Market is not running. Use admin controls to start the contest.
          </p>
        </div>
      )}
    </div>
  );
};