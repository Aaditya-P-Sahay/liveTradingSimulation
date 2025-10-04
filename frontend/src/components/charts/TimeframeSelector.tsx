import React from 'react';
import { Clock, Zap } from 'lucide-react';

interface TimeframeSelectorProps {
  selectedTimeframe: string;
  onTimeframeChange: (timeframe: string) => void;
  className?: string;
}

const TIMEFRAME_OPTIONS = [
  { key: '5s', label: '5s' },
  { key: '30s', label: '30s' },
  { key: '1m', label: '1m' },
  { key: '3m', label: '3m' },
  { key: '5m', label: '5m' }
];

export const TimeframeSelector: React.FC<TimeframeSelectorProps> = ({
  selectedTimeframe,
  onTimeframeChange,
  className = ''
}) => {
  const handleTimeframeClick = (timeframe: string) => {
    console.log(`🔄 TimeframeSelector: Changing to ${timeframe}`);
    onTimeframeChange(timeframe);
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex items-center gap-2 text-gray-400">
        <Clock className="w-4 h-4" />
        <span className="text-sm font-medium">Timeframe:</span>
      </div>
      
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg">
        {TIMEFRAME_OPTIONS.map((option) => (
          <button
            key={option.key}
            onClick={() => handleTimeframeClick(option.key)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              selectedTimeframe === option.key
                ? 'bg-blue-600 text-white shadow-lg transform scale-105'
                : 'bg-transparent text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            {option.label}
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