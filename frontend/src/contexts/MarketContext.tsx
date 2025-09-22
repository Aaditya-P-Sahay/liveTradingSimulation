// frontend/src/contexts/MarketContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { useAuth } from './AuthContext';

const WS_URL = (import.meta as any).env?.VITE_API_URL?.replace('/api', '') || 'http://localhost:3002';
const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3002/api';

// FIXED: Enhanced MarketState interface with corrected fields
interface MarketState {
  isRunning: boolean;
  isPaused: boolean;
  currentDataIndex: number;          // Universal time seconds (0-3600)
  totalDataRows: number;             // Total universal time (3600)
  progress: number;                  // Percentage (0-100)
  elapsedTime: number;               // Wall clock time elapsed
  speed: number;                     // Speed multiplier (5x)
  contestId?: string;
  contestStartTime?: string;
  contestEndTime?: string;
  symbols: string[];
  timeframes: string[];
  
  // Legacy support for existing components
  currentDataTick?: number;          
  totalDataTicks?: number;           
}

interface TickData {
  symbol: string;
  price: number;
  volume?: number;
  timestamp: string;
  universalTime?: number;            // FIXED: Added universal time
  tickIndex: number;
  dataIndex?: number;
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
  symbols: string[];
  totalRows: number;
  speed: number;
  timeframes: string[];
}

interface ContestEndData {
  message: string;
  contestId: string;
  finalResults: LeaderboardEntry[];
  totalRows: number;
  endTime: string;
  contestStartTime: string;
}

interface MarketTickData {
  universalTime: number;             // FIXED: Universal time instead of tick index
  totalTime: number;                 // FIXED: Total universal time
  timestamp: string;
  prices: Record<string, number>;
  progress: number;
  contestStartTime: string;
  elapsedTime: number;
  tickUpdates: number;
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
  universalTime: number;             // FIXED: Universal time
  progress: number;
  contestStartTime: string;
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
  
  // FIXED: MarketState with corrected default values
  const [marketState, setMarketState] = useState<MarketState>({
    isRunning: false,
    isPaused: false,
    currentDataIndex: 0,
    totalDataRows: 3600,               // FIXED: 1 hour in seconds
    progress: 0,
    elapsedTime: 0,
    speed: 5,                          // FIXED: 5x speed default
    symbols: [],
    timeframes: ['1s', '5s', '15s', '30s', '1m', '3m', '5m', '15m'],
    
    // Legacy support
    currentDataTick: 0,
    totalDataTicks: 3600
  });

  // FIXED: WebSocket connection with enhanced error handling
  useEffect(() => {
    console.log(`🔌 FIXED: Connecting to WebSocket: ${WS_URL}`);
    
    const newSocket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      forceNew: true // FIXED: Force new connection
    });

    newSocket.on('connect', () => {
      console.log('✅ FIXED: Connected to market WebSocket');
      setIsConnected(true);
      
      if (token) {
        console.log('🔐 FIXED: Authenticating WebSocket connection...');
        newSocket.emit('authenticate', token);
      }
    });

    newSocket.on('disconnect', (reason: string) => {
      console.log('❌ FIXED: Disconnected from market WebSocket:', reason);
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error: Error) => {
      console.error('🔌 FIXED: WebSocket connection error:', error);
      setIsConnected(false);
    });

    newSocket.on('authenticated', (data: { success: boolean; user?: any; error?: string }) => {
      if (data.success) {
        console.log('✅ FIXED: WebSocket authenticated:', data.user?.email || 'User');
      } else {
        console.error('❌ FIXED: WebSocket authentication failed:', data.error);
      }
    });

    // FIXED: Contest state management with universal time
    newSocket.on('contest_state', (state: Partial<MarketState>) => {
      console.log('📊 FIXED: Contest state update received:', {
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        universalTime: state.currentDataIndex,
        totalTime: state.totalDataRows,
        progress: state.progress
      });
      
      setMarketState(prev => ({
        ...prev,
        isRunning: state.isRunning || false,
        isPaused: state.isPaused || false,
        currentDataIndex: state.currentDataIndex || 0,
        totalDataRows: state.totalDataRows || 3600,
        progress: state.progress || 0,
        elapsedTime: state.elapsedTime || 0,
        speed: state.speed || 5,
        contestId: state.contestId,
        contestStartTime: state.contestStartTime,
        symbols: state.symbols || [],
        timeframes: state.timeframes || prev.timeframes,
        
        // Legacy support
        currentDataTick: state.currentDataIndex || 0,
        totalDataTicks: state.totalDataRows || 3600
      }));
    });

