// backend/utils/timeframeUtils.js

/**
 * Utility functions for handling multiple timeframes
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
 * Parse clean timestamp from database
 */
export function parseCleanTimestamp(timestamp) {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      console.warn('Invalid timestamp:', timestamp);
      return Math.floor(Date.now() / 1000);
    }
    return Math.floor(date.getTime() / 1000);
  } catch (error) {
    console.error('Error parsing timestamp:', timestamp, error);
    return Math.floor(Date.now() / 1000);
  }
}

/**
 * Aggregate ticks into candles for specified timeframe
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
  
  console.log(`🕯️ Aggregating ${ticks.length} ticks to ${timeframeKey} candles (${intervalSeconds}s intervals)`);
  
  // Sort ticks by timestamp to ensure proper order
  const sortedTicks = [...ticks].sort((a, b) => {
    const timeA = parseCleanTimestamp(a.timestamp);
    const timeB = parseCleanTimestamp(b.timestamp);
    return timeA - timeB;
  });
  
  sortedTicks.forEach((tick, index) => {
    try {
      const tickTime = parseCleanTimestamp(tick.timestamp);
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
        candleMap.set(bucketTime, {
          time: bucketTime,
          open: open || price,
          high: Math.max(high, price),
          low: Math.min(low, price),
          close: price,
          volume: volume,
          tickCount: 1,
          symbol: tick.symbol
        });
      } else {
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
  
  console.log(`✅ Created ${candles.length} ${timeframeKey} candles from ${sortedTicks.length} ticks`);
  
  return candles;
}

/**
 * Get timeframe in milliseconds
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
 * Get candle bucket time for a given timestamp and timeframe
 */
export function getCandleBucketTime(timestamp, timeframeKey) {
  const timeframe = TIMEFRAMES[timeframeKey];
  if (!timeframe) return null;
  
  const tickTime = parseCleanTimestamp(timestamp);
  return Math.floor(tickTime / timeframe.seconds) * timeframe.seconds;
}