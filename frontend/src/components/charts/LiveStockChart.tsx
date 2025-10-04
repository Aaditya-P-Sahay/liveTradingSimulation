import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
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

  // === Chart Initialization ===
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
        mode: 1,
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

    // Add series
    if (chartType === 'line') {
      seriesRef.current = chart.addLineSeries({
        color: '#00ff88',
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
    } else {
      seriesRef.current = chart.addCandlestickSeries({
        upColor: '#00ff88',
        downColor: '#ff4444',
        borderUpColor: '#00ff88',
        borderDownColor: '#ff4444',
        wickUpColor: '#00ff88',
        wickDownColor: '#ff4444',
        priceLineVisible: true,
        lastValueVisible: true,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
    }

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        const newWidth = chartContainerRef.current.clientWidth;
        chart.applyOptions({ width: newWidth });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [chartType]);

  // === Helpers ===
  const formatCandle = (candle: any) => {
    if (chartType === 'candlestick') {
      return {
        time: candle.time as UTCTimestamp,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      };
    }
    return { time: candle.time as UTCTimestamp, value: Number(candle.close) };
  };

  const setAllData = (candles: any[]) => {
    if (!seriesRef.current) return;
    const formatted = candles.map(formatCandle);
    seriesRef.current.setData(formatted);
    setCandleCount(formatted.length);
    setLastUpdate(new Date());
  };

  const updateLastCandle = (candle: any, isNew: boolean) => {
    if (!seriesRef.current) return;
    const formatted = formatCandle(candle);
    if (isNew) {
      seriesRef.current.update(formatted);
    } else {
      seriesRef.current.update(formatted);
    }
    setCandleCount(currentCandlesRef.current.length);
    setLastUpdate(new Date());
  };

  // === Mount chart ===
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

  // === Data Loading + Socket Handling ===
  useEffect(() => {
    if (!symbol || !socket || !isConnected) return;

    const loadInitialData = async () => {
      try {
        setLoading(true);
        const response = await apiService.getCandlestick(symbol, selectedTimeframe);
        if (response.data) {
          currentCandlesRef.current = response.data;
          setAllData(response.data);
          console.log('[INIT DATA]', symbol, selectedTimeframe, response.data.length);
        }
      } catch (error) {
        console.error('Error loading initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    socket.emit('subscribe_candles', { symbol, timeframe: selectedTimeframe });

    // Initial candles
    socket.on('initial_candles', (data: any) => {
      console.log('[SOCKET INIT]', data.symbol, data.timeframe, 'candles:', data.candles?.length);
      if (data.symbol === symbol && data.timeframe === selectedTimeframe) {
        currentCandlesRef.current = data.candles;
        setAllData(data.candles);
      }
    });

    // Candle updates
    socket.on('candle_update', (data: any) => {
      console.log('[SOCKET UPDATE]', {
        symbol: data.symbol,
        tf: data.timeframe,
        isNew: data.isNew,
        time: data.candle?.time,
      });

      if (data.symbol === symbol && data.timeframe === selectedTimeframe && data.candle) {
        if (data.isNew) {
          currentCandlesRef.current.push(data.candle);
          updateLastCandle(data.candle, true);
        } else {
          if (currentCandlesRef.current.length > 0) {
            currentCandlesRef.current[currentCandlesRef.current.length - 1] = data.candle;
          }
          updateLastCandle(data.candle, false);
        }

        // Keep a rolling window (e.g., last 200 candles)
        if (currentCandlesRef.current.length > 200) {
          currentCandlesRef.current = currentCandlesRef.current.slice(-200);
        }
      }
    });

    loadInitialData();

    return () => {
      socket.emit('unsubscribe_candles', { symbol, timeframe: selectedTimeframe });
      socket.off('initial_candles');
      socket.off('candle_update');
    };
  }, [symbol, selectedTimeframe, socket, isConnected]);

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
            {candleCount > 0 && <span className="text-gray-400">{candleCount} candles</span>}
            {lastUpdate && <span className="text-gray-400">Updated: {lastUpdate.toLocaleTimeString()}</span>}
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
