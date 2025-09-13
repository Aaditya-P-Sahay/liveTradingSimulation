import { create } from 'zustand';
import { User, Portfolio, Position, Trade, MarketData, ChartState, SimulationControl } from '../types';

interface AppState {
  // Auth
  user: User | null;
  isAuthenticated: boolean;
  
  // Market Data
  marketData: Record<string, MarketData>;
  candlestickData: Record<string, any[]>;
  
  // Portfolio
  portfolio: Portfolio | null;
  positions: Position[];
  trades: Trade[];
  
  // Chart
  chartState: ChartState;
  
  // Simulation
  simulationControl: SimulationControl | null;
  
  // Leaderboard
  leaderboard: Array<{
    user_id: string;
    name: string;
    total_portfolio_value: number;
    rank: number;
  }>;
  
  // Actions
  setUser: (user: User | null) => void;
  setAuthenticated: (authenticated: boolean) => void;
  updateMarketData: (symbol: string, data: MarketData) => void;
  updateCandlestickData: (symbol: string, data: any[]) => void;
  setPortfolio: (portfolio: Portfolio) => void;
  setPositions: (positions: Position[]) => void;
  addTrade: (trade: Trade) => void;
  updateChartState: (updates: Partial<ChartState>) => void;
  setSimulationControl: (control: SimulationControl) => void;
  setLeaderboard: (leaderboard: any[]) => void;
}

export const useStore = create<AppState>((set, get) => ({
  // Initial state
  user: null,
  isAuthenticated: false,
  marketData: {},
  candlestickData: {},
  portfolio: null,
  positions: [],
  trades: [],
  chartState: {
    symbol: 'AAPL',
    timeframe: '1M',
    indicators: [],
    crosshair: {
      x: 0,
      y: 0,
      visible: false,
    },
  },
  simulationControl: null,
  leaderboard: [],
  
  // Actions
  setUser: (user) => set({ user }),
  setAuthenticated: (authenticated) => set({ isAuthenticated: authenticated }),
  
  updateMarketData: (symbol, data) => 
    set((state) => ({
      marketData: { ...state.marketData, [symbol]: data }
    })),
    
  updateCandlestickData: (symbol, data) =>
    set((state) => ({
      candlestickData: { ...state.candlestickData, [symbol]: data }
    })),
    
  setPortfolio: (portfolio) => set({ portfolio }),
  setPositions: (positions) => set({ positions }),
  addTrade: (trade) => set((state) => ({ trades: [...state.trades, trade] })),
  
  updateChartState: (updates) =>
    set((state) => ({
      chartState: { ...state.chartState, ...updates }
    })),
    
  setSimulationControl: (control) => set({ simulationControl: control }),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
}));