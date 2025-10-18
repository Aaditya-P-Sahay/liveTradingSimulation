// backend/index.js - COMPLETE FIXED VERSION WITH CONTEST RESET

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { DataLoader } from './dataLoader.js';
import { CandleAggregator } from './candleAggregator.js';
import { createUniversalTimeMapper } from './utils/timeframeUtils.js';

dotenv.config();

const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5174", "http://localhost:3000", "http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: ["http://localhost:5174", "http://localhost:3000", "http://localhost:5173"],
  credentials: true
}));
app.use(express.json());

const TIMEFRAMES = {
  '5s': { realSeconds: 5, dbSeconds: 25, label: '5 Seconds' },
  '30s': { realSeconds: 30, dbSeconds: 150, label: '30 Seconds' },
  '1m': { realSeconds: 60, dbSeconds: 300, label: '1 Minute' },
  '3m': { realSeconds: 180, dbSeconds: 900, label: '3 Minutes' },
  '5m': { realSeconds: 300, dbSeconds: 1500, label: '5 Minutes' }
};

const contestState = {
  isRunning: false,
  isPaused: false,
  contestId: null,
  contestStartTime: null,
  contestDurationMs: 60 * 60 * 1000,
  dataStartTimestamp: null,
  dataEndTimestamp: null,
  symbols: [],
  latestPrices: new Map(),
  timeMapper: null,
  candleGenerationInterval: null
};

const dataLoader = new DataLoader();
const candleAggregator = new CandleAggregator();

const connectedUsers = new Map();
const userSockets = new Map();
const portfolioCache = new Map();
let leaderboardCache = [];

// ============================================
// UTILITY: Safe Number Conversion
// ============================================
function toSafeNumber(value, defaultValue = 0) {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  
  if (typeof value === 'object') {
    console.warn('⚠️ Received object where number expected:', value);
    return defaultValue;
  }
  
  const num = Number(value);
  
  if (isNaN(num) || !isFinite(num)) {
    console.warn('⚠️ Invalid number conversion:', { value, result: num });
    return defaultValue;
  }
  
  return num;
}

function toSafeInteger(value, defaultValue = 0) {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  
  if (typeof value === 'object') {
    console.error('❌ CRITICAL: Received object where integer expected:', value);
    return defaultValue;
  }
  
  const num = parseInt(value, 10);
  
  if (isNaN(num) || !isFinite(num)) {
    console.warn('⚠️ Invalid integer conversion:', { value, result: num });
    return defaultValue;
  }
  
  return num;
}

// ============================================
// ✅ NEW: CONTEST DATA CLEANUP FUNCTION
// ============================================
async function clearContestData() {
  console.log('🧹 ============================================');
  console.log('🧹 STARTING CONTEST DATA CLEANUP');
  console.log('🧹 ============================================');
  
  const cleanupResults = {
    trades: 0,
    shortPositions: 0,
    portfoliosReset: 0,
    errors: []
  };

  try {
    // Step 1: Delete all trades
    console.log('📋 Step 1/3: Clearing trades...');
    const { data: deletedTrades, error: tradesError, count: tradesCount } = await supabaseAdmin
      .from('trades')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    
    if (tradesError) {
      console.error('❌ Failed to clear trades:', tradesError);
      cleanupResults.errors.push({ step: 'trades', error: tradesError.message });
    } else {
      cleanupResults.trades = tradesCount || 0;
      console.log(`   ✅ Cleared ${cleanupResults.trades} trades`);
    }

    // Step 2: Delete all short positions (including inactive ones from auto square-off)
    console.log('📋 Step 2/3: Clearing short positions...');
    const { data: deletedShorts, error: shortsError, count: shortsCount } = await supabaseAdmin
      .from('short_positions')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    
    if (shortsError) {
      console.error('❌ Failed to clear short positions:', shortsError);
      cleanupResults.errors.push({ step: 'shorts', error: shortsError.message });
    } else {
      cleanupResults.shortPositions = shortsCount || 0;
      console.log(`   ✅ Cleared ${cleanupResults.shortPositions} short positions`);
    }

    // Step 3: Reset all portfolios to initial state (1M cash)
    console.log('📋 Step 3/3: Resetting portfolios to 1M cash...');
    const { data: resetPortfolios, error: portfolioError, count: portfolioCount } = await supabaseAdmin
      .from('portfolio')
      .update({
        cash_balance: 1000000,
        holdings: {},
        market_value: 0,
        total_wealth: 1000000,
        short_value: 0,
        unrealized_pnl: 0,
        total_pnl: 0,
        realized_pnl: 0,
        last_updated: new Date().toISOString()
      }, { count: 'exact' })
      .neq('user_email', '');
    
    if (portfolioError) {
      console.error('❌ Failed to reset portfolios:', portfolioError);
      cleanupResults.errors.push({ step: 'portfolios', error: portfolioError.message });
    } else {
      cleanupResults.portfoliosReset = portfolioCount || 0;
      console.log(`   ✅ Reset ${cleanupResults.portfoliosReset} portfolios to 1M cash`);
    }

    // Step 4: Clear in-memory caches
    console.log('📋 Step 4/4: Clearing memory caches...');
    portfolioCache.clear();
    leaderboardCache = [];
    console.log('   ✅ Memory caches cleared');

    // Summary
    console.log('🧹 ============================================');
    console.log('🧹 CLEANUP SUMMARY:');
    console.log(`   📝 Trades deleted: ${cleanupResults.trades}`);
    console.log(`   📉 Short positions deleted: ${cleanupResults.shortPositions}`);
    console.log(`   💰 Portfolios reset: ${cleanupResults.portfoliosReset}`);
    if (cleanupResults.errors.length > 0) {
      console.log(`   ⚠️ Errors encountered: ${cleanupResults.errors.length}`);
      cleanupResults.errors.forEach(err => {
        console.log(`      - ${err.step}: ${err.error}`);
      });
    } else {
      console.log('   ✅ No errors');
    }
    console.log('🧹 ============================================');

    return {
      success: cleanupResults.errors.length === 0,
      results: cleanupResults
    };

  } catch (error) {
    console.error('❌ CRITICAL ERROR during cleanup:', error);
    cleanupResults.errors.push({ step: 'general', error: error.message });
    return {
      success: false,
      results: cleanupResults,
      error: error.message
    };
  }
}

