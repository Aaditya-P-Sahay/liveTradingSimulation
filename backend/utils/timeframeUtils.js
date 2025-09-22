// backend/utils/timeframeUtils.js

/**
 * FIXED: Utility functions for handling multiple timeframes with proper math
 */

export const TIMEFRAMES = {
  '1s': { seconds: 1, label: '1 Second' },
  '5s': { seconds: 5, label: '5 Seconds' },
  '15s': { seconds: 15, label: '15 Seconds' },
  '30s': { seconds: 30, label: '30 Seconds' },
  '1m': { seconds: 60, label: '1 Minute' },
  '3m': { seconds: 180, label: '3 Minutes' },
  '5m': { seconds: 300, label: '5 Minutes' },
  '15m': { seconds: 900, label: '15 Minutes' }
};

export const DEFAULT_TIMEFRAME = '30s';

/**
 * FIXED: Parse clean timestamp from database (millisecond precision)
 */
export function parseCleanTimestamp(timestamp) {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      console.warn('Invalid timestamp:', timestamp);
      return Math.floor(Date.now() / 1000);
    }
    // FIXED: Return seconds with decimal precision for milliseconds
    return date.getTime() / 1000;
  } catch (error) {
    console.error('Error parsing timestamp:', timestamp, error);
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * FIXED: Create universal time mapper for 5x speed compression
 */
export function createUniversalTimeMapper(marketDataDurationMs, contestDurationMs) {
  const speedMultiplier = marketDataDurationMs / contestDurationMs; // 5x for 5hrs→1hr
  
  return {
    speedMultiplier,
    
    // Convert market time to contest universal time
    marketToUniversal: (marketTimeSeconds) => {
      return marketTimeSeconds / speedMultiplier;
    },
    
    // Convert contest universal time to market time
    universalToMarket: (universalTimeSeconds) => {
      return universalTimeSeconds * speedMultiplier;
    }
  };
}

/**
 * FIXED: Aggregate ticks into candles with proper OHLC logic
 */
export function aggregateTicksToCandles(ticks, timeframeKey = '30s') {
  if (!ticks || ticks.length === 0) return [];
  
  const timeframe = TIMEFRAMES[timeframeKey];
  if (!timeframe) {
    console.error('Invalid timeframe:', timeframeKey);
    return [];
  }
  
  const intervalSeconds = timeframe.seconds;
  const candleMap = new Map();
  
  console.log(`🕯️ FIXED: Aggregating ${ticks.length} ticks to ${timeframeKey} candles (${intervalSeconds}s intervals)`);
  
  // FIXED: Sort ticks by timestamp to ensure proper order
  const sortedTicks = [...ticks].sort((a, b) => {
    const timeA = parseCleanTimestamp(a.timestamp);
    const timeB = parseCleanTimestamp(b.timestamp);
    return timeA - timeB;
  });
  
  sortedTicks.forEach((tick, index) => {
    try {
      const tickTime = parseCleanTimestamp(tick.timestamp);
      
      // FIXED: Proper bucket time calculation with decimal precision
      const bucketTime = Math.floor(tickTime / intervalSeconds) * intervalSeconds;
      
      const price = parseFloat(tick.last_traded_price) || 0;
      const volume = parseInt(tick.volume_traded) || 0;
      const open = parseFloat(tick.open_price) || price;
      const high = parseFloat(tick.high_price) || price;
      const low = parseFloat(tick.low_price) || price;
      const close = parseFloat(tick.close_price) || price;
      
      if (price <= 0) {
        console.warn(`⚠️ Invalid price for tick ${index}: ${price}`);
        return;
      }
      
      if (!candleMap.has(bucketTime)) {
        // FIXED: Create new candle with proper OHLC initialization
        candleMap.set(bucketTime, {
          time: bucketTime,
          open: open,
          high: Math.max(high, price),
          low: Math.min(low, price),
          close: price,
          volume: volume,
          tickCount: 1,
          symbol: tick.symbol
        });
      } else {
        // FIXED: Update existing candle with proper OHLC accumulation
        const candle = candleMap.get(bucketTime);
        candle.high = Math.max(candle.high, high, price);
        candle.low = Math.min(candle.low, low, price);
        candle.close = price; // Always use the latest price as close
        candle.volume += volume;
        candle.tickCount++;
      }
    } catch (error) {
      console.error(`❌ Error processing tick ${index}:`, error);
    }
  });
  
  const candles = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
  
  console.log(`✅ FIXED: Created ${candles.length} ${timeframeKey} candles from ${sortedTicks.length} ticks`);
  
  return candles;
}

/**
 * FIXED: Get timeframe in milliseconds
 */
export function getTimeframeMs(timeframeKey) {
  const timeframe = TIMEFRAMES[timeframeKey];
  return timeframe ? timeframe.seconds * 1000 : TIMEFRAMES[DEFAULT_TIMEFRAME].seconds * 1000;
}

/**
 * Format timeframe for display
 */
export function formatTimeframe(timeframeKey) {
  const timeframe = TIMEFRAMES[timeframeKey];
  return timeframe ? timeframe.label : TIMEFRAMES[DEFAULT_TIMEFRAME].label;
}

/**
 * Validate timeframe
 */
export function isValidTimeframe(timeframeKey) {
  return timeframeKey && TIMEFRAMES.hasOwnProperty(timeframeKey);
}

/**
 * FIXED: Get candle bucket time for a given timestamp and timeframe
 */
export function getCandleBucketTime(timestamp, timeframeKey, isUniversalTime = false) {
  const timeframe = TIMEFRAMES[timeframeKey];
  if (!timeframe) return null;
  
  let timeSeconds;
  if (isUniversalTime) {
    // Timestamp is already in universal time seconds
    timeSeconds = timestamp;
  } else {
    // Parse timestamp string to seconds
    timeSeconds = parseCleanTimestamp(timestamp);
  }
  
  // FIXED: Proper bucket calculation
  return Math.floor(timeSeconds / timeframe.seconds) * timeframe.seconds;
}