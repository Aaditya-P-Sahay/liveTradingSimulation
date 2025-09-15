import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { useMarket } from '../../contexts/MarketContext';

const API_URL = import.meta.env.VITE_API_URL;

export const AdminControls: React.FC = () => {
  const { token, user } = useAuth();
  const { marketState } = useMarket();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  if (user?.role !== 'admin') return null;

  const handleStart = async () => {
    setLoading(true);
    try {
      const { data } = await axios.post(
        `${API_URL}/admin/contest/start`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage('✅ Contest started! ' + data.message);
      // NO RELOAD - WebSocket will update the state automatically
    } catch (error: any) {
      setMessage('❌ ' + (error.response?.data?.error || 'Failed to start'));
    }
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      const { data } = await axios.post(
        `${API_URL}/admin/contest/stop`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage('Contest stopped');
      // NO RELOAD
    } catch (error: any) {
      setMessage('Error: ' + (error.response?.data?.error || 'Failed'));
    }
    setLoading(false);
  };

  const handlePause = async () => {
    setLoading(true);
    try {
      await axios.post(
        `${API_URL}/admin/contest/pause`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage('Contest paused');
    } catch (error: any) {
      setMessage('Error: ' + (error.response?.data?.error || 'Failed'));
    }
    setLoading(false);
  };

  const handleResume = async () => {
    setLoading(true);
    try {
      await axios.post(
        `${API_URL}/admin/contest/resume`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage('Contest resumed');
    } catch (error: any) {
      setMessage('Error: ' + (error.response?.data?.error || 'Failed'));
    }
    setLoading(false);
  };

  return (
    <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4 mb-4">
      <h3 className="text-yellow-400 font-bold mb-3">Admin Controls</h3>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={handleStart}
          disabled={loading || marketState.isRunning}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          Start Contest
        </button>
        <button
          onClick={handlePause}
          disabled={loading || !marketState.isRunning || marketState.isPaused}
          className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
        >
          Pause
        </button>
        <button
          onClick={handleResume}
          disabled={loading || !marketState.isPaused}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Resume
        </button>
        <button
          onClick={handleStop}
          disabled={loading || !marketState.isRunning}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
        >
          Stop Contest
        </button>
      </div>
      {message && (
        <div className="mt-3 text-sm text-gray-300">{message}</div>
      )}
    </div>
  );
};