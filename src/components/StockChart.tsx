import React from 'react'
import { StockData } from '../lib/supabase'

interface StockChartProps {
  data: StockData[]
  symbol: string
}

export const StockChart: React.FC<StockChartProps> = ({ data, symbol }) => {
  if (!data.length) return null

  // Sort data by unique_id to get chronological order
  const sortedData = [...data].sort((a, b) => a.unique_id - b.unique_id)
  
  // Get price range for scaling with some padding
  const prices = sortedData.map(d => d.last_traded_price)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const priceRange = maxPrice - minPrice
  const padding = priceRange * 0.1 // 10% padding
  const chartMinPrice = minPrice - padding
  const chartMaxPrice = maxPrice + padding
  const chartPriceRange = chartMaxPrice - chartMinPrice
  
  // Chart dimensions
  const width = 1000
  const height = 400
  const chartPadding = { top: 20, right: 60, bottom: 40, left: 60 }
  const chartWidth = width - chartPadding.left - chartPadding.right
  const chartHeight = height - chartPadding.top - chartPadding.bottom
  
  // Create SVG path for price line
  const createPath = (data: StockData[]) => {
    return data.map((point, index) => {
      const x = chartPadding.left + (index / (data.length - 1)) * chartWidth
      const y = chartPadding.top + (1 - (point.last_traded_price - chartMinPrice) / chartPriceRange) * chartHeight
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    }).join(' ')
  }

  // Create area fill path
  const createAreaPath = (data: StockData[]) => {
    const linePath = data.map((point, index) => {
      const x = chartPadding.left + (index / (data.length - 1)) * chartWidth
      const y = chartPadding.top + (1 - (point.last_traded_price - chartMinPrice) / chartPriceRange) * chartHeight
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    }).join(' ')
    
    const lastX = chartPadding.left + chartWidth
    const firstX = chartPadding.left
    const bottomY = chartPadding.top + chartHeight
    
    return `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`
  }

  const pathData = createPath(sortedData)
  const areaPathData = createAreaPath(sortedData)
  const latestPrice = sortedData[sortedData.length - 1]?.last_traded_price || 0
  const firstPrice = sortedData[0]?.last_traded_price || 0
  const priceChange = latestPrice - firstPrice
  const priceChangePercent = ((priceChange / firstPrice) * 100).toFixed(2)
  const isPositive = priceChange >= 0

  // Generate Y-axis labels
  const yAxisLabels = []
  const labelCount = 6
  for (let i = 0; i < labelCount; i++) {
    const value = chartMinPrice + (chartPriceRange * i) / (labelCount - 1)
    const y = chartPadding.top + (1 - i / (labelCount - 1)) * chartHeight
    yAxisLabels.push({ value, y })
  }

  // Generate X-axis labels (show every 10th point or so)
  const xAxisLabels = []
  const xLabelStep = Math.max(1, Math.floor(sortedData.length / 10))
  for (let i = 0; i < sortedData.length; i += xLabelStep) {
    const point = sortedData[i]
    const x = chartPadding.left + (i / (sortedData.length - 1)) * chartWidth
    xAxisLabels.push({ 
      x, 
      label: point.timestamp || `${i + 1}`,
      index: i
    })
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-2xl font-bold text-gray-800">{symbol}</h3>
          <p className="text-sm text-gray-600">{sortedData[0]?.company_name}</p>
          <p className="text-xs text-gray-500 mt-1">{sortedData.length} data points</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-gray-800">₹{latestPrice.toFixed(2)}</p>
          <p className={`text-lg font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePercent}%)
          </p>
          <p className="text-xs text-gray-500">vs first data point</p>
        </div>
      </div>
      
      <div className="mb-6 overflow-x-auto">
        <svg width={width} height={height} className="border rounded-lg bg-gray-50">
          {/* Grid lines */}
          <defs>
            <linearGradient id={`gradient-${symbol}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isPositive ? "#10b981" : "#ef4444"} stopOpacity="0.3"/>
              <stop offset="100%" stopColor={isPositive ? "#10b981" : "#ef4444"} stopOpacity="0.05"/>
            </linearGradient>
          </defs>
          
          {/* Horizontal grid lines */}
          {yAxisLabels.map((label, index) => (
            <g key={index}>
              <line
                x1={chartPadding.left}
                y1={label.y}
                x2={chartPadding.left + chartWidth}
                y2={label.y}
                stroke="#e5e7eb"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
            </g>
          ))}
          
          {/* Vertical grid lines */}
          {xAxisLabels.map((label, index) => (
            <line
              key={index}
              x1={label.x}
              y1={chartPadding.top}
              x2={label.x}
              y2={chartPadding.top + chartHeight}
              stroke="#e5e7eb"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
          ))}
          
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
          
          {/* Data points (show every nth point to avoid overcrowding) */}
          {sortedData.filter((_, index) => index % Math.max(1, Math.floor(sortedData.length / 50)) === 0).map((point, index) => {
            const actualIndex = sortedData.indexOf(point)
            const x = chartPadding.left + (actualIndex / (sortedData.length - 1)) * chartWidth
            const y = chartPadding.top + (1 - (point.last_traded_price - chartMinPrice) / chartPriceRange) * chartHeight
            return (
              <circle
                key={point.unique_id}
                cx={x}
                cy={y}
                r="3"
                fill={isPositive ? "#10b981" : "#ef4444"}
                stroke="white"
                strokeWidth="1"
                className="hover:r-6 transition-all cursor-pointer"
              >
                <title>
                  {`₹${point.last_traded_price.toFixed(2)} at ${point.timestamp}
Volume: ${point.volume_traded.toLocaleString()}
High: ₹${point.high_price.toFixed(2)}
Low: ₹${point.low_price.toFixed(2)}`}
                </title>
              </circle>
            )
          })}
          
          {/* Y-axis labels */}
          {yAxisLabels.map((label, index) => (
            <text
              key={index}
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
              key={index}
              x={label.x}
              y={chartPadding.top + chartHeight + 20}
              fontSize="10"
              fill="#6b7280"
              textAnchor="middle"
              transform={`rotate(-45, ${label.x}, ${chartPadding.top + chartHeight + 20})`}
            >
              {label.label.length > 10 ? label.label.substring(0, 10) + '...' : label.label}
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
      
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-gray-600 text-xs uppercase tracking-wide">Volume</p>
          <p className="font-bold text-lg">{latestPrice ? sortedData[sortedData.length - 1].volume_traded.toLocaleString() : 0}</p>
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
          <p className="font-bold text-lg">₹{latestPrice ? sortedData[sortedData.length - 1].average_traded_price.toFixed(2) : 0}</p>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-gray-600 text-xs uppercase tracking-wide">Data Points</p>
          <p className="font-bold text-lg text-blue-600">{sortedData.length}</p>
        </div>
      </div>
    </div>
  )
}