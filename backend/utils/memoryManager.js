// backend/utils/memoryManager.js

/**
 * FIXED: Memory management utilities for handling large datasets efficiently
 */

const MEMORY_LIMITS = {
  MAX_TICKS_PER_SYMBOL: 100000,     // INCREASED: Handle more ticks per symbol
  MAX_CANDLES_PER_TIMEFRAME: 50000,  // INCREASED: Handle more candles
  CLEANUP_INTERVAL: 300000,          // INCREASED: Cleanup every 5 minutes
  BATCH_SIZE: 5000                   // INCREASED: Process in larger batches
};

export class MemoryManager {
  constructor() {
    this.tickData = new Map();           // symbol -> tick[]
    this.candleData = new Map();         // symbol:timeframe -> candle[]
    this.memoryStats = {
      totalTicks: 0,
      totalCandles: 0,
      lastCleanup: Date.now(),
      peakMemoryMB: 0,
      currentMemoryMB: 0
    };
    
    // ENHANCED: Memory monitoring
    this.memoryThresholdMB = 500; // 500MB threshold
    this.isCleanupRunning = false;
    
    this.startCleanupInterval();
    this.startMemoryMonitoring();
  }
  
  /**
   * ENHANCED: Add tick data with efficient memory management
   */
  addTick(symbol, tick) {
    if (!this.tickData.has(symbol)) {
      this.tickData.set(symbol, []);
    }
    
    const ticks = this.tickData.get(symbol);
    ticks.push({
      ...tick,
      addedAt: Date.now() // Track when added for cleanup
    });
    
    // FIXED: More efficient memory limit enforcement
    if (ticks.length > MEMORY_LIMITS.MAX_TICKS_PER_SYMBOL) {
      const removeCount = Math.floor(MEMORY_LIMITS.MAX_TICKS_PER_SYMBOL * 0.1); // Remove 10%
      ticks.splice(0, removeCount);
      console.log(`🧹 OPTIMIZED: Removed ${removeCount} old ticks for ${symbol}`);
    }
    
    this.memoryStats.totalTicks++;
    this.checkMemoryUsage();
  }
  
  /**
   * ENHANCED: Add candle data with efficient memory management
   */
  addCandle(symbol, timeframe, candle) {
    const key = `${symbol}:${timeframe}`;
    
    if (!this.candleData.has(key)) {
      this.candleData.set(key, []);
    }
    
    const candles = this.candleData.get(key);
    
    // FIXED: Check if we should update existing candle or add new one
    const lastCandle = candles[candles.length - 1];
    if (lastCandle && lastCandle.time === candle.time) {
      // Update existing candle
      candles[candles.length - 1] = { 
        ...lastCandle, 
        ...candle,
        updatedAt: Date.now() 
      };
    } else {
      // Add new candle
      candles.push({
        ...candle,
        addedAt: Date.now()
      });
    }
    
    // FIXED: More efficient memory limit enforcement
    if (candles.length > MEMORY_LIMITS.MAX_CANDLES_PER_TIMEFRAME) {
      const removeCount = Math.floor(MEMORY_LIMITS.MAX_CANDLES_PER_TIMEFRAME * 0.1); // Remove 10%
      candles.splice(0, removeCount);
      console.log(`🧹 OPTIMIZED: Removed ${removeCount} old candles for ${key}`);
    }
    
    this.memoryStats.totalCandles++;
    this.checkMemoryUsage();
  }
  
  /**
   * Get tick data for symbol with range support
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
   * ENHANCED: Get comprehensive memory statistics
   */
  getMemoryStats() {
    const memUsage = process.memoryUsage();
    const currentMemoryMB = memUsage.heapUsed / 1024 / 1024;
    
    this.memoryStats.currentMemoryMB = currentMemoryMB;
    if (currentMemoryMB > this.memoryStats.peakMemoryMB) {
      this.memoryStats.peakMemoryMB = currentMemoryMB;
    }
    
    const symbols = this.tickData.size;
    const candleKeys = this.candleData.size;
    const avgTicksPerSymbol = symbols > 0 ? this.memoryStats.totalTicks / symbols : 0;
    
    return {
      ...this.memoryStats,
      symbols,
      candleKeys,
      avgTicksPerSymbol,
      heapUsedMB: currentMemoryMB,
      heapTotalMB: memUsage.heapTotal / 1024 / 1024,
      externalMB: memUsage.external / 1024 / 1024,
      arrayBuffersMB: memUsage.arrayBuffers / 1024 / 1024,
      efficiency: this.calculateEfficiency()
    };
  }
  
  /**
   * ENHANCED: Calculate memory efficiency
   */
  calculateEfficiency() {
    const stats = this.memoryStats;
    const totalItems = stats.totalTicks + stats.totalCandles;
    const memoryPerItem = totalItems > 0 ? stats.currentMemoryMB / totalItems : 0;
    
    return {
      totalItems,
      memoryPerItemKB: memoryPerItem * 1024,
      utilizationPercent: (stats.currentMemoryMB / this.memoryThresholdMB) * 100
    };
  }
  
  /**
   * ENHANCED: Memory monitoring
   */
  startMemoryMonitoring() {
    setInterval(() => {
      this.checkMemoryUsage();
    }, 30000); // Check every 30 seconds
  }
  
