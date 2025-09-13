import React from 'react'
import { StockData } from '../lib/supabase'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface DataTableProps {
  data: StockData[]
}

export const DataTable: React.FC<DataTableProps> = ({ data }) => {
  if (!data.length) return null

  // Sort by unique_id to show chronological order
  const sortedData = [...data].sort((a, b) => b.unique_id - a.unique_id).slice(0, 10)

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Recent Data Points</h3>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-3 font-medium text-gray-600">Time</th>
              <th className="text-right py-2 px-3 font-medium text-gray-600">Price</th>
              <th className="text-right py-2 px-3 font-medium text-gray-600">Volume</th>
              <th className="text-right py-2 px-3 font-medium text-gray-600">High</th>
              <th className="text-right py-2 px-3 font-medium text-gray-600">Low</th>
              <th className="text-right py-2 px-3 font-medium text-gray-600">Change</th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row, index) => {
              const prevRow = sortedData[index + 1]
              const priceChange = prevRow ? row.last_traded_price - prevRow.last_traded_price : 0
              
              return (
                <tr key={row.unique_id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 text-gray-700">{row.timestamp}</td>
                  <td className="py-2 px-3 text-right font-medium">₹{row.last_traded_price.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-gray-600">{row.volume_traded.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right text-gray-600">₹{row.high_price.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-gray-600">₹{row.low_price.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right">
                    {prevRow && (
                      <div className={`flex items-center justify-end ${priceChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {priceChange >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                        {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}