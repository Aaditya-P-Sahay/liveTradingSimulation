import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts';
import { useMarket } from '../../contexts/MarketContext';
import { apiService } from '../../services/api';
import TimeframeSelector from './TimeframeSelector';

interface LiveStockChartProps {
  symbol: string;
  chartType: 'line' | 'candlestick';
}

export const LiveStockChart: React.FC<LiveStockChartProps> = ({ symbol, chartType }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState('30s');
  const [candleCount, setCandleCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  
  const { socket, isConnected, marketState } = useMarket();
  
  const currentCandlesRef = useRef<any[]>([]);

  // Initialize chart with better settings
  const initializeChart = useCallback(() => {
    if (!chartContainerRef.current || chartRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: '#000000' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2a2a2a' },
        horzLines: { color: '#2a2a2a' },
      },
      crosshair: {
        mode: 1, // Magnet mode for better UX
        vertLine: {
          color: '#6A5ACD',
          width: 1,
          style: 2,
          labelBackgroundColor: '#6A5ACD',
        },
        horzLine: {
          color: '#6A5ACD',
          width: 1,
          style: 2,
          labelBackgroundColor: '#6A5ACD',
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderColor: '#333333',
        rightOffset: 5,
        barSpacing: 10,
      },
      rightPriceScale: {
        borderColor: '#333333',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
    });

    chartRef.current = chart;

    // Create series based on chart type
    if (chartType === 'line') {
      const lineSeries = chart.addLineSeries({
        color: '#00ff88',
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
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
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
      });
      seriesRef.current = candlestickSeries;
    }

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [chartType]);

  // Update chart with new candle data
  const updateChartData = useCallback((candles: any[]) => {
    if (!seriesRef.current || !candles || candles.length === 0) return;

    try {
      const formattedData = candles.map(candle => {
        if (chartType === 'candlestick') {
          return {
            time: candle.time as UTCTimestamp,
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
          };
        } else {
          return {
            time: candle.time as UTCTimestamp,
            value: Number(candle.close),
          };
        }
      });

      seriesRef.current.setData(formattedData);
      
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
      
      setCandleCount(candles.length);
      setLastUpdate(new Date());
      
    } catch (error) {
      console.error('Error updating chart:', error);
    }
  }, [chartType]);

  // Initialize chart on mount
  useEffect(() => {
    initializeChart();
    
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [initializeChart]);

  // Load initial data and subscribe to updates
  useEffect(() => {
    if (!symbol || !socket || !isConnected) return;

    const loadInitialData = async () => {
      try {
        setLoading(true);
        const response = await apiService.getCandlestick(symbol, selectedTimeframe);
        
        if (response.data) {
          currentCandlesRef.current = response.data;
          updateChartData(response.data);
        }
      } catch (error) {
        console.error('Error loading initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    // Subscribe to candle updates
    socket.emit('subscribe_candles', { symbol, timeframe: selectedTimeframe });

    // Handle initial candles
    socket.on('initial_candles', (data: any) => {
      if (data.symbol === symbol && data.timeframe === selectedTimeframe) {
        currentCandlesRef.current = data.candles;
        updateChartData(data.candles);
      }
    });

    // Handle new candle updates
    socket.on('candle_update', (data: any) => {
      if (data.symbol === symbol && data.timeframe === selectedTimeframe && data.candle) {
        const updatedCandles = [...currentCandlesRef.current];
        
        if (data.isNew) {
          updatedCandles.push(data.candle);
        } else {
          // Update existing candle
          const lastIndex = updatedCandles.length - 1;
          if (lastIndex >= 0) {
            updatedCandles[lastIndex] = data.candle;
          }
        }
        
        currentCandlesRef.current = updatedCandles;
        updateChartData(updatedCandles);
      }
    });

    loadInitialData();

    return () => {
      socket.emit('unsubscribe_candles', { symbol, timeframe: selectedTimeframe });
      socket.off('initial_candles');
      socket.off('candle_update');
    };
  }, [symbol, selectedTimeframe, socket, isConnected, updateChartData]);

  return (
    <div className="bg-gray-900 rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-xl font-bold text-white">
            {symbol} - {chartType === 'line' ? 'Line' : 'Candlestick'} Chart
          </h3>
          <div className="flex items-center gap-4 mt-2 text-sm">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-gray-400">{isConnected ? 'Live' : 'Disconnected'}</span>
            </div>
            {candleCount > 0 && (
              <span className="text-gray-400">
                {candleCount} candles
              </span>
            )}
            {lastUpdate && (
              <span className="text-gray-400">
                Updated: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
        
        <TimeframeSelector
          selectedTimeframe={selectedTimeframe}
          onTimeframeChange={(tf) => {
            setSelectedTimeframe(tf);
            currentCandlesRef.current = [];
            setCandleCount(0);
          }}
        />
      </div>

      {marketState.isRunning && (
        <div className="mb-4">
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full transition-all duration-1000"
              style={{ width: `${Math.min(marketState.progress || 0, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-gray-400">
            <span>Progress: {(marketState.progress || 0).toFixed(1)}%</span>
            <span>Elapsed: {Math.floor((marketState.elapsedTime || 0) / 60000)}m</span>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center items-center h-[500px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      )}

      <div 
        ref={chartContainerRef} 
        style={{ display: loading ? 'none' : 'block' }}
        className="w-full"
      />

      {!marketState.isRunning && !loading && (
        <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
          <p className="text-yellow-400 text-sm">
            ⚠️ Contest not running. Start the contest from admin panel to see live candles.
          </p>
        </div>
      )}
    </div>
  );
};

export default LiveStockChart;