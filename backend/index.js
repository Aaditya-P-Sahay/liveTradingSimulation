// backend/index.js

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

// REDUCED TIMEFRAMES: 5 instead of 7
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
  contestDurationMs: 60 * 60 * 1000, // 1 hour real time
  dataStartTimestamp: null,
  dataEndTimestamp: null,
  symbols: [],
  latestPrices: new Map(),
  timeMapper: null // created on contest start
};

const dataLoader = new DataLoader();
const candleAggregator = new CandleAggregator();

const connectedUsers = new Map();
const userSockets = new Map();
const portfolioCache = new Map();
let leaderboardCache = [];

// Generate 5s candle (base timeframe)
// Modified: uses DB window end as candle time, relies on DataLoader pointers (centralized)
function generate5sCandle(symbol, dataWindowStartMs, dataWindowEndMs) {
  if (!symbol || dataWindowStartMs == null || dataWindowEndMs == null) return null;

  // DataLoader is the single source of pointer truth
  const { ticks } = dataLoader.getTicksInRange(symbol, dataWindowStartMs, dataWindowEndMs);

  // Candle time must be the DB window END (seconds)
  const candleTime = Math.floor(dataWindowEndMs / 1000);

  // If no ticks in this window: create a carry-forward "empty" candle
  if (!ticks || ticks.length === 0) {
    // use previous close if present
    const prevCandles = candleAggregator.getCandles(symbol, '5s');
    let prevClose = null;
    if (prevCandles && prevCandles.length > 0) {
      prevClose = prevCandles[prevCandles.length - 1].close;
    } else {
      prevClose = contestState.latestPrices.get(symbol) || 0;
    }

    const emptyCandle = {
      time: candleTime,
      open: prevClose,
      high: prevClose,
      low: prevClose,
      close: prevClose,
      volume: 0,
      tickCount: 0
    };

    candleAggregator.storeCandle(symbol, '5s', emptyCandle);
    contestState.latestPrices.set(symbol, emptyCandle.close);

    console.log(`      ⚪ ${symbol} 5s EMPTY @ ${new Date(candleTime * 1000).toISOString()} (carry-forward prevClose=${prevClose})`);
    return emptyCandle;
  }

  // generate base candle using Aggregator
  const candle = candleAggregator.generateBaseCandle(ticks, candleTime, symbol);

  if (candle) {
    candleAggregator.storeCandle(symbol, '5s', candle);
    contestState.latestPrices.set(symbol, candle.close);
  }

  return candle;
}

