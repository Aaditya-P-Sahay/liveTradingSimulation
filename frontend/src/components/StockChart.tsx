import React, { useEffect, useRef, useState } from 'react';
import { StockData } from '../services/api';
import { TrendingUp, TrendingDown, Radio } from 'lucide-react';

interface StockChartProps {
  data: StockData[];
  symbol: string;
  isRealTime?: boolean;
  realtimeCount?: number;
}

export const StockChart: React.FC<StockChartProps> = ({ 
  data, 
  symbol, 
  isRealTime = false, 
  realtimeCount = 0 
}) => {
  const [chartType, setChartType] = useState<'line' | 'candlestick'>('line');
  const [timeRange, setTimeRange] = useState<'all' | '1h' | '6h' | '1d'>('all');
  const animationRef = useRef<number>();

  if (!data.length) return null;

  // Filter data based on time range
  const getFilteredData = () => {
    if (timeRange === 'all') return data;
    
    const now = new Date();
    const ranges = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000
    };
    
    const rangeMs = ranges[timeRange];
    const cutoff = new Date(now.getTime() - rangeMs);
    
    return data.filter(item => {
      const itemTime = new Date(item.normalized_timestamp || item.timestamp);
      return itemTime >= cutoff;
    });
  };

  // Sort data by unique_id to get chronological order
  const sortedData = getFilteredData().sort((a, b) => a.unique_id - b.unique_id);
  
  // Get price range for scaling with some padding
  const prices = sortedData.map(d => d.last_traded_price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;
  const padding = priceRange * 0.1; // 10% padding
  const chartMinPrice = minPrice - padding;
  const chartMaxPrice = maxPrice + padding;
  const chartPriceRange = chartMaxPrice - chartMinPrice;
  
  // Chart dimensions
  const width = 1000;
  const height = 400;
  const chartPadding = { top: 20, right: 80, bottom: 60, left: 80 };
  const chartWidth = width - chartPadding.left - chartPadding.right;
  const chartHeight = height - chartPadding.top - chartPadding.bottom;
  
  // Create SVG path for price line
  const createPath = (data: StockData[]) => {
    return data.map((point, index) => {
      const x = chartPadding.left + (index / Math.max(1, data.length - 1)) * chartWidth;
      const y = chartPadding.top + (1 - (point.last_traded_price - chartMinPrice) / chartPriceRange) * chartHeight;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  };

  // Create area fill path
  const createAreaPath = (data: StockData[]) => {
    if (data.length === 0) return '';
    
    const linePath = data.map((point, index) => {
      const x = chartPadding.left + (index / Math.max(1, data.length - 1)) * chartWidth;
      const y = chartPadding.top + (1 - (point.last_traded_price - chartMinPrice) / chartPriceRange) * chartHeight;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
    
    const lastX = chartPadding.left + chartWidth;
    const firstX = chartPadding.left;
    const bottomY = chartPadding.top + chartHeight;
    
    return `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  };

  const pathData = createPath(sortedData);
  const areaPathData = createAreaPath(sortedData);
  const latestPrice = sortedData[sortedData.length - 1]?.last_traded_price || 0;
  const firstPrice = sortedData[0]?.last_traded_price || 0;
  const priceChange = latestPrice - firstPrice;
  const priceChangePercent = firstPrice > 0 ? ((priceChange / firstPrice) * 100).toFixed(2) : '0.00';
  const isPositive = priceChange >= 0;

  // Generate Y-axis labels
  const yAxisLabels = [];
  const labelCount = 8;
  for (let i = 0; i < labelCount; i++) {
    const value = chartMinPrice + (chartPriceRange * i) / (labelCount - 1);
    const y = chartPadding.top + (1 - i / (labelCount - 1)) * chartHeight;
    yAxisLabels.push({ value, y });
  }

  // Generate X-axis labels
  const xAxisLabels = [];
  const xLabelStep = Math.max(1, Math.floor(sortedData.length / 8));
  for (let i = 0; i < sortedData.length; i += xLabelStep) {
    const point = sortedData[i];
    const x = chartPadding.left + (i / Math.max(1, sortedData.length - 1)) * chartWidth;
    
    // Format timestamp for display
    let displayTime = point.timestamp || `${i + 1}`;
    if (point.normalized_timestamp) {
      const date = new Date(point.normalized_timestamp);
      displayTime = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
    }
    
    xAxisLabels.push({ 
      x, 
      label: displayTime,
      index: i
    });
  }

  // Candlestick data generation (simplified)
  const generateCandlesticks = () => {
    const candles = [];
    const groupSize = Math.max(1, Math.floor(sortedData.length / 50)); // Group data points
    
    for (let i = 0; i < sortedData.length; i += groupSize) {
      const group = sortedData.slice(i, i + groupSize);
      if (group.length === 0) continue;
      
      const open = group[0].last_traded_price;
      const close = group[group.length - 1].last_traded_price;
      const high = Math.max(...group.map(d => d.high_price));
      const low = Math.min(...group.map(d => d.low_price));
      
      const x = chartPadding.left + ((i + groupSize / 2) / Math.max(1, sortedData.length - 1)) * chartWidth;
      const openY = chartPadding.top + (1 - (open - chartMinPrice) / chartPriceRange) * chartHeight;
      const closeY = chartPadding.top + (1 - (close - chartMinPrice) / chartPriceRange) * chartHeight;
      const highY = chartPadding.top + (1 - (high - chartMinPrice) / chartPriceRange) * chartHeight;
      const lowY = chartPadding.top + (1 - (low - chartMinPrice) / chartPriceRange) * chartHeight;
      
      candles.push({
        x, openY, closeY, highY, lowY,
        open, close, high, low,
        isGreen: close >= open,
        group
      });
    }
    
    return candles;
  };

  const candlesticks = chartType === 'candlestick' ? generateCandlesticks() : [];

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center space-x-4">
          <div>
            <h3 className="text-2xl font-bold text-gray-800">{symbol}</h3>
            <p className="text-sm text-gray-600">{sortedData[0]?.company_name}</p>
            <p className="text-xs text-gray-500 mt-1">
              {sortedData.length} data points
              {isRealTime && (
                <span className="inline-flex items-center ml-2">
                  <Radio className="w-3 h-3 text-green-500 mr-1" />
                  Live ({realtimeCount} updates)
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-gray-800">₹{latestPrice.toFixed(2)}</p>
            <p className={`text-lg font-semibold flex items-center justify-end ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {isPositive ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePercent}%)
            </p>
            <p className="text-xs text-gray-500">vs session start</p>
          </div>
        </div>
        
        {/* Chart Controls */}
        <div className="flex flex-col space-y-2">
          <div className="flex space-x-1">
            {['line', 'candlestick'].map((type) => (
              <button
                key={type}
                onClick={() => setChartType(type as 'line' | 'candlestick')}
                className={`px-3 py-1 text-xs rounded ${
                  chartType === type
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {type === 'candlestick' ? 'Candles' : 'Line'}
              </button>
            ))}
          </div>
          <div className="flex space-x-1">
            {(['all', '1h', '6h', '1d'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2 py-1 text-xs rounded ${
                  timeRange === range
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {range.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Chart */}
      <div className="mb-6 overflow-x-auto">
        <svg width={width} height={height} className="border rounded-lg bg-gray-50">
          <defs>
            <linearGradient id={`gradient-${symbol}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isPositive ? "#10b981" : "#ef4444"} stopOpacity="0.3"/>
              <stop offset="100%" stopColor={isPositive ? "#10b981" : "#ef4444"} stopOpacity="0.05"/>
            </linearGradient>
          </defs>
          
          {/* Grid lines */}
          {yAxisLabels.map((label, index) => (
            <line
              key={`hgrid-${index}`}
              x1={chartPadding.left}
              y1={label.y}
              x2={chartPadding.left + chartWidth}
              y2={label.y}
              stroke="#e5e7eb"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
          ))}
          
          {xAxisLabels.map((label, index) => (
            <line
              key={`vgrid-${index}`}
              x1={label.x}
              y1={chartPadding.top}
              x2={label.x}
              y2={chartPadding.top + chartHeight}
              stroke="#e5e7eb"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
          ))}
          
          {/* Chart Content */}
          {chartType === 'line' ? (
            <>
              {/* Area fill */}
              <path
                d={areaPathData}
                fill={`url(#gradient-${symbol})`}
              />
              
              {/* Price line */}
              <path
                d={pathData}
                fill="none"
                stroke={isPositive ? "#10b981" : "#ef4444"}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : (
            /* Candlestick chart */
            candlesticks.map((candle, index) => (
              <g key={`candle-${index}`}>
                {/* High-Low line */}
                <line
                  x1={candle.x}
                  y1={candle.highY}
                  x2={candle.x}
                  y2={candle.lowY}
                  stroke={candle.isGreen ? "#10b981" : "#ef4444"}
                  strokeWidth="1"
                />
                
                {/* Candle body */}
                <rect
                  x={candle.x - 3}
                  y={Math.min(candle.openY, candle.closeY)}
                  width="6"
                  height={Math.abs(candle.closeY - candle.openY) || 1}
                  fill={candle.isGreen ? "#10b981" : "#ef4444"}
                  stroke={candle.isGreen ? "#10b981" : "#ef4444"}
                  strokeWidth="1"
                >
                  <title>
                    Open: ₹{candle.open.toFixed(2)}
                    High: ₹{candle.high.toFixed(2)}
                    Low: ₹{candle.low.toFixed(2)}
                    Close: ₹{candle.close.toFixed(2)}
                  </title>
                </rect>
              </g>
            ))
          )}
          
          {/* Data points for line chart */}
          {chartType === 'line' && sortedData.filter((_, index) => index % Math.max(1, Math.floor(sortedData.length / 50)) === 0).map((point, index) => {
            const actualIndex = sortedData.indexOf(point);
            const x = chartPadding.left + (actualIndex / Math.max(1, sortedData.length - 1)) * chartWidth;
            const y = chartPadding.top + (1 - (point.last_traded_price - chartMinPrice) / chartPriceRange) * chartHeight;
            return (
              <circle
                key={point.unique_id}
                cx={x}
                cy={y}
                r="3"
                fill={isPositive ? "#10b981" : "#ef4444"}
                stroke="white"
                strokeWidth="2"
                className="hover:r-6 transition-all cursor-pointer"
              >
                <title>
                  {`₹${point.last_traded_price.toFixed(2)} at ${point.timestamp}
Volume: ${point.volume_traded.toLocaleString()}
High: ₹${point.high_price.toFixed(2)}
Low: ₹${point.low_price.toFixed(2)}`}
                </title>
              </circle>
            );
          })}
          
          {/* Y-axis labels */}
          {yAxisLabels.map((label, index) => (
            <text
              key={`ylabel-${index}`}
              x={chartPadding.left - 10}
              y={label.y + 4}
              fontSize="11"
              fill="#6b7280"
              textAnchor="end"
              fontFamily="monospace"
            >
              ₹{label.value.toFixed(0)}
            </text>
          ))}
          
          {/* X-axis labels */}
          {xAxisLabels.map((label, index) => (
            <text
              key={`xlabel-${index}`}
              x={label.x}
              y={chartPadding.top + chartHeight + 20}
              fontSize="10"
              fill="#6b7280"
              textAnchor="middle"
              transform={`rotate(-45, ${label.x}, ${chartPadding.top + chartHeight + 20})`}
            >
              {label.label}
            </text>
          ))}
          
          {/* Chart border */}
          <rect
            x={chartPadding.left}
            y={chartPadding.top}
            width={chartWidth}
            height={chartHeight}
            fill="none"
            stroke="#d1d5db"
            strokeWidth="1"
          />
        </svg>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-gray-600 text-xs uppercase tracking-wide">Volume</p>
          <p className="font-bold text-lg">{latestPrice ? sortedData[sortedData.length - 1]?.volume_traded.toLocaleString() : 0}</p>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-gray-600 text-xs uppercase tracking-wide">High</p>
          <p className="font-bold text-lg text-green-600">₹{Math.max(...sortedData.map(d => d.high_price)).toFixed(2)}</p>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-gray-600 text-xs uppercase tracking-wide">Low</p>
          <p className="font-bold text-lg text-red-600">₹{Math.min(...sortedData.map(d => d.low_price)).toFixed(2)}</p>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-gray-600 text-xs uppercase tracking-wide">Avg Price</p>
          <p className="font-bold text-lg">₹{latestPrice ? sortedData[sortedData.length - 1]?.average_traded_price.toFixed(2) : 0}</p>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-gray-600 text-xs uppercase tracking-wide">Data Points</p>
          <p className="font-bold text-lg text-blue-600">{sortedData.length}</p>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-gray-600 text-xs uppercase tracking-wide">Range</p>
          <p className="font-bold text-lg text-purple-600">{timeRange.toUpperCase()}</p>
        </div>
      </div>
    </div>
  );
};