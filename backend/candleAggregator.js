// backend/candleAggregator.js

export class CandleAggregator {
  constructor() {
    this.candleCache = new Map();
    this.lastAggregatedIndex = new Map(); // Track which candles were already aggregated
    
    this.aggregationConfig = {
      '30s': { from: '5s', count: 6 },
      '1m': { from: '30s', count: 2 },
      '3m': { from: '1m', count: 3 },
      '5m': { from: '1m', count: 5 }
    };
    
    this.timeframeRealSeconds = {
      '5s': 5,
      '30s': 30,
      '1m': 60,
      '3m': 180,
      '5m': 300
    };
  }

  generateBaseCandle(ticks, universalTime, marketTime, symbol) {
    if (!ticks || ticks.length === 0) return null;

    const candle = {
      time: universalTime,
      market_time: marketTime,
      open: ticks[0].open,
      high: Math.max(...ticks.map(t => t.high)),
      low: Math.min(...ticks.map(t => t.low)),
      close: ticks[ticks.length - 1].close,
      volume: ticks.reduce((sum, t) => sum + t.volume, 0),
      tickCount: ticks.length
    };

    console.log(`      💹 ${symbol} 5s: O=${candle.open.toFixed(2)} H=${candle.high.toFixed(2)} L=${candle.low.toFixed(2)} C=${candle.close.toFixed(2)} Vol=${candle.volume} (${ticks.length} ticks)`);

    return candle;
  }

  storeCandle(symbol, timeframe, candle) {
    const key = `${symbol}:${timeframe}`;

    if (!this.candleCache.has(key)) {
      this.candleCache.set(key, []);
    }

    const candles = this.candleCache.get(key);
    candles.push(candle);

    if (candles.length > 1000) {
      candles.shift();
    }

    return candle;
  }

  getCandles(symbol, timeframe) {
    const key = `${symbol}:${timeframe}`;
    return this.candleCache.get(key) || [];
  }

  // FIXED: Track last aggregated position to prevent overlapping aggregations
  tryAggregate(symbol, timeframe) {
    const config = this.aggregationConfig[timeframe];
    if (!config) return null;

    const sourceCandles = this.getCandles(symbol, config.from);
    const trackingKey = `${symbol}:${config.from}→${timeframe}`;
    
    // Get last aggregated index (default to -1 if first time)
    const lastAggregatedIdx = this.lastAggregatedIndex.get(trackingKey) || -1;
    
    // We need at least 'count' NEW candles since last aggregation
    const availableNewCandles = sourceCandles.length - 1 - lastAggregatedIdx;
    
    if (availableNewCandles < config.count) {
      return null; // Not enough new candles yet
    }

    // Get the next batch of 'count' candles starting after last aggregated
    const startIdx = lastAggregatedIdx + 1;
    const endIdx = startIdx + config.count;
    
    if (endIdx > sourceCandles.length) {
      return null; // Not enough candles
    }

    const candlesToAggregate = sourceCandles.slice(startIdx, endIdx);

    // Validate we have exactly 'count' candles
    if (candlesToAggregate.length !== config.count) {
      return null;
    }

    // Check consecutiveness using universal time
    const sourceInterval = this.timeframeRealSeconds[config.from];
    
    for (let i = 1; i < candlesToAggregate.length; i++) {
      const expectedTime = candlesToAggregate[i - 1].time + sourceInterval;
      const actualTime = candlesToAggregate[i].time;
      
      if (Math.abs(actualTime - expectedTime) > 0.5) {
        // Gap detected - reset tracking and return null
        console.log(`      ⚠️ Gap detected in ${symbol} ${config.from} for ${timeframe} aggregation`);
        return null;
      }
    }

    // Aggregate OHLC
    const aggregated = {
      time: candlesToAggregate[candlesToAggregate.length - 1].time,
      market_time: candlesToAggregate[candlesToAggregate.length - 1].market_time,
      open: candlesToAggregate[0].open,
      high: Math.max(...candlesToAggregate.map(c => c.high)),
      low: Math.min(...candlesToAggregate.map(c => c.low)),
      close: candlesToAggregate[candlesToAggregate.length - 1].close,
      volume: candlesToAggregate.reduce((sum, c) => sum + c.volume, 0),
      tickCount: candlesToAggregate.reduce((sum, c) => sum + (c.tickCount || 0), 0),
      aggregatedFrom: config.from
    };

    // Update last aggregated index to the last candle we just used
    this.lastAggregatedIndex.set(trackingKey, endIdx - 1);

    console.log(`      📊 ${symbol} ${timeframe}: O=${aggregated.open.toFixed(2)} H=${aggregated.high.toFixed(2)} L=${aggregated.low.toFixed(2)} C=${aggregated.close.toFixed(2)} Vol=${aggregated.volume} (from ${config.count}x${config.from}, indices ${startIdx}-${endIdx-1})`);

    return aggregated;
  }

  processAggregationCascade(symbol, baseTimeframe) {
    const aggregated = [];

    // Try to aggregate all timeframes that depend on this base
    for (const [timeframe, config] of Object.entries(this.aggregationConfig)) {
      if (config.from === baseTimeframe) {
        const candle = this.tryAggregate(symbol, timeframe);
        if (candle) {
          this.storeCandle(symbol, timeframe, candle);
          aggregated.push({ timeframe, candle });

          // Recursively try higher timeframes
          const higher = this.processAggregationCascade(symbol, timeframe);
          aggregated.push(...higher);
        }
      }
    }

    return aggregated;
  }

  clearSymbol(symbol) {
    const timeframes = ['5s', '30s', '1m', '3m', '5m'];
    for (const tf of timeframes) {
      this.candleCache.delete(`${symbol}:${tf}`);
    }
    
    // Clear aggregation tracking for this symbol
    const keysToDelete = [];
    for (const key of this.lastAggregatedIndex.keys()) {
      if (key.startsWith(`${symbol}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.lastAggregatedIndex.delete(key));
  }

  clearAll() {
    this.candleCache.clear();
    this.lastAggregatedIndex.clear();
  }

  getStats() {
    let totalCandles = 0;
    const breakdown = {};

    for (const [key, candles] of this.candleCache.entries()) {
      totalCandles += candles.length;
      const [symbol, timeframe] = key.split(':');
      if (!breakdown[timeframe]) breakdown[timeframe] = 0;
      breakdown[timeframe] += candles.length;
    }

    return {
      totalCandles,
      breakdown,
      memoryMB: Math.round((totalCandles * 80) / 1024 / 1024),
      aggregationTracking: this.lastAggregatedIndex.size
    };
  }
}

export default CandleAggregator;