// ============================================
// CANDLE GENERATION (unchanged)
// ============================================
function generate5sCandle(symbol, universalTime, marketTime, dataWindowStartMs, dataWindowEndMs) {
  if (!symbol || universalTime == null || marketTime == null) return null;

  const { ticks } = dataLoader.getTicksInRange(symbol, dataWindowStartMs, dataWindowEndMs);
  const unixTime = Math.floor(contestState.contestStartTime.getTime() / 1000) + universalTime;

  if (!ticks || ticks.length === 0) {
    const prevCandles = candleAggregator.getCandles(symbol, '5s');
    let prevClose = null;
    if (prevCandles && prevCandles.length > 0) {
      prevClose = prevCandles[prevCandles.length - 1].close;
    } else {
      prevClose = contestState.latestPrices.get(symbol) || 0;
    }

    const emptyCandle = {
      time: unixTime,
      market_time: marketTime,
      open: prevClose,
      high: prevClose,
      low: prevClose,
      close: prevClose,
      volume: 0,
      tickCount: 0
    };

    candleAggregator.storeCandle(symbol, '5s', emptyCandle);
    contestState.latestPrices.set(symbol, emptyCandle.close);

    console.log(`      ⚪ ${symbol} 5s EMPTY @ ${new Date(marketTime * 1000).toISOString()} (carry-forward prevClose=${prevClose?.toFixed(2)})`);
    return emptyCandle;
  }

  const candle = candleAggregator.generateBaseCandle(ticks, unixTime, marketTime, symbol);

  if (candle) {
    candleAggregator.storeCandle(symbol, '5s', candle);
    contestState.latestPrices.set(symbol, candle.close);
  }

  return candle;
}

function generateCandlesFor5sInterval() {
  if (!contestState.isRunning || contestState.isPaused) return;

  if (!contestState.contestStartTime || !contestState.timeMapper) {
    console.warn('Contest start time or time mapper not initialized');
    return;
  }

  const realElapsedMs = Date.now() - contestState.contestStartTime.getTime();
  const intervalNumber = Math.floor(realElapsedMs / 5000);
  
  const universalTime = intervalNumber * 5;
  
  const config = TIMEFRAMES['5s'];
  const universalSeconds = realElapsedMs / 1000;
  const marketOffsetSeconds = contestState.timeMapper.universalToMarket(universalSeconds);
  const dataWindowStartMs = contestState.dataStartTimestamp + Math.floor(marketOffsetSeconds * 1000);
  const dataWindowEndMs = dataWindowStartMs + (config.dbSeconds * 1000);
  const marketTime = Math.floor(dataWindowEndMs / 1000);

  if (dataWindowStartMs >= contestState.dataEndTimestamp) {
    console.log('⚠️ Reached end of data');
    return;
  }

  console.log(`🕯️ Generating 5s candle #${intervalNumber + 1} (DB window ${new Date(dataWindowStartMs).toISOString()} → ${new Date(dataWindowEndMs).toISOString()})`);

  let successCount = 0;
  const aggregatedResults = [];

  for (const symbol of contestState.symbols) {
    const candle = generate5sCandle(symbol, universalTime, marketTime, dataWindowStartMs, dataWindowEndMs);

    if (candle) {
      successCount++;

      io.to(`candles:${symbol}:5s`).emit('candle_update', {
        symbol,
        timeframe: '5s',
        candle,
        isNew: true
      });

      io.emit('symbol_tick', {
        symbol,
        data: {
          last_traded_price: candle.close,
          volume_traded: candle.volume,
          timestamp: new Date(candle.market_time * 1000).toISOString(),
          open_price: candle.open,
          high_price: candle.high,
          low_price: candle.low,
          close_price: candle.close,
          company_name: symbol
        },
        universalTime: universalTime,
        tickIndex: intervalNumber,
        progress: Math.min((realElapsedMs / contestState.contestDurationMs) * 100, 100),
        contestStartTime: contestState.contestStartTime.toISOString()
      });

      const aggregated = candleAggregator.processAggregationCascade(symbol, '5s');

      for (const { timeframe, candle: aggCandle } of aggregated) {
        io.to(`candles:${symbol}:${timeframe}`).emit('candle_update', {
          symbol,
          timeframe,
          candle: aggCandle,
          isNew: true
        });
        aggregatedResults.push(`${symbol}:${timeframe}`);
      }
    }
  }

  console.log(`   ✅ Generated ${successCount} 5s candles`);
  if (aggregatedResults.length > 0) {
    console.log(`   🔼 Aggregated: ${aggregatedResults.join(', ')}`);
  }

  const progress = Math.min((realElapsedMs / contestState.contestDurationMs) * 100, 100);
  
  io.emit('market_tick', {
    universalTime: universalTime,
    totalTime: 3600,
    timestamp: new Date().toISOString(),
    prices: Object.fromEntries(contestState.latestPrices),
    progress,
    elapsedTime: realElapsedMs,
    contestStartTime: contestState.contestStartTime.toISOString(),
    tickUpdates: successCount
  });

  if (intervalNumber > 0 && intervalNumber % 6 === 0) {
    updateLeaderboard().catch(err => {
      console.error('❌ Error updating leaderboard:', err);
    });
  }

  dataLoader.loadNextWindowIfNeeded(dataWindowStartMs).catch(err => {
    console.error('❌ Error loading next window:', err);
  });
}

