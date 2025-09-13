import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useStore } from '../../store/useStore';
import { LogIn, Shield, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const { setUser, setAuthenticated } = useStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        // Fetch user profile
        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('*')
          .eq('auth_id', data.user.id)
          .single();

        if (profileError) throw profileError;

        // Check if admin login is required
        if (isAdmin && profile.role !== 'admin') {
          throw new Error('Admin access required');
        }

        setUser({
          id: data.user.id,
          email: data.user.email!,
          name: profile["Candidate's Name"] || 'User',
          role: profile.role,
          created_at: profile.created_at,
        });
        setAuthenticated(true);
        toast.success('Login successful!');
      }
    } catch (error: any) {
      toast.error(error.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="https://res.cloudinary.com/dqa8tvhz3/image/upload/v1757544674/1c7b235f-1df4-4c6c-8508-981f95caa515.png"
            alt="Institution Logo"
            className="h-16 mx-auto mb-4 opacity-90"
          />
          <h1 className="text-3xl font-bold text-white mb-2">
            Aura Trading Platform
          </h1>
          <p className="text-gray-400">
            Professional Stock Trading Simulation
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-8 shadow-2xl">
          <div className="flex mb-6">
            <button
              type="button"
              onClick={() => setIsAdmin(false)}
              className={`flex-1 py-2 px-4 rounded-l-lg border border-r-0 transition-all ${
                !isAdmin
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                  : 'bg-gray-700/50 border-gray-600 text-gray-400 hover:bg-gray-700'
              }`}
            >
              <LogIn className="w-4 h-4 inline mr-2" />
              User Login
            </button>
            <button
              type="button"
              onClick={() => setIsAdmin(true)}
              className={`flex-1 py-2 px-4 rounded-r-lg border border-l-0 transition-all ${
                isAdmin
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                  : 'bg-gray-700/50 border-gray-600 text-gray-400 hover:bg-gray-700'
              }`}
            >
              <Shield className="w-4 h-4 inline mr-2" />
              Admin Login
            </button>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
                placeholder="Enter your email"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
                placeholder="Enter your password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <TrendingUp className="w-5 h-5 mr-2" />
                  {isAdmin ? 'Admin Login' : 'Start Trading'}
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-400">
            <p>Professional trading simulation platform</p>
            <p className="text-xs mt-1">Real-time market data • Advanced analytics</p>
          </div>
        </div>
      </div>
    </div>
  );
};