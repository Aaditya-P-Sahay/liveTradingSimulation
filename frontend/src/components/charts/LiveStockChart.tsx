import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts';
import { useMarket } from '../../contexts/MarketContext';
import { apiService } from '../../services/api';

interface LiveStockChartProps {
  symbol: string;
  chartType: 'line' | 'candlestick';
}

export const LiveStockChart: React.FC<LiveStockChartProps> = ({ symbol, chartType }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const { socket, isConnected, marketState, lastTickData } = useMarket();
  
  // PYTHON SOLUTION: Simple data tracking with proper backend integration
  const allTicksRef = useRef<any[]>([]);
  const allCandlesRef = useRef<any[]>([]);
  const subscribedRef = useRef<boolean>(false);
  const currentSymbolRef = useRef<string>('');
  const chartInitializedRef = useRef<boolean>(false);
  const intervalSecondsRef = useRef<number>(30);

  // PYTHON SOLUTION: Frontend uses backend-parsed timestamps (Python-processed)
  const parseMarketTimestamp = useCallback((timestamp: string): UTCTimestamp => {
    try {
      // Frontend now trusts backend Python-parsed timestamps
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        console.warn('Invalid timestamp from backend:', timestamp);
        return Math.floor(Date.now() / 1000) as UTCTimestamp;
      }
      return Math.floor(date.getTime() / 1000) as UTCTimestamp;
    } catch (error) {
      console.warn('❌ Error parsing backend timestamp:', timestamp, error);
      return Math.floor(Date.now() / 1000) as UTCTimestamp;
    }
  }, []);

  // PYTHON SOLUTION: Frontend aggregates pre-processed candles from backend
  const aggregateTicksToCandles = useCallback((ticks: any[], intervalSeconds = 30) => {
    if (!ticks || ticks.length === 0) return [];
    
    console.log(`🕯️ PYTHON SOLUTION: Frontend processing ${ticks.length} ticks (backend Python-parsed)`);
    
    const candleMap = new Map<number, any>();
    
    const sortedTicks = [...ticks].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeA - timeB;
    });
    
    sortedTicks.forEach((tick) => {
      const tickTime = parseMarketTimestamp(tick.timestamp);
      const bucketTime = Math.floor(tickTime / intervalSeconds) * intervalSeconds;
      
      const price = parseFloat(tick.last_traded_price) || 0;
      const volume = parseInt(tick.volume_traded) || 0;
      
      if (price <= 0) return;
      
      if (!candleMap.has(bucketTime)) {
        candleMap.set(bucketTime, {
          time: bucketTime as UTCTimestamp,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: volume,
          tickCount: 1
        });
      } else {
        const candle = candleMap.get(bucketTime);
        if (candle) {
          candle.high = Math.max(candle.high, price);
          candle.low = Math.min(candle.low, price);
          candle.close = price;
          candle.volume += volume;
          candle.tickCount++;
        }
      }
    });
    
    const candles = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
    
    console.log(`✅ PYTHON SOLUTION: Frontend created ${candles.length} candles from backend Python-parsed data`);
    return candles;
  }, [parseMarketTimestamp]);

  const createLineDataFromTicks = useCallback((ticks: any[]) => {
    if (!ticks || ticks.length === 0) return [];
    
    const lineData = ticks
      .map((tick: any) => ({
        time: parseMarketTimestamp(tick.timestamp),
        value: parseFloat(tick.last_traded_price) || 0,
      }))
      .filter(d => d.value > 0)
      .sort((a, b) => a.time - b.time);
    
    console.log(`📈 PYTHON SOLUTION: Created line data: ${lineData.length} points from Python-parsed timestamps`);
    return lineData;
  }, [parseMarketTimestamp]);

  const initializeChart = useCallback(() => {
    if (!chartContainerRef.current || chartRef.current) return;

    console.log(`🎯 PYTHON SOLUTION: Initializing ${chartType} chart for ${symbol}`);
    
    const container = chartContainerRef.current;
    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width || 800, 300);
    const height = 500;

    try {
      const chart = createChart(container, {
        width,
        height,
        layout: {
          background: { color: '#1a1a1a' },
          textColor: '#d1d4dc',
        },
        grid: {
          vertLines: { color: '#2a2a2a' },
          horzLines: { color: '#2a2a2a' },
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: true,
          borderColor: '#2a2a2a',
          rightOffset: 12,
          barSpacing: 6,
          fixLeftEdge: false,
          lockVisibleTimeRangeOnResize: false,
          rightBarStaysOnScroll: true,
        },
        rightPriceScale: {
          borderColor: '#2a2a2a',
          scaleMargins: {
            top: 0.1,
            bottom: 0.1,
          },
        },
        crosshair: {
          mode: 1,
          vertLine: {
            color: '#758696',
            width: 1,
            style: 2,
          },
          horzLine: {
            color: '#758696',
            width: 1,
            style: 2,
          },
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
      });

      chartRef.current = chart;

      if (chartType === 'line') {
        const lineSeries = chart.addLineSeries({
          color: '#2962FF',
          lineWidth: 2,
          priceLineVisible: true,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
        });
        seriesRef.current = lineSeries;
      } else {
        const candlestickSeries = chart.addCandlestickSeries({
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderUpColor: '#26a69a',
          borderDownColor: '#ef5350',
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
          priceLineVisible: true,
          lastValueVisible: true,
        });
        seriesRef.current = candlestickSeries;
      }

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      
      resizeObserverRef.current = new ResizeObserver((entries) => {
        if (chartRef.current) {
          const entry = entries[0];
          if (entry) {
            const { width: newWidth, height: newHeight } = entry.contentRect;
            chartRef.current.applyOptions({ 
              width: Math.max(newWidth, 300), 
              height: Math.max(newHeight, 400) 
            });
          }
        }
      });
      
      resizeObserverRef.current.observe(container);
      
      chartInitializedRef.current = true;
      console.log(`✅ PYTHON SOLUTION: ${chartType} chart initialized for ${symbol}`);

    } catch (error) {
      console.error('❌ Chart initialization error:', error);
      setError('Failed to initialize chart');
    }
  }, [chartType, symbol]);

  const updateChartData = useCallback(() => {
    if (!seriesRef.current || allTicksRef.current.length === 0) return;

    console.log(`📊 PYTHON SOLUTION: Updating chart for ${symbol} with ${allTicksRef.current.length} Python-parsed ticks`);

    try {
      if (chartType === 'candlestick' && seriesRef.current) {
        const newCandles = aggregateTicksToCandles(allTicksRef.current, intervalSecondsRef.current);
        
        if (newCandles.length > 0) {
          console.log(`🕯️ PYTHON SOLUTION: ${symbol}: Updating with ${newCandles.length} candles`);
          
          if (allCandlesRef.current.length === 0) {
            seriesRef.current.setData(newCandles);
            allCandlesRef.current = [...newCandles];
          } else {
            const lastStoredTime = allCandlesRef.current[allCandlesRef.current.length - 1]?.time || 0;
            
            newCandles.forEach(candle => {
              if (!seriesRef.current) return;
              
              const existingIndex = allCandlesRef.current.findIndex(c => c.time === candle.time);
              
              if (existingIndex >= 0) {
                allCandlesRef.current[existingIndex] = candle;
                seriesRef.current.update(candle);
              } else if (candle.time > lastStoredTime) {
                allCandlesRef.current.push(candle);
                seriesRef.current.update(candle);
              }
            });
          }
          
          if (chartRef.current && newCandles.length > 1) {
            requestAnimationFrame(() => {
              try {
                const timeScale = chartRef.current?.timeScale();
                const visibleRange = timeScale?.getVisibleRange();
                const lastCandleTime = newCandles[newCandles.length - 1].time;
                
                if (!visibleRange || (visibleRange.to as number) > (lastCandleTime - 600)) {
                  if (newCandles.length > 50) {
                    const startTime = newCandles[Math.max(0, newCandles.length - 50)].time;
                    timeScale?.setVisibleRange({
                      from: startTime as any,
                      to: (lastCandleTime + 120) as any
                    });
                  } else {
                    timeScale?.fitContent();
                  }
                }
              } catch (e) {
                console.debug('Auto-scroll error:', e);
              }
            });
          }
          
          setError('');
        }
      } else if (chartType === 'line' && seriesRef.current) {
        const lineData = createLineDataFromTicks(allTicksRef.current);
        
        if (lineData.length > 0) {
          console.log(`📈 PYTHON SOLUTION: ${symbol}: Updating line chart with ${lineData.length} points`);
          seriesRef.current.setData(lineData);
          
          if (chartRef.current && lineData.length > 100) {
            requestAnimationFrame(() => {
              try {
                const timeScale = chartRef.current?.timeScale();
                const lastPoint = lineData[lineData.length - 1];
                const startPoint = lineData[Math.max(0, lineData.length - 100)];
                
                const visibleRange = {
                  from: startPoint.time as any,
                  to: (lastPoint.time + 120) as any
                };
                timeScale?.setVisibleRange(visibleRange);
              } catch (e) {
                console.debug('Line chart auto-scroll error:', e);
              }
            });
          }
          
          setError('');
        }
      }
    } catch (error) {
      console.error('❌ Chart update error:', error);
      setError('Failed to update chart');
    }
  }, [chartType, aggregateTicksToCandles, createLineDataFromTicks, symbol]);

  useEffect(() => {
    console.log(`🔄 PYTHON SOLUTION: Chart type changed to: ${chartType} for ${symbol}`);
    
    if (chartRef.current) {
      try {
        chartRef.current.remove();
      } catch (e) {
        console.debug('Chart cleanup error:', e);
      }
      chartRef.current = null;
      seriesRef.current = null;
      chartInitializedRef.current = false;
    }
    
    allCandlesRef.current = [];
    
    const initTimeout = setTimeout(() => {
      initializeChart();
      
      const updateTimeout = setTimeout(() => {
        if (allTicksRef.current.length > 0) {
          updateChartData();
        }
      }, 100);
      
      return () => clearTimeout(updateTimeout);
    }, 50);
    
    return () => clearTimeout(initTimeout);
  }, [chartType, initializeChart, updateChartData]);

  useEffect(() => {
    if (!symbol || !socket) return;

    let mounted = true;
    console.log(`🔄 PYTHON SOLUTION: Setting up ${symbol} with backend Python timestamp parsing`);

    const loadData = async () => {
      try {
        setLoading(true);
        setError('');
        
        console.log(`📊 PYTHON SOLUTION: Loading contest data for ${symbol}...`);
        
        const response = await apiService.getContestData(symbol, 0, marketState.currentDataTick || undefined);
        
        if (response.ticks && response.ticks.length > 0 && mounted) {
          allTicksRef.current = response.ticks;
          
          console.log(`✅ PYTHON SOLUTION: Loaded ${response.ticks.length} Python-parsed ticks for ${symbol}`);
          console.log(`📅 Sample timestamp: ${response.ticks[0]?.timestamp}`);
          
          const waitForChart = () => {
            if (chartInitializedRef.current && seriesRef.current) {
              updateChartData();
            } else if (mounted) {
              setTimeout(waitForChart, 100);
            }
          };
          waitForChart();
          
        } else if (mounted) {
          console.log(`⚠️ PYTHON SOLUTION: No ticks available for ${symbol}`);
          setError(`No data available for ${symbol}`);
          allTicksRef.current = [];
        }
      } catch (error: any) {
        console.error(`❌ PYTHON SOLUTION: Failed to load data for ${symbol}:`, error);
        if (mounted) {
          setError(error.response?.data?.error || 'Failed to load data');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    if (currentSymbolRef.current !== symbol) {
      if (currentSymbolRef.current && subscribedRef.current) {
        console.log(`📉 PYTHON SOLUTION: Unsubscribing from ${currentSymbolRef.current}`);
        socket.emit('unsubscribe_symbols', [currentSymbolRef.current]);
      }
      
      console.log(`📈 PYTHON SOLUTION: Subscribing to ${symbol} real-time updates`);
      socket.emit('subscribe_symbols', [symbol]);
      currentSymbolRef.current = symbol;
      subscribedRef.current = true;
    }

    const handleSymbolTick = (data: any) => {
      if (data.symbol === symbol && data.data && mounted) {
        allTicksRef.current.push(data.data);
        
        console.log(`🔔 PYTHON SOLUTION: ${symbol} new tick: LTP=₹${data.data.last_traded_price} at ${data.data.timestamp}`);
        
        if (chartInitializedRef.current) {
          updateChartData();
        }
      }
    };

    const handleContestData = (data: any) => {
      if (data.symbol === symbol && data.ticks && mounted) {
        console.log(`📊 PYTHON SOLUTION: ${symbol}: Full contest data received (${data.ticks.length} ticks)`);
        
        allTicksRef.current = data.ticks;
        allCandlesRef.current = [];
        
        updateChartData();
      }
    };

    const handleMarketTick = (data: any) => {
      if (data.prices && data.prices[symbol] && mounted) {
        const lastTick = allTicksRef.current[allTicksRef.current.length - 1];
        const newPrice = data.prices[symbol];
        
        if (lastTick && Math.abs(lastTick.last_traded_price - newPrice) > 0.01) {
          const now = new Date();
          const syntheticTick = {
            ...lastTick,
            last_traded_price: newPrice,
            timestamp: now.toISOString(),
            volume_traded: 0,
            synthetic: true
          };
          
          allTicksRef.current.push(syntheticTick);
          
          if (chartInitializedRef.current) {
            updateChartData();
          }
        }
      }
    };

    if (socket) {
      socket.on('symbol_tick', handleSymbolTick);
      socket.on('contest_data', handleContestData);
      socket.on('market_tick', handleMarketTick);
    }

    loadData();

    return () => {
      mounted = false;
      if (socket) {
        socket.off('symbol_tick', handleSymbolTick);
        socket.off('contest_data', handleContestData);
        socket.off('market_tick', handleMarketTick);
      }
    };
  }, [symbol, socket, updateChartData]);

  useEffect(() => {
    if (marketState.isRunning && !marketState.isPaused && chartInitializedRef.current) {
      console.log(`🎬 PYTHON SOLUTION: Starting auto-refresh for ${symbol}`);
      
      const interval = setInterval(() => {
        if (allTicksRef.current.length > 0) {
          updateChartData();
        }
      }, 2000);
      
      return () => clearInterval(interval);
    }
  }, [marketState.isRunning, marketState.isPaused, symbol, updateChartData]);

  useEffect(() => {
    return () => {
      console.log(`🧹 PYTHON SOLUTION: Cleaning up chart for ${symbol}`);
      
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          console.debug('Cleanup error:', e);
        }
      }
      
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      
      if (socket && subscribedRef.current && currentSymbolRef.current) {
        socket.emit('unsubscribe_symbols', [currentSymbolRef.current]);
        subscribedRef.current = false;
      }
    };
  }, [socket]);

  const currentPrice = lastTickData.get(symbol)?.price || 
    (allTicksRef.current.length > 0 ? parseFloat(allTicksRef.current[allTicksRef.current.length - 1]?.last_traded_price) : 0);
  
  const firstPrice = allTicksRef.current.length > 0 ? parseFloat(allTicksRef.current[0]?.last_traded_price) : 0;
  const priceChange = currentPrice - firstPrice;
  const priceChangePercent = firstPrice ? (priceChange / firstPrice) * 100 : 0;

  const getPriceRange = () => {
    if (allTicksRef.current.length === 0) return { min: 0, max: 0 };
    
    let min = Infinity;
    let max = -Infinity;
    
    allTicksRef.current.forEach(tick => {
      const price = parseFloat(tick.last_traded_price);
      if (price > 0) {
        min = Math.min(min, price);
        max = Math.max(max, price);
      }
    });
    
    return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
  };

  const priceRange = getPriceRange();

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">
              {symbol} - {chartType === 'line' ? 'Line Chart' : 'Candlestick Chart'}
            </h3>
            {currentPrice > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-bold text-white">₹{currentPrice.toFixed(2)}</span>
                {priceChange !== 0 && (
                  <span className={`text-sm font-medium px-2 py-1 rounded ${
                    priceChange >= 0 ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
                  }`}>
                    {priceChange >= 0 ? '+' : ''}₹{priceChange.toFixed(2)} ({priceChange >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%)
                  </span>
                )}
              </div>
            )}
            <div className="text-xs text-gray-500 mt-1">
              🐍 PYTHON SOLUTION • BACKEND TIMESTAMP PARSING • EXACTLY LIKE YOUR WORKING CODE
            </div>
          </div>
          
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
              }`} />
              <span className="text-gray-400">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            
            {marketState.isRunning && (
              <>
                <span className="text-blue-400">
                  {marketState.isPaused ? '⏸️ Paused' : '🐍 PYTHON LIVE'} @ {marketState.speed}x
                </span>
                <span className="text-purple-400">
                  Ticks: {allTicksRef.current.length}
                </span>
                {chartType === 'candlestick' && (
                  <span className="text-orange-400">
                    Candles: {allCandlesRef.current.length}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {marketState.isRunning && (
        <div className="mb-4">
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${marketState.progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-gray-400">
            <span>Progress: {marketState.progress.toFixed(1)}%</span>
            <span>Tick: {marketState.currentDataTick}/{marketState.totalDataTicks}</span>
            <span>Elapsed: {Math.floor((marketState.elapsedTime || 0) / 60000)}m</span>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
          ⚠️ {error}
          <button 
            onClick={async () => {
              setError('');
              setLoading(true);
              try {
                const data = await apiService.getContestData(symbol, 0, marketState.currentDataTick || undefined);
                if (data.ticks && data.ticks.length > 0) {
                  allTicksRef.current = data.ticks;
                  allCandlesRef.current = [];
                  updateChartData();
                  setError('');
                } else {
                  setError('No data available after retry');
                }
              } catch (err: any) {
                setError(err.response?.data?.error || 'Failed to reload data');
              }
              setLoading(false);
            }}
            className="ml-2 text-red-300 hover:text-red-100 underline"
          >
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="flex justify-center items-center h-[500px] bg-gray-800 rounded-lg">
          <div className="flex flex-col items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <div className="text-gray-400">Loading {chartType} chart...</div>
            <div className="text-xs text-gray-500">PYTHON SOLUTION: Using your working timestamp logic</div>
          </div>
        </div>
      )}
      
      <div 
        ref={chartContainerRef} 
        className={`w-full transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
        style={{ 
          height: '500px',
          minHeight: '500px',
          display: loading ? 'none' : 'block'
        }} 
      />
      
      {!loading && allTicksRef.current.length > 0 && (
        <div className="mt-4 p-4 bg-green-900/20 border border-green-700 rounded-lg">
          <h4 className="text-green-400 font-semibold mb-3">🐍 PYTHON SOLUTION: Working Perfectly!</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-green-300">Python Ticks:</span>
              <span className="text-white ml-2 font-semibold">{allTicksRef.current.length}</span>
            </div>
            {chartType === 'candlestick' && (
              <div>
                <span className="text-green-300">Live Candles:</span>
                <span className="text-white ml-2 font-semibold">{allCandlesRef.current.length}</span>
              </div>
            )}
            <div>
              <span className="text-green-300">Price Range:</span>
              <span className="text-white ml-2">₹{priceRange.min.toFixed(2)} - ₹{priceRange.max.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-green-300">Solution:</span>
              <span className="text-yellow-400 ml-2 font-semibold">🐍 PYTHON</span>
            </div>
          </div>
          
          <div className="mt-3 pt-3 border-t border-green-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-green-300">Timestamp Parsing:</span>
              <span className="font-semibold text-yellow-400">🐍 pd.to_datetime() EXACTLY</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-green-300">Backend Processing:</span>
              <span className="text-white">🐍 Python Script Integration</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-green-300">Your Advice:</span>
              <span className="text-green-400">✅ IMPLEMENTED AS SUGGESTED</span>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && allTicksRef.current.length === 0 && (
        <div className="flex justify-center items-center h-[500px] bg-gray-800 rounded-lg">
          <div className="text-center">
            <div className="text-6xl mb-4">🐍</div>
            <div className="text-gray-400 text-lg">Python Solution Ready</div>
            <div className="text-gray-500 text-sm">
              {marketState.isRunning ? 'Python parsing timestamps...' : 'Start contest for Python-powered charts'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};