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
  const seriesRef = useRef<ISeriesApi<'Line' | 'Candlestick'> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const { socket, isConnected, marketState, lastTickData } = useMarket();
  
  const rawDataRef = useRef<any[]>([]);
  const isDisposedRef = useRef(false);
  const lastUpdateRef = useRef<number>(0);
  const subscribedRef = useRef<boolean>(false);
  const currentSymbolRef = useRef<string>('');
  const chartInitializedRef = useRef<boolean>(false);

  // ENHANCED: Parse Angel One API timestamp format (MM:SS.ms)
  const parseTimestamp = useCallback((timestamp: string): UTCTimestamp => {
    try {
      let date: Date;
      
      if (timestamp.includes(':') && !timestamp.includes('T')) {
        // Handle Angel One format: "49:55.3" = 49 minutes 55.3 seconds from market start
        const [minutes, secondsWithMs] = timestamp.split(':');
        const [seconds, milliseconds = '0'] = secondsWithMs.split('.');
        
        // Create base date (today at market start 9:15 AM IST)
        date = new Date();
        date.setHours(9, 15, 0, 0); // Market start at 9:15 AM
        date.setMinutes(date.getMinutes() + parseInt(minutes));
        date.setSeconds(parseInt(seconds));
        date.setMilliseconds(parseInt(milliseconds.padEnd(3, '0')));
        
        console.log(`🕐 Parsed ${timestamp} -> ${date.toLocaleTimeString()}.${milliseconds}`);
      } else {
        date = new Date(timestamp);
      }
      
      if (isNaN(date.getTime())) {
        console.warn('❌ Invalid timestamp:', timestamp);
        return Math.floor(Date.now() / 1000) as UTCTimestamp;
      }
      
      return Math.floor(date.getTime() / 1000) as UTCTimestamp;
    } catch (error) {
      console.warn('❌ Error parsing timestamp:', timestamp, error);
      return Math.floor(Date.now() / 1000) as UTCTimestamp;
    }
  }, []);

  // ENHANCED: Use existing OHLC data from database instead of calculating
  const createCandles = useCallback((data: any[], intervalSeconds = 30) => {
    if (!data || data.length === 0) return [];
    
    console.log(`\n🔢 === CANDLE MATH FOR ${symbol} ===`);
    console.log(`📥 Input: ${data.length} ticks with existing OHLC data`);
    console.log(`⏱️ Grouping into ${intervalSeconds}-second intervals`);
    
    // Sort data by timestamp first
    const sortedData = [...data].sort((a, b) => {
      const timeA = parseTimestamp(a.timestamp || a.normalized_timestamp);
      const timeB = parseTimestamp(b.timestamp || b.normalized_timestamp);
      return timeA - timeB;
    });

    const candleMap = new Map<number, any>();
    let ticksProcessed = 0;
    let windowsCreated = 0;
    
    // 🔢 ENHANCED MATH: Aggregate existing OHLC data instead of calculating
    sortedData.forEach((tick, index) => {
      const tickTime = parseTimestamp(tick.timestamp || tick.normalized_timestamp);
      
      // 🧮 KEY CALCULATION: Group into 30-second intervals
      // Math: candleTime = floor(tickTime / 30) * 30
      // This creates boundaries every 30 seconds
      const candleTime = Math.floor(tickTime / intervalSeconds) * intervalSeconds;
      
      ticksProcessed++;
      
      // Extract OHLC data from database (your data already has this!)
      const tickOHLC = {
        open: parseFloat(tick.open_price) || parseFloat(tick.last_traded_price) || 0,
        high: parseFloat(tick.high_price) || parseFloat(tick.last_traded_price) || 0,
        low: parseFloat(tick.low_price) || parseFloat(tick.last_traded_price) || 0,
        close: parseFloat(tick.close_price) || parseFloat(tick.last_traded_price) || 0,
        volume: parseInt(tick.volume_traded) || 0,
        ltp: parseFloat(tick.last_traded_price) || 0
      };
      
      if (!candleMap.has(candleTime)) {
        // 🕯️ NEW CANDLE WINDOW
        windowsCreated++;
        candleMap.set(candleTime, {
          time: candleTime as UTCTimestamp,
          
          // 📊 AGGREGATION STRATEGY FOR EXISTING OHLC:
          open: tickOHLC.open,           // First tick's OPEN in this window
          high: tickOHLC.high,           // Start with first tick's HIGH  
          low: tickOHLC.low,             // Start with first tick's LOW
          close: tickOHLC.close,         // Will be updated to last tick's CLOSE
          
          volume: tickOHLC.volume,       // Sum of volumes
          tickCount: 1,
          firstTick: tick,
          lastTick: tick,
          window: `${new Date(candleTime * 1000).toLocaleTimeString()}-${new Date((candleTime + intervalSeconds) * 1000).toLocaleTimeString()}`
        });
        
        if (index < 3) { // Log first few for debugging
          console.log(`   🆕 Window ${windowsCreated}: ${new Date(candleTime * 1000).toLocaleTimeString()}`);
          console.log(`       📊 Tick OHLC: O=${tickOHLC.open} H=${tickOHLC.high} L=${tickOHLC.low} C=${tickOHLC.close}`);
        }
      } else {
        // 🔄 UPDATE EXISTING WINDOW WITH OHLC AGGREGATION
        const candle = candleMap.get(candleTime);
        
        // 🧮 CRITICAL OHLC AGGREGATION MATH:
        // - OPEN stays as first tick's open_price (no change)
        // - HIGH = max of all high_prices in window  
        // - LOW = min of all low_prices in window
        // - CLOSE = last tick's close_price (latest)
        // - VOLUME = sum of all volumes
        
        candle.high = Math.max(candle.high, tickOHLC.high);
        candle.low = Math.min(candle.low, tickOHLC.low);
        candle.close = tickOHLC.close;  // Always use latest close
        candle.volume += tickOHLC.volume;
        candle.tickCount++;
        candle.lastTick = tick;
        
        if (index < 10 && candle.tickCount <= 3) { // Log first few updates
          console.log(`   📊 Update Window ${new Date(candleTime * 1000).toLocaleTimeString()}: ${candle.tickCount} ticks`);
          console.log(`       🔄 Aggregated OHLC: O=${candle.open.toFixed(2)} H=${candle.high.toFixed(2)} L=${candle.low.toFixed(2)} C=${candle.close.toFixed(2)}`);
        }
      }
    });

    // Convert to sorted array
    const candleArray = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
    
    console.log(`✅ CANDLE CREATION COMPLETE:`);
    console.log(`   📥 Processed: ${ticksProcessed} ticks`);
    console.log(`   🕯️ Created: ${candleArray.length} candles (${windowsCreated} windows)`);
    console.log(`   ⏱️ Avg ticks per candle: ${(ticksProcessed / candleArray.length).toFixed(1)}`);
    
    if (candleArray.length > 0) {
      const firstCandle = candleArray[0];
      const lastCandle = candleArray[candleArray.length - 1];
      console.log(`   📊 First: ${new Date(firstCandle.time * 1000).toLocaleTimeString()} OHLC=${firstCandle.open.toFixed(2)}/${firstCandle.high.toFixed(2)}/${firstCandle.low.toFixed(2)}/${firstCandle.close.toFixed(2)}`);
      console.log(`   📊 Last:  ${new Date(lastCandle.time * 1000).toLocaleTimeString()} OHLC=${lastCandle.open.toFixed(2)}/${lastCandle.high.toFixed(2)}/${lastCandle.low.toFixed(2)}/${lastCandle.close.toFixed(2)}`);
    }
    console.log(`=== END CANDLE MATH ===\n`);
    
    return candleArray;
  }, [parseTimestamp, symbol]);

  // ENHANCED: Create line data using last_traded_price
  const createLineData = useCallback((data: any[]) => {
    if (!data || data.length === 0) return [];
    
    const lineData = data
      .map((d: any) => ({
        time: parseTimestamp(d.timestamp || d.normalized_timestamp),
        value: parseFloat(d.last_traded_price) || 0, // Use LTP for line charts
      }))
      .filter(d => d.value > 0)
      .sort((a, b) => a.time - b.time);
    
    console.log(`📈 Created line data: ${lineData.length} points for ${symbol}`);
    return lineData;
  }, [parseTimestamp, symbol]);

  // ENHANCED: Chart initialization with better error handling
  const initializeChart = useCallback(() => {
    if (!chartContainerRef.current || chartRef.current) return;

    console.log(`🎯 Initializing ${chartType} chart for ${symbol}`);
    
    // Get container dimensions
    const container = chartContainerRef.current;
    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width || 800, 300);
    const height = 500;
    
    console.log(`📐 Chart container: ${width}x${height}`);

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
          barSpacing: 3,
          fixLeftEdge: false,
          lockVisibleTimeRangeOnResize: true,
        },
        rightPriceScale: {
          borderColor: '#2a2a2a',
          scaleMargins: {
            top: 0.1,
            bottom: 0.1,
          },
        },
        crosshair: {
          mode: 1, // Normal crosshair
          vertLine: {
            color: '#758696',
            width: 1,
            style: 2, // Dashed
          },
          horzLine: {
            color: '#758696',
            width: 1,
            style: 2, // Dashed
          },
        },
      });

      chartRef.current = chart;

      // Create appropriate series
      if (chartType === 'line') {
        const lineSeries = chart.addLineSeries({
          color: '#2962FF',
          lineWidth: 2,
          priceLineVisible: true,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
        });
        seriesRef.current = lineSeries as any;
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
        seriesRef.current = candlestickSeries as any;
      }

      // Set up resize observer for responsive design
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      
      resizeObserverRef.current = new ResizeObserver((entries) => {
        if (chartRef.current && !isDisposedRef.current) {
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
      console.log(`✅ ${chartType} chart initialized for ${symbol}`);

    } catch (error) {
      console.error('❌ Chart initialization error:', error);
      setError('Failed to initialize chart');
    }
  }, [chartType, symbol]);

  // ENHANCED: Real-time update with better throttling
  const updateChartData = useCallback(() => {
    if (isDisposedRef.current || !seriesRef.current || !rawDataRef.current.length) {
      return;
    }

    // Smart throttling: More frequent updates during active trading
    const now = Date.now();
    const throttleDelay = marketState.isRunning ? 300 : 1000; // 300ms during contest, 1s otherwise
    if (now - lastUpdateRef.current < throttleDelay) {
      return;
    }
    lastUpdateRef.current = now;

    try {
      if (chartType === 'candlestick') {
        const candles = createCandles(rawDataRef.current, 30);
        console.log(`🕯️ ${symbol}: Updating chart with ${candles.length} candles from ${rawDataRef.current.length} ticks`);
        
        if (candles.length > 0) {
          seriesRef.current.setData(candles);
          
          // Auto-scroll to show recent candles (last 20)
          if (chartRef.current && candles.length > 1) {
            setTimeout(() => {
              try {
                const timeScale = chartRef.current?.timeScale();
                const lastCandle = candles[candles.length - 1];
                
                if (candles.length > 20) {
                  const visibleRange = {
                    from: candles[candles.length - 20].time as any,
                    to: (lastCandle.time + 60) as any // Show a bit ahead
                  };
                  timeScale?.setVisibleRange(visibleRange);
                } else {
                  timeScale?.fitContent();
                }
              } catch (e) {
                console.debug('Auto-scroll error:', e);
              }
            }, 100);
          }
          
          setError('');
        } else {
          setError('No candle data generated');
        }
      } else {
        const lineData = createLineData(rawDataRef.current);
        console.log(`📈 ${symbol}: Updating line chart with ${lineData.length} points`);
        
        if (lineData.length > 0) {
          seriesRef.current.setData(lineData);
          
          // Auto-scroll for line chart
          if (chartRef.current && lineData.length > 100) {
            setTimeout(() => {
              try {
                const timeScale = chartRef.current?.timeScale();
                const lastPoint = lineData[lineData.length - 1];
                const startPoint = lineData[Math.max(0, lineData.length - 100)];
                
                const visibleRange = {
                  from: startPoint.time as any,
                  to: (lastPoint.time + 60) as any
                };
                timeScale?.setVisibleRange(visibleRange);
              } catch (e) {
                console.debug('Line chart auto-scroll error:', e);
              }
            }, 100);
          }
          
          setError('');
        } else {
          setError('No line data generated');
        }
      }
    } catch (error) {
      console.error('❌ Chart update error:', error);
      setError('Failed to update chart');
    }
  }, [chartType, createCandles, createLineData, symbol, marketState.isRunning]);

  // ENHANCED: Chart type switching with proper cleanup
  useEffect(() => {
    console.log(`🔄 Chart type changed to: ${chartType} for ${symbol}`);
    
    // Clean up existing chart
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
    
    // Initialize new chart with delay to ensure DOM is ready
    const initTimeout = setTimeout(() => {
      if (!isDisposedRef.current) {
        initializeChart();
        
        // Update with existing data
        const updateTimeout = setTimeout(() => {
          if (rawDataRef.current.length > 0 && !isDisposedRef.current) {
            updateChartData();
          }
        }, 100);
        
        return () => clearTimeout(updateTimeout);
      }
    }, 50);
    
    return () => clearTimeout(initTimeout);
  }, [chartType, initializeChart, updateChartData]);

  // ENHANCED: Symbol and data management with real-time updates
  useEffect(() => {
    if (!symbol || !socket) return;

    let mounted = true;
    console.log(`🔄 Setting up ${symbol} data and real-time updates`);

    const loadData = async () => {
      try {
        setLoading(true);
        setError('');
        
        console.log(`📊 Loading contest data for ${symbol}...`);
        
        // Load complete contest data from Time 0
        const response = await apiService.getContestData(symbol, 0, marketState.currentDataTick || undefined);
        
        if (response.data && response.data.length > 0 && mounted) {
          rawDataRef.current = response.data;
          console.log(`✅ Loaded ${response.data.length} data points for ${symbol}`);
          console.log(`📊 Sample tick:`, response.data[0]);
          
          // Wait for chart initialization then update
          const waitForChart = () => {
            if (chartInitializedRef.current && seriesRef.current) {
              updateChartData();
            } else if (mounted) {
              setTimeout(waitForChart, 100);
            }
          };
          waitForChart();
          
        } else if (mounted) {
          console.log(`⚠️ No data available for ${symbol}`);
          setError(`No data available for ${symbol}`);
          rawDataRef.current = [];
        }
      } catch (error: any) {
        console.error(`❌ Failed to load data for ${symbol}:`, error);
        if (mounted) {
          setError(error.response?.data?.error || 'Failed to load data');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    // WebSocket subscription management
    if (currentSymbolRef.current !== symbol) {
      // Unsubscribe from previous symbol
      if (currentSymbolRef.current && subscribedRef.current) {
        console.log(`📉 Unsubscribing from ${currentSymbolRef.current}`);
        socket.emit('unsubscribe_symbols', [currentSymbolRef.current]);
      }
      
      // Subscribe to new symbol
      console.log(`📈 Subscribing to ${symbol} real-time updates`);
      socket.emit('subscribe_symbols', [symbol]);
      currentSymbolRef.current = symbol;
      subscribedRef.current = true;
    }

    // ENHANCED: Real-time event handlers
    const handleSymbolTick = (data: any) => {
      if (data.symbol === symbol && data.data && mounted) {
        // Add new tick with existing OHLC data
        rawDataRef.current.push(data.data);
        
        console.log(`🔔 ${symbol} new tick: LTP=₹${data.data.last_traded_price} OHLC=${data.data.open_price}/${data.data.high_price}/${data.data.low_price}/${data.data.close_price}`);
        
        // Trigger chart update
        if (!isDisposedRef.current) {
          // Use requestAnimationFrame for smooth updates
          requestAnimationFrame(() => {
            if (mounted && !isDisposedRef.current) {
              updateChartData();
            }
          });
        }
      }
    };

    const handleContestData = (data: any) => {
      if (data.symbol === symbol && data.data && mounted) {
        console.log(`📊 ${symbol}: Full contest data received (${data.data.length} points from Time 0)`);
        rawDataRef.current = data.data;
        updateChartData();
      }
    };

    const handleMarketTick = (data: any) => {
      if (data.prices && data.prices[symbol] && mounted && rawDataRef.current.length > 0) {
        // Update the last tick's LTP if it changed significantly
        const lastTick = rawDataRef.current[rawDataRef.current.length - 1];
        const newPrice = data.prices[symbol];
        
        if (lastTick && Math.abs(lastTick.last_traded_price - newPrice) > 0.01) {
          // Create synthetic tick to keep charts moving
          const syntheticTick = {
            ...lastTick,
            last_traded_price: newPrice,
            close_price: newPrice, // Update close price too
            timestamp: new Date().toISOString(),
            volume_traded: 0, // Mark as synthetic
            synthetic: true
          };
          
          rawDataRef.current.push(syntheticTick);
          
          // Throttled update for market-wide ticks
          setTimeout(() => {
            if (mounted && !isDisposedRef.current) {
              updateChartData();
            }
          }, 200);
        }
      }
    };

    // Set up socket event listeners
    if (socket) {
      socket.on('symbol_tick', handleSymbolTick);
      socket.on('contest_data', handleContestData);
      socket.on('market_tick', handleMarketTick);
    }

    // Auto-refresh for continuous smooth updates
    const refreshInterval = setInterval(() => {
      if (mounted && !isDisposedRef.current && rawDataRef.current.length > 0 && marketState.isRunning) {
        updateChartData();
      }
    }, 2000); // Refresh every 2 seconds during contest

    // Load initial data
    loadData();

    return () => {
      mounted = false;
      clearInterval(refreshInterval);
      if (socket) {
        socket.off('symbol_tick', handleSymbolTick);
        socket.off('contest_data', handleContestData);
        socket.off('market_tick', handleMarketTick);
      }
    };
  }, [symbol, socket, updateChartData, marketState.isRunning]);

  // Component cleanup
  useEffect(() => {
    isDisposedRef.current = false;

    return () => {
      console.log(`🧹 Cleaning up chart for ${symbol}`);
      isDisposedRef.current = true;
      
      // Cleanup chart
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          console.debug('Cleanup error:', e);
        }
      }
      
      // Cleanup resize observer
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      
      // Cleanup WebSocket subscription
      if (socket && subscribedRef.current && currentSymbolRef.current) {
        socket.emit('unsubscribe_symbols', [currentSymbolRef.current]);
        subscribedRef.current = false;
      }
    };
  }, [socket]);

  // Price calculations using your database fields
  const currentPrice = lastTickData.get(symbol)?.price || 
    (rawDataRef.current.length > 0 ? parseFloat(rawDataRef.current[rawDataRef.current.length - 1]?.last_traded_price) : 0);
  
  const firstPrice = rawDataRef.current.length > 0 ? parseFloat(rawDataRef.current[0]?.last_traded_price) : 0;
  const priceChange = currentPrice - firstPrice;
  const priceChangePercent = firstPrice ? (priceChange / firstPrice) * 100 : 0;

  // Get price range from your OHLC data
  const getPriceRange = () => {
    if (rawDataRef.current.length === 0) return { min: 0, max: 0 };
    
    let min = Infinity;
    let max = -Infinity;
    
    rawDataRef.current.forEach(tick => {
      const low = parseFloat(tick.low_price) || parseFloat(tick.last_traded_price);
      const high = parseFloat(tick.high_price) || parseFloat(tick.last_traded_price);
      min = Math.min(min, low);
      max = Math.max(max, high);
    });
    
    return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
  };

  const priceRange = getPriceRange();

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      {/* ENHANCED Header with Angel One API data info */}
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
              Using Angel One API OHLC data • 30-second intervals
            </div>
          </div>
          
          {/* Enhanced Status Indicators */}
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
                  {marketState.isPaused ? '⏸️ Paused' : '▶️ Live'} @ {marketState.speed}x
                </span>
                <span className="text-purple-400">
                  Ticks: {rawDataRef.current.length}
                </span>
                {chartType === 'candlestick' && rawDataRef.current.length > 0 && (
                  <span className="text-orange-400">
                    Candles: {createCandles(rawDataRef.current).length}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Progress Bar for Contest */}
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

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
          ⚠️ {error}
          <button 
            onClick={async () => {
              setError('');
              setLoading(true);
              try {
                const { data } = await apiService.getContestData(symbol, 0, marketState.currentDataTick || undefined);
                if (data.data && data.data.length > 0) {
                  rawDataRef.current = data.data;
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

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center h-[500px] bg-gray-800 rounded-lg">
          <div className="flex flex-col items-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <div className="text-gray-400">Loading {chartType} chart from Angel One API...</div>
            <div className="text-xs text-gray-500">Processing OHLC data for {symbol}</div>
          </div>
        </div>
      )}
      
      {/* Chart Container - Fixed sizing */}
      <div 
        ref={chartContainerRef} 
        className={`w-full transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
        style={{ 
          height: '500px',
          minHeight: '500px',
          display: loading ? 'none' : 'block'
        }} 
      />
      
      {/* ENHANCED Chart Statistics using your database fields */}
      {!loading && rawDataRef.current.length > 0 && (
        <div className="mt-4 p-4 bg-blue-900/20 border border-blue-700 rounded-lg">
          <h4 className="text-blue-400 font-semibold mb-3">📊 Chart Analytics</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-blue-300">Raw Ticks:</span>
              <span className="text-white ml-2 font-semibold">{rawDataRef.current.length}</span>
            </div>
            {chartType === 'candlestick' && (
              <div>
                <span className="text-blue-300">30s Candles:</span>
                <span className="text-white ml-2 font-semibold">{createCandles(rawDataRef.current).length}</span>
              </div>
            )}
            <div>
              <span className="text-blue-300">Price Range:</span>
              <span className="text-white ml-2">₹{priceRange.min.toFixed(2)} - ₹{priceRange.max.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-blue-300">Data Source:</span>
              <span className="text-green-400 ml-2">Angel One API</span>
            </div>
          </div>
          
          {/* Real-time Update Status */}
          <div className="mt-3 pt-3 border-t border-blue-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-blue-300">Real-time Updates:</span>
              <span className={`font-semibold ${subscribedRef.current ? 'text-green-400' : 'text-red-400'}`}>
                {subscribedRef.current ? '🔴 Live' : '⚫ Offline'}
              </span>
            </div>
            {marketState.contestStartTime && (
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-blue-300">Contest Time 0:</span>
                <span className="text-white">{new Date(marketState.contestStartTime).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* No Data State */}
      {!loading && !error && rawDataRef.current.length === 0 && (
        <div className="flex justify-center items-center h-[500px] bg-gray-800 rounded-lg">
          <div className="text-center">
            <div className="text-6xl mb-4">📊</div>
            <div className="text-gray-400 text-lg">No Data Available</div>
            <div className="text-gray-500 text-sm">
              {marketState.isRunning ? 'Waiting for live data...' : 'Start the contest to see live charts'}
            </div>
            <div className="text-xs text-gray-600 mt-2">
              Expected: Angel One API OHLC data for {symbol}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};