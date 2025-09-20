import React, { createContext, useContext, useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { useAuth } from './AuthContext';

const WS_URL = (import.meta as any).env?.VITE_API_URL?.replace('/api', '') || 'http://localhost:3002';
const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3002/api';

interface MarketState {
  isRunning: boolean;
  isPaused: boolean;
  currentDataTick: number;
  totalDataTicks: number;
  progress: number;
  elapsedTime: number;
  speed: number;
  contestId?: string;
  contestStartTime?: string;  // Time 0 - ABSOLUTE TIMESTAMP
  marketStartTime?: string;   // Market start for timestamp calculations
  contestEndTime?: string;
  symbols: string[];
}

interface TickData {
  symbol: string;
  price: number;
  volume?: number;
  timestamp: string;
  absoluteTime?: string;
  tickIndex: number;
  data: any;
  ohlc?: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
}

interface LeaderboardEntry {
  rank: number;
  user_name: string;
  user_email: string;
  total_wealth: number;
  total_pnl: number;
  return_percentage: number;
  cash_balance: number;
  market_value: number;
  short_value: number;
  realized_pnl: number;
  unrealized_pnl: number;
}

interface ContestStartData {
  message: string;
  contestId: string;
  contestStartTime: string;
  marketStartTime: string;
  symbols: string[];
  totalTicks: number;
  speed: number;
}

interface ContestEndData {
  message: string;
  contestId: string;
  finalResults: LeaderboardEntry[];
  totalTicks: number;
  endTime: string;
  contestStartTime: string;
}

interface MarketTickData {
  tickIndex: number;
  totalTicks: number;
  timestamp: string;
  prices: Record<string, number>;
  progress: number;
  contestStartTime: string;
  marketStartTime: string;
  elapsedTime: number;
}

interface SymbolTickData {
  symbol: string;
  data: {
    last_traded_price: number;
    volume_traded: number;
    timestamp: string;
    open_price: number;
    high_price: number;
    low_price: number;
    close_price: number;
  };
  tickIndex: number;
  totalTicks: number;
  progress: number;
  contestStartTime: string;
  marketStartTime: string;
  absoluteTime: string;
}

interface MarketContextType {
  socket: Socket | null;
  marketState: MarketState;
  isConnected: boolean;
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;
  subscribedSymbols: string[];
  subscribeToSymbol: (symbol: string) => void;
  unsubscribeFromSymbol: (symbol: string) => void;
  subscribeToMultipleSymbols: (symbols: string[]) => void;
  unsubscribeFromMultipleSymbols: (symbols: string[]) => void;
  lastTickData: Map<string, TickData>;
}

const MarketContext = createContext<MarketContextType | undefined>(undefined);

export const MarketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('ADANIENT');
  const [subscribedSymbols, setSubscribedSymbols] = useState<string[]>([]);
  const [lastTickData, setLastTickData] = useState<Map<string, TickData>>(new Map());
  const [marketState, setMarketState] = useState<MarketState>({
    isRunning: false,
    isPaused: false,
    currentDataTick: 0,
    totalDataTicks: 0,
    progress: 0,
    elapsedTime: 0,
    speed: 2,
    symbols: []
  });

  // Connection and authentication management
  useEffect(() => {
    console.log(`🔌 Connecting to WebSocket: ${WS_URL}`);
    
    // Initialize WebSocket connection with robust settings
    const newSocket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    // Connection event handlers
    newSocket.on('connect', () => {
      console.log('✅ Connected to market WebSocket');
      setIsConnected(true);
      
      // Authenticate if we have a token
      if (token) {
        console.log('🔐 Authenticating WebSocket connection...');
        newSocket.emit('authenticate', token);
      }
    });

    newSocket.on('disconnect', (reason: string) => {
      console.log('❌ Disconnected from market WebSocket:', reason);
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error: Error) => {
      console.error('🔌 WebSocket connection error:', error);
      setIsConnected(false);
    });

    newSocket.on('authenticated', (data: { success: boolean; user?: any; error?: string }) => {
      if (data.success) {
        console.log('✅ WebSocket authenticated:', data.user?.email || 'User');
      } else {
        console.error('❌ WebSocket authentication failed:', data.error);
      }
    });

    // ENHANCED: Contest state management with Time 0 support
    newSocket.on('contest_state', (state: Partial<MarketState>) => {
      console.log('📊 Contest state update received:', {
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        currentTick: state.currentDataTick,
        totalTicks: state.totalDataTicks,
        progress: state.progress
      });
      
      setMarketState(prev => ({
        ...prev,
        isRunning: state.isRunning || false,
        isPaused: state.isPaused || false,
        currentDataTick: state.currentDataTick || 0,
        totalDataTicks: state.totalDataTicks || 0,
        progress: state.progress || 0,
        elapsedTime: state.elapsedTime || 0,
        speed: state.speed || 2,
        contestId: state.contestId,
        contestStartTime: state.contestStartTime, // Time 0 - ABSOLUTE
        marketStartTime: state.marketStartTime,   // Market start for calculations
        symbols: state.symbols || []
      }));
    });

    // ENHANCED: Contest lifecycle events with notifications
    newSocket.on('contest_started', (data: ContestStartData) => {
      console.log('🚀 Contest started event:', data.message);
      console.log('📊 Contest details:', {
        contestId: data.contestId,
        contestStartTime: data.contestStartTime,
        symbols: data.symbols?.length || 0,
        totalTicks: data.totalTicks
      });
      
      setMarketState(prev => ({
        ...prev,
        isRunning: true,
        isPaused: false,
        contestId: data.contestId,
        contestStartTime: data.contestStartTime, // Time 0 - ABSOLUTE
        marketStartTime: data.marketStartTime,   // Market start for calculations
        symbols: data.symbols || [],
        totalDataTicks: data.totalTicks || 0,
        speed: data.speed || 2,
        currentDataTick: 0,
        progress: 0
      }));
      
      // Show success notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('🚀 Contest Started!', {
          body: `Trading contest has begun with ${data.symbols?.length || 0} symbols. Good luck!`,
          icon: '/favicon.ico'
        });
      }
    });

    newSocket.on('contest_ended', (data: ContestEndData) => {
      console.log('🏁 Contest ended event:', data.message);
      console.log('🏆 Final results preview:', data.finalResults?.slice(0, 3));
      
      setMarketState(prev => ({
        ...prev,
        isRunning: false,
        isPaused: false,
        contestEndTime: data.endTime,
        progress: 100
      }));
      
      // Show end notification
      if ('Notification' in window && Notification.permission === 'granted') {
        const winner = data.finalResults?.[0];
        new Notification('🏁 Contest Ended!', {
          body: winner 
            ? `Winner: ${winner.user_name} with ₹${winner.total_wealth?.toFixed(2)}`
            : 'All positions have been auto squared-off',
          icon: '/favicon.ico'
        });
      }
    });

    newSocket.on('contest_paused', (data: { message: string }) => {
      console.log('⏸️ Contest paused event:', data.message);
      setMarketState(prev => ({ ...prev, isPaused: true }));
      
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('⏸️ Contest Paused', {
          body: 'Trading has been temporarily paused',
          icon: '/favicon.ico'
        });
      }
    });

    newSocket.on('contest_resumed', (data: { message: string }) => {
      console.log('▶️ Contest resumed event:', data.message);
      setMarketState(prev => ({ ...prev, isPaused: false }));
      
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('▶️ Contest Resumed', {
          body: 'Trading has resumed. Good luck!',
          icon: '/favicon.ico'
        });
      }
    });

    newSocket.on('speed_changed', (data: { newSpeed: number; message: string }) => {
      console.log('⚡ Speed changed event:', data.message);
      setMarketState(prev => ({ ...prev, speed: data.newSpeed }));
    });

    // ENHANCED: Market-wide tick updates with performance optimization
    newSocket.on('market_tick', (data: MarketTickData) => {
      // Update market state efficiently
      setMarketState(prev => ({
        ...prev,
        currentDataTick: data.tickIndex,
        totalDataTicks: data.totalTicks,
        progress: data.progress || 0,
        elapsedTime: data.elapsedTime || 0,
        contestStartTime: data.contestStartTime,
        marketStartTime: data.marketStartTime
      }));

      // Batch update last tick data for performance
      if (data.prices && Object.keys(data.prices).length > 0) {
        setLastTickData(prev => {
          const newMap = new Map(prev);
          
          // Efficiently update multiple symbols at once
          Object.entries(data.prices).forEach(([symbol, price]: [string, number]) => {
            const existingData = newMap.get(symbol);
            newMap.set(symbol, {
              symbol,
              price: price,
              timestamp: data.timestamp,
              tickIndex: data.tickIndex,
              volume: existingData?.volume || 0,
              data: existingData?.data || {},
              ohlc: existingData?.ohlc
            });
          });
          
          return newMap;
        });
      }
      
      // Debug output for monitoring (only every 100 ticks to avoid spam)
      if (data.tickIndex % 100 === 0) {
        console.log(`📊 Market tick ${data.tickIndex}/${data.totalTicks} (${data.progress?.toFixed(1)}%) - ${Object.keys(data.prices || {}).length} symbols updated`);
      }
    });

    // ENHANCED: Individual symbol tick updates with detailed data
    newSocket.on('symbol_tick', (data: SymbolTickData) => {
      if (data.symbol && data.data) {
        setLastTickData(prev => {
          const newMap = new Map(prev);
          
          // Create comprehensive tick data object
          const tickData: TickData = {
            symbol: data.symbol,
            price: data.data.last_traded_price,
            volume: data.data.volume_traded,
            timestamp: data.data.timestamp,
            absoluteTime: data.absoluteTime,
            tickIndex: data.tickIndex,
            data: data.data,
            ohlc: {
              open: data.data.open_price,
              high: data.data.high_price,
              low: data.data.low_price,
              close: data.data.close_price
            }
          };
          
          newMap.set(data.symbol, tickData);
          return newMap;
        });

        // Debug output for individual symbols (throttled)
        if (data.tickIndex % 50 === 0) {
          console.log(`📈 ${data.symbol}: ₹${data.data.last_traded_price.toFixed(2)} | OHLC: ${data.data.open_price}/${data.data.high_price}/${data.data.low_price}/${data.data.close_price} | Vol: ${data.data.volume_traded} | Tick: ${data.tickIndex}`);
        }
      }
    });

    // ENHANCED: Portfolio and leaderboard updates
    newSocket.on('portfolio_update', (portfolio: {
      total_wealth?: number;
      total_pnl?: number;
      cash_balance?: number;
    }) => {
      console.log('💼 Portfolio updated:', {
        totalWealth: portfolio.total_wealth?.toFixed(2),
        totalPnL: portfolio.total_pnl?.toFixed(2),
        cashBalance: portfolio.cash_balance?.toFixed(2)
      });
    });

    // FIXED: Properly typed leaderboard update handler
    newSocket.on('leaderboard_update', (leaderboard: LeaderboardEntry[]) => {
      if (leaderboard && leaderboard.length > 0) {
        const topThreeDescriptions = leaderboard.slice(0, 3).map((entry: LeaderboardEntry, index: number) => 
          `${index + 1}. ${entry.user_name}: ₹${entry.total_wealth?.toFixed(2)} (${entry.return_percentage?.toFixed(2)}%)`
        );
        console.log('🏆 Leaderboard updated - Top 3:', topThreeDescriptions);
      }
    });

    // Error handling
    newSocket.on('error', (error: Error) => {
      console.error('🔴 WebSocket error:', error);
    });

    setSocket(newSocket);

    // ENHANCED: Fetch initial contest state with retry logic
    const fetchInitialState = async (retries: number = 3): Promise<void> => {
      try {
        console.log('📊 Fetching initial contest state...');
        const { data } = await axios.get(`${API_URL}/contest/state`);
        
        console.log('✅ Initial contest state loaded:', {
          isRunning: data.isRunning,
          isPaused: data.isPaused,
          currentTick: data.currentDataTick,
          totalTicks: data.totalDataTicks,
          symbols: data.symbols?.length || 0
        });
        
        setMarketState(prev => ({
          ...prev,
          isRunning: data.isRunning || false,
          isPaused: data.isPaused || false,
          currentDataTick: data.currentDataTick || 0,
          totalDataTicks: data.totalDataTicks || 0,
          progress: data.progress || 0,
          elapsedTime: data.elapsedTime || 0,
          speed: data.speed || 2,
          contestId: data.contestId,
          contestStartTime: data.contestStartTime,
          marketStartTime: data.marketStartTime,
          contestEndTime: data.contestEndTime,
          symbols: data.symbols || []
        }));
      } catch (error) {
        console.error('❌ Failed to fetch initial contest state:', error);
        if (retries > 0) {
          console.log(`🔄 Retrying in 2 seconds... (${retries} attempts left)`);
          setTimeout(() => fetchInitialState(retries - 1), 2000);
        }
      }
    };

    fetchInitialState();

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((permission: NotificationPermission) => {
        console.log('🔔 Notification permission:', permission);
      });
    }

    return () => {
      console.log('🧹 Cleaning up WebSocket connection');
      newSocket.close();
    };
  }, [token]);

  // ENHANCED: Efficient subscription management with batch operations
  const subscribeToMultipleSymbols = (symbols: string[]): void => {
    if (!socket || !socket.connected || symbols.length === 0) {
      console.warn('⚠️ Cannot subscribe: socket not ready or no symbols provided');
      return;
    }
    
    const newSymbols = symbols.filter((symbol: string) => !subscribedSymbols.includes(symbol));
    if (newSymbols.length === 0) {
      console.log('ℹ️ All requested symbols already subscribed');
      return;
    }
    
    console.log(`📈 Subscribing to ${newSymbols.length} new symbols:`, newSymbols.join(', '));
    socket.emit('subscribe_symbols', newSymbols);
    setSubscribedSymbols(prev => {
      const updated = [...prev, ...newSymbols];
      console.log(`✅ Total subscribed symbols: ${updated.length}`);
      return updated;
    });
  };

  const unsubscribeFromMultipleSymbols = (symbols: string[]): void => {
    if (!socket || !socket.connected || symbols.length === 0) {
      console.warn('⚠️ Cannot unsubscribe: socket not ready or no symbols provided');
      return;
    }
    
    const symbolsToUnsubscribe = symbols.filter((symbol: string) => subscribedSymbols.includes(symbol));
    if (symbolsToUnsubscribe.length === 0) {
      console.log('ℹ️ No subscribed symbols to unsubscribe from');
      return;
    }
    
    console.log(`📉 Unsubscribing from ${symbolsToUnsubscribe.length} symbols:`, symbolsToUnsubscribe.join(', '));
    socket.emit('unsubscribe_symbols', symbolsToUnsubscribe);
    setSubscribedSymbols(prev => {
      const updated = prev.filter((s: string) => !symbolsToUnsubscribe.includes(s));
      console.log(`✅ Remaining subscribed symbols: ${updated.length}`);
      return updated;
    });
    
    // Clean up last tick data for unsubscribed symbols
    setLastTickData(prev => {
      const newMap = new Map(prev);
      symbolsToUnsubscribe.forEach((symbol: string) => newMap.delete(symbol));
      return newMap;
    });
  };

  const subscribeToSymbol = (symbol: string): void => {
    subscribeToMultipleSymbols([symbol]);
  };

  const unsubscribeFromSymbol = (symbol: string): void => {
    unsubscribeFromMultipleSymbols([symbol]);
  };

  // ENHANCED: Connection status monitoring
  useEffect(() => {
    const handleOnline = (): void => {
      console.log('🌐 Network connection restored');
      if (socket && !socket.connected) {
        socket.connect();
      }
    };

    const handleOffline = (): void => {
      console.log('🔌 Network connection lost');
      setIsConnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [socket]);

  // ENHANCED: Debug information in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const logInterval = setInterval(() => {
        console.log('📊 Market Context Debug Info:', {
          isConnected,
          subscribedSymbols: subscribedSymbols.length,
          lastTickDataSize: lastTickData.size,
          marketState: {
            isRunning: marketState.isRunning,
            currentTick: marketState.currentDataTick,
            progress: `${marketState.progress.toFixed(1)}%`
          }
        });
      }, 30000); // Every 30 seconds

      return () => clearInterval(logInterval);
    }
  }, [isConnected, subscribedSymbols.length, lastTickData.size, marketState.isRunning, marketState.currentDataTick, marketState.progress]);

  const contextValue: MarketContextType = {
    socket,
    marketState,
    isConnected,
    selectedSymbol,
    setSelectedSymbol,
    subscribedSymbols,
    subscribeToSymbol,
    unsubscribeFromSymbol,
    subscribeToMultipleSymbols,
    unsubscribeFromMultipleSymbols,
    lastTickData
  };

  return (
    <MarketContext.Provider value={contextValue}>
      {children}
    </MarketContext.Provider>
  );
};

export const useMarket = (): MarketContextType => {
  const context = useContext(MarketContext);
  if (!context) {
    throw new Error('useMarket must be used within MarketProvider');
  }
  return context;
};

// Export types for use in other components
export type { MarketState, TickData, MarketContextType, LeaderboardEntry };