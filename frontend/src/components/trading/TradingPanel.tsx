import React, { useState } from 'react';
import { apiService } from '../../services/api';

interface TradingPanelProps {
  symbol: string;
}

export const TradingPanel: React.FC<TradingPanelProps> = ({ symbol }) => {
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleTrade = async () => {
    setLoading(true);
    setMessage('');

    try {
      const result = await apiService.placeTrade({
        symbol,
        order_type: orderType,
        quantity,
      });
      
      setMessage(`✅ Order placed! ID: ${result.trade.id}`);
      setQuantity(1);
    } catch (error: any) {
      setMessage(`❌ ${error.response?.data?.error || 'Trade failed'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Place Order - {symbol}</h3>
      
      <div className="flex gap-2">
        <button
          onClick={() => setOrderType('buy')}
          className={`flex-1 py-2 rounded-md transition-colors ${
            orderType === 'buy'
              ? 'bg-green-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setOrderType('sell')}
          className={`flex-1 py-2 rounded-md transition-colors ${
            orderType === 'sell'
              ? 'bg-red-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Sell
        </button>
      </div>

      <div>
        <label className="block text-gray-300 text-sm font-medium mb-2">
          Quantity
        </label>
        <input
          type="number"
          min="1"
          value={quantity}
          onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
          className="w-full px-3 py-2 bg-gray-800 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <button
        onClick={handleTrade}
        disabled={loading}
        className={`w-full py-3 rounded-md font-medium transition-colors ${
          orderType === 'buy'
            ? 'bg-green-600 hover:bg-green-700'
            : 'bg-red-600 hover:bg-red-700'
        } text-white disabled:opacity-50`}
      >
        {loading ? 'Processing...' : `${orderType.toUpperCase()} ${symbol}`}
      </button>

      {message && (
        <div className={`p-3 rounded-md text-sm ${
          message.includes('❌') 
            ? 'bg-red-900/50 text-red-200' 
            : 'bg-green-900/50 text-green-200'
        }`}>
          {message}
        </div>
      )}
    </div>
  );
};