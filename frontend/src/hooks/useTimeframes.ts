// frontend/src/hooks/useTimeframes.ts
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
  const [timeframes, setTimeframes] = useState<TimeframeInfo | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('30s');
  const [loading, setLoading] = useState(true);
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
      setError(err.message || 'Failed to load timeframes');
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