import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { supabase } from '../../lib/supabase';
import { 
  ComposedChart, 
  CandlestickChart, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  ResponsiveContainer,
  Bar,
  Line,
  ReferenceLine
} from 'recharts';
import { ZoomIn, ZoomOut, Move, TrendingUp } from 'lucide-react';
import { TechnicalIndicators } from './TechnicalIndicators';

interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  date: string;
}

export const TradingChart: React.FC = () => {
  const { 
    chartState, 
    updateChartState, 
    marketData, 
    candlestickData,
    updateCandlestickData 
  } = useStore();
  
  const [chartData, setChartData] = useState<CandleData[]>([]);
  const [crosshair, setCrosshair] = useState({ x: 0, y: 0, visible: false });
  const [hoveredData, setHoveredData] = useState<CandleData | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // Generate realistic candlestick data
  const generateCandlestickData = useCallback((symbol: string, timeframe: string) => {
    const basePrice = marketData[symbol]?.last_traded_price || 150;
    const data: CandleData[] = [];
    const now = Date.now();
    const timeframeMs = {
      '1M': 60 * 1000,
      '5M': 5 * 60 * 1000,
      '15M': 15 * 60 * 1000,
      '1H': 60 * 60 * 1000,
    }[timeframe] || 60 * 1000;

    let currentPrice = basePrice;
    
    for (let i = 100; i >= 0; i--) {
      const timestamp = now - (i * timeframeMs);
      const volatility = 0.02; // 2% volatility
      
      const open = currentPrice;
      const change = (Math.random() - 0.5) * volatility * open;
      const close = Math.max(0.01, open + change);
      
      const high = Math.max(open, close) * (1 + Math.random() * 0.01);
      const low = Math.min(open, close) * (1 - Math.random() * 0.01);
      const volume = Math.floor(Math.random() * 1000000) + 100000;
      
      data.push({
        timestamp,
        open: Number(open.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(close.toFixed(2)),
        volume,
        date: new Date(timestamp).toLocaleTimeString(),
      });
      
      currentPrice = close;
    }
    
    return data;
  }, [marketData]);

  // Update chart data when symbol or timeframe changes
  useEffect(() => {
    const data = generateCandlestickData(chartState.symbol, chartState.timeframe);
    setChartData(data);
    updateCandlestickData(chartState.symbol, data);
  }, [chartState.symbol, chartState.timeframe, generateCandlestickData, updateCandlestickData]);

  // Real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (marketData[chartState.symbol]) {
        const currentData = marketData[chartState.symbol];
        const newPrice = currentData.last_traded_price;
        
        setChartData(prev => {
          const updated = [...prev];
          const lastCandle = updated[updated.length - 1];
          
          if (lastCandle) {
            // Update the last candle
            lastCandle.close = newPrice;
            lastCandle.high = Math.max(lastCandle.high, newPrice);
            lastCandle.low = Math.min(lastCandle.low, newPrice);
            lastCandle.volume = currentData.volume_traded;
          }
          
          return updated;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [chartState.symbol, marketData]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (chartRef.current) {
      const rect = chartRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      setCrosshair({ x, y, visible: true });
      updateChartState({
        crosshair: { x, y, visible: true }
      });
    }
  };

  const handleMouseLeave = () => {
    setCrosshair({ x: 0, y: 0, visible: false });
    updateChartState({
      crosshair: { x: 0, y: 0, visible: false }
    });
    setHoveredData(null);
  };

  const CustomCandlestick = (props: any) => {
    const { payload, x, y, width, height } = props;
    if (!payload) return null;

    const { open, close, high, low } = payload;
    const isUp = close > open;
    const color = isUp ? '#00B894' : '#D63031';
    
    const bodyHeight = Math.abs(close - open);
    const bodyY = Math.min(open, close);
    
    return (
      <g>
        {/* Wick */}
        <line
          x1={x + width / 2}
          y1={high}
          x2={x + width / 2}
          y2={low}
          stroke={color}
          strokeWidth={1}
        />
        {/* Body */}
        <rect
          x={x + 1}
          y={bodyY}
          width={width - 2}
          height={bodyHeight || 1}
          fill={isUp ? color : color}
          stroke={color}
          strokeWidth={1}
        />
      </g>
    );
  };

  const currentPrice = chartData[chartData.length - 1]?.close || 0;
  const priceChange = chartData.length > 1 
    ? currentPrice - chartData[chartData.length - 2].close 
    : 0;
  const priceChangePercent = chartData.length > 1 
    ? (priceChange / chartData[chartData.length - 2].close) * 100 
    : 0;

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-700/30 rounded-xl overflow-hidden">
      {/* Chart Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700/30">
        <div className="flex items-center space-x-4">
          <h3 className="text-lg font-bold text-white">{chartState.symbol}</h3>
          <div className="flex items-center space-x-2">
            <span className="text-2xl font-bold text-white">
              ${currentPrice.toFixed(2)}
            </span>
            <span className={`text-sm font-medium ${
              priceChange >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)} ({priceChangePercent.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Timeframe Selector */}
        <div className="flex items-center space-x-2">
          {(['1M', '5M', '15M', '1H'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => updateChartState({ timeframe: tf })}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                chartState.timeframe === tf
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Container */}
      <div 
        ref={chartRef}
        className="relative h-96"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
            <XAxis 
              dataKey="date" 
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#9CA3AF', fontSize: 12 }}
            />
            <YAxis 
              domain={['dataMin - 1', 'dataMax + 1']}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#9CA3AF', fontSize: 12 }}
              orientation="right"
            />
            
            {/* Candlesticks */}
            <Bar 
              dataKey="close" 
              shape={<CustomCandlestick />}
              fill="transparent"
            />
            
            {/* Technical Indicators */}
            {chartState.indicators.map((indicator, index) => (
              indicator.visible && (
                <Line
                  key={`${indicator.name}-${index}`}
                  type="monotone"
                  dataKey={`indicator_${index}`}
                  stroke={indicator.color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
              )
            ))}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Crosshair */}
        {crosshair.visible && (
          <>
            <div
              className="absolute border-l border-amber-400/50 pointer-events-none"
              style={{
                left: crosshair.x,
                top: 0,
                height: '100%',
              }}
            />
            <div
              className="absolute border-t border-amber-400/50 pointer-events-none"
              style={{
                top: crosshair.y,
                left: 0,
                width: '100%',
              }}
            />
          </>
        )}

        {/* Hovered Data Display */}
        {hoveredData && (
          <div
            className="absolute bg-gray-800/90 backdrop-blur-sm border border-gray-600 rounded-lg p-3 pointer-events-none z-10"
            style={{
              left: Math.min(crosshair.x + 10, chartRef.current?.clientWidth! - 200),
              top: Math.max(crosshair.y - 80, 10),
            }}
          >
            <div className="text-xs text-gray-300 space-y-1">
              <div>Time: {hoveredData.date}</div>
              <div>Open: ${hoveredData.open.toFixed(2)}</div>
              <div>High: ${hoveredData.high.toFixed(2)}</div>
              <div>Low: ${hoveredData.low.toFixed(2)}</div>
              <div>Close: ${hoveredData.close.toFixed(2)}</div>
              <div>Volume: {hoveredData.volume.toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>

      {/* Volume Chart */}
      <div className="h-24 border-t border-gray-700/30">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Bar 
              dataKey="volume" 
              fill="#6B7280" 
              opacity={0.6}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Technical Indicators Panel */}
      <TechnicalIndicators />
    </div>
  );
};