function startCandleGeneration() {
  console.log('🚀 Starting candle generation (5s base + aggregation)...');

  candleAggregator.clearAll();

  const config = TIMEFRAMES['5s'];
  const intervalMs = config.realSeconds * 1000;

  generateCandlesFor5sInterval();

  const intervalId = setInterval(() => {
    generateCandlesFor5sInterval();
  }, intervalMs);

  contestState.candleGenerationInterval = intervalId;

  console.log('✅ Candle generation started (5s interval)');
}

// ============================================
// ✅ MODIFIED: CONTEST CONTROL WITH CLEANUP
// ============================================
async function startContest() {
  if (contestState.isRunning && !contestState.isPaused) {
    return { success: true, message: 'Contest already running' };
  }

  if (contestState.isPaused) {
    contestState.isPaused = false;
    startCandleGeneration();
    io.emit('contest_resumed', { message: 'Contest resumed' });
    return { success: true, message: 'Contest resumed' };
  }

  try {
    console.log('🚀 ============================================');
    console.log('🚀 STARTING NEW CONTEST');
    console.log('🚀 ============================================');

    // ✅ NEW: Ensure all portfolios have fresh 1M for new contest instance
    console.log('💰 Ensuring all users have 1M cash for new contest...');
    
    const { data: existingPortfolios, error: checkError } = await supabaseAdmin
      .from('portfolio')
      .select('user_email, cash_balance, total_wealth');
    
    if (!checkError && existingPortfolios) {
      for (const portfolio of existingPortfolios) {
        // Reset any portfolio that doesn't have exactly 1M (from previous contest)
        if (portfolio.total_wealth !== 1000000) {
          await supabaseAdmin
            .from('portfolio')
            .update({
              cash_balance: 1000000,
              holdings: {},
              market_value: 0,
              total_wealth: 1000000,
              short_value: 0,
              unrealized_pnl: 0,
              total_pnl: 0,
              realized_pnl: 0,
              last_updated: new Date().toISOString()
            })
            .eq('user_email', portfolio.user_email);
          
          console.log(`   ✅ Reset portfolio for ${portfolio.user_email} (had ₹${portfolio.total_wealth})`);
        }
      }
      console.log(`💰 Verified/reset ${existingPortfolios.length} existing portfolios`);
    }

    const { symbols, dataStartTime, dataEndTime } = await dataLoader.initialize();

    contestState.symbols = symbols;
    contestState.dataStartTimestamp = dataStartTime;
    contestState.dataEndTimestamp = dataEndTime;

    const dataSpanHours = (dataEndTime - dataStartTime) / (1000 * 60 * 60);
    console.log(`✅ Data loaded: ${dataSpanHours.toFixed(2)} hours of market data`);

    if (dataSpanHours < 4) {
      throw new Error(`Insufficient data: only ${dataSpanHours.toFixed(2)} hours. Need at least 4 hours.`);
    }

    const marketDurationMs = contestState.dataEndTimestamp - contestState.dataStartTimestamp;
    contestState.timeMapper = createUniversalTimeMapper(marketDurationMs, contestState.contestDurationMs);

    contestState.isRunning = true;
    contestState.isPaused = false;
    contestState.contestId = crypto.randomUUID();
    contestState.contestStartTime = new Date();

    console.log(`
📊 CONTEST STARTED:
========================================
   Contest ID: ${contestState.contestId}
   Duration: 1 hour real-time
   Speed: ${(marketDurationMs / contestState.contestDurationMs).toFixed(2)}x compression
   Symbols: ${contestState.symbols.join(', ')}
   Timeframes: ${Object.keys(TIMEFRAMES).join(', ')}
   Start Time: ${contestState.contestStartTime.toLocaleString()}
========================================`);

    startCandleGeneration();

    setTimeout(async () => {
      if (contestState.isRunning) {
        console.log('⏰ Contest duration reached - stopping');
        await stopContest();
      }
    }, contestState.contestDurationMs);

    io.emit('contest_started', {
      message: 'Contest started!',
      contestId: contestState.contestId,
      contestStartTime: contestState.contestStartTime.toISOString(),
      symbols: contestState.symbols,
      duration: contestState.contestDurationMs,
      timeframes: Object.keys(TIMEFRAMES),
      speed: marketDurationMs / contestState.contestDurationMs
    });

    return {
      success: true,
      message: 'Contest started successfully',
      contestId: contestState.contestId,
      symbols: contestState.symbols
    };

  } catch (error) {
    console.error('❌ Failed to start contest:', error);
    contestState.isRunning = false;
    return { success: false, message: error.message };
  }
}

