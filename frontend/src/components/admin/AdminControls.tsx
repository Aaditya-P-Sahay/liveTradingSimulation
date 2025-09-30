import React, { useState, useEffect } from 'react';
import { apiService } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useMarket } from '../../contexts/MarketContext';
import { 
  Play, 
  Pause, 
  Square, 
  Settings, 
  Zap, 
  Users, 
  BarChart3, 
  Clock,
  Database,
  Activity,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Server
} from 'lucide-react';

export const AdminControls: React.FC = () => {
  const { token, user } = useAuth();
  const { marketState } = useMarket();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'warning'>('success');
  const [adminStatus, setAdminStatus] = useState<any>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDataInfo, setShowDataInfo] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Only show for admins
  if (user?.role !== 'admin') return null;

  useEffect(() => {
    loadAdminStatus();
    
    // Auto-refresh status every 5 seconds if enabled
    const interval = autoRefresh ? setInterval(loadAdminStatus, 5000) : null;
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  const loadAdminStatus = async () => {
    try {
      const status = await apiService.getAdminStatus();
      setAdminStatus(status);
    } catch (error) {
      console.error('Failed to load admin status:', error);
    }
  };

  const showMessage = (msg: string, type: 'success' | 'error' | 'warning' = 'success', duration = 5000) => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), duration);
  };

  const handleAction = async (action: string, actionFn: () => Promise<any>, successMsg: string) => {
    setLoading(true);
    setMessage('');
    
    try {
      const result = await actionFn();
      showMessage(`✅ ${successMsg}`, 'success');
      await loadAdminStatus();
    } catch (error: any) {
      showMessage(`❌ ${error.response?.data?.error || `Failed to ${action}`}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStart = () => {
    if (marketState.isRunning && !marketState.isPaused) {
      showMessage('⚠️ Contest is already running', 'warning');
      return;
    }
    
    handleAction(
      'start', 
      () => apiService.startContest(), 
      'Contest started successfully! Data streaming begins now.'
    );
  };

  const handlePause = () => {
    if (!marketState.isRunning) {
      showMessage('⚠️ Contest is not running', 'warning');
      return;
    }
    
    if (marketState.isPaused) {
      showMessage('⚠️ Contest is already paused', 'warning');
      return;
    }
    
    handleAction(
      'pause', 
      () => apiService.pauseContest(), 
      'Contest paused. All trading suspended.'
    );
  };

  const handleResume = () => {
    if (!marketState.isRunning) {
      showMessage('⚠️ Contest is not running', 'warning');
      return;
    }
    
    if (!marketState.isPaused) {
      showMessage('⚠️ Contest is not paused', 'warning');
      return;
    }
    
    handleAction(
      'resume', 
      () => apiService.resumeContest(), 
      'Contest resumed. Trading enabled.'
    );
  };

  const handleStop = () => {
    if (!marketState.isRunning) {
      showMessage('⚠️ Contest is not running', 'warning');
      return;
    }
    
    if (confirm('⚠️ WARNING: This will:\n\n• Stop the contest immediately\n• Auto square-off ALL short positions\n• Finalize the leaderboard\n• Prevent any further trading\n\nAre you sure you want to stop the contest?')) {
      handleAction(
        'stop', 
        () => apiService.stopContest(), 
        'Contest stopped. All positions squared-off and results finalized.'
      );
    }
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getStatusColor = () => {
    if (!marketState.isRunning) return 'text-red-400 bg-red-900/30 border-red-700';
    if (marketState.isPaused) return 'text-yellow-400 bg-yellow-900/30 border-yellow-700';
    return 'text-green-400 bg-green-900/30 border-green-700';
  };

  const getStatusText = () => {
    if (!marketState.isRunning) return 'STOPPED';
    if (marketState.isPaused) return 'PAUSED';
    return 'RUNNING';
  };

  const getStatusIcon = () => {
    if (!marketState.isRunning) return <Square className="w-4 h-4" />;
    if (marketState.isPaused) return <Pause className="w-4 h-4" />;
    return <Play className="w-4 h-4 animate-pulse" />;
  };

  return (
    <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 border border-gray-700 rounded-lg p-6 mb-6 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-yellow-400" />
          <h3 className="text-yellow-400 font-bold text-xl">Admin Control Panel</h3>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-2 rounded-lg transition-colors ${
              autoRefresh 
                ? 'bg-blue-900/30 text-blue-400 border border-blue-700' 
                : 'bg-gray-700 text-gray-400'
            }`}
            title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          >
            <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
          </button>
          
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="px-3 py-1 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors text-sm"
          >
            {showAdvanced ? 'Basic' : 'Advanced'} View
          </button>
        </div>
      </div>

      {/* Contest Status Card */}
      <div className="bg-gray-800/50 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-gray-300 font-medium">Contest Status</h4>
          <div className={`px-4 py-2 rounded-full flex items-center gap-2 border ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="font-bold">{getStatusText()}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-gray-400">Progress</span>
            </div>
            <div className="text-xl font-bold text-white">{marketState.progress.toFixed(1)}%</div>
            <div className="w-full bg-gray-700 rounded-full h-1 mt-2">
              <div 
                className="bg-blue-500 h-1 rounded-full transition-all duration-500"
                style={{ width: `${marketState.progress}%` }}
              />
            </div>
          </div>

          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span className="text-xs text-gray-400">Speed</span>
            </div>
            <div className="text-xl font-bold text-white">5x</div>
            <div className="text-xs text-gray-500">Fixed rate</div>
          </div>

          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-green-400" />
              <span className="text-xs text-gray-400">Elapsed</span>
            </div>
            <div className="text-xl font-bold text-white">
              {formatTime(marketState.elapsedTime || 0)}
            </div>
            <div className="text-xs text-gray-500">Real time</div>
          </div>

          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-gray-400">Symbols</span>
            </div>
            <div className="text-xl font-bold text-white">{marketState.symbols.length}</div>
            <div className="text-xs text-gray-500">Active stocks</div>
          </div>
        </div>

        {marketState.contestStartTime && (
          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Started:</span>
                <span className="text-white ml-2">
                  {new Date(marketState.contestStartTime).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Will End:</span>
                <span className="text-white ml-2">
                  {new Date(new Date(marketState.contestStartTime).getTime() + 3600000).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <button
          onClick={handleStart}
          disabled={loading || (marketState.isRunning && !marketState.isPaused)}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium"
        >
          <Play className="w-5 h-5" />
          {marketState.isPaused ? 'Resume' : 'Start'} Contest
        </button>
        
        <button
          onClick={handlePause}
          disabled={loading || !marketState.isRunning || marketState.isPaused}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium"
        >
          <Pause className="w-5 h-5" />
          Pause
        </button>

        <button
          onClick={handleResume}
          disabled={loading || !marketState.isPaused}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium"
        >
          <Play className="w-5 h-5" />
          Resume
        </button>
        
        <button
          onClick={handleStop}
          disabled={loading || !marketState.isRunning}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium"
        >
          <Square className="w-5 h-5" />
          Stop & Square-off
        </button>
      </div>

      {/* Advanced Status */}
      {showAdvanced && adminStatus && (
        <div className="border-t border-gray-700 pt-6">
          <h4 className="text-gray-300 font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Advanced System Status
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-800/50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-blue-400" />
                <span className="text-blue-400 font-medium">Connected Users</span>
              </div>
              <div className="text-2xl font-bold text-white">{adminStatus.connectedUsers || 0}</div>
              <div className="text-xs text-gray-500 mt-1">Active WebSocket connections</div>
            </div>
            
            <div className="bg-gray-800/50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-4 h-4 text-green-400" />
                <span className="text-green-400 font-medium">Memory Usage</span>
              </div>
              <div className="text-2xl font-bold text-white">{adminStatus.memoryUsage || 0} MB</div>
              <div className="text-xs text-gray-500 mt-1">Server heap memory</div>
            </div>
            
            <div className="bg-gray-800/50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-purple-400" />
                <span className="text-purple-400 font-medium">Data Loaded</span>
              </div>
              <div className="text-2xl font-bold text-white">
                {adminStatus.dataLoaded ? '✅ Yes' : '❌ No'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {adminStatus.totalDataRows ? `${adminStatus.totalDataRows.toLocaleString()} rows` : 'Not loaded'}
              </div>
            </div>
          </div>

          {/* Data Information Panel */}
          <div className="mt-6">
            <button
              onClick={() => setShowDataInfo(!showDataInfo)}
              className="flex items-center gap-2 text-gray-400 hover:text-gray-300 transition-colors mb-4"
            >
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">
                {showDataInfo ? 'Hide' : 'Show'} Data Information
              </span>
            </button>

            {showDataInfo && (
              <div className="bg-gray-900/50 rounded-lg p-4 space-y-3">
                <div className="text-sm text-gray-300">
                  <p className="mb-2">📊 <strong>Data Structure:</strong></p>
                  <ul className="ml-4 space-y-1 text-gray-400">
                    <li>• 5 hours of tick-by-tick market data</li>
                    <li>• Millisecond precision timestamps</li>
                    <li>• Pre-calculated OHLC for each tick</li>
                    <li>• {marketState.symbols.length} symbols tracked</li>
                    <li>• 5x time compression (5hrs → 1hr)</li>
                  </ul>
                </div>

                <div className="text-sm text-gray-300">
                  <p className="mb-2">🕯️ <strong>Candle Generation:</strong></p>
                  <ul className="ml-4 space-y-1 text-gray-400">
                    <li>• Real-time intervals: 1s, 5s, 15s, 30s, 1m, 3m, 5m</li>
                    <li>• Database windows: 5s, 25s, 75s, 150s, 300s, 900s, 1500s</li>
                    <li>• OHLC aggregated from tick data</li>
                    <li>• WebSocket rooms for live updates</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status Messages */}
      {message && (
        <div className={`mt-6 p-4 rounded-lg text-sm border animate-pulse ${
          messageType === 'error' 
            ? 'bg-red-900/50 text-red-200 border-red-700' 
            : messageType === 'warning'
            ? 'bg-yellow-900/50 text-yellow-200 border-yellow-700'
            : 'bg-green-900/50 text-green-200 border-green-700'
        }`}>
          <div className="flex items-center gap-2">
            {messageType === 'error' && <AlertTriangle className="w-4 h-4" />}
            {message}
          </div>
        </div>
      )}

      {/* Important Notice */}
      <div className="mt-6 p-4 bg-orange-900/20 border border-orange-700 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-5 h-5 text-orange-400" />
          <span className="text-orange-400 font-medium">Important Information</span>
        </div>
        <ul className="text-orange-200 text-sm space-y-1">
          <li>• Contest runs for exactly 1 hour (simulating 5 hours of market data)</li>
          <li>• All short positions auto square-off when contest ends</li>
          <li>• Data streams at 5x speed (5 database seconds = 1 real second)</li>
          <li>• Users can join mid-contest and see full history from start</li>
          <li>• Pausing stops candle generation but maintains connection</li>
          <li>• {marketState.symbols.length} symbols streaming simultaneously</li>
        </ul>
      </div>
    </div>
  );
};