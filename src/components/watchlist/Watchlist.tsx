import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { supabase } from '../../lib/supabase';
import { Eye, Plus, X, TrendingUp, TrendingDown } from 'lucide-react';

interface WatchlistItem {
  symbol: string;
  company_name: string;
  last_price: number;
  change: number;
  change_percent: number;
  volume: number;
}

export const Watchlist: React.FC = () => {
  const { updateChartState, marketData } = useStore();
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);

  useEffect(() => {
    fetchWatchlistData();
    fetchAvailableSymbols();
  }, []);

  const fetchWatchlistData = async () => {
    try {
      // Get sample watchlist symbols
      const symbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'AMZN'];
      
      const { data, error } = await supabase
        .from('LALAJI')
        .select('*')
        .in('symbol', symbols)
        .order('symbol');

      if (error) throw error;

      const watchlistData: WatchlistItem[] = data?.map(item => ({
        symbol: item.symbol,
        company_name: item.company_name,
        last_price: item.last_traded_price,
        change: item.last_traded_price - item.open_price,
        change_percent: ((item.last_traded_price - item.open_price) / item.open_price) * 100,
        volume: item.volume_traded,
      })) || [];

      setWatchlistItems(watchlistData);
    } catch (error: any) {
      console.error('Error fetching watchlist:', error);
    }
  };

  const fetchAvailableSymbols = async () => {
    try {
      const { data, error } = await supabase
        .from('LALAJI')
        .select('symbol')
        .order('symbol');

      if (error) throw error;

      const symbols = data?.map(item => item.symbol) || [];
      setAvailableSymbols([...new Set(symbols)]);
    } catch (error: any) {
      console.error('Error fetching symbols:', error);
    }
  };

  const addToWatchlist = (symbol: string) => {
    // In a real app, this would save to user preferences
    setShowAddModal(false);
    setSearchTerm('');
    // Refresh watchlist data
    fetchWatchlistData();
  };

  const removeFromWatchlist = (symbol: string) => {
    setWatchlistItems(prev => prev.filter(item => item.symbol !== symbol));
  };

  const selectSymbol = (symbol: string) => {
    updateChartState({ symbol });
  };

  const filteredSymbols = availableSymbols.filter(symbol =>
    symbol.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-700/30">
        <h3 className="text-lg font-semibold text-white flex items-center">
          <Eye className="w-5 h-5 mr-2 text-amber-400" />
          Watchlist
        </h3>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-1 px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Add</span>
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {watchlistItems.map((item) => (
          <div
            key={item.symbol}
            className="flex items-center justify-between p-3 border-b border-gray-700/20 hover:bg-gray-700/20 transition-colors cursor-pointer group"
            onClick={() => selectSymbol(item.symbol)}
          >
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">{item.symbol}</div>
                  <div className="text-xs text-gray-400 truncate max-w-32">
                    {item.company_name}
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="font-semibold text-white">
                    ${item.last_price.toFixed(2)}
                  </div>
                  <div className={`text-xs flex items-center ${
                    item.change >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {item.change >= 0 ? (
                      <TrendingUp className="w-3 h-3 mr-1" />
                    ) : (
                      <TrendingDown className="w-3 h-3 mr-1" />
                    )}
                    {item.change >= 0 ? '+' : ''}${item.change.toFixed(2)} ({item.change_percent.toFixed(2)}%)
                  </div>
                </div>
              </div>
              
              <div className="mt-2 text-xs text-gray-500">
                Vol: {item.volume.toLocaleString()}
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                removeFromWatchlist(item.symbol);
              }}
              className="opacity-0 group-hover:opacity-100 ml-2 p-1 text-gray-400 hover:text-red-400 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {watchlistItems.length === 0 && (
        <div className="p-8 text-center text-gray-400">
          <Eye className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Your watchlist is empty</p>
          <p className="text-sm">Add symbols to track their performance</p>
        </div>
      )}

      {/* Add Symbol Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Add to Watchlist</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4">
              <input
                type="text"
                placeholder="Search symbols..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                autoFocus
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2">
              {filteredSymbols.slice(0, 20).map((symbol) => (
                <button
                  key={symbol}
                  onClick={() => addToWatchlist(symbol)}
                  className="w-full text-left p-3 bg-gray-700/30 hover:bg-gray-700/50 rounded-lg text-white transition-colors"
                >
                  {symbol}
                </button>
              ))}
            </div>

            {filteredSymbols.length === 0 && searchTerm && (
              <div className="text-center py-4 text-gray-400">
                No symbols found matching "{searchTerm}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};