async function stopContest() {
  if (!contestState.isRunning) {
    return { success: true, message: 'Contest not running' };
  }

  try {
    console.log('🛑 ============================================');
    console.log('🛑 STOPPING CONTEST');
    console.log('🛑 ============================================');

    // Step 1: Stop candle generation
    if (contestState.candleGenerationInterval) {
      clearInterval(contestState.candleGenerationInterval);
      console.log('✅ Candle generation stopped');
    }

    // Step 2: Auto square-off all active short positions
    const { data: shortPositions, error: shortError } = await supabaseAdmin
      .from('short_positions')
      .select('*')
      .eq('is_active', true);

    if (!shortError && shortPositions && shortPositions.length > 0) {
      console.log(`🔄 Auto-squaring off ${shortPositions.length} short positions...`);
      
      for (const short of shortPositions) {
        const shortQty = toSafeInteger(short.quantity);
        const shortPrice = toSafeNumber(short.avg_short_price);
        const currentPrice = toSafeNumber(contestState.latestPrices.get(short.symbol) || shortPrice);
        
        const pnl = (shortPrice - currentPrice) * shortQty;
        const coverCost = currentPrice * shortQty;

        console.log(`   📊 ${short.symbol}: Short@₹${shortPrice.toFixed(2)} Cover@₹${currentPrice.toFixed(2)} Qty=${shortQty} P&L=₹${pnl.toFixed(2)}`);

        const { data: portfolio } = await supabaseAdmin
          .from('portfolio')
          .select('*')
          .eq('user_email', short.user_email)
          .single();

        if (portfolio) {
          const currentCash = toSafeNumber(portfolio.cash_balance);
          const currentRealizedPnl = toSafeNumber(portfolio.realized_pnl);
          
          const newCashBalance = currentCash - coverCost;
          const newRealizedPnl = currentRealizedPnl + pnl;

          await supabaseAdmin
            .from('portfolio')
            .update({
              cash_balance: newCashBalance,
              realized_pnl: newRealizedPnl
            })
            .eq('user_email', short.user_email);

          console.log(`   💰 ${short.user_email}: Cash ₹${currentCash.toFixed(2)} → ₹${newCashBalance.toFixed(2)} (P&L: ₹${pnl.toFixed(2)})`);
        }

        await supabaseAdmin
          .from('short_positions')
          .update({ is_active: false })
          .eq('id', short.id);

        await supabaseAdmin
          .from('trades')
          .insert({
            user_email: short.user_email,
            symbol: short.symbol,
            company_name: short.company_name,
            order_type: 'buy_to_cover',
            quantity: shortQty,
            price: currentPrice,
            total_amount: coverCost,
            timestamp: new Date().toISOString()
          });
      }

      console.log(`✅ Auto squared-off ${shortPositions.length} short positions`);
    } else {
      console.log('ℹ️ No active short positions to square-off');
    }

    // Step 3: Update final leaderboard
    console.log('📊 Calculating final leaderboard...');
    await updateLeaderboard();
    console.log('✅ Final leaderboard calculated');

    // ✅ NEW STEP 4: Clear all contest data for fresh start
    console.log('🧹 Starting contest data cleanup...');
    const cleanupResult = await clearContestData();
    
    if (cleanupResult.success) {
      console.log('✅ Contest data cleanup completed successfully');
    } else {
      console.warn('⚠️ Contest data cleanup completed with errors:', cleanupResult.results.errors);
    }

    // Step 5: Update contest state
    contestState.isRunning = false;
    contestState.isPaused = false;

    console.log('🛑 ============================================');
    console.log('🛑 CONTEST STOPPED SUCCESSFULLY');
    console.log('🛑 ============================================');

    // Step 6: Notify clients
    io.emit('contest_ended', {
      message: 'Contest ended',
      contestId: contestState.contestId,
      finalLeaderboard: leaderboardCache.slice(0, 10),
      cleanupResults: cleanupResult.results
    });

    return { 
      success: true, 
      message: 'Contest stopped successfully',
      cleanup: cleanupResult.results
    };

  } catch (error) {
    console.error('❌ Error stopping contest:', error);
    return { success: false, message: error.message };
  }
}

function getCurrentPrice(symbol) {
  return contestState.latestPrices.get(symbol) || null;
}

// ============================================
// AUTHENTICATION (unchanged)
// ============================================
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    let { data: userData } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    if (!userData) {
      const { data: emailData } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq("Candidate's Email", user.email)
        .single();

      if (emailData) {
        await supabaseAdmin
          .from('users')
          .update({ auth_id: user.id })
          .eq("Candidate's Email", user.email);
        userData = emailData;
      }
    }

    if (!userData) {
      return res.status(401).json({ error: 'User profile not found' });
    }

    req.user = userData;
    req.auth_user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

async function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ============================================
// PORTFOLIO MANAGEMENT (unchanged)
// ============================================
async function getOrCreatePortfolio(userEmail) {
  if (portfolioCache.has(userEmail)) {
    return portfolioCache.get(userEmail);
  }

  try {
    let { data: portfolio, error } = await supabaseAdmin
      .from('portfolio')
      .select('*')
      .eq('user_email', userEmail)
      .single();

    if (error && error.code === 'PGRST116') {
      const newPortfolio = {
        user_email: userEmail,
        cash_balance: 1000000,
        holdings: {},
        market_value: 0,
        total_wealth: 1000000,
        short_value: 0,
        unrealized_pnl: 0,
        total_pnl: 0,
        realized_pnl: 0
      };

      const { data, error: insertError } = await supabaseAdmin
        .from('portfolio')
        .insert(newPortfolio)
        .select()
        .single();

      if (insertError) throw insertError;
      portfolio = data;
    } else if (error) {
      throw error;
    }

    portfolioCache.set(userEmail, portfolio);
    return portfolio;
  } catch (error) {
    console.error('Error getting/creating portfolio:', error);
    return null;
  }
}

