import { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api';

export interface Timeframe {
  seconds: number;
  label: string;
}

export interface TimeframeInfo {
  available: string[];
  enabled: string[];
  default: string;
  details: Record<string, Timeframe>;
}

export const useTimeframes = () => {
  const [timeframes, setTimeframes] = useState<TimeframeInfo | null>({
    available: ['1s', '5s', '15s', '30s', '1m', '3m', '5m'],
    enabled: ['1s', '5s', '15s', '30s', '1m', '3m', '5m'],
    default: '30s',
    details: {
      '1s': { seconds: 1, label: '1 Second' },
      '5s': { seconds: 5, label: '5 Seconds' },
      '15s': { seconds: 15, label: '15 Seconds' },
      '30s': { seconds: 30, label: '30 Seconds' },
      '1m': { seconds: 60, label: '1 Minute' },
      '3m': { seconds: 180, label: '3 Minutes' },
      '5m': { seconds: 300, label: '5 Minutes' }
    }
  });
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('30s');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadTimeframes();
  }, []);

  const loadTimeframes = async () => {
    try {
      setLoading(true);
      const data = await apiService.getTimeframes();
      setTimeframes(data);
      setSelectedTimeframe(data.default);
      setError('');
    } catch (err: any) {
      console.error('Failed to load timeframes:', err);
      // Use fallback data
      setError('');
    } finally {
      setLoading(false);
    }
  };

  const changeTimeframe = useCallback((newTimeframe: string) => {
    if (timeframes?.available.includes(newTimeframe)) {
      setSelectedTimeframe(newTimeframe);
    }
  }, [timeframes]);

  const getTimeframeLabel = useCallback((timeframeKey: string) => {
    return timeframes?.details[timeframeKey]?.label || timeframeKey;
  }, [timeframes]);

  const getTimeframeSeconds = useCallback((timeframeKey: string) => {
    return timeframes?.details[timeframeKey]?.seconds || 30;
  }, [timeframes]);

  return {
    timeframes,
    selectedTimeframe,
    setSelectedTimeframe: changeTimeframe,
    getTimeframeLabel,
    getTimeframeSeconds,
    loading,
    error,
    refresh: loadTimeframes
  };
};

export default useTimeframes;