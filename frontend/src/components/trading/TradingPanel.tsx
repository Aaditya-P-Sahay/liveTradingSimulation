import React, { useState, useEffect } from 'react';
import { apiService } from '../../services/api';
import { useMarket } from '../../contexts/MarketContext';

interface TradingPanelProps {
  symbol: string;
}

export const TradingPanel: React.FC<TradingPanelProps> = ({ symbol }) => {
  const { marketState, lastTickData } = useMarket();
  const [orderType, setOrderType] = useState<'buy' | 'sell' | 'short_sell' | 'buy_to_cover'>('buy');
  const [quantity, setQuantity] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [portfolio, setPortfolio] = useState<any>(null);
  const [shortPositions, setShortPositions] = useState<any[]>([]);

  // Load current portfolio and short positions
  useEffect(() => {
    loadTradingData();
  }, [symbol]);

  const loadTradingData = async () => {
    try {
      const [portfolioData, shortsData] = await Promise.all([
        apiService.getPortfolio(),
        apiService.getShortPositions(true)
      ]);
      setPortfolio(portfolioData);
      setShortPositions(shortsData.shorts || []);
    } catch (error) {
      console.error('Failed to load trading data:', error);
    }
  };

  const handleTrade = async () => {
    if (!marketState.isRunning || marketState.isPaused) {
      setMessage('❌ Trading is only allowed when contest is running');
      return;
    }

    if (quantity <= 0) {
      setMessage('❌ Quantity must be positive');
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
      
      setMessage(`✅ ${orderType.toUpperCase().replace('_', ' ')} order executed! Price: ₹${result.executedAt.price.toFixed(2)}, Total: ₹${result.trade.total_amount.toFixed(2)}`);
      setQuantity(1);
      
      // Refresh trading data
      await loadTradingData();
      
      // Clear message after 5 seconds
      setTimeout(() => setMessage(''), 5000);
    } catch (error: any) {
      setMessage(`❌ ${error.response?.data?.error || 'Trade failed'}`);
      setTimeout(() => setMessage(''), 8000);
    } finally {
      setLoading(false);
    }
  };

  // Get available quantity for sell/cover orders
  const getAvailableQuantity = () => {
    if (!portfolio) return { available: 0, type: '' };
    
    if (orderType === 'sell') {
      const holding = portfolio.holdings?.[symbol];
      return { 
        available: holding?.quantity || 0, 
        type: 'shares owned',
        avgPrice: holding?.avg_price
      };
    } else if (orderType === 'buy_to_cover') {
      const symbolShorts = shortPositions.filter(s => s.symbol === symbol);
      const totalShorts = symbolShorts.reduce((sum, s) => sum + s.quantity, 0);
      return { 
        available: totalShorts, 
        type: 'shares shorted',
        avgPrice: symbolShorts.length > 0 ? 
          symbolShorts.reduce((sum, s) => sum + (s.avg_short_price * s.quantity), 0) / 
          symbolShorts.reduce((sum, s) => sum + s.quantity, 0) : 0
      };
    }
    return { available: Infinity, type: 'unlimited' };
  };

  const availability = getAvailableQuantity();
  const currentPrice = lastTickData.get(symbol)?.price || 0;
  const totalValue = currentPrice * quantity;

  // Calculate potential P&L for display
  const calculatePotentialPnl = () => {
    if (!availability.avgPrice || !currentPrice) return null;
    
    if (orderType === 'sell') {
      return (currentPrice - availability.avgPrice) * quantity;
    } else if (orderType === 'buy_to_cover') {
      return (availability.avgPrice - currentPrice) * quantity;
    }
    return null;
  };

  const potentialPnl = calculatePotentialPnl();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold text-white">Trade {symbol}</h3>
        <div className="flex items-center gap-4">
          {!marketState.isRunning && (
            <span className="px-3 py-1 bg-red-900/30 border border-red-700 rounded-full text-red-400 text-sm">
              Market Closed
            </span>
          )}
          {currentPrice > 0 && (
            <div className="text-right">
              <div className="text-lg font-bold text-white">₹{currentPrice.toFixed(2)}</div>
              <div className="text-xs text-gray-400">Current Price</div>
            </div>
          )}
        </div>
      </div>

      {/* Contest Status */}
      {marketState.isRunning && (
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-400">Contest Progress</span>
            <span className="text-white">{marketState.progress.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
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
      
      {/* ENHANCED: Order Type Buttons with Icons */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setOrderType('buy')}
            className={`py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
              orderType === 'buy'
                ? 'bg-green-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <span>📈</span> Buy
          </button>
          <button
            onClick={() => setOrderType('sell')}
            disabled={!portfolio?.holdings?.[symbol]?.quantity}
            className={`py-3 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
              orderType === 'sell'
                ? 'bg-red-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <span>📉</span> Sell
          </button>
        </div>

        {/* Short Selling Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setOrderType('short_sell')}
            className={`py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
              orderType === 'short_sell'
                ? 'bg-orange-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <span>🔻</span> Short Sell
          </button>
          <button
            onClick={() => setOrderType('buy_to_cover')}
            disabled={shortPositions.filter(s => s.symbol === symbol).length === 0}
            className={`py-3 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
              orderType === 'buy_to_cover'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <span>🔺</span> Buy to Cover
          </button>
        </div>

        {/* Availability Info */}
        {availability.available !== Infinity && (
          <div className="text-center p-2 bg-gray-800 rounded text-sm text-gray-300">
            {availability.available > 0 ? (
              <>
                <span className="text-green-400">{availability.available}</span> {availability.type} available
                {availability.avgPrice && (
                  <span className="text-gray-400 ml-2">
                    (Avg: ₹{availability.avgPrice.toFixed(2)})
                  </span>
                )}
              </>
            ) : (
              <span className="text-red-400">No {availability.type} available</span>
            )}
          </div>
        )}
      </div>

      {/* Quantity Input */}
      <div>
        <label className="block text-gray-300 text-sm font-medium mb-2">
          Quantity
          {availability.available !== Infinity && availability.available > 0 && (
            <span className="text-gray-400 ml-2">(Max: {availability.available})</span>
          )}
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            min="1"
            max={availability.available !== Infinity ? availability.available : undefined}
            value={quantity}
            onChange={(e) => {
              const val = Math.max(1, parseInt(e.target.value) || 1);
              const maxVal = availability.available !== Infinity ? availability.available : val;
              setQuantity(Math.min(val, maxVal));
            }}
            className="flex-1 px-4 py-3 bg-gray-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-700"
          />
          {availability.available !== Infinity && availability.available > 0 && (
            <button
              onClick={() => setQuantity(availability.available)}
              className="px-4 py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors text-sm"
            >
              Max
            </button>
          )}
        </div>
      </div>

      {/* Trade Summary */}
      <div className="bg-gray-800 rounded-lg p-4 space-y-2">
        <h4 className="text-sm font-medium text-gray-400">Trade Summary</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Order Type:</span>
            <span className="text-white capitalize">{orderType.replace('_', ' ')}</span>
          </div>
          {currentPrice > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-gray-400">Price per Share:</span>
                <span className="text-white">₹{currentPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Value:</span>
                <span className="text-white font-semibold">₹{totalValue.toFixed(2)}</span>
              </div>
              {potentialPnl !== null && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Potential P&L:</span>
                  <span className={`font-semibold ${potentialPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {potentialPnl >= 0 ? '+' : ''}₹{potentialPnl.toFixed(2)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Order Type Description */}
      <div className="bg-gray-800 rounded-lg p-3 text-sm text-gray-300">
        {orderType === 'buy' && '📈 Buy shares with cash. Profit when price goes up.'}
        {orderType === 'sell' && '📉 Sell owned shares for cash. Realizes profit/loss.'}
        {orderType === 'short_sell' && '🔻 Borrow and sell shares. Profit when price goes down. Requires buying back later.'}
        {orderType === 'buy_to_cover' && '🔺 Buy shares to close short position. Settles the borrowed shares.'}
      </div>

      {/* Execute Button */}
      <button
        onClick={handleTrade}
        disabled={
          loading || 
          !marketState.isRunning || 
          marketState.isPaused || 
          (availability.available !== Infinity && quantity > availability.available) ||
          currentPrice <= 0
        }
        className={`w-full py-4 rounded-lg font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          orderType === 'buy' ? 'bg-green-600 hover:bg-green-700' :
          orderType === 'sell' ? 'bg-red-600 hover:bg-red-700' :
          orderType === 'short_sell' ? 'bg-orange-600 hover:bg-orange-700' :
          'bg-purple-600 hover:bg-purple-700'
        }`}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            Processing...
          </div>
        ) : (
          `${orderType.toUpperCase().replace('_', ' ')} ${quantity} ${symbol}`
        )}
      </button>

      {/* Status Message */}
      {message && (
        <div className={`p-4 rounded-lg text-sm border ${
          message.includes('❌') 
            ? 'bg-red-900/50 text-red-200 border-red-800' 
            : 'bg-green-900/50 text-green-200 border-green-800'
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
              <div className="text-white font-semibold">₹{portfolio.cash_balance?.toFixed(2) || '0.00'}</div>
            </div>
            <div>
              <span className="text-gray-400">Total Wealth:</span>
              <div className="text-white font-semibold">₹{portfolio.total_wealth?.toFixed(2) || '0.00'}</div>
            </div>
            <div>
              <span className="text-gray-400">Market Value:</span>
              <div className="text-white">₹{portfolio.market_value?.toFixed(2) || '0.00'}</div>
            </div>
            <div>
              <span className="text-gray-400">Total P&L:</span>
              <div className={`font-semibold ${
                (portfolio.total_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {(portfolio.total_pnl || 0) >= 0 ? '+' : ''}₹{portfolio.total_pnl?.toFixed(2) || '0.00'}
              </div>
            </div>
          </div>
          
          {/* Return Percentage */}
          <div className="mt-3 pt-3 border-t border-gray-700 text-center">
            <span className="text-gray-400 text-sm">Return: </span>
            <span className={`font-bold ${
              ((portfolio.total_wealth - 1000000) / 1000000 * 100) >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {((portfolio.total_wealth - 1000000) / 1000000 * 100) >= 0 ? '+' : ''}
              {((portfolio.total_wealth - 1000000) / 1000000 * 100).toFixed(2)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
};