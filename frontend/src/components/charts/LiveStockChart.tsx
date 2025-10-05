import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, UTCTimestamp, HistogramData } from 'lightweight-charts';
import { useMarket } from '../../contexts/MarketContext';
import { apiService } from '../../services/api';
import TimeframeSelector from './TimeframeSelector';
import { TrendingUp, Activity, BarChart3 } from 'lucide-react';

interface LiveStockChartProps {
  symbol: string;
  chartType: 'line' | 'candlestick';
}

export const LiveStockChart: React.FC<LiveStockChartProps> = ({ symbol, chartType }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [loading, setLoading] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState('30s');
  const [candleCount, setCandleCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const { socket, isConnected, marketState } = useMarket();
  const currentCandlesRef = useRef<any[]>([]);
  
  const currentSymbolRef = useRef(symbol);
  const currentTimeframeRef = useRef(selectedTimeframe);

  // Ultra-premium color palette: Swiss precision meets Japanese zen
  const colors = {
    // Base layers - deep night blacks with subtle warmth
    background: '#08090E',           // Deepest charcoal black
    chartBackground: '#0D0E14',      // Canvas black with hint of blue
    surface: '#13141B',              // Elevated surface
    surfaceHover: '#1A1C24',         // Interactive surface
    
    // Borders and dividers - barely visible, zen-like
    border: '#1E2029',               // Whisper of separation
    borderSubtle: '#16171E',         // Almost invisible
    
    // Grid - ghost lines
    grid: 'rgba(140, 145, 160, 0.04)', // Barely perceptible
    
    // Market colors - refined and muted
    bullish: '#34D399',              // Calm emerald
    bearish: '#F87171',              // Gentle rose
    
    // Volume - translucent wash
    bullishVolume: 'rgba(52, 211, 153, 0.18)',
    bearishVolume: 'rgba(248, 113, 113, 0.18)',
    
    // Line chart - serene blue
    line: '#60A5FA',                 // Sky blue
    
    // Typography - layered grays
    textPrimary: '#F8F9FB',          // Pure white with warmth
    textSecondary: '#A0A8B8',        // Soft gray
    textTertiary: '#5A616E',         // Muted slate
    
    // Accent - precious metal
    accent: '#C5A572',               // Antique gold
    accentMuted: 'rgba(197, 165, 114, 0.08)',
    
    // Status colors - gentle and clear
    success: '#34D399',
    successGlow: 'rgba(52, 211, 153, 0.3)',
    warning: '#FBBF24',
    warningMuted: 'rgba(251, 191, 36, 0.1)',
    danger: '#F87171',
    
    // Interactive elements
    crosshair: '#60A5FA',
    crosshairLabel: '#1E293B',
  };

  const initializeChart = useCallback(() => {
    if (!chartContainerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 640,
      layout: {
        background: { color: colors.chartBackground },
        textColor: colors.textSecondary,
        fontSize: 11,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif",
      },
      grid: {
        vertLines: { 
          color: colors.grid,
          style: 0,
        },
        horzLines: { 
          color: colors.grid,
          style: 0,
        },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: colors.crosshair,
          width: 1,
          style: 3,
          labelBackgroundColor: colors.crosshairLabel,
        },
        horzLine: {
          color: colors.crosshair,
          width: 1,
          style: 3,
          labelBackgroundColor: colors.crosshairLabel,
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderColor: colors.border,
        rightOffset: 15,
        barSpacing: 14,
        minBarSpacing: 6,
      },
      rightPriceScale: {
        borderColor: colors.border,
        scaleMargins: {
          top: 0.06,
          bottom: 0.32,
        },
        textColor: colors.textSecondary,
      },
    });

    chartRef.current = chart;

    if (chartType === 'line') {
      seriesRef.current = chart.addLineSeries({
        color: colors.line,
        lineWidth: 3, // FIXED: Integer only (was 2.5)
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        lineStyle: 0,
      });
    } else {
      seriesRef.current = chart.addCandlestickSeries({
        upColor: colors.bullish,
        downColor: colors.bearish,
        borderUpColor: colors.bullish,
        borderDownColor: colors.bearish,
        wickUpColor: colors.bullish,
        wickDownColor: colors.bearish,
        priceLineVisible: true,
        lastValueVisible: true,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
    }

    volumeSeriesRef.current = chart.addHistogramSeries({
      color: colors.bullishVolume,
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    volumeSeriesRef.current.priceScale().applyOptions({
      scaleMargins: {
        top: 0.68,
        bottom: 0,
      },
    });

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        const newWidth = chartContainerRef.current.clientWidth;
        chart.applyOptions({ width: newWidth });
      }
    };

    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [chartType]);

  const formatCandle = useCallback((candle: any) => {
    if (chartType === 'candlestick') {
      return {
        time: candle.time as UTCTimestamp,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      };
    }
    return { time: candle.time as UTCTimestamp, value: Number(candle.close) };
  }, [chartType]);

  const formatVolumeData = useCallback((candles: any[]): HistogramData[] => {
    return candles.map(candle => {
      const open = Number(candle.open);
      const close = Number(candle.close);
      
      const isBullish = close >= open;
      const color = isBullish ? colors.bullishVolume : colors.bearishVolume;

      return {
        time: candle.time as UTCTimestamp,
        value: Number(candle.volume) || 0,
        color: color,
      };
    });
  }, []);

  const setAllData = useCallback((candles: any[]) => {
    if (!seriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;
    
    const formattedCandles = candles.map(formatCandle);
    seriesRef.current.setData(formattedCandles);
    
    const volumeData = formatVolumeData(candles);
    volumeSeriesRef.current.setData(volumeData);
    
    setCandleCount(candles.length);
    setLastUpdate(new Date());
  }, [formatCandle, formatVolumeData]);

  const updateLastCandle = useCallback((candle: any, isNew: boolean) => {
    if (!seriesRef.current || !volumeSeriesRef.current) return;
    
    const formattedCandle = formatCandle(candle);
    seriesRef.current.update(formattedCandle);
    
    const open = Number(candle.open);
    const close = Number(candle.close);
    const isBullish = close >= open;
    
    const volumeBar: HistogramData = {
      time: candle.time as UTCTimestamp,
      value: Number(candle.volume) || 0,
      color: isBullish ? colors.bullishVolume : colors.bearishVolume,
    };
    
    volumeSeriesRef.current.update(volumeBar);
    
    setCandleCount(currentCandlesRef.current.length);
    setLastUpdate(new Date());
  }, [formatCandle]);

  useEffect(() => {
    const cleanup = initializeChart();
    return cleanup;
  }, [initializeChart]);

  useEffect(() => {
    if (!socket || !isConnected) return;
    
    currentSymbolRef.current = symbol;
    currentTimeframeRef.current = selectedTimeframe;

    const loadInitialData = async () => {
      try {
        setLoading(true);
        
        socket.emit('unsubscribe_candles', { 
          symbol: currentSymbolRef.current, 
          timeframe: currentTimeframeRef.current 
        });
        
        socket.emit('subscribe_candles', { symbol, timeframe: selectedTimeframe });

        const response = await apiService.getCandlestick(symbol, selectedTimeframe);
        if (response.data && response.data.length > 0) {
          currentCandlesRef.current = response.data;
          setAllData(response.data);
        } else {
          currentCandlesRef.current = [];
          setCandleCount(0);
        }
      } catch (error) {
        console.error('Error loading initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    const handleInitialCandles = (data: any) => {
      if (data.symbol === currentSymbolRef.current && 
          data.timeframe === currentTimeframeRef.current) {
        currentCandlesRef.current = data.candles || [];
        setAllData(data.candles || []);
      }
    };

    const handleCandleUpdate = (data: any) => {
      if (data.symbol !== currentSymbolRef.current || 
          data.timeframe !== currentTimeframeRef.current) {
        return;
      }

      if (!data.candle) return;

      if (data.isNew) {
        currentCandlesRef.current.push(data.candle);
        updateLastCandle(data.candle, true);
      } else {
        if (currentCandlesRef.current.length > 0) {
          currentCandlesRef.current[currentCandlesRef.current.length - 1] = data.candle;
        }
        updateLastCandle(data.candle, false);
      }

      if (currentCandlesRef.current.length > 200) {
        currentCandlesRef.current = currentCandlesRef.current.slice(-200);
      }
    };

    socket.on('initial_candles', handleInitialCandles);
    socket.on('candle_update', handleCandleUpdate);

    loadInitialData();

    return () => {
      socket.off('initial_candles', handleInitialCandles);
      socket.off('candle_update', handleCandleUpdate);
      socket.emit('unsubscribe_candles', { symbol, timeframe: selectedTimeframe });
    };
  }, [symbol, selectedTimeframe, socket, isConnected, setAllData, updateLastCandle]);

  return (
    <div 
      className="rounded-2xl p-8 shadow-2xl border transition-all duration-500"
      style={{ 
        background: colors.background,
        borderColor: colors.border,
      }}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-7">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            {chartType === 'candlestick' ? (
              <BarChart3 className="w-5 h-5" style={{ color: colors.accent, opacity: 0.9 }} />
            ) : (
              <Activity className="w-5 h-5" style={{ color: colors.accent, opacity: 0.9 }} />
            )}
            <h3 
              className="text-2xl font-extralight tracking-wider"
              style={{ color: colors.textPrimary, letterSpacing: '0.05em' }}
            >
              {symbol}
            </h3>
            <span 
              className="px-3 py-1 rounded-lg text-[10px] font-medium tracking-widest uppercase"
              style={{ 
                backgroundColor: colors.accentMuted,
                color: colors.accent,
                letterSpacing: '0.1em',
              }}
            >
              {chartType === 'line' ? 'Line' : 'Candlestick'}
            </span>
          </div>
          
          <div className="flex items-center gap-6 text-[11px]">
            <div className="flex items-center gap-2.5">
              <div 
                className="w-1.5 h-1.5 rounded-full transition-all duration-500"
                style={{ 
                  backgroundColor: isConnected ? colors.success : colors.danger,
                  boxShadow: isConnected ? `0 0 10px ${colors.successGlow}` : 'none',
                }}
              />
              <span style={{ color: colors.textSecondary, letterSpacing: '0.02em' }}>
                {isConnected ? 'Live Session' : 'Disconnected'}
              </span>
            </div>
            
            {candleCount > 0 && (
              <div style={{ color: colors.textTertiary }}>
                <span style={{ color: colors.textSecondary, fontWeight: 500 }}>{candleCount}</span> bars
              </div>
            )}
            
            {lastUpdate && (
              <div style={{ color: colors.textTertiary }}>
                Last <span style={{ color: colors.textSecondary }}>
                  {lastUpdate.toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    second: '2-digit' 
                  })}
                </span>
              </div>
            )}
          </div>
        </div>

        <TimeframeSelector
          selectedTimeframe={selectedTimeframe}
          onTimeframeChange={(tf) => {
            setSelectedTimeframe(tf);
            currentCandlesRef.current = [];
            setCandleCount(0);
          }}
        />
      </div>

      {/* Contest Progress */}
      {marketState.isRunning && (
        <div className="mb-7">
          <div 
            className="w-full rounded-full h-1 overflow-hidden"
            style={{ backgroundColor: colors.surface }}
          >
            <div
              className="h-1 rounded-full transition-all duration-1000 ease-out"
              style={{ 
                width: `${Math.min(marketState.progress || 0, 100)}%`,
                background: `linear-gradient(90deg, ${colors.accent} 0%, ${colors.bullish} 100%)`,
                boxShadow: `0 0 16px ${colors.accent}25`,
              }}
            />
          </div>
          <div className="flex justify-between mt-2.5 text-[10px]" style={{ color: colors.textTertiary, letterSpacing: '0.02em' }}>
            <span>
              Progress <span style={{ color: colors.textSecondary, fontWeight: 500 }}>
                {(marketState.progress || 0).toFixed(1)}%
              </span>
            </span>
            <span>
              Elapsed <span style={{ color: colors.textSecondary, fontWeight: 500 }}>
                {Math.floor((marketState.elapsedTime || 0) / 60000)}m {Math.floor(((marketState.elapsedTime || 0) % 60000) / 1000)}s
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Volume Legend */}
      <div className="mb-6 flex items-center gap-8 text-[10px]">
        <div className="flex items-center gap-2.5">
          <div 
            className="w-3.5 h-3.5 rounded-sm"
            style={{ backgroundColor: colors.bullishVolume, border: `1px solid ${colors.bullish}30` }}
          />
          <span style={{ color: colors.textSecondary, letterSpacing: '0.03em' }}>Accumulation</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div 
            className="w-3.5 h-3.5 rounded-sm"
            style={{ backgroundColor: colors.bearishVolume, border: `1px solid ${colors.bearish}30` }}
          />
          <span style={{ color: colors.textSecondary, letterSpacing: '0.03em' }}>Distribution</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" style={{ color: colors.accent, opacity: 0.7 }} />
          <span style={{ color: colors.textTertiary, letterSpacing: '0.03em' }}>Volume Profile</span>
        </div>
      </div>

      {/* Chart Container */}
      {loading && (
        <div 
          className="flex justify-center items-center h-[640px] rounded-xl border"
          style={{ 
            backgroundColor: colors.chartBackground,
            borderColor: colors.borderSubtle,
          }}
        >
          <div className="flex flex-col items-center gap-5">
            <div 
              className="animate-spin rounded-full h-10 w-10 border border-t-transparent"
              style={{ borderColor: `${colors.accent}40 transparent ${colors.accent}40 ${colors.accent}40` }}
            />
            <div className="text-xs" style={{ color: colors.textSecondary, letterSpacing: '0.05em' }}>
              Initializing market stream
            </div>
          </div>
        </div>
      )}

      <div
        ref={chartContainerRef}
        style={{ display: loading ? 'none' : 'block' }}
        className="w-full rounded-xl overflow-hidden border"
      >
        {/* FIXED: Removed duplicate style attribute */}
      </div>

      {/* Status Messages */}
      {!marketState.isRunning && !loading && (
        <div 
          className="mt-6 p-4 rounded-xl border"
          style={{ 
            backgroundColor: colors.warningMuted,
            borderColor: `${colors.warning}20`,
          }}
        >
          <p className="text-xs" style={{ color: colors.warning, letterSpacing: '0.02em' }}>
            Market session inactive • Awaiting contest start
          </p>
        </div>
      )}
    </div>
  );
};

export default LiveStockChart;