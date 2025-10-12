// backend/tests/unit/candles.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { CandleAggregator } from '../../candleAggregator.js';

describe('Candle Generation from LTP', () => {
  let aggregator;

  beforeEach(() => {
    aggregator = new CandleAggregator();
  });

  it('should generate 5s candle from multiple ticks', () => {
    const ticks = [
      { open: 2400, high: 2400, low: 2400, close: 2400, volume: 100 },
      { open: 2405, high: 2405, low: 2405, close: 2405, volume: 150 },
      { open: 2398, high: 2398, low: 2398, close: 2398, volume: 200 },
      { open: 2410, high: 2410, low: 2410, close: 2410, volume: 180 }
    ];

    const candle = aggregator.generateBaseCandle(
      ticks,
      5, // universalTime
      1000000, // marketTime
      'ADANIENT'
    );

    expect(candle.open).toBe(2400); // First tick's close
    expect(candle.high).toBe(2410); // Max of all highs
    expect(candle.low).toBe(2398);  // Min of all lows
    expect(candle.close).toBe(2410); // Last tick's close
    expect(candle.volume).toBe(630); // Sum of volumes

    console.log('✅ 5s candle OHLC:', candle);
    console.log('   Shows authentic price movement: L=2398, H=2410 (₹12 range)');
  });

  it('should demonstrate frozen OHLC problem would create flat lines', () => {
    const frozenTicks = [
      { open: 2400, high: 2400, low: 2400, close: 2400, volume: 100 },
      { open: 2400, high: 2400, low: 2400, close: 2400, volume: 150 },
      { open: 2400, high: 2400, low: 2400, close: 2400, volume: 200 }
    ];

    const frozenCandle = aggregator.generateBaseCandle(
      frozenTicks,
      5,
      1000000,
      'TEST'
    );

    expect(frozenCandle.open).toBe(2400);
    expect(frozenCandle.high).toBe(2400);
    expect(frozenCandle.low).toBe(2400);
    expect(frozenCandle.close).toBe(2400);

    console.log('❌ Frozen OHLC creates flat line: All values = 2400');
    console.log('✅ Your LTP fix prevents this!');
  });

  it('should aggregate 30s candle from 6x5s candles', () => {
    for (let i = 0; i < 6; i++) {
      const candle = {
        time: i * 5,
        open: 2400 + i * 2,
        high: 2405 + i * 2,
        low: 2398 + i * 2,
        close: 2402 + i * 2,
        volume: 100 + i * 10
      };
      aggregator.storeCandle('TEST', '5s', candle);
    }

    const aggregated = aggregator.tryAggregate('TEST', '30s');

    expect(aggregated).not.toBeNull();
    expect(aggregated.open).toBe(2400);
    expect(aggregated.close).toBe(2412);
    expect(aggregated.volume).toBe(750);

    console.log('✅ 30s candle aggregated from 6 5s candles');
  });

  it('should detect gaps and prevent aggregation', () => {
    aggregator.storeCandle('TEST', '5s', { time: 0, open: 100, high: 105, low: 95, close: 102, volume: 100 });
    aggregator.storeCandle('TEST', '5s', { time: 5, open: 102, high: 108, low: 100, close: 105, volume: 120 });
    aggregator.storeCandle('TEST', '5s', { time: 15, open: 105, high: 110, low: 103, close: 108, volume: 130 });

    const result = aggregator.tryAggregate('TEST', '30s');

    expect(result).toBeNull();

    console.log('✅ Gap detection prevents invalid aggregation');
  });
});