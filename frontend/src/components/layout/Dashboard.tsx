import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useMarket } from '../../contexts/MarketContext';
import { LiveStockChart } from '../charts/LiveStockChart';
import { TradingPanel } from '../trading/TradingPanel';
import { Portfolio } from '../trading/Portfolio';
import { AdminControls } from '../admin/AdminControls';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { selectedSymbol, setSelectedSymbol, marketState } = useMarket();
  const [symbols, setSymbols] = useState<string[]>(['ADANIENT']); // Default symbol
  const [chartType, setChartType] = useState<'line' | 'candlestick'>('candlestick');
  const [activeTab, setActiveTab] = useState<'trade' | 'portfolio'>('trade');

  useEffect(() => {
    loadSymbols();
  }, []);

  const loadSymbols = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/symbols`);
      if (Array.isArray(data) && data.length > 0) {
        setSymbols(data);
        if (!selectedSymbol) {
          setSelectedSymbol(data[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load symbols:', error);
      // Keep default symbol if API fails
      if (!selectedSymbol) {
        setSelectedSymbol('ADANIENT');
      }
    }
  };

  // Safety check - if user is not logged in, show loading
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-white">Trading Contest</h1>
              {marketState?.isRunning && (
                <div className="flex items-center gap-2 px-3 py-1 bg-green-900/30 border border-green-700 rounded-full">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-xs text-green-400">
                    {marketState.isPaused ? 'Paused' : 'Live Trading'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className="text-gray-400">{user.email || 'User'}</span>
              <button
                onClick={logout}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Admin Controls */}
        {user?.role === 'admin' && <AdminControls />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Chart and Trading */}
          <div className="lg:col-span-2">
            {/* Stock Selector */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Select Stock
              </label>
              <select
                value={selectedSymbol || ''}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {symbols.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym}
                  </option>
                ))}
              </select>
            </div>

            {/* Chart Type Buttons and Chart */}
            {selectedSymbol && (
              <div className="mb-6">
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setChartType('line')}
                    className={`px-4 py-2 rounded transition-colors ${
                      chartType === 'line'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    Line
                  </button>
                  <button
                    onClick={() => setChartType('candlestick')}
                    className={`px-4 py-2 rounded transition-colors ${
                      chartType === 'candlestick'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    Candlestick
                  </button>
                </div>
                <LiveStockChart 
                  symbol={selectedSymbol} 
                  chartType={chartType}
                  key={`${selectedSymbol}-${chartType}`}
                />
              </div>
            )}

            {/* Trading/Portfolio Tabs */}
            <div className="bg-gray-900 rounded-lg">
              <div className="flex border-b border-gray-800">
                <button
                  onClick={() => setActiveTab('trade')}
                  className={`flex-1 px-4 py-3 font-medium transition-colors ${
                    activeTab === 'trade'
                      ? 'text-blue-400 border-b-2 border-blue-400'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Trade
                </button>
                <button
                  onClick={() => setActiveTab('portfolio')}
                  className={`flex-1 px-4 py-3 font-medium transition-colors ${
                    activeTab === 'portfolio'
                      ? 'text-blue-400 border-b-2 border-blue-400'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  Portfolio
                </button>
              </div>
              <div className="p-6">
                {activeTab === 'trade' && selectedSymbol ? (
                  <TradingPanel symbol={selectedSymbol} />
                ) : activeTab === 'portfolio' ? (
                  <Portfolio />
                ) : (
                  <div className="text-gray-400">Select a symbol to trade</div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Market Info */}
          <div className="space-y-6">
            {/* Market Status */}
            <div className="bg-gray-900 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Market Status</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">Status</span>
                  <span className={`font-medium ${
                    marketState?.isRunning 
                      ? marketState.isPaused ? 'text-yellow-400' : 'text-green-400'
                      : 'text-red-400'
                  }`}>
                    {marketState?.isRunning 
                      ? marketState.isPaused ? 'Paused' : 'Running'
                      : 'Stopped'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Speed</span>
                  <span className="text-white">{marketState?.speed || 0}x</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Progress</span>
                  <span className="text-white">{(marketState?.progress || 0).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Tick</span>
                  <span className="text-white">
                    {marketState?.currentTickIndex || 0} / {marketState?.totalTicks || 0}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="bg-gray-900 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Quick Stats</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total Symbols</span>
                  <span className="text-white">{symbols.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Selected</span>
                  <span className="text-white">{selectedSymbol || 'None'}</span>
                </div>
                {marketState?.isRunning && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Time Elapsed</span>
                    <span className="text-white">
                      {Math.floor((marketState.elapsedTime || 0) / 60000)}m
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};