import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { supabase } from '../../lib/supabase';
import { Trophy, Medal, Award, TrendingUp, Crown } from 'lucide-react';

interface LeaderboardEntry {
  user_id: string;
  name: string;
  total_portfolio_value: number;
  rank: number;
  change_24h: number;
  total_trades: number;
}

export const Leaderboard: React.FC = () => {
  const { user, leaderboard, setLeaderboard } = useStore();
  const [isLoading, setIsLoading] = useState(true);
  const [userRank, setUserRank] = useState<number | null>(null);

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchLeaderboard = async () => {
    try {
      // Fetch top performers with portfolio values
      const { data: portfolios, error } = await supabase
        .from('portfolios')
        .select(`
          user_id,
          total_portfolio_value,
          users!inner("Candidate's Name")
        `)
        .order('total_portfolio_value', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Get trade counts for each user
      const userIds = portfolios?.map(p => p.user_id) || [];
      const { data: tradeCounts } = await supabase
        .from('trades')
        .select('user_id')
        .in('user_id', userIds);

      const tradeCountMap = tradeCounts?.reduce((acc, trade) => {
        acc[trade.user_id] = (acc[trade.user_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};

      // Format leaderboard data
      const formattedLeaderboard: LeaderboardEntry[] = portfolios?.map((portfolio, index) => ({
        user_id: portfolio.user_id,
        name: portfolio.users["Candidate's Name"] || 'Anonymous',
        total_portfolio_value: portfolio.total_portfolio_value,
        rank: index + 1,
        change_24h: Math.random() * 10 - 5, // Mock 24h change
        total_trades: tradeCountMap[portfolio.user_id] || 0,
      })) || [];

      setLeaderboard(formattedLeaderboard);

      // Find current user's rank
      if (user) {
        const currentUserEntry = formattedLeaderboard.find(entry => entry.user_id === user.id);
        setUserRank(currentUserEntry?.rank || null);
      }

    } catch (error: any) {
      console.error('Error fetching leaderboard:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1: return <Crown className="w-6 h-6 text-amber-400" />;
      case 2: return <Medal className="w-6 h-6 text-gray-300" />;
      case 3: return <Award className="w-6 h-6 text-amber-600" />;
      default: return <span className="w-6 h-6 flex items-center justify-center text-gray-400 font-bold">{rank}</span>;
    }
  };

  const getRankBadge = (rank: number) => {
    if (rank <= 3) {
      const colors = {
        1: 'bg-gradient-to-r from-amber-400 to-amber-600 text-black',
        2: 'bg-gradient-to-r from-gray-300 to-gray-500 text-black',
        3: 'bg-gradient-to-r from-amber-600 to-amber-800 text-white',
      };
      return colors[rank as keyof typeof colors];
    }
    return 'bg-gray-700/50 text-gray-300';
  };

  if (isLoading) {
    return (
      <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700/50 rounded w-1/3"></div>
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-700/30 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl overflow-hidden">
      <div className="p-6 border-b border-gray-700/30">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center">
            <Trophy className="w-6 h-6 mr-2 text-amber-400" />
            Leaderboard
          </h2>
          {userRank && (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-400">Your Rank:</span>
              <div className={`px-3 py-1 rounded-full text-sm font-bold ${getRankBadge(userRank)}`}>
                #{userRank}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {leaderboard.slice(0, 10).map((entry) => (
          <div
            key={entry.user_id}
            className={`flex items-center justify-between p-4 border-b border-gray-700/20 transition-colors ${
              entry.user_id === user?.id 
                ? 'bg-amber-500/10 border-amber-500/20' 
                : 'hover:bg-gray-700/20'
            }`}
          >
            <div className="flex items-center space-x-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${getRankBadge(entry.rank)}`}>
                {entry.rank <= 3 ? getRankIcon(entry.rank) : entry.rank}
              </div>
              
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white">
                    {entry.name}
                  </span>
                  {entry.user_id === user?.id && (
                    <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-1 rounded">
                      You
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-400">
                  {entry.total_trades} trades
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="font-bold text-white text-lg">
                ${entry.total_portfolio_value.toLocaleString()}
              </div>
              <div className={`text-sm flex items-center ${
                entry.change_24h >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                <TrendingUp className={`w-3 h-3 mr-1 ${
                  entry.change_24h < 0 ? 'rotate-180' : ''
                }`} />
                {entry.change_24h >= 0 ? '+' : ''}{entry.change_24h.toFixed(2)}%
              </div>
            </div>
          </div>
        ))}
      </div>

      {leaderboard.length === 0 && (
        <div className="p-8 text-center text-gray-400">
          <Trophy className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No traders yet. Be the first to start trading!</p>
        </div>
      )}
    </div>
  );
};