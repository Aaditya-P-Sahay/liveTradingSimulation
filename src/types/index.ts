export interface MarketData {
  unique_id: number;
  timestamp: string;
  symbol: string;
  company_name: string;
  token: number;
  last_traded_price: number;
  volume_traded: number;
  exchange_timestamp: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  total_buy_quantity: string;
  total_sell_quantity: string;
  average_traded_price: number;
  subscription_mode: string;
}

export interface CandlestickData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  created_at: string;
}

export interface Portfolio {
  id: string;
  user_id: string;
  total_cash: number;
  available_cash: number;
  margin_used: number;
  total_portfolio_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  created_at: string;
  updated_at: string;
}

export interface Position {
  id: string;
  user_id: string;
  symbol: string;
  quantity: number;
  average_price: number;
  current_price: number;
  position_type: 'long' | 'short';
  unrealized_pnl: number;
  created_at: string;
  updated_at: string;
}

export interface Trade {
  id: string;
  user_id: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'SHORT' | 'COVER';
  quantity: number;
  price: number;
  total_amount: number;
  stop_loss?: number;
  timestamp: string;
  status: 'pending' | 'executed' | 'cancelled';
}

export interface SimulationControl {
  id: string;
  is_running: boolean;
  speed_multiplier: number;
  simulation_time: string;
  created_at: string;
  updated_at: string;
}

export interface TechnicalIndicator {
  name: string;
  values: number[];
  color: string;
  visible: boolean;
}

export interface ChartState {
  symbol: string;
  timeframe: '1M' | '5M' | '15M' | '1H';
  indicators: TechnicalIndicator[];
  crosshair: {
    x: number;
    y: number;
    visible: boolean;
  };
}