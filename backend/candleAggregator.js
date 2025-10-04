// backend/candleAggregator.js

export class CandleAggregator {
  constructor() {
    this.candleCache = new Map();
    // FIXED: Complete aggregation chain
    this.aggregationConfig = {
      '30s': { from: '5s', count: 6 },
      '1m': { from: '30s', count: 2 },
      '3m': { from: '1m', count: 3 },
      '5m': { from: '1m', count: 5 }
    };
  }

  // Generate base 5s candle from raw ticks with OHLC logging
  generateBaseCandle(ticks, timestamp, symbol) {
    if (!ticks || ticks.length === 0) return null;

    const candle = {
      time: timestamp,
      open: ticks[0].open,
      high: Math.max(...ticks.map(t => t.high)),
      low: Math.min(...ticks.map(t => t.low)),
      close: ticks[ticks.length - 1].close,
      volume: ticks.reduce((sum, t) => sum + t.volume, 0),
      tickCount: ticks.length
    };

    // OHLC LOGGING AS REQUESTED
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

    // Keep only last 1000 candles to prevent memory bloat
    if (candles.length > 1000) {
      candles.shift();
    }

    return candle;
  }

  getCandles(symbol, timeframe) {
    const key = `${symbol}:${timeframe}`;
    return this.candleCache.get(key) || [];
  }

  // Aggregate higher timeframe candle from lower timeframe candles
  tryAggregate(symbol, timeframe) {
    const config = this.aggregationConfig[timeframe];
    if (!config) return null;

    const sourceCandles = this.getCandles(symbol, config.from);

    // Need exactly 'count' candles to aggregate
    if (sourceCandles.length < config.count) return null;

    // Take last N candles
    const candlesToAggregate = sourceCandles.slice(-config.count);

    // Check if they're consecutive (no gaps)
    const sourceInterval = this.getTimeframeSeconds(config.from);
    for (let i = 1; i < candlesToAggregate.length; i++) {
      const expectedTime = candlesToAggregate[i - 1].time + sourceInterval;
      // TOLERANCE FIX: use 0.5s tolerance (since times are exact bucket-ends in seconds)
      if (Math.abs(candlesToAggregate[i].time - expectedTime) > 0.5) {
        return null; // Gap detected
      }
    }

    // Aggregate OHLC
    const aggregated = {
      time: candlesToAggregate[candlesToAggregate.length - 1].time,
      open: candlesToAggregate[0].open,
      high: Math.max(...candlesToAggregate.map(c => c.high)),
      low: Math.min(...candlesToAggregate.map(c => c.low)),
      close: candlesToAggregate[candlesToAggregate.length - 1].close,
      volume: candlesToAggregate.reduce((sum, c) => sum + c.volume, 0),
      tickCount: candlesToAggregate.reduce((sum, c) => sum + (c.tickCount || 0), 0),
      aggregatedFrom: config.from
    };

    // OHLC LOGGING FOR AGGREGATED CANDLES
    console.log(`      📊 ${symbol} ${timeframe}: O=${aggregated.open.toFixed(2)} H=${aggregated.high.toFixed(2)} L=${aggregated.low.toFixed(2)} C=${aggregated.close.toFixed(2)} Vol=${aggregated.volume} (from ${config.count}x${config.from})`);

    return aggregated;
  }

  getTimeframeSeconds(timeframe) {
    const map = {
      '5s': 5,
      '30s': 30,
      '1m': 60,
      '3m': 180,
      '5m': 300
    };
    return map[timeframe] || 0;
  }

  // Process aggregation cascade after base candle is created
  processAggregationCascade(symbol, baseTimeframe) {
    const aggregated = [];

    // Try to aggregate each higher timeframe
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
  }

  clearAll() {
    this.candleCache.clear();
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
      memoryMB: Math.round((totalCandles * 80) / 1024 / 1024)
    };
  }
}

export default CandleAggregator;
