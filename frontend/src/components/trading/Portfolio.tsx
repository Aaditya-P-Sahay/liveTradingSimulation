import React, { useEffect, useState } from 'react';
import { apiService } from '../../services/api';
import { useMarket } from '../../contexts/MarketContext';
import { TrendingUp, TrendingDown, Eye, EyeOff, RefreshCw, AlertCircle } from 'lucide-react';

export const Portfolio: React.FC = () => {
  const { lastTickData } = useMarket();
  const [portfolio, setPortfolio] = useState<any>(null);
  const [shortPositions, setShortPositions] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showTrades, setShowTrades] = useState(false);
  const [showShorts, setShowShorts] = useState(true);

  useEffect(() => {
    loadPortfolioData();
    const interval = setInterval(loadPortfolioData, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const loadPortfolioData = async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      
      const [portfolioData, shortData, tradesData] = await Promise.all([
        apiService.getPortfolio(),
        apiService.getShortPositions(true), // Active shorts only
        apiService.getTrades(1, 20) // Recent 20 trades
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
      setRefreshing(false);
    }
  };

  // Get live prices for positions
  const getLivePrice = (symbol: string) => {
    return lastTickData.get(symbol)?.price || null;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="flex flex-col items-center gap-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <div className="text-gray-400">Loading portfolio...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/50 text-red-200 p-4 rounded-lg border border-red-800">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-5 h-5" />
          <span className="font-semibold">Error</span>
        </div>
        <p>{error}</p>
        <button
          onClick={() => loadPortfolioData()}
          className="mt-3 px-4 py-2 bg-red-700 text-red-100 rounded-lg hover:bg-red-600 transition-colors text-sm"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400 mb-4">Portfolio not found</p>
        <button
          onClick={() => loadPortfolioData()}
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

  // Calculate live portfolio values
  const calculateLiveValues = () => {
    let liveMarketValue = 0;
    let liveTotalWealth = portfolio.cash_balance;
    let liveUnrealizedPnl = 0;

    // Long positions
    Object.entries(holdings).forEach(([symbol, position]: [string, any]) => {
      const livePrice = getLivePrice(symbol);
      if (livePrice && position.quantity > 0) {
        const marketValue = livePrice * position.quantity;
        const unrealizedPnl = (livePrice - position.avg_price) * position.quantity;
        liveMarketValue += marketValue;
        liveUnrealizedPnl += unrealizedPnl;
      }
    });

    // Short positions
    shortPositions.forEach(short => {
      const livePrice = getLivePrice(short.symbol);
      if (livePrice) {
        const shortPnl = (short.avg_short_price - livePrice) * short.quantity;
        liveUnrealizedPnl += shortPnl;
      }
    });

    liveTotalWealth += liveMarketValue + liveUnrealizedPnl;

    return { liveMarketValue, liveTotalWealth, liveUnrealizedPnl };
  };

  const { liveMarketValue, liveTotalWealth, liveUnrealizedPnl } = calculateLiveValues();

  return (
    <div className="space-y-6">
      {/* Portfolio Summary with Live Prices */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-700 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-semibold text-white">Portfolio Summary</h4>
          <button
            onClick={() => loadPortfolioData(true)}
            disabled={refreshing}
            className="p-2 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh Portfolio"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div className="text-center p-3 bg-gray-900/50 rounded-lg">
            <p className="text-sm text-gray-400">Total Wealth</p>
            <p className="text-2xl font-bold text-white">₹{liveTotalWealth.toFixed(2)}</p>
            {liveTotalWealth !== portfolio.total_wealth && (
              <p className="text-xs text-blue-400">Live: ₹{liveTotalWealth.toFixed(2)}</p>
            )}
          </div>
          <div className="text-center p-3 bg-gray-900/50 rounded-lg">
            <p className="text-sm text-gray-400">Cash Balance</p>
            <p className="text-xl font-semibold text-green-400">₹{portfolio.cash_balance?.toFixed(2) || '0.00'}</p>
          </div>
          <div className="text-center p-3 bg-gray-900/50 rounded-lg">
            <p className="text-sm text-gray-400">Market Value</p>
            <p className="text-xl font-semibold text-blue-400">₹{liveMarketValue.toFixed(2)}</p>
          </div>
          <div className="text-center p-3 bg-gray-900/50 rounded-lg">
            <p className="text-sm text-gray-400">Total P&L</p>
            <p className={`text-xl font-semibold ${
              liveUnrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {liveUnrealizedPnl >= 0 ? '+' : ''}₹{liveUnrealizedPnl.toFixed(2)}
            </p>
          </div>
        </div>
        
        {/* Return Percentage */}
        <div className="text-center p-3 bg-gray-900/50 rounded-lg">
          <p className="text-sm text-gray-400">Return</p>
          <p className={`text-lg font-semibold ${
            ((liveTotalWealth - 1000000) / 1000000 * 100) >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {((liveTotalWealth - 1000000) / 1000000 * 100) >= 0 ? '+' : ''}
            {((liveTotalWealth - 1000000) / 1000000 * 100).toFixed(2)}%
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
            {Object.entries(holdings).map(([symbol, position]: [string, any]) => {
              const livePrice = getLivePrice(symbol);
              const currentPrice = livePrice || position.current_price || position.avg_price;
              const marketValue = currentPrice * position.quantity;
              const unrealizedPnl = (currentPrice - position.avg_price) * position.quantity;
              const pnlPercent = ((currentPrice - position.avg_price) / position.avg_price) * 100;
              
              return (
                <div key={symbol} className="bg-gray-700 rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h5 className="font-semibold text-white">{symbol}</h5>
                        {livePrice && (
                          <span className="text-xs bg-green-900/30 text-green-400 px-2 py-1 rounded">
                            LIVE
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-400">
                        {position.quantity} shares @ ₹{position.avg_price?.toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-500">{position.company_name}</p>
                      <p className="text-sm text-gray-300 mt-1">
                        Current: ₹{currentPrice.toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-white">
                        ₹{marketValue.toFixed(2)}
                      </p>
                      <div className={`flex items-center text-sm ${
                        unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {unrealizedPnl >= 0 ? 
                          <TrendingUp className="w-4 h-4 mr-1" /> : 
                          <TrendingDown className="w-4 h-4 mr-1" />
                        }
                        <div>
                          <div>
                            {unrealizedPnl >= 0 ? '+' : ''}₹{unrealizedPnl.toFixed(2)}
                          </div>
                          <div className="text-xs">
                            {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <TrendingUp className="w-12 h-12 mx-auto mb-2 text-gray-600" />
            <p>No long positions</p>
            <p className="text-sm">Start buying stocks to build your portfolio</p>
          </div>
        )}
      </div>

      {/* ENHANCED: Short Positions */}
      {(hasShorts || showShorts) && (
        <div className="bg-gray-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-white">Short Positions</h4>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">{shortPositions.length} positions</span>
              <button
                onClick={() => setShowShorts(!showShorts)}
                className="text-gray-400 hover:text-white"
              >
                {showShorts ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          
          {showShorts && (
            <>
              {hasShorts ? (
                <div className="space-y-3">
                  {shortPositions.map((short: any) => {
                    const livePrice = getLivePrice(short.symbol);
                    const currentPrice = livePrice || short.current_price || short.avg_short_price;
                    const unrealizedPnl = (short.avg_short_price - currentPrice) * short.quantity;
                    const pnlPercent = ((short.avg_short_price - currentPrice) / short.avg_short_price) * 100;
                    const shortValue = currentPrice * short.quantity;
                    
                    return (
                      <div key={short.id} className="bg-orange-900/20 border border-orange-700 rounded-lg p-4">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h5 className="font-semibold text-white">{short.symbol}</h5>
                              <span className="text-xs bg-orange-900/50 text-orange-400 px-2 py-1 rounded">
                                SHORT
                              </span>
                              {livePrice && (
                                <span className="text-xs bg-green-900/30 text-green-400 px-2 py-1 rounded">
                                  LIVE
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-400">
                              {short.quantity} shares shorted @ ₹{short.avg_short_price?.toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-500">{short.company_name}</p>
                            <p className="text-xs text-gray-500">
                              Opened: {new Date(short.opened_at).toLocaleDateString()}
                            </p>
                            <p className="text-sm text-gray-300 mt-1">
                              Current: ₹{currentPrice.toFixed(2)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-semibold text-orange-400">
                              -₹{shortValue.toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-400 mb-1">Short Value</p>
                            <div className={`flex items-center text-sm ${
                              unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {unrealizedPnl >= 0 ? 
                                <TrendingUp className="w-4 h-4 mr-1" /> : 
                                <TrendingDown className="w-4 h-4 mr-1" />
                              }
                              <div>
                                <div>
                                  {unrealizedPnl >= 0 ? '+' : ''}₹{unrealizedPnl.toFixed(2)}
                                </div>
                                <div className="text-xs">
                                  {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <TrendingDown className="w-12 h-12 mx-auto mb-2 text-gray-600" />
                  <p>No short positions</p>
                  <p className="text-sm">Short sell stocks to profit from price decreases</p>
                </div>
              )}
            </>
          )}
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
                <div className="flex items-center gap-3">
                  <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                    trade.order_type === 'buy' ? 'bg-green-900 text-green-300' :
                    trade.order_type === 'sell' ? 'bg-red-900 text-red-300' :
                    trade.order_type === 'short_sell' ? 'bg-orange-900 text-orange-300' :
                    'bg-purple-900 text-purple-300'
                  }`}>
                    {trade.order_type.toUpperCase().replace('_', ' ')}
                  </span>
                  <div>
                    <span className="text-white font-medium">{trade.symbol}</span>
                    <span className="text-gray-400 ml-2">{trade.quantity} @ ₹{trade.price.toFixed(2)}</span>
                  </div>
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

      {/* Auto Square-off Warning */}
      {hasShorts && (
        <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-5 h-5 text-yellow-400" />
            <span className="font-semibold text-yellow-400">Auto Square-off Notice</span>
          </div>
          <p className="text-yellow-200 text-sm">
            All short positions will be automatically squared-off when the contest ends. 
            You can manually cover your positions anytime before contest end.
          </p>
        </div>
      )}

      {/* Refresh Button */}
      <button
        onClick={() => loadPortfolioData(true)}
        disabled={refreshing}
        className="w-full py-3 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        {refreshing ? 'Refreshing...' : 'Refresh Portfolio'}
      </button>
    </div>
  );
};