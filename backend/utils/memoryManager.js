// backend/utils/memoryManager.js

/**
 * Memory management utilities for handling large datasets
 */

const MEMORY_LIMITS = {
  MAX_TICKS_PER_SYMBOL: 50000,      // Keep last 50k ticks per symbol
  MAX_CANDLES_PER_TIMEFRAME: 10000,  // Keep last 10k candles per timeframe
  CLEANUP_INTERVAL: 60000,           // Cleanup every minute
  BATCH_SIZE: 1000                   // Process data in batches
};

export class MemoryManager {
  constructor() {
    this.tickData = new Map();           // symbol -> tick[]
    this.candleData = new Map();         // symbol:timeframe -> candle[]
    this.memoryStats = {
      totalTicks: 0,
      totalCandles: 0,
      lastCleanup: Date.now()
    };
    
    // Start periodic cleanup
    this.startCleanupInterval();
  }
  
  /**
   * Add tick data with memory management
   */
  addTick(symbol, tick) {
    if (!this.tickData.has(symbol)) {
      this.tickData.set(symbol, []);
    }
    
    const ticks = this.tickData.get(symbol);
    ticks.push(tick);
    
    // Maintain memory limit
    if (ticks.length > MEMORY_LIMITS.MAX_TICKS_PER_SYMBOL) {
      const removeCount = ticks.length - MEMORY_LIMITS.MAX_TICKS_PER_SYMBOL;
      ticks.splice(0, removeCount);
      console.log(`🧹 Cleaned ${removeCount} old ticks for ${symbol}`);
    }
    
    this.memoryStats.totalTicks++;
  }
  
  /**
   * Add candle data with memory management
   */
  addCandle(symbol, timeframe, candle) {
    const key = `${symbol}:${timeframe}`;
    
    if (!this.candleData.has(key)) {
      this.candleData.set(key, []);
    }
    
    const candles = this.candleData.get(key);
    
    // Check if we should update existing candle or add new one
    const lastCandle = candles[candles.length - 1];
    if (lastCandle && lastCandle.time === candle.time) {
      // Update existing candle
      candles[candles.length - 1] = { ...lastCandle, ...candle };
    } else {
      // Add new candle
      candles.push(candle);
    }
    
    // Maintain memory limit
    if (candles.length > MEMORY_LIMITS.MAX_CANDLES_PER_TIMEFRAME) {
      const removeCount = candles.length - MEMORY_LIMITS.MAX_CANDLES_PER_TIMEFRAME;
      candles.splice(0, removeCount);
      console.log(`🧹 Cleaned ${removeCount} old candles for ${key}`);
    }
    
    this.memoryStats.totalCandles++;
  }
  
  /**
   * Get tick data for symbol
   */
  getTicks(symbol, fromIndex = 0, toIndex = null) {
    const ticks = this.tickData.get(symbol) || [];
    const endIndex = toIndex !== null ? Math.min(toIndex + 1, ticks.length) : ticks.length;
    return ticks.slice(Math.max(0, fromIndex), endIndex);
  }
  
  /**
   * Get candle data for symbol and timeframe
   */
  getCandles(symbol, timeframe) {
    const key = `${symbol}:${timeframe}`;
    return this.candleData.get(key) || [];
  }
  
  /**
   * Get memory statistics
   */
  getMemoryStats() {
    const symbols = this.tickData.size;
    const candleKeys = this.candleData.size;
    const avgTicksPerSymbol = symbols > 0 ? this.memoryStats.totalTicks / symbols : 0;
    
    return {
      ...this.memoryStats,
      symbols,
      candleKeys,
      avgTicksPerSymbol,
      memoryUsageMB: process.memoryUsage().heapUsed / 1024 / 1024
    };
  }
  
  /**
   * Periodic cleanup
   */
  startCleanupInterval() {
    setInterval(() => {
      this.performCleanup();
    }, MEMORY_LIMITS.CLEANUP_INTERVAL);
  }
  
  /**
   * Perform memory cleanup
   */
  performCleanup() {
    const beforeStats = this.getMemoryStats();
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    const afterStats = this.getMemoryStats();
    this.memoryStats.lastCleanup = Date.now();
    
    console.log(`🧹 Memory cleanup completed:`, {
      before: `${beforeStats.memoryUsageMB.toFixed(2)}MB`,
      after: `${afterStats.memoryUsageMB.toFixed(2)}MB`,
      symbols: afterStats.symbols,
      totalTicks: this.memoryStats.totalTicks,
      totalCandles: this.memoryStats.totalCandles
    });
  }
  
  /**
   * Get total memory footprint
   */
  getMemoryFootprint() {
    let totalSize = 0;
    
    // Estimate tick data size
    for (const [symbol, ticks] of this.tickData.entries()) {
      totalSize += ticks.length * 200; // ~200 bytes per tick estimate
    }
    
    // Estimate candle data size
    for (const [key, candles] of this.candleData.entries()) {
      totalSize += candles.length * 100; // ~100 bytes per candle estimate
    }
    
    return {
      estimatedBytes: totalSize,
      estimatedMB: totalSize / 1024 / 1024,
      actualHeapMB: process.memoryUsage().heapUsed / 1024 / 1024
    };
  }
}

export default MemoryManager;