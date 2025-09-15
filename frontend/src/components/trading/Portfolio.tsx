import React, { useEffect, useState } from 'react';
import { apiService } from '../../services/api';

export const Portfolio: React.FC = () => {
  const [portfolio, setPortfolio] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadPortfolio();
    const interval = setInterval(loadPortfolio, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadPortfolio = async () => {
    try {
      const data = await apiService.getPortfolio();
      setPortfolio(data);
      setError('');
    } catch (err: any) {
      setError('Failed to load portfolio');
      console.error('Portfolio error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-400">Loading portfolio...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/50 text-red-200 p-4 rounded-md">
        {error}
      </div>
    );
  }

  if (!portfolio || !portfolio.portfolio || portfolio.portfolio.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400 mb-4">No positions yet</p>
        <p className="text-sm text-gray-500">
          Start trading to build your portfolio
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-400 mb-3">Portfolio Summary</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400">Total Value</p>
            <p className="text-lg font-semibold text-white">
              ₹{portfolio.total_value?.toFixed(2) || '0.00'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Cash Balance</p>
            <p className="text-lg font-semibold text-white">
              ₹{portfolio.cash_balance?.toFixed(2) || '0.00'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-400">Holdings</h4>
        {portfolio.portfolio.map((item: any) => (
          <div key={item.symbol} className="bg-gray-800 rounded-lg p-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold text-white">{item.symbol}</p>
                <p className="text-xs text-gray-400">
                  {item.quantity} shares @ ₹{item.average_price?.toFixed(2)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-white">
                  ₹{item.current_value?.toFixed(2)}
                </p>
                <p className={`text-xs ${
                  item.profit_loss >= 0 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {item.profit_loss >= 0 ? '+' : ''}₹{item.profit_loss?.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={loadPortfolio}
        className="w-full py-2 bg-gray-800 text-gray-300 rounded-md hover:bg-gray-700 transition-colors text-sm"
      >
        Refresh Portfolio
      </button>
    </div>
  );
};