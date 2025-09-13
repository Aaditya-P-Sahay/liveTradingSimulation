import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Real-time subscription for market data
export const subscribeToMarketData = (callback: (payload: any) => void) => {
  return supabase
    .channel('market-data')
    .on('postgres_changes', 
      { 
        event: '*', 
        schema: 'public', 
        table: 'LALAJI' 
      }, 
      callback
    )
    .subscribe();
};

// Real-time subscription for simulation control
export const subscribeToSimulationControl = (callback: (payload: any) => void) => {
  return supabase
    .channel('simulation-control')
    .on('postgres_changes', 
      { 
        event: '*', 
        schema: 'public', 
        table: 'simulation_control' 
      }, 
      callback
    )
    .subscribe();
};