// Main candle generation loop
function generateCandlesFor5sInterval() {
  if (!contestState.isRunning || contestState.isPaused) return;

  if (!contestState.contestStartTime || !contestState.timeMapper) {
    console.warn('Contest start time or time mapper not initialized');
    return;
  }

  // elapsed in real contest time (ms)
  const realElapsedMs = Date.now() - contestState.contestStartTime.getTime();

  const config = TIMEFRAMES['5s'];

  // Convert contest elapsed -> market offset using timeMapper
  const universalSeconds = realElapsedMs / 1000; // contest seconds elapsed
  const marketOffsetSeconds = contestState.timeMapper.universalToMarket(universalSeconds); // seconds into market data
  const dataWindowStartMs = contestState.dataStartTimestamp + Math.floor(marketOffsetSeconds * 1000);
  const dataWindowEndMs = dataWindowStartMs + (config.dbSeconds * 1000);

  // Check if beyond data
  if (dataWindowStartMs >= contestState.dataEndTimestamp) {
    console.log('⚠️ Reached end of data');
    return;
  }

  // Calculate which 5s interval we're on (for logs)
  const intervalNumber = Math.floor(realElapsedMs / (config.realSeconds * 1000));
  console.log(`🕯️ Generating 5s candle #${intervalNumber + 1} (DB window ${new Date(dataWindowStartMs).toISOString()} → ${new Date(dataWindowEndMs).toISOString()})`);

  let successCount = 0;
  const aggregatedResults = [];

  for (const symbol of contestState.symbols) {
    const candle = generate5sCandle(symbol, dataWindowStartMs, dataWindowEndMs);

    if (candle) {
      successCount++;

      // Emit 5s candle
      io.to(`candles:${symbol}:5s`).emit('candle_update', {
        symbol,
        timeframe: '5s',
        candle,
        isNew: true
      });

      // Try to aggregate higher timeframes
      const aggregated = candleAggregator.processAggregationCascade(symbol, '5s');

      // Emit aggregated candles
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

  // Emit market update
  const progress = Math.min((realElapsedMs / contestState.contestDurationMs) * 100, 100);
  io.emit('market_update', {
    currentTime: Date.now(),
    progress,
    elapsedTime: realElapsedMs
  });

  // Check if need to load next window
  dataLoader.loadNextWindowIfNeeded(dataWindowStartMs);
}

// Start candle generation
function startCandleGeneration() {
  console.log('🚀 Starting candle generation (5s base + aggregation)...');

  // Reset caches where necessary
  candleAggregator.clearAll();

  const config = TIMEFRAMES['5s'];
  const intervalMs = config.realSeconds * 1000;

  // Generate first candle immediately
  generateCandlesFor5sInterval();

  // Then continue at 5-second intervals
  const intervalId = setInterval(() => {
    generateCandlesFor5sInterval();
  }, intervalMs);

  contestState.candleGenerationInterval = intervalId;

  console.log('✅ Candle generation started (5s interval)');
}

// Start contest
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
    console.log('🚀 STARTING NEW CONTEST...');

    // Initialize data loader
    const { symbols, dataStartTime, dataEndTime } = await dataLoader.initialize();

    contestState.symbols = symbols;
    contestState.dataStartTimestamp = dataStartTime;
    contestState.dataEndTimestamp = dataEndTime;

    const dataSpanHours = (dataEndTime - dataStartTime) / (1000 * 60 * 60);
    console.log(`✅ Data loaded: ${dataSpanHours.toFixed(2)} hours of market data`);

    if (dataSpanHours < 4) {
      throw new Error(`Insufficient data: only ${dataSpanHours.toFixed(2)} hours. Need at least 4 hours.`);
    }

    // Create universal time mapper
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
   Speed: ${ (marketDurationMs / contestState.contestDurationMs).toFixed(2) }x compression
   Symbols: ${contestState.symbols.join(', ')}
   Timeframes: ${Object.keys(TIMEFRAMES).join(', ')}
   Start Time: ${contestState.contestStartTime.toLocaleString()}
========================================`);

    startCandleGeneration();

    // Auto-stop after contest duration
    setTimeout(async () => {
      if (contestState.isRunning) {
        console.log('⏰ Contest duration reached - stopping');
        await stopContest();
      }
    }, contestState.contestDurationMs);

    io.emit('contest_started', {
      message: 'Contest started!',
      contestId: contestState.contestId,
      contestStartTime: contestState.contestStartTime,
      symbols: contestState.symbols,
      duration: contestState.contestDurationMs,
      timeframes: Object.keys(TIMEFRAMES)
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

// Stop contest
async function stopContest() {
  if (!contestState.isRunning) {
    return { success: true, message: 'Contest not running' };
  }

  try {
    console.log('🛑 Stopping contest...');

    if (contestState.candleGenerationInterval) {
      clearInterval(contestState.candleGenerationInterval);
    }

    // Auto square-off all short positions
    const { data: shortPositions, error: shortError } = await supabaseAdmin
      .from('short_positions')
      .select('*')
      .eq('is_active', true);

    if (!shortError && shortPositions) {
      for (const short of shortPositions) {
        const currentPrice = contestState.latestPrices.get(short.symbol) || short.avg_short_price;
        const pnl = (short.avg_short_price - currentPrice) * short.quantity;

        const { data: portfolio } = await supabaseAdmin
          .from('portfolio')
          .select('*')
          .eq('user_email', short.user_email)
          .single();

        if (portfolio) {
          await supabaseAdmin
            .from('portfolio')
            .update({
              cash_balance: portfolio.cash_balance + (short.avg_short_price * short.quantity) + pnl,
              realized_pnl: (portfolio.realized_pnl || 0) + pnl
            })
            .eq('user_email', short.user_email);
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
            quantity: short.quantity,
            price: currentPrice,
            total_amount: currentPrice * short.quantity,
            timestamp: new Date().toISOString()
          });
      }

      console.log(`✅ Auto squared-off ${shortPositions.length} short positions`);
    }

    await updateLeaderboard();

    contestState.isRunning = false;
    contestState.isPaused = false;

    io.emit('contest_ended', {
      message: 'Contest ended',
      contestId: contestState.contestId,
      finalLeaderboard: leaderboardCache.slice(0, 10)
    });

    return { success: true, message: 'Contest stopped successfully' };

  } catch (error) {
    console.error('❌ Error stopping contest:', error);
    return { success: false, message: error.message };
  }
}

// Get current price
function getCurrentPrice(symbol) {
  return contestState.latestPrices.get(symbol) || null;
}

// Authentication middleware
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

// Portfolio management
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
      const currentPrice = getCurrentPrice(symbol);
      if (currentPrice && position.quantity > 0) {
        const positionValue = currentPrice * position.quantity;
        longMarketValue += positionValue;
        longUnrealizedPnl += (currentPrice - position.avg_price) * position.quantity;

        holdings[symbol] = {
          ...position,
          current_price: currentPrice,
          market_value: positionValue,
          unrealized_pnl: (currentPrice - position.avg_price) * position.quantity
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
      const currentPrice = getCurrentPrice(short.symbol) || short.avg_short_price;
      shortValue += currentPrice * short.quantity;
      shortUnrealizedPnl += (short.avg_short_price - currentPrice) * short.quantity;
    }

    const totalWealth = portfolio.cash_balance + longMarketValue + longUnrealizedPnl + shortUnrealizedPnl;
    const totalPnl = longUnrealizedPnl + shortUnrealizedPnl + (portfolio.realized_pnl || 0);

    const updatedPortfolio = {
      ...portfolio,
      holdings,
      market_value: longMarketValue,
      short_value: shortValue,
      unrealized_pnl: longUnrealizedPnl + shortUnrealizedPnl,
      total_wealth: totalWealth,
      total_pnl: totalPnl,
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

async function executeTrade(userEmail, symbol, companyName, orderType, quantity, price) {
  try {
    if (!contestState.isRunning || contestState.isPaused) {
      throw new Error('Trading is only allowed when contest is running');
    }

    const totalAmount = price * quantity;
    const portfolio = await getOrCreatePortfolio(userEmail);

    if (orderType === 'buy') {
      if (portfolio.cash_balance < totalAmount) {
        throw new Error('Insufficient cash balance');
      }

      const holdings = portfolio.holdings || {};
      if (holdings[symbol]) {
        const newQuantity = holdings[symbol].quantity + quantity;
        const newAvgPrice = ((holdings[symbol].avg_price * holdings[symbol].quantity) + totalAmount) / newQuantity;
        holdings[symbol] = {
          ...holdings[symbol],
          quantity: newQuantity,
          avg_price: newAvgPrice
        };
      } else {
        holdings[symbol] = {
          quantity,
          avg_price: price,
          company_name: companyName,
          current_price: price,
          market_value: totalAmount,
          unrealized_pnl: 0
        };
      }

      portfolio.cash_balance -= totalAmount;
      portfolio.holdings = holdings;
      portfolioCache.set(userEmail, portfolio);

      await supabaseAdmin
        .from('portfolio')
        .update({
          cash_balance: portfolio.cash_balance,
          holdings
        })
        .eq('user_email', userEmail);

    } else if (orderType === 'sell') {
      const holdings = portfolio.holdings || {};

      if (!holdings[symbol] || holdings[symbol].quantity < quantity) {
        throw new Error('Insufficient holdings to sell');
      }

      const position = holdings[symbol];
      const realizedPnl = (price - position.avg_price) * quantity;

      holdings[symbol].quantity -= quantity;
      if (holdings[symbol].quantity === 0) {
        delete holdings[symbol];
      }

      portfolio.cash_balance += totalAmount;
      portfolio.holdings = holdings;
      portfolio.realized_pnl = (portfolio.realized_pnl || 0) + realizedPnl;
      portfolioCache.set(userEmail, portfolio);

      await supabaseAdmin
        .from('portfolio')
        .update({
          cash_balance: portfolio.cash_balance,
          holdings,
          realized_pnl: portfolio.realized_pnl
        })
        .eq('user_email', userEmail);

    } else if (orderType === 'short_sell') {
      await supabaseAdmin
        .from('short_positions')
        .insert({
          user_email: userEmail,
          symbol,
          company_name: companyName,
          quantity,
          avg_short_price: price,
          current_price: price,
          unrealized_pnl: 0,
          is_active: true,
          opened_at: new Date().toISOString()
        });

      portfolio.cash_balance += totalAmount;
      portfolioCache.set(userEmail, portfolio);

      await supabaseAdmin
        .from('portfolio')
        .update({ cash_balance: portfolio.cash_balance })
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

      let remainingQuantity = quantity;
      let totalPnl = 0;

      for (const short of shorts) {
        if (remainingQuantity <= 0) break;

        const coverQuantity = Math.min(remainingQuantity, short.quantity);
        const pnl = (short.avg_short_price - price) * coverQuantity;
        totalPnl += pnl;

        if (coverQuantity === short.quantity) {
          await supabaseAdmin
            .from('short_positions')
            .update({ is_active: false })
            .eq('id', short.id);
        } else {
          await supabaseAdmin
            .from('short_positions')
            .update({ quantity: short.quantity - coverQuantity })
            .eq('id', short.id);
        }

        remainingQuantity -= coverQuantity;
      }

      portfolio.cash_balance -= totalAmount;
      portfolio.realized_pnl = (portfolio.realized_pnl || 0) + totalPnl;
      portfolioCache.set(userEmail, portfolio);

      await supabaseAdmin
        .from('portfolio')
        .update({
          cash_balance: portfolio.cash_balance,
          realized_pnl: portfolio.realized_pnl
        })
        .eq('user_email', userEmail);
    }

    const { data: trade, error } = await supabaseAdmin
      .from('trades')
      .insert({
        user_email: userEmail,
        symbol,
        company_name: companyName,
        order_type: orderType,
        quantity,
        price,
        total_amount: totalAmount,
        timestamp: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    const updatedPortfolio = await updatePortfolioValues(userEmail);

    return { trade, portfolio: updatedPortfolio };
  } catch (error) {
    console.error('Trade execution error:', error);
    throw error;
  }
}

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
      total_wealth: p.total_wealth,
      total_pnl: p.total_pnl,
      return_percentage: ((p.total_wealth - 1000000) / 1000000) * 100,
      cash_balance: p.cash_balance,
      market_value: p.market_value,
      short_value: p.short_value,
      realized_pnl: p.realized_pnl || 0,
      unrealized_pnl: p.unrealized_pnl || 0
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
    contestDurationMs: contestState.contestDurationMs
  };
}

// REST API Routes
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
  res.json(contestState.symbols);
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

    const companyName = symbol; // Use symbol as company name for now
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

// Admin routes
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

// WebSocket handlers
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

setTimeout(() => {
  console.log('Candle counts snapshot:', {
    '5s': candleAggregator.getCandles('ADANIENT', '5s').length,
    '30s': candleAggregator.getCandles('ADANIENT', '30s').length,
    '1m': candleAggregator.getCandles('ADANIENT', '1m').length
  });
}, 30000);


const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`
🚀 REFACTORED TRADING PLATFORM
========================================
📍 Port: ${PORT}
📊 WebSocket: Enabled
🔐 Auth: Supabase
💾 Database: Connected
🕐 Contest: 1 hour (5x speed)
📈 Timeframes: ${Object.keys(TIMEFRAMES).join(', ')}
🎯 Strategy: Progressive loading + Aggregation
========================================
✅ Server ready!
  `);
});
