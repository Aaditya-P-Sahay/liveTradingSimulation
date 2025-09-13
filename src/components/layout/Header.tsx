import React from 'react';
import { useStore } from '../../store/useStore';
import { supabase } from '../../lib/supabase';
import { LogOut, User, Crown, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';

export const Header: React.FC = () => {
  const { user, setUser, setAuthenticated, simulationControl } = useStore();

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setAuthenticated(false);
      toast.success('Logged out successfully');
    } catch (error: any) {
      toast.error('Logout failed');
    }
  };

  return (
    <header className="bg-gray-900/95 backdrop-blur-sm border-b border-gray-800/50 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <img
            src="https://res.cloudinary.com/dqa8tvhz3/image/upload/v1757544674/1c7b235f-1df4-4c6c-8508-981f95caa515.png"
            alt="Logo"
            className="h-8 opacity-90"
          />
          <div>
            <h1 className="text-xl font-bold text-white">Aura Trading</h1>
            <div className="flex items-center space-x-2 text-xs">
              <div className={`w-2 h-2 rounded-full ${
                simulationControl?.is_running ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <span className="text-gray-400">
                Market {simulationControl?.is_running ? 'Open' : 'Closed'}
              </span>
              {simulationControl?.speed_multiplier && simulationControl.speed_multiplier > 1 && (
                <span className="text-amber-400">
                  {simulationControl.speed_multiplier}x Speed
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 px-3 py-2 bg-gray-800/50 rounded-lg">
            {user?.role === 'admin' ? (
              <Crown className="w-4 h-4 text-amber-400" />
            ) : (
              <User className="w-4 h-4 text-gray-400" />
            )}
            <span className="text-sm text-white">{user?.name}</span>
            {user?.role === 'admin' && (
              <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-1 rounded">
                Admin
              </span>
            )}
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center space-x-2 px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-800/50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="text-sm">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};