async function updatePortfolioValues(userEmail) {
  try {
    const portfolio = await getOrCreatePortfolio(userEmail);
    if (!portfolio) return null;

    let longMarketValue = 0;
    let longUnrealizedPnl = 0;

    const holdings = portfolio.holdings || {};
    for (const [symbol, position] of Object.entries(holdings)) {
      const qty = toSafeInteger(position.quantity);
      const avgPrice = toSafeNumber(position.avg_price);
      const currentPrice = toSafeNumber(getCurrentPrice(symbol) || avgPrice);
      
      if (qty > 0) {
        const positionValue = currentPrice * qty;
        longMarketValue += positionValue;
        longUnrealizedPnl += (currentPrice - avgPrice) * qty;

        holdings[symbol] = {
          ...position,
          quantity: qty,
          avg_price: avgPrice,
          current_price: currentPrice,
          market_value: positionValue,
          unrealized_pnl: (currentPrice - avgPrice) * qty
        };
      }
    }

    const { data: shortPositions } = await supabaseAdmin
      .from('short_positions')
      .select('*')
      .eq('user_email', userEmail)
      .eq('is_active', true);

    let shortValue = 0;
    let shortUnrealizedPnl = 0;

    for (const short of shortPositions || []) {
      const shortQty = toSafeInteger(short.quantity);
      const shortPrice = toSafeNumber(short.avg_short_price);
      const currentPrice = toSafeNumber(getCurrentPrice(short.symbol) || shortPrice);
      
      shortValue += currentPrice * shortQty;
      shortUnrealizedPnl += (shortPrice - currentPrice) * shortQty;
    }

    const cashBalance = toSafeNumber(portfolio.cash_balance);
    const realizedPnl = toSafeNumber(portfolio.realized_pnl);
    
    const totalWealth = cashBalance + longMarketValue + shortUnrealizedPnl;
    const totalPnl = longUnrealizedPnl + shortUnrealizedPnl + realizedPnl;

    const updatedPortfolio = {
      ...portfolio,
      holdings,
      cash_balance: cashBalance,
      market_value: longMarketValue,
      short_value: shortValue,
      unrealized_pnl: longUnrealizedPnl + shortUnrealizedPnl,
      total_wealth: totalWealth,
      total_pnl: totalPnl,
      realized_pnl: realizedPnl,
      last_updated: new Date().toISOString()
    };

    portfolioCache.set(userEmail, updatedPortfolio);

    await supabaseAdmin
      .from('portfolio')
      .update(updatedPortfolio)
      .eq('user_email', userEmail);

    io.to(`user:${userEmail}`).emit('portfolio_update', updatedPortfolio);

    return updatedPortfolio;
  } catch (error) {
    console.error('Error updating portfolio:', error);
    return null;
  }
}

