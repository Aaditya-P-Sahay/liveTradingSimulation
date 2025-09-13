import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useStore } from '../../store/useStore';
import { Play, Pause, Settings, Users, Activity } from 'lucide-react';
import toast from 'react-hot-toast';

export const AdminPanel: React.FC = () => {
  const { simulationControl, setSimulationControl } = useStore();
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState({
    activeUsers: 0,
    totalTrades: 0,
    totalVolume: 0,
  });

  useEffect(() => {
    fetchSimulationControl();
    fetchStats();
  }, []);

  const fetchSimulationControl = async () => {
    try {
      const { data, error } = await supabase
        .from('simulation_control')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      
      if (data) {
        setSimulationControl(data);
        setSpeedMultiplier(data.speed_multiplier);
      }
    } catch (error: any) {
      console.error('Error fetching simulation control:', error);
    }
  };

  const fetchStats = async () => {
    try {
      // Get active users count
      const { count: userCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });

      // Get total trades count
      const { count: tradeCount } = await supabase
        .from('trades')
        .select('*', { count: 'exact', head: true });

      // Get total volume
      const { data: volumeData } = await supabase
        .from('trades')
        .select('total_amount');

      const totalVolume = volumeData?.reduce((sum, trade) => sum + (trade.total_amount || 0), 0) || 0;

      setStats({
        activeUsers: userCount || 0,
        totalTrades: tradeCount || 0,
        totalVolume,
      });
    } catch (error: any) {
      console.error('Error fetching stats:', error);
    }
  };

  const toggleSimulation = async () => {
    setIsLoading(true);
    try {
      const newState = !simulationControl?.is_running;
      
      const { data, error } = await supabase
        .from('simulation_control')
        .upsert({
          id: simulationControl?.id || crypto.randomUUID(),
          is_running: newState,
          speed_multiplier: speedMultiplier,
          simulation_time: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      setSimulationControl(data);
      toast.success(`Market simulation ${newState ? 'started' : 'stopped'}`);
    } catch (error: any) {
      toast.error('Failed to update simulation state');
    } finally {
      setIsLoading(false);
    }
  };

  const updateSpeed = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('simulation_control')
        .upsert({
          id: simulationControl?.id || crypto.randomUUID(),
          is_running: simulationControl?.is_running || false,
          speed_multiplier: speedMultiplier,
          simulation_time: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      setSimulationControl(data);
      toast.success(`Speed updated to ${speedMultiplier}x`);
    } catch (error: any) {
      toast.error('Failed to update speed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white flex items-center">
          <Settings className="w-5 h-5 mr-2 text-amber-400" />
          Admin Control Panel
        </h2>
        <div className={`px-3 py-1 rounded-full text-xs font-medium ${
          simulationControl?.is_running 
            ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
            : 'bg-red-500/20 text-red-400 border border-red-500/30'
        }`}>
          {simulationControl?.is_running ? 'Market Open' : 'Market Closed'}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Active Users</p>
              <p className="text-2xl font-bold text-white">{stats.activeUsers}</p>
            </div>
            <Users className="w-8 h-8 text-blue-400" />
          </div>
        </div>
        
        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Trades</p>
              <p className="text-2xl font-bold text-white">{stats.totalTrades}</p>
            </div>
            <Activity className="w-8 h-8 text-green-400" />
          </div>
        </div>
        
        <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Volume</p>
              <p className="text-2xl font-bold text-white">
                ${stats.totalVolume.toLocaleString()}
              </p>
            </div>
            <div className="w-8 h-8 bg-amber-400/20 rounded-full flex items-center justify-center">
              <span className="text-amber-400 font-bold">$</span>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={toggleSimulation}
            disabled={isLoading}
            className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-all ${
              simulationControl?.is_running
                ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30'
                : 'bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30'
            } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {simulationControl?.is_running ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5" />
            )}
            <span>
              {simulationControl?.is_running ? 'Stop Market' : 'Start Market'}
            </span>
          </button>

          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-400">Speed:</label>
            <select
              value={speedMultiplier}
              onChange={(e) => setSpeedMultiplier(Number(e.target.value))}
              className="bg-gray-900/50 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={5}>5x</option>
              <option value={10}>10x</option>
            </select>
            <button
              onClick={updateSpeed}
              disabled={isLoading}
              className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded text-sm transition-colors"
            >
              Update
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};