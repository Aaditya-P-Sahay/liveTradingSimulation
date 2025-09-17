import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { useMarket } from '../../contexts/MarketContext';
import { apiService } from '../../services/api';

interface LiveStockChartProps {
  symbol: string;
  chartType: 'line' | 'candlestick';
}

export const LiveStockChart: React.FC<LiveStockChartProps> = ({ symbol, chartType }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line' | 'Candlestick'> | null>(null);
  const [loading, setLoading] = useState(true);
  const { socket, isConnected, marketState, subscribeToSymbol, unsubscribeFromSymbol } = useMarket();
  
  const rawDataRef = useRef<any[]>([]);
  const isDisposedRef = useRef(false);

  const parseTimestamp = useCallback((timestamp: string): number => {
    const date = new Date(timestamp);
    return Math.floor(date.getTime() / 1000);
  }, []);

  const create30SecondCandles = useCallback((data: any[]) => {
    const candles: any[] = [];
    let currentCandle: any = null;
    const interval = 30;

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
  }, [parseTimestamp]);

  const updateChartData = useCallback(() => {
    if (isDisposedRef.current || !seriesRef.current || !rawDataRef.current.length) {
      return;
    }

    try {
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
    } catch (error) {
      console.debug('Chart update skipped:', error);
    }
  }, [chartType, create30SecondCandles, parseTimestamp]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    isDisposedRef.current = false;

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
      if (chartContainerRef.current && !isDisposedRef.current && chartRef.current) {
        try {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
          });
        } catch (error) {
          console.debug('Resize skipped:', error);
        }
      }
    };
    
    window.addEventListener('resize', handleResize);

    return () => {
      isDisposedRef.current = true;
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (error) {
          console.debug('Chart cleanup error:', error);
        }
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [chartType]);

  // Load contest data and set up WebSocket
  useEffect(() => {
    if (!symbol || !socket) return;

    let mounted = true;

    const loadContestData = async () => {
      try {
        setLoading(true);
        
        // Load complete contest data from start to current tick
        const { data } = await apiService.getContestData(symbol, 0, marketState.currentDataTick);
        
        if (data.data && data.data.length > 0 && mounted && !isDisposedRef.current) {
          rawDataRef.current = data.data;
          updateChartData();
          console.log(`📈 Loaded contest data for ${symbol}: ${data.data.length} points from contest start`);
        }
      } catch (error) {
        console.error('Failed to load contest data:', error);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    // Subscribe to symbol updates
    subscribeToSymbol(symbol);

    // Set up socket listeners
    const handleContestData = (data: any) => {
      if (!mounted || isDisposedRef.current) return;
      if (data.symbol === symbol && data.data) {
        console.log(`📊 Received contest data for ${symbol}: ${data.data.length} points`);
        rawDataRef.current = data.data;
        updateChartData();
      }
    };

    const handleSymbolTick = (data: any) => {
      if (!mounted || isDisposedRef.current) return;
      if (data.symbol === symbol && data.data) {
        rawDataRef.current.push(data.data);
        updateChartData();
        console.log(`📈 New tick for ${symbol} at tick ${data.tickIndex}: ₹${data.data.last_traded_price}`);
      }
    };

    const handleMarketTick = (data: any) => {
      if (!mounted || isDisposedRef.current) return;
      if (data.prices && data.prices[symbol]) {
        const lastItem = rawDataRef.current[rawDataRef.current.length - 1];
        if (lastItem) {
          lastItem.last_traded_price = data.prices[symbol];
          updateChartData();
        }
      }
    };

    socket.on('contest_data', handleContestData);
    socket.on('symbol_tick', handleSymbolTick);
    socket.on('market_tick', handleMarketTick);

    // Load initial data
    loadContestData();

    return () => {
      mounted = false;
      unsubscribeFromSymbol(symbol);
      socket.off('contest_data', handleContestData);
      socket.off('symbol_tick', handleSymbolTick);
      socket.off('market_tick', handleMarketTick);
    };
  }, [symbol, socket, marketState.currentDataTick, subscribeToSymbol, unsubscribeFromSymbol, updateChartData]);

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
                Tick: {marketState.currentDataTick}/{marketState.totalDataTicks}
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
          <div className="text-gray-400">Loading contest chart data...</div>
        </div>
      )}
      
      <div 
        ref={chartContainerRef} 
        style={{ 
          display: loading ? 'none' : 'block',
          minHeight: '400px'
        }} 
      />
      
      {!marketState.isRunning && !loading && (
        <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
          <p className="text-yellow-400 text-sm">
            ⚠️ Contest is not running. Use admin controls to start the contest to see live data.
          </p>
        </div>
      )}
    </div>
  );
};