// ============================================
// TRADE EXECUTION (unchanged - already correct)
// ============================================
async function executeTrade(userEmail, symbol, companyName, orderType, quantity, price) {
  try {
    if (!contestState.isRunning || contestState.isPaused) {
      throw new Error('Trading is only allowed when contest is running');
    }

    console.log('📥 Trade request received:', {
      userEmail,
      symbol,
      orderType,
      quantity,
      quantityType: typeof quantity,
      price,
      priceType: typeof price
    });

    const numQuantity = toSafeInteger(quantity);
    const numPrice = toSafeNumber(price);

    if (numQuantity <= 0) {
      throw new Error(`Invalid quantity: ${quantity} (converted to ${numQuantity})`);
    }
    if (numPrice <= 0) {
      throw new Error(`Invalid price: ${price} (converted to ${numPrice})`);
    }

    const totalAmount = numQuantity * numPrice;

    console.log(`🔄 Executing ${orderType}: ${numQuantity} ${symbol} @ ₹${numPrice} (Total: ₹${totalAmount})`);

    const portfolio = await getOrCreatePortfolio(userEmail);

    if (orderType === 'buy') {
      const currentCash = toSafeNumber(portfolio.cash_balance);
      
      if (currentCash < totalAmount) {
        throw new Error('Insufficient cash balance');
      }

      const holdings = portfolio.holdings || {};
      
      if (holdings[symbol]) {
        const existingQty = toSafeInteger(holdings[symbol].quantity);
        const existingAvg = toSafeNumber(holdings[symbol].avg_price);
        
        const newQuantity = existingQty + numQuantity;
        const newAvgPrice = ((existingAvg * existingQty) + totalAmount) / newQuantity;
        
        holdings[symbol] = {
          quantity: newQuantity,
          avg_price: newAvgPrice,
          company_name: companyName,
          current_price: numPrice,
          market_value: numPrice * newQuantity,
          unrealized_pnl: (numPrice - newAvgPrice) * newQuantity
        };
      } else {
        holdings[symbol] = {
          quantity: numQuantity,
          avg_price: numPrice,
          company_name: companyName,
          current_price: numPrice,
          market_value: totalAmount,
          unrealized_pnl: 0
        };
      }

      const newCashBalance = currentCash - totalAmount;

      portfolioCache.set(userEmail, {
        ...portfolio,
        cash_balance: newCashBalance,
        holdings
      });

      await supabaseAdmin
        .from('portfolio')
        .update({
          cash_balance: newCashBalance,
          holdings
        })
        .eq('user_email', userEmail);

    } else if (orderType === 'sell') {
      const holdings = portfolio.holdings || {};

      if (!holdings[symbol]) {
        throw new Error('No holdings found for this symbol');
      }

      const existingQty = toSafeInteger(holdings[symbol].quantity);
      const existingAvg = toSafeNumber(holdings[symbol].avg_price);

      if (existingQty < numQuantity) {
        throw new Error('Insufficient holdings to sell');
      }

      const realizedPnl = (numPrice - existingAvg) * numQuantity;
      const newQuantity = existingQty - numQuantity;

      if (newQuantity === 0) {
        delete holdings[symbol];
      } else {
        holdings[symbol] = {
          ...holdings[symbol],
          quantity: newQuantity,
          current_price: numPrice,
          market_value: numPrice * newQuantity,
          unrealized_pnl: (numPrice - existingAvg) * newQuantity
        };
      }

      const currentCash = toSafeNumber(portfolio.cash_balance);
      const currentRealizedPnl = toSafeNumber(portfolio.realized_pnl);
      
      const newCashBalance = currentCash + totalAmount;
      const newRealizedPnl = currentRealizedPnl + realizedPnl;

      portfolioCache.set(userEmail, {
        ...portfolio,
        cash_balance: newCashBalance,
        holdings,
        realized_pnl: newRealizedPnl
      });

      await supabaseAdmin
        .from('portfolio')
        .update({
          cash_balance: newCashBalance,
          holdings,
          realized_pnl: newRealizedPnl
        })
        .eq('user_email', userEmail);

    } else if (orderType === 'short_sell') {
      await supabaseAdmin
        .from('short_positions')
        .insert({
          user_email: userEmail,
          symbol,
          company_name: companyName,
          quantity: numQuantity,
          avg_short_price: numPrice,
          current_price: numPrice,
          unrealized_pnl: 0,
          is_active: true,
          opened_at: new Date().toISOString()
        });

      const currentCash = toSafeNumber(portfolio.cash_balance);
      const newCashBalance = currentCash + totalAmount;

      portfolioCache.set(userEmail, {
        ...portfolio,
        cash_balance: newCashBalance
      });

      await supabaseAdmin
        .from('portfolio')
        .update({ 
          cash_balance: newCashBalance
        })
        .eq('user_email', userEmail);

    } else if (orderType === 'buy_to_cover') {
      const { data: shorts } = await supabaseAdmin
        .from('short_positions')
        .select('*')
        .eq('user_email', userEmail)
        .eq('symbol', symbol)
        .eq('is_active', true)
        .order('opened_at', { ascending: true });

      if (!shorts || shorts.length === 0) {
        throw new Error('No short positions to cover');
      }

      let remainingQuantity = numQuantity;
      let totalPnl = 0;

      for (const short of shorts) {
        if (remainingQuantity <= 0) break;

        const shortQty = toSafeInteger(short.quantity);
        const shortPrice = toSafeNumber(short.avg_short_price);
        const coverQuantity = Math.min(remainingQuantity, shortQty);
        const pnl = (shortPrice - numPrice) * coverQuantity;
        totalPnl += pnl;

        if (coverQuantity === shortQty) {
          await supabaseAdmin
            .from('short_positions')
            .update({ is_active: false })
            .eq('id', short.id);
        } else {
          await supabaseAdmin
            .from('short_positions')
            .update({ 
              quantity: shortQty - coverQuantity
            })
            .eq('id', short.id);
        }

        remainingQuantity -= coverQuantity;
      }

      const currentCash = toSafeNumber(portfolio.cash_balance);
      const currentRealizedPnl = toSafeNumber(portfolio.realized_pnl);
      
      const newCashBalance = currentCash - totalAmount;
      const newRealizedPnl = currentRealizedPnl + totalPnl;

      portfolioCache.set(userEmail, {
        ...portfolio,
        cash_balance: newCashBalance,
        realized_pnl: newRealizedPnl
      });

      await supabaseAdmin
        .from('portfolio')
        .update({
          cash_balance: newCashBalance,
          realized_pnl: newRealizedPnl
        })
        .eq('user_email', userEmail);
    }

    const safeTradeData = {
      user_email: userEmail,
      symbol,
      company_name: companyName,
      order_type: orderType,
      quantity: Math.floor(numQuantity),
      price: parseFloat(numPrice.toFixed(2)),
      total_amount: parseFloat(totalAmount.toFixed(2)),
      timestamp: new Date().toISOString()
    };

    console.log('📝 Inserting trade with sanitized data:', {
      quantity: safeTradeData.quantity,
      quantityType: typeof safeTradeData.quantity,
      price: safeTradeData.price,
      priceType: typeof safeTradeData.price
    });

    const { data: trade, error } = await supabaseAdmin
      .from('trades')
      .insert(safeTradeData)
      .select()
      .single();

    if (error) {
      console.error('❌ Trade insertion error:', error);
      throw error;
    }

    console.log(`✅ Trade executed successfully: ${orderType} ${numQuantity} ${symbol} @ ₹${numPrice}`);

    const updatedPortfolio = await updatePortfolioValues(userEmail);

    return { trade, portfolio: updatedPortfolio };
  } catch (error) {
    console.error('Trade execution error:', error);
    throw error;
  }
}

