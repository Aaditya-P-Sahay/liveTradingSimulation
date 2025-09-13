// src/lib/types.ts
// Common type definitions for the application

export interface StockData {
  unique_id: number;
  timestamp: string;
  normalized_timestamp?: string;
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
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketTick {
  symbol: string;
  price: number;
  volume: number;
  timestamp: string;
  change: number;
  changePercent: number;
}