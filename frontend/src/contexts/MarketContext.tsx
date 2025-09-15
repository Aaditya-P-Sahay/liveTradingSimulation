import React, { createContext, useContext, useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';

const WS_URL = import.meta.env.VITE_WS_URL;
const API_URL = import.meta.env.VITE_API_URL;

interface MarketState {
  isRunning: boolean;
  isPaused: boolean;
  currentTickIndex: number;
  totalTicks: number;
  progress: number;
  elapsedTime: number;
  speed: number;
}

interface MarketContextType {
  socket: Socket | null;
  marketState: MarketState;
  isConnected: boolean;
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;
}

const MarketContext = createContext<MarketContextType | undefined>(undefined);

export const MarketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('ADANIENT');
  const [marketState, setMarketState] = useState<MarketState>({
    isRunning: false,
    isPaused: false,
    currentTickIndex: 0,
    totalTicks: 0,
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
      console.log('✅ Connected to market');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Disconnected from market');
      setIsConnected(false);
    });

    // Listen for global market state updates
    newSocket.on('market_state', (state: MarketState) => {
      setMarketState(state);
    });

    newSocket.on('market_stopped', ({ finalResults }) => {
      console.log('Market stopped, final results:', finalResults);
      setMarketState(prev => ({ ...prev, isRunning: false }));
    });

    newSocket.on('market_paused', () => {
      setMarketState(prev => ({ ...prev, isPaused: true }));
    });

    setSocket(newSocket);

    // Fetch initial market state
    axios.get(`${API_URL}/market/state`)
      .then(({ data }) => setMarketState(data))
      .catch(console.error);

    return () => {
      newSocket.close();
    };
  }, []);

  return (
    <MarketContext.Provider value={{
      socket,
      marketState,
      isConnected,
      selectedSymbol,
      setSelectedSymbol
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