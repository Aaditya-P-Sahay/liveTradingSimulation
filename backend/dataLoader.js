// backend/dataLoader.js - FIXED TO USE LTP INSTEAD OF FROZEN OHLC
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
    this.symbolPointers = new Map();
    this.windowBoundaries = {
      current: null,
      next: null
    };
    this.dataStartTime = null;
    this.dataEndTime = null;
    this.symbols = [];
    this.isLoading = false;
  }

  async initialize() {
    console.log('📊 DataLoader: Initializing with LTP-based OHLC generation...');

    try {
      // Enhanced symbol discovery with multiple sampling points
      const symbolSet = new Set();
      let totalRowsFetched = 0;
      
      console.log('🔍 Discovering symbols from database...');
      
      // Sample from beginning, middle, and end of data to catch all symbols
      const sampleOffsets = [0, 50000, 100000, 150000, 200000];
      
      for (const offset of sampleOffsets) {
        const { data: symbolRows, error: symError } = await supabaseAdmin
          .from('LALAJI')
          .select('symbol')
          .order('timestamp', { ascending: true })
          .range(offset, offset + 9999);

        if (symError) {
          console.error(`❌ Symbol query at offset ${offset} error:`, symError);
          continue;
        }

        if (symbolRows && symbolRows.length > 0) {
          symbolRows.forEach(row => {
            if (row && row.symbol && typeof row.symbol === 'string') {
              symbolSet.add(row.symbol.trim());
            }
          });
          totalRowsFetched += symbolRows.length;
          
          console.log(`   Offset ${offset}: Found ${symbolSet.size} unique symbols so far`);
        }
        
        // Early exit if we got fewer rows than requested (reached end)
        if (symbolRows && symbolRows.length < 10000) {
          console.log(`   Reached end of data at offset ${offset}`);
          break;
        }
      }

      this.symbols = Array.from(symbolSet).filter(Boolean).sort();
      
      console.log(`✅ Symbol Discovery Complete: Found ${this.symbols.length} symbols`);
      console.log(`   Symbols: ${this.symbols.join(', ')}`);
      console.log(`   Total rows sampled: ${totalRowsFetched.toLocaleString()}`);
      
      if (this.symbols.length === 0) {
        throw new Error('No symbols found in database');
      }

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

      console.log(`⏰ Data span: ${new Date(this.dataStartTime).toISOString()} to ${new Date(this.dataEndTime).toISOString()}`);
      console.log(`   Duration: ${((this.dataEndTime - this.dataStartTime) / (1000 * 60 * 60)).toFixed(2)} hours`);

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

        for (const row of batch) {
          if (!row.symbol) continue;

          const symbolData = windowData.get(row.symbol);
          if (symbolData) {
            // CRITICAL FIX: Use last_traded_price for ALL OHLC values
            // This ensures we get real price movement instead of frozen database OHLC
            const ltp = parseFloat(row.last_traded_price);
            
            // Validate LTP
            if (!ltp || isNaN(ltp) || ltp <= 0) {
              console.warn(`⚠️ Invalid LTP for ${row.symbol} at ${row.timestamp}: ${row.last_traded_price}`);
              continue;
            }

            symbolData.push({
              timestamp_ms: new Date(row.timestamp).getTime(),
              // FIXED: All OHLC fields now use LTP
              // When generateBaseCandle() processes multiple ticks:
              // - open = first tick's LTP
              // - high = max(all ticks' LTP)
              // - low = min(all ticks' LTP)
              // - close = last tick's LTP
              // This creates proper moving candles instead of flat ones
              open: ltp,
              high: ltp,
              low: ltp,
              close: ltp,
              volume: parseInt(row.volume_traded) || 0
            });
          }
        }

        totalLoaded += batch.length;
        batchCount++;
        offset += batch.length;

        if (batchCount % 5 === 0) {
          console.log(`   Batch ${batchCount}: +${batch.length} rows (Total: ${totalLoaded})`);
        }

        // Break if we got fewer rows than the limit (reached end of window)
        if (batch.length < SUPABASE_BATCH_LIMIT) break;

        // Safety check - prevent infinite loops
        if (batchCount > 100) {
          console.warn('⚠️ Exceeded max batches (100), stopping window load');
          break;
        }
      }

      // Reset pointers for new window
      this.symbolPointers.clear();

      // Store loaded data with validation
      let validSymbolCount = 0;
      for (const [symbol, data] of windowData.entries()) {
        if (data.length === 0) {
          // Symbol had no ticks in this window - this is normal
          this.loadedWindows.set(symbol, []);
          this.symbolPointers.set(symbol, 0);
          continue;
        }

        // Sort by timestamp to ensure chronological order
        const sortedData = data.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
        
        // Validate: Check for actual price variation
        const uniquePrices = new Set(sortedData.map(t => t.close));
        const priceRange = Math.max(...sortedData.map(t => t.close)) - Math.min(...sortedData.map(t => t.close));
        
        this.loadedWindows.set(symbol, sortedData);
        this.symbolPointers.set(symbol, 0);
        
        if (data.length > 0) {
          validSymbolCount++;
          console.log(`   ${symbol}: ${data.length} ticks, ${uniquePrices.size} unique prices, range: ${priceRange.toFixed(2)}`);
        }
      }

      this.windowBoundaries.current = windowStartTime;
      this.windowBoundaries.next = windowEndTime;

      console.log(`✅ Window loaded: ${totalLoaded} rows in ${batchCount} batches`);
      console.log(`   ${validSymbolCount} symbols with data in this window`);

    } catch (error) {
      console.error('❌ Window loading failed:', error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  getTicksInRange(symbol, startTime, endTime) {
    const symbolData = this.loadedWindows.get(symbol);
    if (!symbolData || symbolData.length === 0) {
      return { ticks: [], nextPointer: 0 };
    }

    let pointerIndex = this.symbolPointers.get(symbol) || 0;
    const result = [];
    let i = pointerIndex;

    // Skip to start time (pointer system preserved)
    while (i < symbolData.length && symbolData[i].timestamp_ms < startTime) {
      i++;
    }

    // Collect ticks in range
    while (i < symbolData.length && symbolData[i].timestamp_ms < endTime) {
      result.push(symbolData[i]);
      i++;
    }

    // Update pointer for next call
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

  // Non-blocking window loading (fire and forget)
  async loadNextWindowIfNeeded(currentContestTime) {
    if (this.shouldLoadNextWindow(currentContestTime) && !this.isLoading) {
      console.log('🔄 Loading next window in background...');
      // Fire and forget - caller should not await this
      return this.loadWindow(this.windowBoundaries.next);
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