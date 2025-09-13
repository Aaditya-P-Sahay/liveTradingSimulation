import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { supabase, subscribeToMarketData, subscribeToSimulationControl } from '../lib/supabase';

export const useMarketData = () => {
  const { 
    updateMarketData, 
    setSimulationControl,
    simulationControl 
  } = useStore();

  useEffect(() => {
    // Subscribe to real-time market data updates
    const marketDataSubscription = subscribeToMarketData((payload) => {
      if (payload.new) {
        updateMarketData(payload.new.symbol, payload.new);
      }
    });

    // Subscribe to simulation control updates
    const simulationSubscription = subscribeToSimulationControl((payload) => {
      if (payload.new) {
        setSimulationControl(payload.new);
      }
    });

    // Fetch initial market data
    const fetchInitialData = async () => {
      try {
        const { data, error } = await supabase
          .from('LALAJI')
          .select('*')
          .order('timestamp', { ascending: false });

        if (error) throw error;

        // Group by symbol and get latest data for each
        const latestData: Record<string, any> = {};
        data?.forEach(item => {
          if (!latestData[item.symbol] || 
              new Date(item.timestamp) > new Date(latestData[item.symbol].timestamp)) {
            latestData[item.symbol] = item;
          }
        });

        // Update store with latest data for each symbol
        Object.entries(latestData).forEach(([symbol, data]) => {
          updateMarketData(symbol, data);
        });

      } catch (error) {
        console.error('Error fetching initial market data:', error);
      }
    };

    fetchInitialData();

    // Cleanup subscriptions
    return () => {
      marketDataSubscription.unsubscribe();
      simulationSubscription.unsubscribe();
    };
  }, [updateMarketData, setSimulationControl]);

  // Simulate real-time market data when simulation is running
  useEffect(() => {
    if (!simulationControl?.is_running) return;

    const interval = setInterval(async () => {
      try {
        // Fetch latest data and simulate price movements
        const { data, error } = await supabase
          .from('LALAJI')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(50);

        if (error) throw error;

        // Simulate price changes
        data?.forEach(item => {
          const volatility = 0.001; // 0.1% volatility per update
          const change = (Math.random() - 0.5) * volatility * item.last_traded_price;
          const newPrice = Math.max(0.01, item.last_traded_price + change);
          
          const updatedItem = {
            ...item,
            last_traded_price: Number(newPrice.toFixed(2)),
            high_price: Math.max(item.high_price, newPrice),
            low_price: Math.min(item.low_price, newPrice),
            volume_traded: item.volume_traded + Math.floor(Math.random() * 1000),
            timestamp: new Date().toISOString(),
          };

          updateMarketData(item.symbol, updatedItem);
        });

      } catch (error) {
        console.error('Error simulating market data:', error);
      }
    }, 1000 * (simulationControl?.speed_multiplier || 1));

    return () => clearInterval(interval);
  }, [simulationControl, updateMarketData]);
};