import React, { useState, useEffect } from 'react';
import { StockData } from '../services/api';
import { TrendingUp, TrendingDown, Clock, Volume, DollarSign } from 'lucide-react';

interface DataTableProps {
  data: StockData[];
  highlightRecent?: boolean;
}

export const DataTable: React.FC<DataTableProps> = ({ data, highlightRecent = false }) => {
  const [recentIds, setRecentIds] = useState<Set<number>>(new Set());

  if (!data.length) return null;

  // Sort by unique_id to show chronological order, latest first
  const sortedData = [...data].sort((a, b) => b.unique_id - a.unique_id).slice(0, 20);

  // Track recently added items
  useEffect(() => {
    if (!highlightRecent) return;

    const newIds = new Set(sortedData.slice(0, 5).map(item => item.unique_id));
    setRecentIds(newIds);

    // Remove highlight after 3 seconds
    const timer = setTimeout(() => {
      setRecentIds(new Set());
    }, 3000);

    return () => clearTimeout(timer);
  }, [data.length, highlightRecent]);

  const formatTime = (timestamp: string, normalizedTimestamp?: string) => {
    if (normalizedTimestamp) {
      const date = new Date(normalizedTimestamp);
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
      });
    }
    return timestamp.length > 10 ? timestamp.substring(0, 10) + '...' : timestamp;
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1000000) {
      return `${(volume / 1000000).toFixed(1)}M`;
    } else if (volume >= 1000) {
      return `${(volume / 1000).toFixed(1)}K`;
    }
    return volume.toLocaleString();
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800 flex items-center">
          <Clock className="w-5 h-5 mr-2 text-blue-600" />
          Recent Data Points
        </h3>
        <div className="text-xs text-gray-500">
          Showing latest 20 of {data.length} total points
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-gray-600 rounded-l-lg">
                <div className="flex items-center">
                  <Clock className="w-4 h-4 mr-1" />
                  Time
                </div>
              </th>
              <th className="text-right py-3 px-4 font-medium text-gray-600">
                <div className="flex items-center justify-end">
                  <DollarSign className="w-4 h-4 mr-1" />
                  Price
                </div>
              </th>
              <th className="text-right py-3 px-4 font-medium text-gray-600">
                <div className="flex items-center justify-end">
                  <Volume className="w-4 h-4 mr-1" />
                  Volume
                </div>
              </th>
              <th className="text-right py-3 px-4 font-medium text-gray-600">High</th>
              <th className="text-right py-3 px-4 font-medium text-gray-600">Low</th>
              <th className="text-right py-3 px-4 font-medium text-gray-600">Avg Price</th>
              <th className="text-right py-3 px-4 font-medium text-gray-600 rounded-r-lg">Change</th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((row, index) => {
              const prevRow = sortedData[index + 1];
              const priceChange = prevRow ? row.last_traded_price - prevRow.last_traded_price : 0;
              const volumeChange = prevRow ? row.volume_traded - prevRow.volume_traded : 0;
              const isRecent = recentIds.has(row.unique_id);
              
              return (
                <tr 
                  key={row.unique_id} 
                  className={`border-b border-gray-100 transition-all duration-300 ${
                    isRecent 
                      ? 'bg-blue-50 border-blue-200' 
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="py-3 px-4 text-gray-700">
                    <div className="flex flex-col">
                      <span className="font-mono text-sm">
                        {formatTime(row.timestamp, row.normalized_timestamp)}
                      </span>
                      <span className="text-xs text-gray-500">
                        ID: {row.unique_id}
                      </span>
                    </div>
                  </td>
                  
                  <td className="py-3 px-4 text-right">
                    <div className="flex flex-col items-end">
                      <span className="font-bold text-lg text-gray-800">
                        ₹{row.last_traded_price.toFixed(2)}
                      </span>
                      {isRecent && (
                        <span className="text-xs text-blue-600 font-medium">
                          LIVE
                        </span>
                      )}
                    </div>
                  </td>
                  
                  <td className="py-3 px-4 text-right">
                    <div className="flex flex-col items-end">
                      <span className="font-medium text-gray-700">
                        {formatVolume(row.volume_traded)}
                      </span>
                      {volumeChange !== 0 && prevRow && (
                        <span className={`text-xs ${volumeChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {volumeChange > 0 ? '+' : ''}{formatVolume(Math.abs(volumeChange))}
                        </span>
                      )}
                    </div>
                  </td>
                  
                  <td className="py-3 px-4 text-right">
                    <span className="font-medium text-green-600">
                      ₹{row.high_price.toFixed(2)}
                    </span>
                  </td>
                  
                  <td className="py-3 px-4 text-right">
                    <span className="font-medium text-red-600">
                      ₹{row.low_price.toFixed(2)}
                    </span>
                  </td>
                  
                  <td className="py-3 px-4 text-right">
                    <span className="text-gray-600">
                      ₹{row.average_traded_price.toFixed(2)}
                    </span>
                  </td>
                  
                  <td className="py-3 px-4 text-right">
                    {prevRow ? (
                      <div className={`flex items-center justify-end ${priceChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {priceChange >= 0 ? 
                          <TrendingUp className="w-3 h-3 mr-1" /> : 
                          <TrendingDown className="w-3 h-3 mr-1" />
                        }
                        <div className="flex flex-col items-end">
                          <span className="font-medium">
                            {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}
                          </span>
                          <span className="text-xs">
                            {((priceChange / prevRow.last_traded_price) * 100).toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary Stats */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-600">
          <div>
            <span className="font-medium">Total Volume:</span>
            <span className="ml-1 text-gray-800">
              {formatVolume(sortedData.reduce((sum, row) => sum + row.volume_traded, 0))}
            </span>
          </div>
          <div>
            <span className="font-medium">Price Range:</span>
            <span className="ml-1 text-gray-800">
              ₹{Math.min(...sortedData.map(r => r.low_price)).toFixed(2)} - 
              ₹{Math.max(...sortedData.map(r => r.high_price)).toFixed(2)}
            </span>
          </div>
          <div>
            <span className="font-medium">Avg Price:</span>
            <span className="ml-1 text-gray-800">
              ₹{(sortedData.reduce((sum, row) => sum + row.last_traded_price, 0) / sortedData.length).toFixed(2)}
            </span>
          </div>
          <div>
            <span className="font-medium">Data Points:</span>
            <span className="ml-1 text-gray-800">
              {sortedData.length} shown / {data.length} total
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};