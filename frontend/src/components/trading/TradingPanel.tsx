import React, { useState, useEffect } from 'react';
import { apiService } from '../../services/api';
import { useMarket } from '../../contexts/MarketContext';

interface TradingPanelProps {
  symbol: string;
}

export const TradingPanel: React.FC<TradingPanelProps> = ({ symbol }) => {
  const { marketState } = useMarket();
  const [orderType, setOrderType] = useState<'buy' | 'sell' | 'short_sell' | 'buy_to_cover'>('buy');
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [portfolio, setPortfolio] = useState<any>(null);

  // Load current portfolio to show holdings/shorts
  useEffect(() => {
    loadPortfolio();
  }, []);

  const loadPortfolio = async () => {
    try {
      const data = await apiService.getPortfolio();
      setPortfolio(data);
    } catch (error) {
      console.error('Failed to load portfolio:', error);
    }
  };

  const handleTrade = async () => {
    if (!marketState.isRunning || marketState.isPaused) {
      setMessage('❌ Trading is only allowed when contest is running');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const result = await apiService.placeTrade({
        symbol,
        order_type: orderType,
        quantity,
      });
      
      setMessage(`✅ ${orderType.toUpperCase()} order executed! Price: ₹${result.executedAt.price}`);
      setQuantity(1);
      
      // Refresh portfolio
      await loadPortfolio();
    } catch (error: any) {
      setMessage(`❌ ${error.response?.data?.error || 'Trade failed'}`);
    } finally {
      setLoading(false);
    }
  };

  // Get available quantity for sell/cover orders
  const getAvailableQuantity = () => {
    if (!portfolio) return 0;
    
    if (orderType === 'sell') {
      const holding = portfolio.holdings?.[symbol];
      return holding?.quantity || 0;
    } else if (orderType === 'buy_to_cover') {
      // This would need short positions from API - placeholder for now
      return 100; // TODO: Get actual short positions
    }
    return Infinity; // For buy and short_sell
  };

  const maxQuantity = getAvailableQuantity();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-white">Trade {symbol}</h3>
        {!marketState.isRunning && (
          <span className="px-3 py-1 bg-red-900/30 border border-red-700 rounded-full text-red-400 text-sm">
            Market Closed
          </span>
        )}
      </div>

      {/* Contest Status */}
      {marketState.isRunning && (
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Contest Progress</span>
            <span className="text-white">{marketState.progress.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${marketState.progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400 mt-2">
            <span>Tick: {marketState.currentDataTick}/{marketState.totalDataTicks}</span>
            <span>{marketState.isPaused ? '⏸️ Paused' : '▶️ Live'} @ {marketState.speed}x</span>
          </div>
        </div>
      )}
      
      {/* Order Type Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setOrderType('buy')}
          className={`py-3 rounded-lg font-medium transition-colors ${
            orderType === 'buy'
              ? 'bg-green-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setOrderType('sell')}
          disabled={!portfolio?.holdings?.[symbol]?.quantity}
          className={`py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            orderType === 'sell'
              ? 'bg-red-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Sell
          {portfolio?.holdings?.[symbol]?.quantity && (
            <span className="text-xs block">({portfolio.holdings[symbol].quantity} available)</span>
          )}
        </button>
      </div>

      {/* Short Selling Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setOrderType('short_sell')}
          className={`py-3 rounded-lg font-medium transition-colors ${
            orderType === 'short_sell'
              ? 'bg-orange-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Short Sell
        </button>
        <button
          onClick={() => setOrderType('buy_to_cover')}
          className={`py-3 rounded-lg font-medium transition-colors ${
            orderType === 'buy_to_cover'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Buy to Cover
        </button>
      </div>

      {/* Quantity Input */}
      <div>
        <label className="block text-gray-300 text-sm font-medium mb-2">
          Quantity
          {maxQuantity !== Infinity && maxQuantity > 0 && (
            <span className="text-gray-400 ml-2">(Max: {maxQuantity})</span>
          )}
        </label>
        <input
          type="number"
          min="1"
          max={maxQuantity !== Infinity ? maxQuantity : undefined}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-700"
        />
      </div>

      {/* Order Type Description */}
      <div className="bg-gray-800 rounded-lg p-3 text-sm text-gray-300">
        {orderType === 'buy' && 'Buy shares with cash. Profit when price goes up.'}
        {orderType === 'sell' && 'Sell owned shares for cash. Realizes profit/loss.'}
        {orderType === 'short_sell' && 'Borrow and sell shares. Profit when price goes down.'}
        {orderType === 'buy_to_cover' && 'Buy shares to close short position.'}
      </div>

      {/* Execute Button */}
      <button
        onClick={handleTrade}
        disabled={loading || !marketState.isRunning || marketState.isPaused || (maxQuantity !== Infinity && quantity > maxQuantity)}
        className={`w-full py-4 rounded-lg font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          orderType === 'buy' ? 'bg-green-600 hover:bg-green-700' :
          orderType === 'sell' ? 'bg-red-600 hover:bg-red-700' :
          orderType === 'short_sell' ? 'bg-orange-600 hover:bg-orange-700' :
          'bg-purple-600 hover:bg-purple-700'
        }`}
      >
        {loading ? 'Processing...' : `${orderType.toUpperCase().replace('_', ' ')} ${quantity} ${symbol}`}
      </button>

      {/* Status Message */}
      {message && (
        <div className={`p-4 rounded-lg text-sm ${
          message.includes('❌') 
            ? 'bg-red-900/50 text-red-200 border border-red-800' 
            : 'bg-green-900/50 text-green-200 border border-green-800'
        }`}>
          {message}
        </div>
      )}

      {/* Portfolio Summary */}
      {portfolio && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-400 mb-3">Portfolio Summary</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Cash:</span>
              <span className="text-white ml-2">₹{portfolio.cash_balance?.toFixed(2) || '0.00'}</span>
            </div>
            <div>
              <span className="text-gray-400">Total Wealth:</span>
              <span className="text-white ml-2">₹{portfolio.total_wealth?.toFixed(2) || '0.00'}</span>
            </div>
            <div>
              <span className="text-gray-400">Market Value:</span>
              <span className="text-white ml-2">₹{portfolio.market_value?.toFixed(2) || '0.00'}</span>
            </div>
            <div>
              <span className="text-gray-400">P&L:</span>
              <span className={`ml-2 ${
                (portfolio.total_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                ₹{portfolio.total_pnl?.toFixed(2) || '0.00'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};