import React, { createContext, useContext, useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { useAuth } from './AuthContext';

const WS_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface MarketState {
  isRunning: boolean;
  isPaused: boolean;
  currentDataTick: number;
  totalDataTicks: number;
  progress: number;
  elapsedTime: number;
  speed: number;
  contestId?: string;
  contestStartTime?: string;
  dataStartTime?: string;
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
}

const MarketContext = createContext<MarketContextType | undefined>(undefined);

export const MarketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('ADANIENT');
  const [subscribedSymbols, setSubscribedSymbols] = useState<string[]>([]);
  const [marketState, setMarketState] = useState<MarketState>({
    isRunning: false,
    isPaused: false,
    currentDataTick: 0,
    totalDataTicks: 0,
    progress: 0,
    elapsedTime: 0,
    speed: 2
  });

  useEffect(() => {
    // Initialize WebSocket connection
    const newSocket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
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

    // Contest state updates
    newSocket.on('contest_state', (state) => {
      console.log('📊 Contest state update:', state);
      setMarketState({
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        currentDataTick: state.currentDataTick,
        totalDataTicks: state.totalDataTicks,
        progress: state.progress || 0,
        elapsedTime: state.elapsedTime || 0,
        speed: state.speed || 2,
        contestId: state.contestId,
        contestStartTime: state.contestStartTime,
        dataStartTime: state.dataStartTime
      });
    });

    // Market-wide updates
    newSocket.on('market_tick', (data) => {
      setMarketState(prev => ({
        ...prev,
        currentDataTick: data.tickIndex,
        totalDataTicks: data.totalTicks,
        progress: data.progress,
        contestStartTime: data.contestStartTime,
        dataStartTime: data.dataStartTime
      }));
    });

    newSocket.on('contest_ended', (data) => {
      console.log('🏁 Contest ended:', data.message);
      setMarketState(prev => ({ ...prev, isRunning: false, isPaused: false }));
    });

    newSocket.on('contest_paused', (data) => {
      console.log('⏸️ Contest paused:', data.message);
      setMarketState(prev => ({ ...prev, isPaused: true }));
    });

    newSocket.on('contest_resumed', (data) => {
      console.log('▶️ Contest resumed:', data.message);
      setMarketState(prev => ({ ...prev, isPaused: false }));
    });

    setSocket(newSocket);

    // Fetch initial contest state
    axios.get(`${API_URL}/contest/state`)
      .then(({ data }) => {
        setMarketState({
          isRunning: data.isRunning,
          isPaused: data.isPaused,
          currentDataTick: data.currentDataTick,
          totalDataTicks: data.totalDataTicks,
          progress: data.progress || 0,
          elapsedTime: data.elapsedTime || 0,
          speed: data.speed || 2,
          contestId: data.contestId,
          contestStartTime: data.contestStartTime,
          dataStartTime: data.dataStartTime
        });
      })
      .catch(console.error);

    return () => {
      newSocket.close();
    };
  }, [token]);

  const subscribeToSymbol = (symbol: string) => {
    if (!socket || subscribedSymbols.includes(symbol)) return;
    
    socket.emit('subscribe_symbols', [symbol]);
    setSubscribedSymbols(prev => [...prev, symbol]);
    console.log('📈 Subscribed to symbol:', symbol);
  };

  const unsubscribeFromSymbol = (symbol: string) => {
    if (!socket || !subscribedSymbols.includes(symbol)) return;
    
    socket.emit('unsubscribe_symbols', [symbol]);
    setSubscribedSymbols(prev => prev.filter(s => s !== symbol));
    console.log('📉 Unsubscribed from symbol:', symbol);
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
      unsubscribeFromSymbol
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