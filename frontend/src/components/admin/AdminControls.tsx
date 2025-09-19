import React, { useState, useEffect } from 'react';
import { apiService } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useMarket } from '../../contexts/MarketContext';
import { Play, Pause, Square, Settings, Zap, Users, BarChart3 } from 'lucide-react';

export const AdminControls: React.FC = () => {
  const { token, user } = useAuth();
  const { marketState } = useMarket();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [adminStatus, setAdminStatus] = useState<any>(null);
  const [speedInput, setSpeedInput] = useState(2);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Only show for admins
  if (user?.role !== 'admin') return null;

  useEffect(() => {
    loadAdminStatus();
    setSpeedInput(marketState.speed);
  }, [marketState.speed]);

  const loadAdminStatus = async () => {
    try {
      const status = await apiService.getAdminStatus();
      setAdminStatus(status);
    } catch (error) {
      console.error('Failed to load admin status:', error);
    }
  };

  const handleAction = async (action: string, actionFn: () => Promise<any>, successMsg: string) => {
    setLoading(true);
    setMessage('');
    
    try {
      const result = await actionFn();
      setMessage(`✅ ${successMsg}`);
      await loadAdminStatus();
      
      // Clear message after 3 seconds
      setTimeout(() => setMessage(''), 3000);
    } catch (error: any) {
      setMessage(`❌ ${error.response?.data?.error || `Failed to ${action}`}`);
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  const handleStart = () => handleAction(
    'start', 
    () => apiService.startContest(), 
    'Contest started successfully!'
  );

  const handlePause = () => handleAction(
    'pause', 
    () => apiService.pauseContest(), 
    'Contest paused'
  );

  const handleResume = () => handleAction(
    'resume', 
    () => apiService.resumeContest(), 
    'Contest resumed'
  );

  const handleStop = () => {
    if (confirm('Are you sure you want to stop the contest? All positions will be auto squared-off.')) {
      handleAction(
        'stop', 
        () => apiService.stopContest(), 
        'Contest stopped and all positions squared-off'
      );
    }
  };

  const handleSpeedChange = async () => {
    if (speedInput < 0.5 || speedInput > 10) {
      setMessage('❌ Speed must be between 0.5 and 10');
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    await handleAction(
      'change speed',
      () => apiService.setContestSpeed(speedInput),
      `Speed changed to ${speedInput}x`
    );
  };

  return (
    <div className="bg-gradient-to-r from-yellow-900/30 to-orange-900/30 border border-yellow-700 rounded-lg p-6 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-yellow-400" />
          <h3 className="text-yellow-400 font-bold text-lg">Admin Controls</h3>
        </div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-yellow-400 hover:text-yellow-300 text-sm"
        >
          {showAdvanced ? 'Basic' : 'Advanced'}
        </button>
      </div>

      {/* Contest Status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 p-4 bg-gray-800/50 rounded-lg">
        <div className="text-center">
          <div className={`text-lg font-bold ${
            marketState.isRunning 
              ? marketState.isPaused ? 'text-yellow-400' : 'text-green-400'
              : 'text-red-400'
          }`}>
            {marketState.isRunning 
              ? marketState.isPaused ? 'PAUSED' : 'RUNNING'
              : 'STOPPED'}
          </div>
          <div className="text-xs text-gray-400">Contest Status</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-white">{marketState.speed}x</div>
          <div className="text-xs text-gray-400">Speed</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-white">{marketState.progress.toFixed(1)}%</div>
          <div className="text-xs text-gray-400">Progress</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-white">
            {Math.floor((marketState.elapsedTime || 0) / 60000)}m
          </div>
          <div className="text-xs text-gray-400">Elapsed</div>
        </div>
      </div>

      {/* Primary Controls */}
      <div className="flex gap-2 flex-wrap mb-4">
        <button
          onClick={handleStart}
          disabled={loading || (marketState.isRunning && !marketState.isPaused)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          <Play className="w-4 h-4" />
          {marketState.isPaused ? 'Resume Contest' : 'Start Contest'}
        </button>
        
        <button
          onClick={handlePause}
          disabled={loading || !marketState.isRunning || marketState.isPaused}
          className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 transition-colors"
        >
          <Pause className="w-4 h-4" />
          Pause
        </button>
        
        <button
          onClick={handleStop}
          disabled={loading || !marketState.isRunning}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          <Square className="w-4 h-4" />
          Stop & Square-off
        </button>
      </div>

      {/* Speed Control */}
      <div className="flex items-center gap-3 mb-4">
        <Zap className="w-5 h-5 text-yellow-400" />
        <span className="text-yellow-400 font-medium">Speed:</span>
        <input
          type="number"
          min="0.5"
          max="10"
          step="0.5"
          value={speedInput}
          onChange={(e) => setSpeedInput(parseFloat(e.target.value))}
          className="w-20 px-2 py-1 bg-gray-800 text-white rounded border border-gray-600 focus:border-yellow-500"
        />
        <span className="text-gray-400">x</span>
        <button
          onClick={handleSpeedChange}
          disabled={loading || speedInput === marketState.speed}
          className="px-3 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 text-sm transition-colors"
        >
          Set
        </button>
      </div>

      {/* Advanced Controls */}
      {showAdvanced && adminStatus && (
        <div className="border-t border-yellow-700 pt-4">
          <h4 className="text-yellow-400 font-semibold mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Advanced Status
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-800/50 p-3 rounded">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-blue-400" />
                <span className="text-blue-400 font-medium">Connected Users</span>
              </div>
              <div className="text-white">{adminStatus.connectedUsers || 0} users</div>
            </div>
            
            <div className="bg-gray-800/50 p-3 rounded">
              <div className="text-green-400 font-medium mb-2">Active Symbols</div>
              <div className="text-white">{adminStatus.symbols?.length || 0} symbols</div>
            </div>
            
            <div className="bg-gray-800/50 p-3 rounded">
              <div className="text-purple-400 font-medium mb-2">Data Ticks</div>
              <div className="text-white">
                {adminStatus.currentDataTick}/{adminStatus.totalDataTicks}
              </div>
            </div>
          </div>

          {/* Symbol Rooms */}
          {adminStatus.symbolRooms && (
            <div className="mt-4">
              <div className="text-yellow-400 font-medium mb-2">Symbol Subscriptions</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {Object.entries(adminStatus.symbolRooms).map(([symbol, count]: [string, any]) => (
                  <div key={symbol} className="bg-gray-800/50 p-2 rounded">
                    <div className="text-white font-medium">{symbol}</div>
                    <div className="text-gray-400">{count} subscribers</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contest Timeline */}
          {marketState.contestStartTime && (
            <div className="mt-4 p-3 bg-blue-900/20 border border-blue-700 rounded">
              <div className="text-blue-400 font-medium mb-2">Contest Timeline</div>
              <div className="text-sm space-y-1">
                <div className="text-gray-300">
                  <span className="text-blue-400">Time 0 (Start):</span> {new Date(marketState.contestStartTime).toLocaleString()}
                </div>
                {marketState.dataStartTime && (
                  <div className="text-gray-300">
                    <span className="text-blue-400">Data Start:</span> {new Date(marketState.dataStartTime).toLocaleString()}
                  </div>
                )}
                <div className="text-gray-300">
                  <span className="text-blue-400">Elapsed:</span> {Math.floor((marketState.elapsedTime || 0) / 60000)}m {Math.floor(((marketState.elapsedTime || 0) % 60000) / 1000)}s
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status Message */}
      {message && (
        <div className={`mt-4 p-3 rounded-lg text-sm ${
          message.includes('❌') 
            ? 'bg-red-900/50 text-red-200 border border-red-700' 
            : 'bg-green-900/50 text-green-200 border border-green-700'
        }`}>
          {message}
        </div>
      )}

      {/* Important Notice */}
      <div className="mt-4 p-3 bg-orange-900/20 border border-orange-700 rounded-lg">
        <div className="text-orange-400 font-medium text-sm">⚠️ Important:</div>
        <ul className="text-orange-200 text-xs mt-1 space-y-1">
          <li>• Contest automatically stops after 1 hour or when data is exhausted</li>
          <li>• All short positions are auto squared-off when contest ends</li>
          <li>• Users joining mid-contest see data from Time 0</li>
          <li>• Speed changes affect all connected users in real-time</li>
        </ul>
      </div>
    </div>
  );
};