// ============================================
// LEADERBOARD (unchanged)
// ============================================
async function updateLeaderboard() {
  try {
    const { data, error } = await supabaseAdmin
      .from('portfolio')
      .select('*')
      .order('total_wealth', { ascending: false });

    if (error) throw error;

    const { data: users } = await supabaseAdmin
      .from('users')
      .select('*');

    const userMap = new Map(users?.map(u => [u["Candidate's Email"], u]) || []);

    const leaderboard = (data || []).map((p, index) => ({
      rank: index + 1,
      user_name: userMap.get(p.user_email)?.["Candidate's Name"] || p.user_email,
      user_email: p.user_email,
      total_wealth: toSafeNumber(p.total_wealth),
      total_pnl: toSafeNumber(p.total_pnl),
      return_percentage: ((toSafeNumber(p.total_wealth) - 1000000) / 1000000) * 100,
      cash_balance: toSafeNumber(p.cash_balance),
      market_value: toSafeNumber(p.market_value),
      short_value: toSafeNumber(p.short_value),
      realized_pnl: toSafeNumber(p.realized_pnl),
      unrealized_pnl: toSafeNumber(p.unrealized_pnl)
    }));

    leaderboardCache = leaderboard;
    io.emit('leaderboard_update', leaderboard.slice(0, 20));

    return leaderboard;
  } catch (error) {
    console.error('Error updating leaderboard:', error);
    return [];
  }
}

function getContestStateForClient() {
  const elapsedTime = contestState.contestStartTime
    ? Date.now() - contestState.contestStartTime.getTime()
    : 0;

  const progress = contestState.contestStartTime
    ? Math.min((elapsedTime / contestState.contestDurationMs) * 100, 100)
    : 0;

  return {
    isRunning: contestState.isRunning,
    isPaused: contestState.isPaused,
    contestStartTime: contestState.contestStartTime,
    elapsedTime,
    progress,
    symbols: contestState.symbols,
    contestId: contestState.contestId,
    timeframes: Object.keys(TIMEFRAMES),
    contestDurationMs: contestState.contestDurationMs,
    currentDataIndex: Math.floor(elapsedTime / 1000),
    totalDataRows: 3600,
    speed: 5
  };
}

// ============================================
// REST API ROUTES (unchanged)
// ============================================
app.get('/api/health', (req, res) => {
  const loaderStats = dataLoader.getStats();
  const aggregatorStats = candleAggregator.getStats();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connectedUsers: connectedUsers.size,
    contestState: getContestStateForClient(),
    uptime: process.uptime(),
    activeSymbols: contestState.symbols.length,
    dataLoader: loaderStats,
    candleAggregator: aggregatorStats,
    totalMemoryMB: loaderStats.memoryMB + aggregatorStats.memoryMB
  });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    let { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('auth_id', data.user.id)
      .single();

    if (userError && userError.code === 'PGRST116') {
      const { data: emailData } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq("Candidate's Email", email)
        .single();

      if (emailData) {
        await supabaseAdmin
          .from('users')
          .update({ auth_id: data.user.id })
          .eq("Candidate's Email", email);
        userData = emailData;
      }
    }

    if (!userData) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    res.json({
      success: true,
      user: {
        email: userData["Candidate's Email"],
        name: userData["Candidate's Name"],
        role: userData.role || 'user'
      },
      token: data.session.access_token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: {
      email: req.user["Candidate's Email"],
      name: req.user["Candidate's Name"],
      role: req.user.role
    }
  });
});

app.get('/api/symbols', (req, res) => {
  if (contestState.symbols.length === 0) {
    res.json(['ADANIENT', 'AXISBANK', 'BANKBARODA', 'CANBK', 'HDFCBANK', 'HINDALCO', 
              'ICICIBANK', 'INFY', 'ITC', 'KOTAKBANK', 'LT', 'M&M', 'ONGC', 
              'PNB', 'RELIANCE', 'SBIN', 'TATAMOTORS', 'TATAPOWER', 'TATASTEEL', 'TCS']);
  } else {
    res.json(contestState.symbols);
  }
});

app.get('/api/timeframes', (req, res) => {
  res.json({
    available: Object.keys(TIMEFRAMES),
    enabled: Object.keys(TIMEFRAMES),
    default: '30s',
    details: Object.fromEntries(
      Object.entries(TIMEFRAMES).map(([key, config]) => [key, {
        realSeconds: config.realSeconds,
        dbSeconds: config.dbSeconds,
        label: config.label
      }])
    )
  });
});