    // FIXED: Contest lifecycle events with enhanced logging
    newSocket.on('contest_started', (data: ContestStartData) => {
      console.log('🚀 FIXED: Contest started event:', data.message);
      console.log('📊 FIXED: Contest details:', {
        contestId: data.contestId,
        contestStartTime: data.contestStartTime,
        symbols: data.symbols?.length || 0,
        totalRows: data.totalRows,
        timeframes: data.timeframes?.length || 0,
        speed: data.speed
      });
      
      setMarketState(prev => ({
        ...prev,
        isRunning: true,
        isPaused: false,
        contestId: data.contestId,
        contestStartTime: data.contestStartTime,
        symbols: data.symbols || [],
        totalDataRows: data.totalRows || 3600,
        speed: data.speed || 5,
        currentDataIndex: 0,
        progress: 0,
        timeframes: data.timeframes || prev.timeframes,
        
        // Legacy support
        totalDataTicks: data.totalRows || 3600,
        currentDataTick: 0
      }));
      
      // Show success notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('🚀 FIXED Contest Started!', {
          body: `Trading contest has begun with ${data.symbols?.length || 0} symbols and 5x speed compression!`,
          icon: '/favicon.ico'
        });
      }
    });

    newSocket.on('contest_ended', (data: ContestEndData) => {
      console.log('🏁 FIXED: Contest ended event:', data.message);
      console.log('🏆 FIXED: Final results preview:', data.finalResults?.slice(0, 3));
      
      setMarketState(prev => ({
        ...prev,
        isRunning: false,
        isPaused: false,
        contestEndTime: data.endTime,
        progress: 100
      }));
      
      if ('Notification' in window && Notification.permission === 'granted') {
        const winner = data.finalResults?.[0];
        new Notification('🏁 Contest Ended!', {
          body: winner 
            ? `Winner: ${winner.user_name} with ₹${winner.total_wealth?.toFixed(2)}`
            : 'Contest has ended',
          icon: '/favicon.ico'
        });
      }
    });

    newSocket.on('contest_paused', (data: { message: string }) => {
      console.log('⏸️ FIXED: Contest paused event:', data.message);
      setMarketState(prev => ({ ...prev, isPaused: true }));
    });

    newSocket.on('contest_resumed', (data: { message: string }) => {
      console.log('▶️ FIXED: Contest resumed event:', data.message);
      setMarketState(prev => ({ ...prev, isPaused: false }));
    });

    newSocket.on('speed_changed', (data: { newSpeed: number; message: string }) => {
      console.log('⚡ FIXED: Speed changed event:', data.message);
      setMarketState(prev => ({ ...prev, speed: data.newSpeed }));
    });

    // FIXED: Market-wide tick updates with universal time
    newSocket.on('market_tick', (data: MarketTickData) => {
      // FIXED: Update market state with universal time
      setMarketState(prev => ({
        ...prev,
        currentDataIndex: data.universalTime,
        totalDataRows: data.totalTime,
        progress: data.progress || 0,
        elapsedTime: data.elapsedTime || 0,
        contestStartTime: data.contestStartTime,
        
        // Legacy support
        currentDataTick: Math.floor(data.universalTime),
        totalDataTicks: data.totalTime
      }));

      // FIXED: Batch update last tick data efficiently
      if (data.prices && Object.keys(data.prices).length > 0) {
        setLastTickData(prev => {
          const newMap = new Map(prev);
          
          Object.entries(data.prices).forEach(([symbol, price]: [string, number]) => {
            const existingData = newMap.get(symbol);
            newMap.set(symbol, {
              symbol,
              price: price,
              timestamp: data.timestamp,
              universalTime: data.universalTime,
              tickIndex: Math.floor(data.universalTime),
              volume: existingData?.volume || 0,
              data: existingData?.data || {},
              ohlc: existingData?.ohlc
            });
          });
          
          return newMap;
        });
      }
      
      // FIXED: Debug output with universal time
      if (Math.floor(data.universalTime) % 100 === 0) {
        console.log(`📊 FIXED: Market tick ${data.universalTime.toFixed(1)}/${data.totalTime} (${data.progress?.toFixed(1)}%) - ${Object.keys(data.prices || {}).length} symbols updated`);
      }
    });

    // FIXED: Individual symbol tick updates with universal time
    newSocket.on('symbol_tick', (data: SymbolTickData) => {
      if (data.symbol && data.data) {
        setLastTickData(prev => {
          const newMap = new Map(prev);
          
          const tickData: TickData = {
            symbol: data.symbol,
            price: data.data.last_traded_price,
            volume: data.data.volume_traded,
            timestamp: data.data.timestamp,
            universalTime: data.universalTime,
            tickIndex: Math.floor(data.universalTime),
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

        // FIXED: Debug output with universal time
        if (Math.floor(data.universalTime) % 50 === 0) {
          console.log(`📈 FIXED: ${data.symbol}: ₹${data.data.last_traded_price.toFixed(2)} | Universal Time: ${data.universalTime.toFixed(1)}`);
        }
      }
    });

    // Portfolio and leaderboard updates (preserved)
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
      console.error('🔴 FIXED: WebSocket error:', error);
    });

    setSocket(newSocket);

    // FIXED: Fetch initial contest state with retry logic
    const fetchInitialState = async (retries: number = 3): Promise<void> => {
      try {
        console.log('📊 FIXED: Fetching initial contest state...');
        const { data } = await axios.get(`${API_URL}/contest/state`);
        
        console.log('✅ FIXED: Initial contest state loaded:', {
          isRunning: data.isRunning,
          isPaused: data.isPaused,
          universalTime: data.currentDataIndex,
          totalTime: data.totalDataRows,
          symbols: data.symbols?.length || 0,
          speed: data.speed
        });
        
        setMarketState(prev => ({
          ...prev,
          isRunning: data.isRunning || false,
          isPaused: data.isPaused || false,
          currentDataIndex: data.currentDataIndex || 0,
          totalDataRows: data.totalDataRows || 3600,
          progress: data.progress || 0,
          elapsedTime: data.elapsedTime || 0,
          speed: data.speed || 5,
          contestId: data.contestId,
          contestStartTime: data.contestStartTime,
          contestEndTime: data.contestEndTime,
          symbols: data.symbols || [],
          timeframes: data.timeframes || prev.timeframes,
          
          // Legacy support
          currentDataTick: data.currentDataIndex || 0,
          totalDataTicks: data.totalDataRows || 3600
        }));
      } catch (error) {
        console.error('❌ FIXED: Failed to fetch initial contest state:', error);
        if (retries > 0) {
          console.log(`🔄 FIXED: Retrying in 2 seconds... (${retries} attempts left)`);
          setTimeout(() => fetchInitialState(retries - 1), 2000);
        }
      }
    };

    fetchInitialState();

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((permission: NotificationPermission) => {
        console.log('🔔 FIXED: Notification permission:', permission);
      });
    }

    return () => {
      console.log('🧹 FIXED: Cleaning up WebSocket connection');
      newSocket.close();
    };
  }, [token]);

  // FIXED: Subscription functions with enhanced error handling
  const subscribeToMultipleSymbols = (symbols: string[]): void => {
    if (!socket || !socket.connected || symbols.length === 0) {
      console.warn('⚠️ FIXED: Cannot subscribe: socket not ready or no symbols provided');
      return;
    }
    
    const newSymbols = symbols.filter((symbol: string) => !subscribedSymbols.includes(symbol));
    if (newSymbols.length === 0) {
      console.log('ℹ️ FIXED: All requested symbols already subscribed');
      return;
    }
    
    console.log(`📈 FIXED: Subscribing to ${newSymbols.length} new symbols:`, newSymbols.join(', '));
    socket.emit('subscribe_symbols', newSymbols);
    setSubscribedSymbols(prev => {
      const updated = [...prev, ...newSymbols];
      console.log(`✅ FIXED: Total subscribed symbols: ${updated.length}`);
      return updated;
    });
  };

  const unsubscribeFromMultipleSymbols = (symbols: string[]): void => {
    if (!socket || !socket.connected || symbols.length === 0) {
      console.warn('⚠️ FIXED: Cannot unsubscribe: socket not ready or no symbols provided');
      return;
    }
    
    const symbolsToUnsubscribe = symbols.filter((symbol: string) => subscribedSymbols.includes(symbol));
    if (symbolsToUnsubscribe.length === 0) {
      console.log('ℹ️ FIXED: No subscribed symbols to unsubscribe from');
      return;
    }
    
    console.log(`📉 FIXED: Unsubscribing from ${symbolsToUnsubscribe.length} symbols:`, symbolsToUnsubscribe.join(', '));
    socket.emit('unsubscribe_symbols', symbolsToUnsubscribe);
    setSubscribedSymbols(prev => {
      const updated = prev.filter((s: string) => !symbolsToUnsubscribe.includes(s));
      console.log(`✅ FIXED: Remaining subscribed symbols: ${updated.length}`);
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

  // FIXED: Connection status monitoring
  useEffect(() => {
    const handleOnline = (): void => {
      console.log('🌐 FIXED: Network connection restored');
      if (socket && !socket.connected) {
        socket.connect();
      }
    };

    const handleOffline = (): void => {
      console.log('🔌 FIXED: Network connection lost');
      setIsConnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [socket]);

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

export type { MarketState, TickData, MarketContextType, LeaderboardEntry };