import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData, CandlestickData, Time } from 'lightweight-charts';
import { useMarket } from '../../contexts/MarketContext';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

interface LiveStockChartProps {
  symbol: string;
  chartType: 'line' | 'candlestick';
}

function parseTimestamp(timestamp: string, baseDate?: Date): number {
  const base = baseDate || new Date();
  base.setHours(9, 15, 0, 0); // Market opens at 9:15 AM
  
  if (timestamp.includes(':')) {
    const parts = timestamp.split(':');
    const minutes = parseInt(parts[0]);
    const secondsParts = parts[1].split('.');
    const seconds = parseInt(secondsParts[0]);
    const milliseconds = parseInt(secondsParts[1] || '0') * 100;
    
    base.setMinutes(base.getMinutes() + minutes);
    base.setSeconds(seconds);
    base.setMilliseconds(milliseconds);
  }
  
  return Math.floor(base.getTime() / 1000);
}

export const LiveStockChart: React.FC<LiveStockChartProps> = ({ symbol, chartType }) => {
  const { socket, marketState, isConnected } = useMarket();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line' | 'Candlestick'> | null>(null);
  const [lastPrice, setLastPrice] = useState(0);
  const [priceChange, setPriceChange] = useState(0);
  const [loading, setLoading] = useState(true);
  
  // Store raw data for candle formation
  const rawDataRef = useRef<any[]>([]);
  const currentCandleRef = useRef<any>(null);
  const candlesRef = useRef<Map<number, any>>(new Map());
  const lastProcessedTick = useRef<number>(-1);

  // Helper to create 30-second candles from raw data
  const create30SecondCandles = useCallback((data: any[]) => {
    const candles = new Map<number, any>();
    const intervalMs = 30000; // 30 seconds
    
    data.forEach(tick => {
      const timestamp = parseTimestamp(tick.timestamp);
      const candleTime = Math.floor(timestamp * 1000 / intervalMs) * intervalMs / 1000;
      
      if (!candles.has(candleTime)) {
        candles.set(candleTime, {
          time: candleTime as Time,
          open: tick.last_traded_price,
          high: tick.last_traded_price,
          low: tick.last_traded_price,
          close: tick.last_traded_price,
          volume: tick.volume_traded || 0
        });
      } else {
        const candle = candles.get(candleTime);
        candle.high = Math.max(candle.high, tick.last_traded_price);
        candle.low = Math.min(candle.low, tick.last_traded_price);
        candle.close = tick.last_traded_price;
        candle.volume += tick.volume_traded || 0;
      }
    });
    
    return Array.from(candles.values()).sort((a, b) => a.time - b.time);
  }, []);

  // Recreate chart when type changes
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean up old chart
    if (chartRef.current) {
      chartRef.current.remove();
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { color: '#1a1a2e' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#2a2a3e' },
        horzLines: { color: '#2a2a3e' },
      },
      rightPriceScale: {
        borderColor: '#2a2a3e',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: '#2a2a3e',
        rightOffset: 5,
        barSpacing: 3,
        fixLeftEdge: true,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: true,
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    if (chartType === 'line') {
      const lineSeries = chart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: '#ffffff',
        crosshairMarkerBackgroundColor: '#3b82f6',
        lastValueVisible: true,
        priceLineVisible: true,
      });
      seriesRef.current = lineSeries as any;
    } else {
      const candleSeries = chart.addCandlestickSeries({
        upColor: '#10b981',
        downColor: '#ef4444',
        borderUpColor: '#10b981',
        borderDownColor: '#ef4444',
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      });
      seriesRef.current = candleSeries as any;
    }

    // Fit content
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    // Clear data refs when chart type changes
    rawDataRef.current = [];
    currentCandleRef.current = null;
    candlesRef.current.clear();
    lastProcessedTick.current = -1;

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [chartType]); // Recreate when chartType changes

  // Load initial data when symbol changes or market starts
  useEffect(() => {
    if (!symbol) {
      setLoading(false);
      return;
    }

    const loadInitialData = async () => {
      try {
        setLoading(true);
        
        // Get historical data up to current tick
        const { data } = await axios.get(
          `${API_URL}/history/${symbol}/range?from=0&to=${marketState.currentTickIndex || 0}`
        );
        
        if (data.data && data.data.length > 0 && seriesRef.current) {
          rawDataRef.current = data.data;
          
          if (chartType === 'candlestick') {
            // Create 30-second candles
            const candles = create30SecondCandles(data.data);
            candlesRef.current = new Map(candles.map(c => [c.time, c]));
            
            // For large datasets, limit initial display
            if (candles.length > 5000) {
              seriesRef.current.setData(candles.slice(-5000));
            } else {
              seriesRef.current.setData(candles);
            }
          } else {
            // Line chart - show all points but downsample if too many
            const formattedData = data.data.map((d: any) => ({
              time: parseTimestamp(d.timestamp) as Time,
              value: d.last_traded_price,
            }));
            
            if (formattedData.length > 10000) {
              // Downsample for performance
              const step = Math.ceil(formattedData.length / 10000);
const downsampled = formattedData.filter(
  (_: { time: Time; value: number }, index: number) => index % step === 0
);              seriesRef.current.setData(downsampled);
            } else {
              seriesRef.current.setData(formattedData);
            }
          }
          
          // Update price display
          const lastTick = data.data[data.data.length - 1];
          if (lastTick) {
            setLastPrice(lastTick.last_traded_price);
            const change = ((lastTick.last_traded_price - lastTick.open_price) / lastTick.open_price) * 100;
            setPriceChange(change);
          }
          
          lastProcessedTick.current = marketState.currentTickIndex || 0;
          
          // Fit content after data load
          if (chartRef.current) {
            chartRef.current.timeScale().fitContent();
          }
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, [symbol, chartType, marketState.isRunning, create30SecondCandles]);

  // Handle live tick updates
  const handleTick = useCallback((tickData: any) => {
    if (tickData.symbol !== symbol || !seriesRef.current) return;
    
    const { data, globalTickIndex } = tickData;
    
    // Skip if already processed
    if (globalTickIndex <= lastProcessedTick.current) return;
    lastProcessedTick.current = globalTickIndex;
    
    rawDataRef.current.push(data);
    
    const timestamp = parseTimestamp(data.timestamp);
    
    if (chartType === 'line') {
      // Update line chart immediately
      seriesRef.current.update({
        time: timestamp as Time,
        value: data.last_traded_price,
      });
    } else {
      // Update/create 30-second candle
      const intervalMs = 30000;
      const candleTime = Math.floor(timestamp * 1000 / intervalMs) * intervalMs / 1000;
      
      if (!currentCandleRef.current || currentCandleRef.current.time !== candleTime) {
        // Start new candle
        currentCandleRef.current = {
          time: candleTime as Time,
          open: data.last_traded_price,
          high: data.last_traded_price,
          low: data.last_traded_price,
          close: data.last_traded_price,
        };
        candlesRef.current.set(candleTime, currentCandleRef.current);
        // Add new candle to chart
        seriesRef.current.update(currentCandleRef.current);
      } else {
        // Update existing candle
        currentCandleRef.current.high = Math.max(currentCandleRef.current.high, data.last_traded_price);
        currentCandleRef.current.low = Math.min(currentCandleRef.current.low, data.last_traded_price);
        currentCandleRef.current.close = data.last_traded_price;
        // Update the candle on chart
        seriesRef.current.update(currentCandleRef.current);
      }
    }
    
    // Update price display
    setLastPrice(data.last_traded_price);
    const change = ((data.last_traded_price - data.open_price) / data.open_price) * 100;
    setPriceChange(change);
  }, [symbol, chartType]);

  // Subscribe to WebSocket updates
  useEffect(() => {
    if (!socket || !symbol) return;

    socket.emit('join_symbol', symbol);
    socket.on('tick', handleTick);

    // Also listen for historical data updates
    const handleHistoricalData = (data: any) => {
      if (data.symbol === symbol && seriesRef.current) {
        console.log(`Received historical data for ${symbol}: ${data.data.length} points`);
      }
    };
    
    socket.on('historical_data', handleHistoricalData);

    return () => {
      socket.off('tick', handleTick);
      socket.off('historical_data', handleHistoricalData);
      socket.emit('leave_symbol', symbol);
    };
  }, [socket, symbol, handleTick]);

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-xl font-bold text-white">{symbol}</h3>
          <div className="flex items-center gap-4 mt-1">
            <span className="text-2xl font-semibold text-white">
              ₹{lastPrice.toFixed(2)}
            </span>
            <span className={`text-sm font-medium ${
              priceChange >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-1">
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
              {chartType === 'candlestick' && (
                <span className="text-xs text-yellow-400">
                  📊 30-sec candles
                </span>
              )}
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
              Elapsed: {Math.floor((marketState.elapsedTime || 0) / 60000)}m {Math.floor(((marketState.elapsedTime || 0) % 60000) / 1000)}s
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