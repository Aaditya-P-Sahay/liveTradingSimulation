// frontend/src/components/charts/TimeframeSelector.tsx
import React from 'react';
import { Clock, Zap } from 'lucide-react';
import { useTimeframes } from '../../hooks/useTimeframes';

interface TimeframeSelectorProps {
  selectedTimeframe: string;
  onTimeframeChange: (timeframe: string) => void;
  className?: string;
}

export const TimeframeSelector: React.FC<TimeframeSelectorProps> = ({
  selectedTimeframe,
  onTimeframeChange,
  className = ''
}) => {
  const { timeframes, getTimeframeLabel } = useTimeframes();

  if (!timeframes) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <Clock className="w-4 h-4" />
        <span className="text-sm">Loading timeframes...</span>
      </div>
    );
  }

  const handleTimeframeClick = (timeframe: string) => {
    onTimeframeChange(timeframe);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex items-center gap-2 text-gray-400">
        <Clock className="w-4 h-4" />
        <span className="text-sm font-medium">Timeframe:</span>
      </div>
      
      <div className="flex gap-1">
        {timeframes.enabled.map((timeframe) => (
          <button
            key={timeframe}
            onClick={() => handleTimeframeClick(timeframe)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-all duration-200 ${
              selectedTimeframe === timeframe
                ? 'bg-blue-600 text-white shadow-lg transform scale-105'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
            }`}
          >
            {getTimeframeLabel(timeframe)}
          </button>
        ))}
      </div>
      
      {selectedTimeframe && (
        <div className="flex items-center gap-1 text-green-400 text-xs">
          <Zap className="w-3 h-3" />
          <span>Live</span>
        </div>
      )}
    </div>
  );
};

export default TimeframeSelector;