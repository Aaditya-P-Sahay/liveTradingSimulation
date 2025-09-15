import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData, CandlestickData } from 'lightweight-charts';
import { webSocketService } from '../../services/websocket';
import { apiService } from '../../services/api';

interface StockChartProps {
  symbol: string;
  chartType: 'line' | 'candlestick';
}

export const StockChart: React.FC<StockChartProps> = ({ symbol, chartType }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line' | 'Candlestick'> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastPrice, setLastPrice] = useState<number>(0);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chartContainerRef.current) return;

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
      timeScale: {
        borderColor: '#2a2a3e',
      },
    });

    chartRef.current = chart;

    if (chartType === 'line') {
      const lineSeries = chart.addLineSeries({
        color: '#3b82f6',
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

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [chartType]);

  // Load initial data from API
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        if (chartType === 'candlestick') {
          const response = await apiService.getCandlestick(symbol, '1m');
          if (response.data && seriesRef.current) {
            const formattedData = response.data.map((d: any) => ({
              time: new Date(d.time).getTime() / 1000,
              open: d.open,
              high: d.high,
              low: d.low,
              close: d.close,
            }));
            seriesRef.current.setData(formattedData);
          }
        } else {
          const response = await apiService.getHistory(symbol, 1, 100);
          if (response.data && seriesRef.current) {
            const formattedData = response.data.map((d: any) => ({
              time: new Date(d.timestamp).getTime() / 1000,
              value: d.last_traded_price,
            }));
            seriesRef.current.setData(formattedData);
          }
        }
      } catch (error) {
        console.error('Failed to load initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, [symbol, chartType]);

  // Subscribe to WebSocket updates
  useEffect(() => {
    const unsubscribeConnection = webSocketService.subscribeToConnection(setIsConnected);
    
    const unsubscribeTicks = webSocketService.subscribeToTicks(symbol, (tick) => {
      if (!seriesRef.current) return;

      const price = tick.data.last_traded_price;
      const timestamp = Math.floor(new Date(tick.data.timestamp).getTime() / 1000);

      if (chartType === 'line') {
        const lineData: LineData = {
          time: timestamp as any,
          value: price,
        };
        seriesRef.current.update(lineData);
      } else {
        const candleData: CandlestickData = {
          time: timestamp as any,
          open: tick.data.open_price,
          high: tick.data.high_price,
          low: tick.data.low_price,
          close: price,
        };
        seriesRef.current.update(candleData);
      }

      setLastPrice(price);
      setPriceChange(((price - tick.data.open_price) / tick.data.open_price) * 100);
    });

    webSocketService.joinSymbol(symbol);

    return () => {
      unsubscribeConnection();
      unsubscribeTicks();
      webSocketService.leaveSymbol(symbol);
    };
  }, [symbol, chartType]);

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
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`} />
          <span className="text-xs text-gray-400">
            {isConnected ? 'Live' : 'Disconnected'}
          </span>
        </div>
      </div>
      {loading && (
        <div className="flex justify-center items-center h-[400px]">
          <div className="text-gray-400">Loading chart data...</div>
        </div>
      )}
      <div ref={chartContainerRef} className="w-full" style={{ display: loading ? 'none' : 'block' }} />
    </div>
  );
};