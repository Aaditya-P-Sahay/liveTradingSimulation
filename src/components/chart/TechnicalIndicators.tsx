import React, { useState } from 'react';
import { useStore } from '../../store/useStore';
import { TrendingUp, Eye, EyeOff, Settings } from 'lucide-react';

const AVAILABLE_INDICATORS = [
  { name: 'SMA(20)', color: '#00A3FF', description: 'Simple Moving Average (20 periods)' },
  { name: 'EMA(20)', color: '#FFC107', description: 'Exponential Moving Average (20 periods)' },
  { name: 'RSI(14)', color: '#9C27B0', description: 'Relative Strength Index (14 periods)' },
  { name: 'MACD', color: '#4CAF50', description: 'Moving Average Convergence Divergence' },
  { name: 'Bollinger Bands', color: '#FF5722', description: 'Bollinger Bands (20, 2)' },
];

export const TechnicalIndicators: React.FC = () => {
  const { chartState, updateChartState } = useStore();
  const [showPanel, setShowPanel] = useState(false);

  const toggleIndicator = (indicatorName: string) => {
    const existingIndex = chartState.indicators.findIndex(ind => ind.name === indicatorName);
    
    if (existingIndex >= 0) {
      // Toggle visibility
      const updatedIndicators = [...chartState.indicators];
      updatedIndicators[existingIndex].visible = !updatedIndicators[existingIndex].visible;
      updateChartState({ indicators: updatedIndicators });
    } else {
      // Add new indicator
      const newIndicator = AVAILABLE_INDICATORS.find(ind => ind.name === indicatorName);
      if (newIndicator) {
        const updatedIndicators = [
          ...chartState.indicators,
          {
            name: newIndicator.name,
            values: [], // Would be calculated with TA-Lib
            color: newIndicator.color,
            visible: true,
          }
        ];
        updateChartState({ indicators: updatedIndicators });
      }
    }
  };

  const removeIndicator = (indicatorName: string) => {
    const updatedIndicators = chartState.indicators.filter(ind => ind.name !== indicatorName);
    updateChartState({ indicators: updatedIndicators });
  };

  return (
    <div className="border-t border-gray-700/30 bg-gray-800/20">
      <div className="flex items-center justify-between p-3">
        <button
          onClick={() => setShowPanel(!showPanel)}
          className="flex items-center space-x-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <TrendingUp className="w-4 h-4" />
          <span>Technical Indicators</span>
          <span className="text-xs bg-gray-700/50 px-2 py-1 rounded">
            {chartState.indicators.filter(ind => ind.visible).length} active
          </span>
        </button>

        {/* Active Indicators */}
        <div className="flex items-center space-x-2">
          {chartState.indicators.map((indicator, index) => (
            <div
              key={`${indicator.name}-${index}`}
              className="flex items-center space-x-1 px-2 py-1 bg-gray-700/30 rounded text-xs"
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: indicator.color }}
              />
              <span className="text-gray-300">{indicator.name}</span>
              <button
                onClick={() => toggleIndicator(indicator.name)}
                className="text-gray-400 hover:text-white"
              >
                {indicator.visible ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3" />
                )}
              </button>
              <button
                onClick={() => removeIndicator(indicator.name)}
                className="text-gray-400 hover:text-red-400 ml-1"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Indicator Selection Panel */}
      {showPanel && (
        <div className="border-t border-gray-700/30 p-4 bg-gray-900/30">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {AVAILABLE_INDICATORS.map((indicator) => {
              const isActive = chartState.indicators.some(ind => ind.name === indicator.name);
              const activeIndicator = chartState.indicators.find(ind => ind.name === indicator.name);
              
              return (
                <button
                  key={indicator.name}
                  onClick={() => toggleIndicator(indicator.name)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    isActive && activeIndicator?.visible
                      ? 'bg-gray-700/50 border-gray-600 text-white'
                      : isActive
                      ? 'bg-gray-800/50 border-gray-700 text-gray-400'
                      : 'bg-gray-800/30 border-gray-700/50 text-gray-400 hover:bg-gray-700/30 hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-2 mb-1">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: indicator.color }}
                    />
                    <span className="font-medium text-sm">{indicator.name}</span>
                  </div>
                  <p className="text-xs text-gray-500">{indicator.description}</p>
                  
                  {isActive && (
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-green-400">Added</span>
                      <div className="flex items-center space-x-1">
                        {activeIndicator?.visible ? (
                          <Eye className="w-3 h-3 text-green-400" />
                        ) : (
                          <EyeOff className="w-3 h-3 text-gray-500" />
                        )}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 text-xs text-gray-500">
            Click to add/remove indicators. Use the eye icon to toggle visibility.
          </div>
        </div>
      )}
    </div>
  );
};