// backend/dataLoader.js
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SUPABASE_BATCH_LIMIT = 1000;
const WINDOW_SIZE_MINUTES = 10;
const BUFFER_MINUTES = 2;

export class DataLoader {
  constructor() {
    this.loadedWindows = new Map();
    this.symbolPointers = new Map(); // Track read position for each symbol (centralized pointer)
    this.windowBoundaries = {
      current: null,
      next: null
    };
    this.dataStartTime = null;
    this.dataEndTime = null;
    this.symbols = [];
    this.isLoading = false;
  }

  // ✅ initialize: single large select + dedupe (instead of multiple offsets)
  async initialize() {
    console.log('📊 DataLoader: Initializing...');

    try {
      // TRY: Single large query and dedupe.
      const { data: symbolRows, error: symError } = await supabaseAdmin
        .from('LALAJI')
        .select('symbol')
        .limit(50000);

      if (symError) throw symError;

      this.symbols = [...new Set((symbolRows || []).map(row => row.symbol))].filter(Boolean).sort();
      console.log(`✅ Found ${this.symbols.length} symbols:`, this.symbols.join(', '));

      // Get time boundaries
      const { data: timeData, error: timeError } = await supabaseAdmin
        .from('LALAJI')
        .select('timestamp')
        .order('timestamp', { ascending: true })
        .limit(1);

      if (timeError) throw timeError;

      this.dataStartTime = new Date(timeData[0].timestamp).getTime();

      const { data: endData } = await supabaseAdmin
        .from('LALAJI')
        .select('timestamp')
        .order('timestamp', { ascending: false })
        .limit(1);

      this.dataEndTime = new Date(endData[0].timestamp).getTime();

      console.log(`⏰ Data span: ${new Date(this.dataStartTime).toLocaleString()} to ${new Date(this.dataEndTime).toLocaleString()}`);

      // Load first window
      await this.loadWindow(this.dataStartTime);

      return {
        symbols: this.symbols,
        dataStartTime: this.dataStartTime,
        dataEndTime: this.dataEndTime
      };

    } catch (error) {
      console.error('❌ DataLoader initialization failed:', error);
      throw error;
    }
  }

  async loadWindow(windowStartTime) {
    if (this.isLoading) {
      console.log('⏳ Already loading window, skipping...');
      return;
    }

    this.isLoading = true;
    const windowEndTime = windowStartTime + (WINDOW_SIZE_MINUTES * 60 * 1000);

    console.log(`📦 Loading window: ${new Date(windowStartTime).toLocaleTimeString()} to ${new Date(windowEndTime).toLocaleTimeString()}`);

    try {
      const windowData = new Map();
      this.symbols.forEach(symbol => windowData.set(symbol, []));

      let totalLoaded = 0;
      let offset = 0;
      let batchCount = 0;

      while (true) {
        const { data: batch, error } = await supabaseAdmin
          .from('LALAJI')
          .select('*')
          .gte('timestamp', new Date(windowStartTime).toISOString())
          .lt('timestamp', new Date(windowEndTime).toISOString())
          .order('timestamp', { ascending: true })
          .range(offset, offset + SUPABASE_BATCH_LIMIT - 1);

        if (error) {
          console.error('❌ Batch query error:', error);
          break;
        }

        if (!batch || batch.length === 0) break;

        // Process batch
        for (const row of batch) {
          if (!row.symbol) continue;

          const symbolData = windowData.get(row.symbol);
          if (symbolData) {
            symbolData.push({
              timestamp_ms: new Date(row.timestamp).getTime(),
              open: parseFloat(row.open_price) || parseFloat(row.last_traded_price),
              high: parseFloat(row.high_price) || parseFloat(row.last_traded_price),
              low: parseFloat(row.low_price) || parseFloat(row.last_traded_price),
              close: parseFloat(row.close_price) || parseFloat(row.last_traded_price),
              volume: parseInt(row.volume_traded) || 0
            });
          }
        }

        totalLoaded += batch.length;
        batchCount++;
        offset += batch.length;

        console.log(`   Batch ${batchCount}: +${batch.length} rows (Total: ${totalLoaded})`);

        if (batch.length < SUPABASE_BATCH_LIMIT) break;

        if (batchCount > 100) {
          console.warn('⚠️ Exceeded max batches, stopping');
          break;
        }
      }

      // CRITICAL: Reset internal pointers when loading new window
      this.symbolPointers.clear();

      // Store loaded data and initialize internal pointers
      for (const [symbol, data] of windowData.entries()) {
        const sortedData = data.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
        this.loadedWindows.set(symbol, sortedData);
        this.symbolPointers.set(symbol, 0); // initialize internal pointer
        console.log(`   ${symbol}: ${data.length} ticks`);
      }

      this.windowBoundaries.current = windowStartTime;
      this.windowBoundaries.next = windowEndTime;

      console.log(`✅ Window loaded: ${totalLoaded} rows in ${batchCount} batches`);

    } catch (error) {
      console.error('❌ Window loading failed:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Centralized pointer-based tick retrieval (server should NOT maintain raw pointers)
   *
   * Returns { ticks: [...], nextPointer: <index> }
   */
  getTicksInRange(symbol, startTime, endTime) {
    const symbolData = this.loadedWindows.get(symbol);
    if (!symbolData || symbolData.length === 0) {
      return { ticks: [], nextPointer: 0 };
    }

    let pointerIndex = this.symbolPointers.get(symbol) || 0;
    const result = [];
    let i = pointerIndex;

    // Skip to start time (pointer may be before our window)
    while (i < symbolData.length && symbolData[i].timestamp_ms < startTime) {
      i++;
    }

    // Collect ticks in range
    while (i < symbolData.length && symbolData[i].timestamp_ms < endTime) {
      result.push(symbolData[i]);
      i++;
    }

    // Update pointer to end of this range (centralized)
    this.symbolPointers.set(symbol, i);

    return {
      ticks: result,
      nextPointer: i
    };
  }

  shouldLoadNextWindow(currentContestTime) {
    if (!this.windowBoundaries.current) return false;

    const bufferTime = BUFFER_MINUTES * 60 * 1000;
    const timeUntilWindowEnd = this.windowBoundaries.next - currentContestTime;

    return timeUntilWindowEnd < bufferTime;
  }

  async loadNextWindowIfNeeded(currentContestTime) {
    if (this.shouldLoadNextWindow(currentContestTime) && !this.isLoading) {
      console.log('🔄 Loading next window in background...');
      await this.loadWindow(this.windowBoundaries.next);
    }
  }

  getStats() {
    let totalTicks = 0;
    for (const [symbol, data] of this.loadedWindows.entries()) {
      totalTicks += data.length;
    }

    return {
      symbols: this.symbols.length,
      totalTicks,
      windowStart: this.windowBoundaries.current,
      windowEnd: this.windowBoundaries.next,
      memoryMB: Math.round((totalTicks * 100) / 1024 / 1024)
    };
  }
}

export default DataLoader;