app.get('/api/candlestick/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const timeframe = req.query.timeframe || '30s';

    const candles = candleAggregator.getCandles(symbol, timeframe);

    res.json({
      symbol,
      timeframe,
      data: candles,
      totalCandles: candles.length,
      contestState: getContestStateForClient()
    });
  } catch (error) {
    console.error('Error fetching candles:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/contest/state', (req, res) => {
  res.json(getContestStateForClient());
});

app.post('/api/trade', authenticateToken, async (req, res) => {
  try {
    const { symbol, order_type, quantity } = req.body;
    const userEmail = req.user["Candidate's Email"];

    if (!contestState.isRunning || contestState.isPaused) {
      return res.status(400).json({ error: 'Trading is only allowed when contest is running' });
    }

    const currentPrice = getCurrentPrice(symbol);
    if (!currentPrice) {
      return res.status(400).json({ error: 'Price not available for symbol' });
    }

    const companyName = symbol;
    const result = await executeTrade(userEmail, symbol, companyName, order_type, quantity, currentPrice);
    await updateLeaderboard();

    res.json({
      success: true,
      trade: result.trade,
      portfolio: result.portfolio,
      executedAt: {
        price: currentPrice,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Trade API error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/portfolio', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user["Candidate's Email"];
    const portfolio = await updatePortfolioValues(userEmail);
    res.json(portfolio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trades', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user["Candidate's Email"];
    const { data: trades, error } = await supabaseAdmin
      .from('trades')
      .select('*')
      .eq('user_email', userEmail)
      .order('timestamp', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ trades: trades || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/shorts', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user["Candidate's Email"];
    const activeOnly = req.query.active === 'true';

    let query = supabaseAdmin
      .from('short_positions')
      .select('*')
      .eq('user_email', userEmail)
      .order('opened_at', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data: shorts, error } = await query;

    if (error) throw error;
    res.json({ shorts: shorts || [], count: shorts?.length || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  res.json(leaderboardCache);
});

app.post('/api/admin/contest/start', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await startContest();
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: result.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/contest/stop', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await stopContest();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ NEW ENDPOINT: Manual data reset (for admin debugging)
app.post('/api/admin/contest/reset-data', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('🔧 Admin triggered manual data reset');
    const result = await clearContestData();
    res.json({
      success: result.success,
      message: result.success ? 'Data reset completed' : 'Data reset completed with errors',
      details: result.results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/contest/pause', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!contestState.isRunning) {
      return res.status(400).json({ error: 'Contest not running' });
    }

    contestState.isPaused = true;

    if (contestState.candleGenerationInterval) {
      clearInterval(contestState.candleGenerationInterval);
    }

    io.emit('contest_paused', { message: 'Contest paused' });
    res.json({ success: true, message: 'Contest paused' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/contest/resume', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!contestState.isRunning || !contestState.isPaused) {
      return res.status(400).json({ error: 'Contest not paused' });
    }

    contestState.isPaused = false;
    startCandleGeneration();

    io.emit('contest_resumed', { message: 'Contest resumed' });
    res.json({ success: true, message: 'Contest resumed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/contest/status', authenticateToken, requireAdmin, (req, res) => {
  const loaderStats = dataLoader.getStats();
  const aggregatorStats = candleAggregator.getStats();

  res.json({
    ...getContestStateForClient(),
    connectedUsers: connectedUsers.size,
    dataLoader: loaderStats,
    candleAggregator: aggregatorStats,
    totalMemoryMB: loaderStats.memoryMB + aggregatorStats.memoryMB
  });
});

// ============================================
// WEBSOCKET HANDLERS (unchanged)
// ============================================
io.on('connection', (socket) => {
  console.log(`👤 User connected: ${socket.id}`);

  socket.emit('contest_state', getContestStateForClient());

  socket.on('authenticate', async (token) => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (!error && user) {
        let { data: userData } = await supabaseAdmin
          .from('users')
          .select('*')
          .eq('auth_id', user.id)
          .single();

        if (!userData) {
          const { data: emailData } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq("Candidate's Email", user.email)
            .single();
          userData = emailData;
        }

        if (userData) {
          const userEmail = userData["Candidate's Email"];

          connectedUsers.set(socket.id, {
            email: userEmail,
            name: userData["Candidate's Name"],
            role: userData.role
          });

          userSockets.set(userEmail, socket.id);
          socket.join(`user:${userEmail}`);

          socket.emit('authenticated', {
            success: true,
            user: {
              email: userEmail,
              name: userData["Candidate's Name"],
              role: userData.role
            }
          });

          console.log(`✅ User authenticated: ${userEmail}`);
        }
      }
    } catch (error) {
      socket.emit('authenticated', { success: false, error: error.message });
    }
  });

  socket.on('subscribe_candles', ({ symbol, timeframe }) => {
    const room = `candles:${symbol}:${timeframe}`;
    socket.join(room);
    console.log(`📊 ${socket.id} subscribed to ${room}`);

    const candles = candleAggregator.getCandles(symbol, timeframe);

    socket.emit('initial_candles', {
      symbol,
      timeframe,
      candles,
      totalCandles: candles.length
    });
  });

  socket.on('unsubscribe_candles', ({ symbol, timeframe }) => {
    const room = `candles:${symbol}:${timeframe}`;
    socket.leave(room);
    console.log(`📊 ${socket.id} unsubscribed from ${room}`);
  });

  socket.on('disconnect', () => {
    console.log(`👤 User disconnected: ${socket.id}`);

    const userInfo = connectedUsers.get(socket.id);
    if (userInfo) {
      userSockets.delete(userInfo.email);
      connectedUsers.delete(socket.id);
    }
  });
});

setInterval(async () => {
  if (contestState.isRunning && !contestState.isPaused) {
    await updateLeaderboard();
  }
}, 30000);

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`
🚀 TRADING PLATFORM - COMPLETE FIXED VERSION
========================================
📍 Port: ${PORT}
📊 WebSocket: Enabled
🔐 Auth: Supabase
💾 Database: Connected
🕐 Contest: 1 hour (5x speed)
📈 Timeframes: ${Object.keys(TIMEFRAMES).join(', ')}
🎯 Type Safety: FULL
🔧 Auto Square-Off: FIXED
🧹 Data Reset: IMPLEMENTED
✅ Ready for 200+ users
========================================
✅ Server ready!
  `);
});