import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type StockData = {
  unique_id: number
  timestamp: string
  symbol: string
  company_name: string
  token: number
  last_traded_price: number
  volume_traded: number
  exchange_timestamp: string
  open_price: number
  high_price: number
  low_price: number
  close_price: number
  total_buy_quantity: string
  total_sell_quantity: string
  average_traded_price: number
  subscription_mode: string
}