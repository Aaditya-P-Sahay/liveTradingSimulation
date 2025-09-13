// src/components/Watchlist.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, X, Star, TrendingUp, TrendingDown, Eye, EyeOff, MoreVertical } from 'lucide-react';
import { webSocketService, StockTick } from '../services/websocket';
import { apiService } from '../services/api';

interface WatchlistItem {
  symbol: string;
  companyName: string;
  currentPrice: number;
  previousPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  lastUpdate: string;
  isFavorite: boolean;
}

interface WatchlistProps {
  onSymbolSelect: (symbol: string) => void;
  selectedSymbol?: string;
  isVisible: boolean;
  onToggleVisibility: () => void;
}

export const Watchlist: React.FC<WatchlistProps> = ({
  onSymbolSelect,
  selectedSymbol,
  isVisible,
  onToggleVisibility
}) => {
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [isAddingSymbol, setIsAddingSymbol] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'symbol' | 'change' | 'volume'>('symbol');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Load watchlist from localStorage
  useEffect(() => {
    const savedWatchlist = localStorage.getItem('stockWatchlist');
    if (savedWatchlist) {
      try {
        const parsed = JSON.parse(savedWatchlist);
        setWatchlistItems(parsed.map((item: any) => ({
          ...item,
          change: 0,
          changePercent: 0,
          previousPrice: item.currentPrice || 0
        })));
      } catch (error) {
        console.error('Failed to parse saved watchlist:', error);
      }
    }
  }, []);

  // Save watchlist to localStorage
  const saveWatchlist = useCallback((items: WatchlistItem[]) => {
    localStorage.setItem('stockWatchlist', JSON.stringify(items));
  }, []);

  // Load available symbols
  useEffect(() => {
    const loadSymbols = async () => {
      try {
        const symbols = await apiService.getSymbols();
        setAvailableSymbols(symbols);
      } catch (error) {
        console.error('Failed to load symbols:', error);
      }
    };
    loadSymbols();
  }, []);

  // Handle real-time updates
  const handleTickUpdate = useCallback((tick: StockTick) => {
    setWatchlistItems(prev => 
      prev.map(item => {
        if (item.symbol === tick.symbol) {
          const previousPrice = item.currentPrice;
          const newPrice = tick.data.last_traded_price;
          const change = newPrice - previousPrice;
          const changePercent = previousPrice > 0 ? (change / previousPrice) * 100 : 0;

          return {
            ...item,
            currentPrice: newPrice,
            previousPrice,
            change,
            changePercent,
            volume: tick.data.volume_traded,
            lastUpdate: new Date().toLocaleTimeString(),
            companyName: tick.data.company_name || item.companyName
          };
        }
        return item;
      })
    );
  }, []);

  // Subscribe to updates for all watchlist symbols
  useEffect(() => {
    const unsubscribeFunctions: (() => void)[] = [];

    watchlistItems.forEach(item => {
      const unsubscribe = webSocketService.subscribeToTicks(item.symbol, handleTickUpdate);
      unsubscribeFunctions.push(unsubscribe);
    });

    return () => {
      unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
    };
  }, [watchlistItems.map(item => item.symbol).join(','), handleTickUpdate]);

  const addToWatchlist = async (symbol: string) => {
    if (watchlistItems.some(item => item.symbol === symbol)) {
      return; // Already in watchlist
    }

    try {
      // Get initial data for the symbol
      const response = await apiService.getHistory(symbol, 1, 1);
      const latestData = response.data[response.data.length - 1];

      const newItem: WatchlistItem = {
        symbol,
        companyName: latestData?.company_name || symbol,
        currentPrice: latestData?.last_traded_price || 0,
        previousPrice: latestData?.last_traded_price || 0,
        change: 0,
        changePercent: 0,
        volume: latestData?.volume_traded || 0,
        lastUpdate: new Date().toLocaleTimeString(),
        isFavorite: false
      };

      const updatedItems = [...watchlistItems, newItem];
      setWatchlistItems(updatedItems);
      saveWatchlist(updatedItems);
      setIsAddingSymbol(false);
      setSearchTerm('');
    } catch (error) {
      console.error('Failed to add symbol to watchlist:', error);
    }
  };

  const removeFromWatchlist = (symbol: string) => {
    const updatedItems = watchlistItems.filter(item => item.symbol !== symbol);
    setWatchlistItems(updatedItems);
    saveWatchlist(updatedItems);
  };

  const toggleFavorite = (symbol: string) => {
    const updatedItems = watchlistItems.map(item =>
      item.symbol === symbol ? { ...item, isFavorite: !item.isFavorite } : item
    );
    setWatchlistItems(updatedItems);
    saveWatchlist(updatedItems);
  };

  const getSortedItems = () => {
    const sorted = [...watchlistItems].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'symbol':
          comparison = a.symbol.localeCompare(b.symbol);
          break;
        case 'change':
          comparison = a.changePercent - b.changePercent;
          break;
        case 'volume':
          comparison = a.volume - b.volume;
          break;
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Always show favorites first
    return sorted.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return 0;
    });
  };

  const filteredSymbols = availableSymbols.filter(symbol =>
    symbol.toLowerCase().includes(searchTerm.toLowerCase()) &&
    !watchlistItems.some(item => item.symbol === symbol)
  );

  if (!isVisible) {
    return (
      <button
        onClick={onToggleVisibility}
        className="fixed left-4 top-1/2 transform -translate-y-1/2 bg-blue-600 text-white p-3 rounded-r-lg shadow-lg hover:bg-blue-700 transition-colors z-40"
        title="Show Watchlist"
      >
        <Eye className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed left-0 top-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Watchlist</h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsAddingSymbol(true)}
            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            title="Add Stock"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleVisibility}
            className="p-2 text-gray-600 hover:text-gray-800 transition-colors"
            title="Hide Watchlist"
          >
            <EyeOff className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sort Controls */}
      <div className="p-3 border-b border-gray-100 flex items-center space-x-2">
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'symbol' | 'change' | 'volume')}
          className="text-xs bg-gray-100 border-0 rounded px-2 py-1"
        >
          <option value="symbol">Symbol</option>
          <option value="change">Change</option>
          <option value="volume">Volume</option>
        </select>
        <button
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="text-xs text-gray-600 hover:text-gray-800"
        >
          {sortOrder === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      {/* Add Symbol Modal */}
      {isAddingSymbol && (
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search symbols..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {filteredSymbols.slice(0, 10).map(symbol => (
              <button
                key={symbol}
                onClick={() => addToWatchlist(symbol)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-white rounded-lg transition-colors"
              >
                {symbol}
              </button>
            ))}
          </div>
          <div className="mt-3 flex space-x-2">
            <button
              onClick={() => setIsAddingSymbol(false)}
              className="flex-1 px-3 py-2 text-sm bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Watchlist Items */}
      <div className="flex-1 overflow-y-auto">
        {getSortedItems().map(item => (
          <div
            key={item.symbol}
            className={`p-4 border-b border-gray-100 cursor-pointer transition-colors ${
              selectedSymbol === item.symbol ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50'
            }`}
            onClick={() => onSymbolSelect(item.symbol)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(item.symbol);
                    }}
                    className={`mr-2 p-1 rounded ${
                      item.isFavorite ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'
                    }`}
                  >
                    <Star className={`w-4 h-4 ${item.isFavorite ? 'fill-current' : ''}`} />
                  </button>
                  <div>
                    <h3 className="font-semibold text-gray-800 truncate">{item.symbol}</h3>
                    <p className="text-xs text-gray-600 truncate">{item.companyName}</p>
                  </div>
                </div>
                
                <div className="mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-gray-800">
                      ₹{item.currentPrice.toFixed(2)}
                    </span>
                    <div className={`flex items-center text-sm ${
                      item.change >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {item.change >= 0 ? 
                        <TrendingUp className="w-3 h-3 mr-1" /> : 
                        <TrendingDown className="w-3 h-3 mr-1" />
                      }
                      <span>{item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-xs ${
                      item.change >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
                    </span>
                    <span className="text-xs text-gray-500">
                      Vol: {item.volume.toLocaleString()}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-400">
                      Updated: {item.lastUpdate}
                    </span>
                  </div>
                </div>
              </div>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromWatchlist(item.symbol);
                }}
                className="ml-2 p-1 text-gray-400 hover:text-red-500 transition-colors"
                title="Remove from watchlist"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}

        {watchlistItems.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            <Star className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p className="text-sm">Your watchlist is empty</p>
            <p className="text-xs text-gray-400 mt-1">
              Click the + button to add stocks
            </p>
          </div>
        )}
      </div>

      {/* Footer Stats */}
      {watchlistItems.length > 0 && (
        <div className="p-3 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-between text-xs text-gray-600">
            <span>{watchlistItems.length} stocks</span>
            <span>
              {watchlistItems.filter(item => item.change > 0).length} up,{' '}
              {watchlistItems.filter(item => item.change < 0).length} down
            </span>
          </div>
        </div>
      )}
    </div>
  );
};