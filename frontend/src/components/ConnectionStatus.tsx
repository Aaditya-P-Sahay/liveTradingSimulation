// src/components/ConnectionStatus.tsx
import React from 'react';
import { Wifi, WifiOff, Radio, Database, TrendingUp } from 'lucide-react';

interface ConnectionStatusProps {
  isConnected: boolean;
  selectedSymbol: string;
  dataCount: number;
  realtimeCount: number;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  isConnected,
  selectedSymbol,
  dataCount,
  realtimeCount
}) => {
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 mb-6 border-l-4 border-blue-500">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Connection Status */}
        <div className="flex items-center">
          {isConnected ? (
            <div className="flex items-center text-green-600">
              <Wifi className="w-5 h-5 mr-2" />
              <div>
                <div className="font-semibold text-sm">WebSocket</div>
                <div className="text-xs">Connected</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center text-red-600">
              <WifiOff className="w-5 h-5 mr-2" />
              <div>
                <div className="font-semibold text-sm">WebSocket</div>
                <div className="text-xs">Disconnected</div>
              </div>
            </div>
          )}
        </div>

        {/* Selected Symbol */}
        <div className="flex items-center">
          <Radio className="w-5 h-5 mr-2 text-blue-600" />
          <div>
            <div className="font-semibold text-sm text-gray-800">Symbol</div>
            <div className="text-xs text-gray-600">
              {selectedSymbol || 'None selected'}
            </div>
          </div>
        </div>

        {/* Data Count */}
        <div className="flex items-center">
          <Database className="w-5 h-5 mr-2 text-purple-600" />
          <div>
            <div className="font-semibold text-sm text-gray-800">Total Data</div>
            <div className="text-xs text-gray-600">
              {dataCount.toLocaleString()} points
            </div>
          </div>
        </div>

        {/* Realtime Updates */}
        <div className="flex items-center">
          <TrendingUp className="w-5 h-5 mr-2 text-green-600" />
          <div>
            <div className="font-semibold text-sm text-gray-800">Live Ticks</div>
            <div className="text-xs text-gray-600">
              {realtimeCount} updates
            </div>
          </div>
        </div>
      </div>

      {/* Status Message */}
      <div className="mt-3 text-xs text-gray-500">
        {isConnected ? (
          <span>✅ Real-time data streaming active</span>
        ) : (
          <span>⚠️ Using cached data only - WebSocket connection lost</span>
        )}
      </div>
    </div>
  );
};