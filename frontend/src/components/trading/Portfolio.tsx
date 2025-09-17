import React, { useEffect, useState } from 'react';
import { apiService } from '../../services/api';
import { TrendingUp, TrendingDown, Eye, EyeOff } from 'lucide-react';

export const Portfolio: React.FC = () => {
  const [portfolio, setPortfolio] = useState<any>(null);
  const [shortPositions, setShortPositions] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTrades, setShowTrades] = useState(false);

  useEffect(() => {
    loadPortfolioData();
    const interval = setInterval(loadPortfolioData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const loadPortfolioData = async () => {
    try {
      const [portfolioData, shortData, tradesData] = await Promise.all([
        apiService.getPortfolio(),
        apiService.getShortPositions(true), // Active shorts only
        apiService.getTrades(1, 10) // Recent 10 trades
      ]);
      
      setPortfolio(portfolioData);
      setShortPositions(shortData.shorts || []);
      setTrades(tradesData.trades || []);
      setError('');
    } catch (err: any) {
      setError('Failed to load portfolio data');
      console.error('Portfolio error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-400">Loading portfolio...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/50 text-red-200 p-4 rounded-lg border border-red-800">
        {error}
        <button
          onClick={loadPortfolioData}
          className="ml-4 text-red-300 hover:text-red-100 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400 mb-4">Portfolio not found</p>
        <button
          onClick={loadPortfolioData}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Load Portfolio
        </button>
      </div>
    );
  }

  const holdings = portfolio.holdings || {};
  const hasHoldings = Object.keys(holdings).length > 0;
  const hasShorts = shortPositions.length > 0;

  return (
    <div className="space-y-6">
      {/* Portfolio Summary */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h4 className="text-lg font-semibold text-white mb-4">Portfolio Summary</h4>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-sm text-gray-400">Total Wealth</p>
            <p className="text-2xl font-bold text-white">
              ₹{portfolio.total_wealth?.toFixed(2) || '0.00'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-400">Cash Balance</p>
            <p className="text-xl font-semibold text-green-400">
              ₹{portfolio.cash_balance?.toFixed(2) || '0.00'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-400">Market Value</p>
            <p className="text-xl font-semibold text-blue-400">
              ₹{portfolio.market_value?.toFixed(2) || '0.00'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-400">Total P&L</p>
            <p className={`text-xl font-semibold ${
              (portfolio.total_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {(portfolio.total_pnl || 0) >= 0 ? '+' : ''}₹{portfolio.total_pnl?.toFixed(2) || '0.00'}
            </p>
          </div>
        </div>
        
        {/* Return Percentage */}
        <div className="mt-4 text-center">
          <p className="text-sm text-gray-400">Return</p>
          <p className={`text-lg font-semibold ${
            ((portfolio.total_wealth - 1000000) / 1000000 * 100) >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {((portfolio.total_wealth - 1000000) / 1000000 * 100) >= 0 ? '+' : ''}
            {((portfolio.total_wealth - 1000000) / 1000000 * 100).toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Long Positions */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-semibold text-white">Long Positions</h4>
          <span className="text-sm text-gray-400">{Object.keys(holdings).length} stocks</span>
        </div>
        
        {hasHoldings ? (
          <div className="space-y-3">
            {Object.entries(holdings).map(([symbol, position]: [string, any]) => (
              <div key={symbol} className="bg-gray-700 rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h5 className="font-semibold text-white">{symbol}</h5>
                    <p className="text-sm text-gray-400">
                      {position.quantity} shares @ ₹{position.avg_price?.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500">{position.company_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-white">
                      ₹{position.market_value?.toFixed(2) || (position.quantity * (position.current_price || position.avg_price)).toFixed(2)}
                    </p>
                    <div className={`flex items-center text-sm ${
                      (position.unrealized_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {(position.unrealized_pnl || 0) >= 0 ? 
                        <TrendingUp className="w-4 h-4 mr-1" /> : 
                        <TrendingDown className="w-4 h-4 mr-1" />
                      }
                      <span>
                        {(position.unrealized_pnl || 0) >= 0 ? '+' : ''}₹{position.unrealized_pnl?.toFixed(2) || '0.00'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <p>No long positions</p>
            <p className="text-sm">Start buying stocks to build your portfolio</p>
          </div>
        )}
      </div>

      {/* Short Positions */}
      {hasShorts && (
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-white">Short Positions</h4>
            <span className="text-sm text-gray-400">{shortPositions.length} positions</span>
          </div>
          
          <div className="space-y-3">
            {shortPositions.map((short: any) => (
              <div key={short.id} className="bg-gray-700 rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h5 className="font-semibold text-white">{short.symbol}</h5>
                    <p className="text-sm text-gray-400">
                      {short.quantity} shares shorted @ ₹{short.avg_short_price?.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500">{short.company_name}</p>
                    <p className="text-xs text-gray-500">
                      Opened: {new Date(short.opened_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-orange-400">
                      -₹{((short.current_price || short.avg_short_price) * short.quantity).toFixed(2)}
                    </p>
                    <div className={`flex items-center text-sm ${
                      (short.unrealized_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {(short.unrealized_pnl || 0) >= 0 ? 
                        <TrendingUp className="w-4 h-4 mr-1" /> : 
                        <TrendingDown className="w-4 h-4 mr-1" />
                      }
                      <span>
                        {(short.unrealized_pnl || 0) >= 0 ? '+' : ''}₹{short.unrealized_pnl?.toFixed(2) || '0.00'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Trades */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-semibold text-white">Recent Trades</h4>
          <button
            onClick={() => setShowTrades(!showTrades)}
            className="flex items-center text-sm text-gray-400 hover:text-white transition-colors"
          >
            {showTrades ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
            {showTrades ? 'Hide' : 'Show'}
          </button>
        </div>

        {showTrades && (
          <div className="space-y-2">
            {trades.length > 0 ? trades.map((trade: any) => (
              <div key={trade.id} className="bg-gray-700 rounded-lg p-3 flex justify-between items-center">
                <div>
                  <span className={`inline-block px-2 py-1 rounded text-xs font-medium mr-3 ${
                    trade.order_type === 'buy' ? 'bg-green-900 text-green-300' :
                    trade.order_type === 'sell' ? 'bg-red-900 text-red-300' :
                    trade.order_type === 'short_sell' ? 'bg-orange-900 text-orange-300' :
                    'bg-purple-900 text-purple-300'
                  }`}>
                    {trade.order_type.toUpperCase().replace('_', ' ')}
                  </span>
                  <span className="text-white font-medium">{trade.symbol}</span>
                  <span className="text-gray-400 ml-2">{trade.quantity} @ ₹{trade.price}</span>
                </div>
                <div className="text-right">
                  <p className="text-white">₹{trade.total_amount?.toFixed(2)}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(trade.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            )) : (
              <div className="text-center py-4 text-gray-400">
                <p>No recent trades</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Refresh Button */}
      <button
        onClick={loadPortfolioData}
        className="w-full py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium"
      >
        Refresh Portfolio
      </button>
    </div>
  );
};