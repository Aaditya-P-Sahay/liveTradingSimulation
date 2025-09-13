import React from 'react';
import { useStore } from '../../store/useStore';
import { Header } from './Header';
import { AdminPanel } from '../admin/AdminPanel';
import { TradingChart } from '../chart/TradingChart';
import { TradingPanel } from '../trading/TradingPanel';
import { PortfolioDashboard } from '../portfolio/PortfolioDashboard';
import { Leaderboard } from '../leaderboard/Leaderboard';
import { Watchlist } from '../watchlist/Watchlist';

export const MainLayout: React.FC = () => {
  const { user } = useStore();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800">
      <Header />
      
      <div className="p-6">
        {user?.role === 'admin' && (
          <div className="mb-6">
            <AdminPanel />
          </div>
        )}

        <div className="grid grid-cols-12 gap-6">
          {/* Left Sidebar - Watchlist */}
          <div className="col-span-12 lg:col-span-3">
            <Watchlist />
          </div>

          {/* Main Content - Chart */}
          <div className="col-span-12 lg:col-span-6">
            <TradingChart />
          </div>

          {/* Right Sidebar - Trading Panel */}
          <div className="col-span-12 lg:col-span-3">
            <TradingPanel />
          </div>

          {/* Bottom Section - Portfolio and Leaderboard */}
          <div className="col-span-12 lg:col-span-8">
            <PortfolioDashboard />
          </div>

          <div className="col-span-12 lg:col-span-4">
            <Leaderboard />
          </div>
        </div>
      </div>
    </div>
  );
};