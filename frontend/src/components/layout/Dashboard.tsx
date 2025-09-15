import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useMarket } from '../../contexts/MarketContext';
import { LiveStockChart } from '.././charts/LiveStockChart';
import { TradingPanel } from '.././trading/TradingPanel';
import { Portfolio } from '.././trading/Portfolio';
import axios from 'axios';
import { AdminControls } from '.././admin/AdminControls';

const API_URL = import.meta.env.VITE_API_URL;

export const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { selectedSymbol, setSelectedSymbol, marketState } = useMarket();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'line' | 'candlestick'>('candlestick');
  const [activeTab, setActiveTab] = useState<'trade' | 'portfolio'>('trade');

  useEffect(() => {
    loadSymbols();
  }, []);

  const loadSymbols = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/symbols`);
      setSymbols(data);
    } catch (error) {
      console.error('Failed to load symbols:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-white">Trading Contest</h1>
              {marketState.isRunning && (
                <div className="flex items-center gap-2 px-3 py-1 bg-green-900/30 border border-green-700 rounded-full">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-xs text-green-400">
                    {marketState.isPaused ? 'PAUSED' : 'LIVE'}
                  </span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-4">
              <span className="text-gray-300">{user?.email}</span>
              <button
                onClick={logout}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <AdminControls />  {/* Add this line */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart Section - 2 columns */}
          <div className="lg:col-span-2">
            {/* Symbol Selector */}
            <div className="bg-gray-900 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <select
                    value={selectedSymbol}
                    onChange={(e) => setSelectedSymbol(e.target.value)}
                    className="px-3 py-2 bg-gray-800 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {symbols.map((symbol) => (
                      <option key={symbol} value={symbol}>{symbol}</option>
                    ))}
                  </select>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setChartType('line')}
                      className={`px-3 py-2 rounded-md transition-colors ${
                        chartType === 'line'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      Line
                    </button>
                    <button
                      onClick={() => setChartType('candlestick')}
                      className={`px-3 py-2 rounded-md transition-colors ${
                        chartType === 'candlestick'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      Candlestick
                    </button>
                  </div>
                </div>

                {/* Timer Display */}
                {marketState.isRunning && (
                  <div className="text-sm text-gray-400">
                    Max Duration: 1 hour | Elapsed: {Math.floor(marketState.elapsedTime / 60000)}m
                  </div>
                )}
              </div>
            </div>

            {/* Live Chart */}
            <LiveStockChart symbol={selectedSymbol} chartType={chartType} />
          </div>

          {/* Trading Panel - 1 column */}
          <div className="lg:col-span-1">
            <div className="bg-gray-900 rounded-lg">
              {/* Tabs */}
              <div className="flex border-b border-gray-800">
                <button
                  onClick={() => setActiveTab('trade')}
                  className={`flex-1 px-4 py-3 transition-colors ${
                    activeTab === 'trade'
                      ? 'bg-gray-800 text-white border-b-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Trade
                </button>
                <button
                  onClick={() => setActiveTab('portfolio')}
                  className={`flex-1 px-4 py-3 transition-colors ${
                    activeTab === 'portfolio'
                      ? 'bg-gray-800 text-white border-b-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Portfolio
                </button>
              </div>

              {/* Tab Content */}
              <div className="p-4">
                {activeTab === 'trade' ? (
                  <TradingPanel symbol={selectedSymbol} />
                ) : (
                  <Portfolio />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};