import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { supabase } from '../../lib/supabase';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Eye, 
  Star,
  Activity,
  PieChart
} from 'lucide-react';

export const PortfolioDashboard: React.FC = () => {
  const { user, portfolio, positions, setPortfolio, setPositions } = useStore();
  const [activeTab, setActiveTab] = useState<'holdings' | 'positions' | 'watchlist'>('holdings');
  const [watchlist, setWatchlist] = useState<string[]>(['AAPL', 'GOOGL', 'MSFT', 'TSLA']);

  useEffect(() => {
    if (user) {
      fetchPortfolio();
      fetchPositions();
    }
  }, [user]);

  const fetchPortfolio = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('portfolios')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setPortfolio(data);
      } else {
        // Create initial portfolio
        const newPortfolio = {
          id: crypto.randomUUID(),
          user_id: user.id,
          total_cash: 100000, // Starting with $100k
          available_cash: 100000,
          margin_used: 0,
          total_portfolio_value: 100000,
          unrealized_pnl: 0,
          realized_pnl: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { error: insertError } = await supabase
          .from('portfolios')
          .insert([newPortfolio]);

        if (!insertError) {
          setPortfolio(newPortfolio);
        }
      }
    } catch (error: any) {
      console.error('Error fetching portfolio:', error);
    }
  };

  const fetchPositions = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;
      setPositions(data || []);
    } catch (error: any) {
      console.error('Error fetching positions:', error);
    }
  };

  const longPositions = positions.filter(p => p.position_type === 'long');
  const shortPositions = positions.filter(p => p.position_type === 'short');
  const totalUnrealizedPnL = positions.reduce((sum, p) => sum + p.unrealized_pnl, 0);

  const PositionRow: React.FC<{ position: any }> = ({ position }) => (
    <div className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
      <div className="flex items-center space-x-3">
        <div className={`w-2 h-2 rounded-full ${
          position.position_type === 'long' ? 'bg-green-400' : 'bg-red-400'
        }`} />
        <div>
          <div className="font-medium text-white">{position.symbol}</div>
          <div className="text-xs text-gray-400">
            {position.quantity} shares @ ${position.average_price.toFixed(2)}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-white font-medium">
          ${(position.quantity * position.current_price).toFixed(2)}
        </div>
        <div className={`text-xs ${
          position.unrealized_pnl >= 0 ? 'text-green-400' : 'text-red-400'
        }`}>
          {position.unrealized_pnl >= 0 ? '+' : ''}${position.unrealized_pnl.toFixed(2)}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Portfolio Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Value</p>
              <p className="text-2xl font-bold text-white">
                ${portfolio?.total_portfolio_value.toLocaleString() || '0'}
              </p>
            </div>
            <PieChart className="w-8 h-8 text-amber-400" />
          </div>
        </div>

        <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Available Cash</p>
              <p className="text-2xl font-bold text-white">
                ${portfolio?.available_cash.toLocaleString() || '0'}
              </p>
            </div>
            <DollarSign className="w-8 h-8 text-green-400" />
          </div>
        </div>

        <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Unrealized P&L</p>
              <p className={`text-2xl font-bold ${
                totalUnrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {totalUnrealizedPnL >= 0 ? '+' : ''}${totalUnrealizedPnL.toFixed(2)}
              </p>
            </div>
            {totalUnrealizedPnL >= 0 ? (
              <TrendingUp className="w-8 h-8 text-green-400" />
            ) : (
              <TrendingDown className="w-8 h-8 text-red-400" />
            )}
          </div>
        </div>

        <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Margin Used</p>
              <p className="text-2xl font-bold text-white">
                ${portfolio?.margin_used.toLocaleString() || '0'}
              </p>
            </div>
            <Activity className="w-8 h-8 text-blue-400" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="flex border-b border-gray-700/30">
          {[
            { key: 'holdings', label: 'Holdings', icon: PieChart },
            { key: 'positions', label: 'Positions', icon: Activity },
            { key: 'watchlist', label: 'Watchlist', icon: Eye },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as any)}
              className={`flex items-center space-x-2 px-6 py-4 transition-colors ${
                activeTab === key
                  ? 'bg-amber-500/20 text-amber-400 border-b-2 border-amber-500'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/30'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'holdings' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white mb-4">Portfolio Holdings</h3>
              {positions.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <PieChart className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No positions yet. Start trading to build your portfolio!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {positions.map((position) => (
                    <PositionRow key={position.id} position={position} />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'positions' && (
            <div className="space-y-6">
              {/* Long Positions */}
              <div>
                <h4 className="text-md font-semibold text-green-400 mb-3 flex items-center">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Long Positions ({longPositions.length})
                </h4>
                {longPositions.length === 0 ? (
                  <p className="text-gray-400 text-sm">No long positions</p>
                ) : (
                  <div className="space-y-3">
                    {longPositions.map((position) => (
                      <PositionRow key={position.id} position={position} />
                    ))}
                  </div>
                )}
              </div>

              {/* Short Positions */}
              <div>
                <h4 className="text-md font-semibold text-red-400 mb-3 flex items-center">
                  <TrendingDown className="w-4 h-4 mr-2" />
                  Short Positions ({shortPositions.length})
                </h4>
                {shortPositions.length === 0 ? (
                  <p className="text-gray-400 text-sm">No short positions</p>
                ) : (
                  <div className="space-y-3">
                    {shortPositions.map((position) => (
                      <PositionRow key={position.id} position={position} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'watchlist' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white mb-4">Watchlist</h3>
              <div className="space-y-3">
                {watchlist.map((symbol) => (
                  <div
                    key={symbol}
                    className="flex items-center justify-between p-3 bg-gray-800/30 rounded-lg border border-gray-700/30"
                  >
                    <div className="flex items-center space-x-3">
                      <Star className="w-4 h-4 text-amber-400" />
                      <span className="font-medium text-white">{symbol}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-medium">$150.25</div>
                      <div className="text-xs text-green-400">+2.45 (1.65%)</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};