  /**
   * ENHANCED: Check memory usage and trigger cleanup if needed
   */
  checkMemoryUsage() {
    const currentMemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
    
    if (currentMemoryMB > this.memoryThresholdMB && !this.isCleanupRunning) {
      console.log(`⚠️ Memory threshold exceeded: ${currentMemoryMB.toFixed(2)}MB > ${this.memoryThresholdMB}MB`);
      this.performAggressiveCleanup();
    }
  }
  
  /**
   * ENHANCED: Periodic cleanup
   */
  startCleanupInterval() {
    setInterval(() => {
      this.performCleanup();
    }, MEMORY_LIMITS.CLEANUP_INTERVAL);
  }
  
  /**
   * ENHANCED: Perform memory cleanup
   */
  performCleanup() {
    if (this.isCleanupRunning) return;
    
    this.isCleanupRunning = true;
    const beforeStats = this.getMemoryStats();
    
    try {
      // Clean old tick data (keep last 50% if over limit)
      for (const [symbol, ticks] of this.tickData.entries()) {
        if (ticks.length > MEMORY_LIMITS.MAX_TICKS_PER_SYMBOL * 0.8) {
          const keepCount = Math.floor(MEMORY_LIMITS.MAX_TICKS_PER_SYMBOL * 0.5);
          const removeCount = ticks.length - keepCount;
          ticks.splice(0, removeCount);
          console.log(`🧹 Cleaned ${removeCount} old ticks for ${symbol}`);
        }
      }
      
      // Clean old candle data (keep last 50% if over limit)
      for (const [key, candles] of this.candleData.entries()) {
        if (candles.length > MEMORY_LIMITS.MAX_CANDLES_PER_TIMEFRAME * 0.8) {
          const keepCount = Math.floor(MEMORY_LIMITS.MAX_CANDLES_PER_TIMEFRAME * 0.5);
          const removeCount = candles.length - keepCount;
          candles.splice(0, removeCount);
          console.log(`🧹 Cleaned ${removeCount} old candles for ${key}`);
        }
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const afterStats = this.getMemoryStats();
      this.memoryStats.lastCleanup = Date.now();
      
      console.log(`🧹 Memory cleanup completed:`, {
        before: `${beforeStats.heapUsedMB.toFixed(2)}MB`,
        after: `${afterStats.heapUsedMB.toFixed(2)}MB`,
        saved: `${(beforeStats.heapUsedMB - afterStats.heapUsedMB).toFixed(2)}MB`,
        symbols: afterStats.symbols,
        totalTicks: this.memoryStats.totalTicks,
        totalCandles: this.memoryStats.totalCandles
      });
      
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    } finally {
      this.isCleanupRunning = false;
    }
  }
  
  /**
   * ENHANCED: Aggressive cleanup for memory pressure
   */
  performAggressiveCleanup() {
    if (this.isCleanupRunning) return;
    
    console.log('🚨 Performing aggressive memory cleanup...');
    this.isCleanupRunning = true;
    
    try {
      // More aggressive cleanup - keep only 30% of data
      for (const [symbol, ticks] of this.tickData.entries()) {
        if (ticks.length > 1000) {
          const keepCount = Math.floor(ticks.length * 0.3);
          const removeCount = ticks.length - keepCount;
          ticks.splice(0, removeCount);
          console.log(`🚨 Aggressively cleaned ${removeCount} ticks for ${symbol}`);
        }
      }
      
      for (const [key, candles] of this.candleData.entries()) {
        if (candles.length > 1000) {
          const keepCount = Math.floor(candles.length * 0.3);
          const removeCount = candles.length - keepCount;
          candles.splice(0, removeCount);
          console.log(`🚨 Aggressively cleaned ${removeCount} candles for ${key}`);
        }
      }
      
      // Force garbage collection multiple times
      if (global.gc) {
        global.gc();
        setTimeout(() => global.gc(), 100);
        setTimeout(() => global.gc(), 500);
      }
      
    } catch (error) {
      console.error('❌ Error during aggressive cleanup:', error);
    } finally {
      this.isCleanupRunning = false;
    }
  }
  
  /**
   * ENHANCED: Get total memory footprint
   */
  getMemoryFootprint() {
    let totalSize = 0;
    
    // Estimate tick data size
    for (const [symbol, ticks] of this.tickData.entries()) {
      totalSize += ticks.length * 300; // ~300 bytes per tick estimate (increased)
    }
    
    // Estimate candle data size
    for (const [key, candles] of this.candleData.entries()) {
      totalSize += candles.length * 150; // ~150 bytes per candle estimate (increased)
    }
    
    return {
      estimatedBytes: totalSize,
      estimatedMB: totalSize / 1024 / 1024,
      actualHeapMB: process.memoryUsage().heapUsed / 1024 / 1024,
      efficiency: this.calculateEfficiency()
    };
  }
  
  /**
   * ENHANCED: Clear all data (for contest reset)
   */
  clearAllData() {
    console.log('🗑️ Clearing all memory data...');
    
    this.tickData.clear();
    this.candleData.clear();
    
    this.memoryStats = {
      totalTicks: 0,
      totalCandles: 0,
      lastCleanup: Date.now(),
      peakMemoryMB: 0,
      currentMemoryMB: 0
    };
    
    if (global.gc) {
      global.gc();
    }
    
    console.log('✅ All memory data cleared');
  }
}

export default MemoryManager;