import React, { createContext, useContext, useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { useAuth } from './AuthContext';

const WS_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3002';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002/api';

interface MarketState {
  isRunning: boolean;
  isPaused: boolean;
  currentDataTick: number;
  totalDataTicks: number;
  progress: number;
  elapsedTime: number;
  speed: number;
  contestId?: string;
  contestStartTime?: string;  // Time 0
  dataStartTime?: string;
  contestEndTime?: string;
  symbols: string[];
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
  lastTickData: Map<string, any>;
}

const MarketContext = createContext<MarketContextType | undefined>(undefined);

export const MarketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('ADANIENT');
  const [subscribedSymbols, setSubscribedSymbols] = useState<string[]>([]);
  const [lastTickData, setLastTickData] = useState<Map<string, any>>(new Map());
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

  useEffect(() => {
    console.log(`🔌 Connecting to WebSocket: ${WS_URL}`);
    
    // Initialize WebSocket connection
    const newSocket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    newSocket.on('connect', () => {
      console.log('✅ Connected to market WebSocket');
      setIsConnected(true);
      
      // Authenticate if we have a token
      if (token) {
        newSocket.emit('authenticate', token);
      }
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Disconnected from market WebSocket');
      setIsConnected(false);
    });

    newSocket.on('authenticated', (data) => {
      if (data.success) {
        console.log('✅ WebSocket authenticated:', data.user.email);
      } else {
        console.error('❌ WebSocket authentication failed:', data.error);
      }
    });

    // ENHANCED: Contest state updates with Time 0 support
    newSocket.on('contest_state', (state) => {
      console.log('📊 Contest state update:', state);
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
        contestStartTime: state.contestStartTime, // Time 0
        dataStartTime: state.dataStartTime,
        symbols: state.symbols || []
      }));
    });

    // ENHANCED: Contest lifecycle events
    newSocket.on('contest_started', (data) => {
      console.log('🚀 Contest started:', data.message);
      setMarketState(prev => ({
        ...prev,
        isRunning: true,
        isPaused: false,
        contestId: data.contestId,
        contestStartTime: data.contestStartTime, // Time 0
        dataStartTime: data.dataStartTime,
        symbols: data.symbols || [],
        totalDataTicks: data.totalTicks || 0,
        speed: data.speed || 2,
        currentDataTick: 0
      }));
      
      // Show success notification
      if ('Notification' in window) {
        new Notification('Contest Started!', {
          body: 'Trading contest has begun. Good luck!',
          icon: '/favicon.ico'
        });
      }
    });

    newSocket.on('contest_ended', (data) => {
      console.log('🏁 Contest ended:', data.message);
      setMarketState(prev => ({
        ...prev,
        isRunning: false,
        isPaused: false,
        contestEndTime: data.endTime
      }));
      
      // Show end notification
      if ('Notification' in window) {
        new Notification('Contest Ended!', {
          body: 'All positions have been auto squared-off',
          icon: '/favicon.ico'
        });
      }
    });

    newSocket.on('contest_paused', (data) => {
      console.log('⏸️ Contest paused:', data.message);
      setMarketState(prev => ({ ...prev, isPaused: true }));
    });

    newSocket.on('contest_resumed', (data) => {
      console.log('▶️ Contest resumed:', data.message);
      setMarketState(prev => ({ ...prev, isPaused: false }));
    });

    newSocket.on('speed_changed', (data) => {
      console.log('⚡ Speed changed:', data.message);
      setMarketState(prev => ({ ...prev, speed: data.newSpeed }));
    });

    // ENHANCED: Market-wide tick updates
    newSocket.on('market_tick', (data) => {
      setMarketState(prev => ({
        ...prev,
        currentDataTick: data.tickIndex,
        totalDataTicks: data.totalTicks,
        progress: data.progress || 0,
        elapsedTime: data.elapsedTime || 0,
        contestStartTime: data.contestStartTime,
        dataStartTime: data.dataStartTime
      }));

      // Update last tick data for all symbols
      if (data.prices) {
        setLastTickData(prev => {
          const newMap = new Map(prev);
          Object.entries(data.prices).forEach(([symbol, price]) => {
            newMap.set(symbol, {
              symbol,
              price,
              timestamp: data.timestamp,
              tickIndex: data.tickIndex
            });
          });
          return newMap;
        });
      }
    });

    // ENHANCED: Individual symbol tick updates
    newSocket.on('symbol_tick', (data) => {
      if (data.symbol && data.data) {
        setLastTickData(prev => {
          const newMap = new Map(prev);
          newMap.set(data.symbol, {
            symbol: data.symbol,
            price: data.data.last_traded_price,
            volume: data.data.volume_traded,
            timestamp: data.data.timestamp,
            tickIndex: data.tickIndex,
            data: data.data,
            // Include OHLC from Angel One API
            ohlc: {
              open: data.data.open_price,
              high: data.data.high_price,
              low: data.data.low_price,
              close: data.data.close_price
            }
          });
          return newMap;
        });

        console.log(`📈 ${data.symbol}: ₹${data.data.last_traded_price} OHLC=${data.data.open_price}/${data.data.high_price}/${data.data.low_price}/${data.data.close_price} (Tick ${data.tickIndex})`);
      }
    });

    // Portfolio and leaderboard updates
    newSocket.on('portfolio_update', (portfolio) => {
      console.log('💼 Portfolio updated:', portfolio.total_wealth);
    });

    newSocket.on('leaderboard_update', (leaderboard) => {
      console.log('🏆 Leaderboard updated, top 3:', leaderboard.slice(0, 3));
    });

    setSocket(newSocket);

    // Fetch initial contest state
    axios.get(`${API_URL}/contest/state`)
      .then(({ data }) => {
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
          dataStartTime: data.dataStartTime,
          contestEndTime: data.contestEndTime,
          symbols: data.symbols || []
        }));
      })
      .catch(console.error);

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      newSocket.close();
    };
  }, [token]);

  // REVERTED: Back to working subscription logic
  const subscribeToMultipleSymbols = (symbols: string[]) => {
    if (!socket || symbols.length === 0) return;
    
    const newSymbols = symbols.filter(symbol => !subscribedSymbols.includes(symbol));
    if (newSymbols.length === 0) return;
    
    socket.emit('subscribe_symbols', newSymbols);
    setSubscribedSymbols(prev => [...prev, ...newSymbols]);
    console.log('📈 Subscribed to symbols:', newSymbols.join(', '));
  };

  const unsubscribeFromMultipleSymbols = (symbols: string[]) => {
    if (!socket || symbols.length === 0) return;
    
    const symbolsToUnsubscribe = symbols.filter(symbol => subscribedSymbols.includes(symbol));
    if (symbolsToUnsubscribe.length === 0) return;
    
    socket.emit('unsubscribe_symbols', symbolsToUnsubscribe);
    setSubscribedSymbols(prev => prev.filter(s => !symbolsToUnsubscribe.includes(s)));
    console.log('📉 Unsubscribed from symbols:', symbolsToUnsubscribe.join(', '));
  };

  const subscribeToSymbol = (symbol: string) => {
    subscribeToMultipleSymbols([symbol]);
  };

  const unsubscribeFromSymbol = (symbol: string) => {
    unsubscribeFromMultipleSymbols([symbol]);
  };

  return (
    <MarketContext.Provider value={{
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
    }}>
      {children}
    </MarketContext.Provider>
  );
};

export const useMarket = () => {
  const context = useContext(MarketContext);
  if (!context) throw new Error('useMarket must be used within MarketProvider');
  return context;
};