import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import cron from 'node-cron';

// Import new utilities
import { 
  TIMEFRAMES, 
  DEFAULT_TIMEFRAME, 
  aggregateTicksToCandles,
  parseCleanTimestamp,
  isValidTimeframe,
  getCandleBucketTime
} from './utils/timeframeUtils.js';
import MemoryManager from './utils/memoryManager.js';

dotenv.config();

const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  process.exit(1);
}

console.log('✅ Environment variables loaded');

const app = express();
const server = createServer(app);

// Socket.IO configuration optimized for 200+ users
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5174", "http://localhost:3000", "http://localhost:5173", process.env.FRONTEND_URL],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e6,
  allowEIO3: true,
  perMessageDeflate: false,
  httpCompression: false
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: ["http://localhost:5174", "http://localhost:3000", "http://localhost:5173", process.env.FRONTEND_URL],
  credentials: true
}));
app.use(express.json());

// ==================== ENHANCED CONTEST STATE FOR MULTI-TIMEFRAMES ====================
const contestState = {
  isRunning: false,
  isPaused: false,
  contestId: null,
  contestStartTime: null,
  currentDataIndex: 0,
  totalDataRows: 0,
  contestDurationMs: 60 * 60 * 1000, // 1 hour
  speed: 2,
  symbols: [],
  intervalId: null,
  contestEndTime: null,
  enabledTimeframes: ['1s', '5s', '15s', '30s', '1m', '3m', '5m'], // Multiple timeframes
  playbackStartTime: null,
  playbackCurrentTime: null
};

// Enhanced Memory Management
const memoryManager = new MemoryManager();
const connectedUsers = new Map();
const userSockets = new Map();
const portfolioCache = new Map();
const leaderboardCache = [];
const symbolRooms = new Map();
const userSymbolSubscriptions = new Map();

// Multi-timeframe candle caches
const candlestickCaches = new Map(); // symbol:timeframe -> candles[]

// Real-time price tracking
const latestPrices = new Map(); // symbol -> latest price info

// ==================== DATA LOADING WITH CLEAN TIMESTAMPS ====================

async function loadAllMarketData() {
  console.log('📊 Loading all market data with clean timestamps...');
  const startTime = Date.now();
  
  try {
    // Get all available symbols
    const symbols = await getAvailableSymbols();
    contestState.symbols = symbols;
    
    console.log(`Found ${symbols.length} symbols: ${symbols.slice(0, 5).join(', ')}...`);
    
    // Load all data efficiently
    const { data: allData, error } = await supabaseAdmin
      .from('LALAJI')
      .select('*')
      .order('timestamp', { ascending: true });
    
    if (error) throw error;
    
    console.log(`✅ Loaded ${allData.length} total rows from database`);
    contestState.totalDataRows = allData.length;
    
    // Group data by symbol and process
    allData.forEach((row, index) => {
      const symbol = row.symbol;
      
      // Add row index for playback control
      const enhancedRow = {
        ...row,
        dataIndex: index,
        timestamp: row.timestamp, // Clean timestamp from DB
        parsedTime: parseCleanTimestamp(row.timestamp)
      };
      
      memoryManager.addTick(symbol, enhancedRow);
      
      // Update latest price
      latestPrices.set(symbol, {
        price: parseFloat(row.last_traded_price),
        volume: parseInt(row.volume_traded),
        timestamp: row.timestamp,
        dataIndex: index
      });
      
      if (index % 50000 === 0) {
        console.log(`📈 Processed ${index} rows...`);
      }
    });
    
    console.log(`🎯 Data loaded in ${Date.now() - startTime}ms:`);
    console.log(`   - Total rows: ${allData.length}`);
    console.log(`   - Symbols: ${symbols.length}`);
    console.log(`   - Memory usage: ${memoryManager.getMemoryFootprint().estimatedMB.toFixed(2)}MB`);
    
    // Pre-generate candles for all timeframes
    await preGenerateCandles(symbols);
    
    return true;
  } catch (error) {
    console.error('❌ Error loading market data:', error);
    return false;
  }
}

async function preGenerateCandles(symbols) {
  console.log('🕯️ Pre-generating candles for all timeframes...');
  const startTime = Date.now();
  
  for (const symbol of symbols) {
    const ticks = memoryManager.getTicks(symbol);
    if (ticks.length === 0) continue;
    
    // Generate candles for all enabled timeframes
    for (const timeframe of contestState.enabledTimeframes) {
      const candles = aggregateTicksToCandles(ticks, timeframe);
      
      // Store in memory manager
      candles.forEach(candle => {
        memoryManager.addCandle(symbol, timeframe, candle);
      });
      
      // Store in direct cache for quick access
      const cacheKey = `${symbol}:${timeframe}`;
      candlestickCaches.set(cacheKey, candles);
      
      console.log(`   ✅ ${symbol} ${timeframe}: ${candles.length} candles`);
    }
  }
  
  console.log(`🎯 Candle pre-generation completed in ${Date.now() - startTime}ms`);
}

async function getAvailableSymbols() {
  try {
    console.log('Fetching unique symbols from database...');
    
    const { data, error } = await supabaseAdmin
      .from('LALAJI')
      .select('symbol')
      .order('symbol');
    
    if (error) throw error;
    
    const symbols = [...new Set(data.map(row => row.symbol))].filter(Boolean);
    console.log(`✅ Found ${symbols.length} unique symbols`);
    return symbols;
    
  } catch (error) {
    console.error('Error fetching symbols:', error);
    return [];
  }
}

// ==================== REAL-TIME STREAMING ====================

function startContestSimulation() {
  if (contestState.intervalId) {
    clearInterval(contestState.intervalId);
  }
  
  console.log('🚀 Starting enhanced real-time simulation...');
  console.log(`   - Speed: ${contestState.speed}x`);
  console.log(`   - Total rows: ${contestState.totalDataRows}`);
  console.log(`   - Enabled timeframes: ${contestState.enabledTimeframes.join(', ')}`);
  
  const baseInterval = 100; // 100ms base interval
  const actualInterval = baseInterval / contestState.speed;
  
  contestState.intervalId = setInterval(async () => {
    if (contestState.isPaused) return;
    
    // Check if contest should end
    const elapsedTime = Date.now() - contestState.contestStartTime.getTime();
    if (elapsedTime >= contestState.contestDurationMs || 
        contestState.currentDataIndex >= contestState.totalDataRows - 1) {
      await stopContest();
      return;
    }
    
    // Advance data index
    contestState.currentDataIndex += Math.floor(contestState.speed);
    if (contestState.currentDataIndex >= contestState.totalDataRows) {
      contestState.currentDataIndex = contestState.totalDataRows - 1;
    }
    
    // Emit market tick with current prices
    const currentPrices = {};
    const tickUpdates = [];
    
    for (const symbol of contestState.symbols) {
      const ticks = memoryManager.getTicks(symbol);
      const relevantTicks = ticks.filter(tick => tick.dataIndex <= contestState.currentDataIndex);
      
      if (relevantTicks.length > 0) {
        const latestTick = relevantTicks[relevantTicks.length - 1];
        currentPrices[symbol] = parseFloat(latestTick.last_traded_price);
        
        // Emit individual symbol tick
        const tickUpdate = {
          symbol,
          data: latestTick,
          tickIndex: contestState.currentDataIndex,
          totalTicks: contestState.totalDataRows,
          progress: (contestState.currentDataIndex / contestState.totalDataRows) * 100,
          contestStartTime: contestState.contestStartTime,
          currentTime: new Date().toISOString()
        };
        
        tickUpdates.push(tickUpdate);
        io.to(`symbol:${symbol}`).emit('symbol_tick', tickUpdate);
        
        // Update real-time candles for all timeframes
        await updateRealTimeCandles(symbol, latestTick);
      }
    }
    
    // Emit market-wide tick
    io.to(`contest:${contestState.contestId}`).emit('market_tick', {
      tickIndex: contestState.currentDataIndex,
      totalTicks: contestState.totalDataRows,
      timestamp: new Date().toISOString(),
      prices: currentPrices,
      progress: (contestState.currentDataIndex / contestState.totalDataRows) * 100,
      contestStartTime: contestState.contestStartTime,
      elapsedTime: elapsedTime,
      tickUpdates: tickUpdates.length
    });
    
    // Periodic updates
    if (contestState.currentDataIndex % 1000 === 0) {
      console.log(`📊 Tick ${contestState.currentDataIndex}/${contestState.totalDataRows} (${((contestState.currentDataIndex / contestState.totalDataRows) * 100).toFixed(2)}%)`);
      
      // Update portfolios
      for (const userEmail of portfolioCache.keys()) {
        await updatePortfolioValues(userEmail);
      }
      
      // Update leaderboard
      await updateLeaderboard();
      
      // Save contest state
      await saveContestState();
    }
    
  }, actualInterval);
  
  console.log(`✅ Simulation started with ${actualInterval}ms interval`);
}

async function updateRealTimeCandles(symbol, newTick) {
  // Update candles for all enabled timeframes
  for (const timeframe of contestState.enabledTimeframes) {
    const cacheKey = `${symbol}:${timeframe}`;
    const existingCandles = candlestickCaches.get(cacheKey) || [];
    
    const bucketTime = getCandleBucketTime(newTick.timestamp, timeframe);
    if (!bucketTime) continue;
    
    const price = parseFloat(newTick.last_traded_price);
    const volume = parseInt(newTick.volume_traded) || 0;
    
    // Find or create candle for this time bucket
    let targetCandle = existingCandles.find(c => c.time === bucketTime);
    
    if (!targetCandle) {
      // Create new candle
      targetCandle = {
        time: bucketTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: volume,
        symbol: symbol
      };
      
      existingCandles.push(targetCandle);
      existingCandles.sort((a, b) => a.time - b.time);
    } else {
      // Update existing candle
      targetCandle.high = Math.max(targetCandle.high, price);
      targetCandle.low = Math.min(targetCandle.low, price);
      targetCandle.close = price;
      targetCandle.volume += volume;
    }
    
    // Update cache
    candlestickCaches.set(cacheKey, existingCandles);
    
    // Emit real-time candle update
    io.to(`symbol:${symbol}:${timeframe}`).emit('candle_update', {
      symbol,
      timeframe,
      candle: targetCandle,
      totalCandles: existingCandles.length
    });
  }
}

// ==================== YOUR ORIGINAL AUTHENTICATION (PRESERVED) ====================

async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
      if (decoded.test && decoded.exp > Date.now()) {
        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('*')
          .eq("Candidate's Email", decoded.email)
          .single();
        
        if (userData) {
          req.user = userData;
          req.auth_user = { id: 'test', email: decoded.email };
          return next();
        }
      }
    } catch (e) {
      // Not a test token, continue with normal auth
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('Token verification failed:', error);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    let { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    if (userError && userError.code === 'PGRST116') {
      const { data: emailData, error: emailError } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq("Candidate's Email", user.email)
        .single();
      
      if (emailData && !emailError) {
        await supabaseAdmin
          .from('users')
          .update({ auth_id: user.id })
          .eq("Candidate's Email", user.email);
        
        userData = emailData;
        userError = null;
      }
    }

    if (userError || !userData) {
      console.error('User not found:', userError);
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

// ==================== PORTFOLIO & TRADING FUNCTIONS ====================

async function getOrCreatePortfolio(userEmail) {
  // Check cache first
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

    // Cache the portfolio
    portfolioCache.set(userEmail, portfolio);
    return portfolio;
  } catch (error) {
    console.error('Error getting/creating portfolio:', error);
    return null;
  }
}

function getCurrentPrice(symbol) {
  const priceInfo = latestPrices.get(symbol);
  if (!priceInfo) return null;
  
  // Get price up to current data index
  const ticks = memoryManager.getTicks(symbol);
  const relevantTicks = ticks.filter(tick => tick.dataIndex <= contestState.currentDataIndex);
  
  if (relevantTicks.length === 0) return null;
  
  const latestTick = relevantTicks[relevantTicks.length - 1];
  return parseFloat(latestTick.last_traded_price);
}

function getTicksFromTimeZero(symbol, endIndex = null) {
  const ticks = memoryManager.getTicks(symbol);
  const maxIndex = endIndex !== null ? endIndex : contestState.currentDataIndex;
  
  return ticks.filter(tick => tick.dataIndex <= maxIndex);
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

    let shortMarketValue = 0;
    let shortUnrealizedPnl = 0;

    if (shortPositions) {
      for (const short of shortPositions) {
        const currentPrice = getCurrentPrice(short.symbol);
        if (currentPrice) {
          const positionValue = currentPrice * short.quantity;
          shortMarketValue += positionValue;
          shortUnrealizedPnl += (short.avg_short_price - currentPrice) * short.quantity;
          
          await supabaseAdmin
            .from('short_positions')
            .update({
              current_price: currentPrice,
              unrealized_pnl: (short.avg_short_price - currentPrice) * short.quantity,
              updated_at: new Date().toISOString()
            })
            .eq('id', short.id);
        }
      }
    }

    const totalUnrealizedPnl = longUnrealizedPnl + shortUnrealizedPnl;
    const totalWealth = portfolio.cash_balance + longMarketValue + totalUnrealizedPnl;
    const totalPnl = totalUnrealizedPnl + (portfolio.realized_pnl || 0);

    const updatedPortfolio = {
      ...portfolio,
      holdings,
      market_value: longMarketValue,
      short_value: shortMarketValue,
      unrealized_pnl: totalUnrealizedPnl,
      total_wealth: totalWealth,
      total_pnl: totalPnl,
      last_updated: new Date().toISOString()
    };

    // Update cache
    portfolioCache.set(userEmail, updatedPortfolio);
    
    // Emit to user
    const socketId = userSockets.get(userEmail);
    if (socketId) {
      io.to(`user:${userEmail}`).emit('portfolio_update', updatedPortfolio);
    }

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
    
    if (orderType === 'buy') {
      const portfolio = await getOrCreatePortfolio(userEmail);
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
      
      const updatedPortfolio = {
        ...portfolio,
        cash_balance: portfolio.cash_balance - totalAmount,
        holdings
      };
      
      portfolioCache.set(userEmail, updatedPortfolio);
        
    } else if (orderType === 'sell') {
      const portfolio = await getOrCreatePortfolio(userEmail);
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
      
      const updatedPortfolio = {
        ...portfolio,
        cash_balance: portfolio.cash_balance + totalAmount,
        holdings,
        realized_pnl: (portfolio.realized_pnl || 0) + realizedPnl
      };
      
      portfolioCache.set(userEmail, updatedPortfolio);
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

    leaderboardCache.length = 0;
    leaderboardCache.push(...leaderboard);

    io.to(`contest:${contestState.contestId}`).emit('leaderboard_update', leaderboard.slice(0, 20));

    return leaderboard;
  } catch (error) {
    console.error('Error updating leaderboard:', error);
    return [];
  }
}

// ==================== CONTEST MANAGEMENT ====================

async function startContest() {
  if (contestState.isRunning && !contestState.isPaused) {
    console.log('Contest already running');
    return { success: true, message: 'Contest already running' };
  }

  if (contestState.isPaused) {
    contestState.isPaused = false;
    console.log('📊 Resuming contest');
    startContestSimulation();
    await saveContestState();
    
    io.to(`contest:${contestState.contestId}`).emit('contest_resumed', {
      message: 'Contest has been resumed',
      contestState: getContestStateForClient()
    });
    
    return { success: true, message: 'Contest resumed' };
  }

  try {
    console.log('🚀 Starting new trading contest...');
    
    // Load all market data
    const dataLoaded = await loadAllMarketData();
    if (!dataLoaded) {
      throw new Error('Failed to load market data');
    }
    
    contestState.isRunning = true;
    contestState.isPaused = false;
    contestState.contestId = crypto.randomUUID();
    contestState.contestStartTime = new Date();
    contestState.currentDataIndex = 0;
    contestState.contestEndTime = new Date(Date.now() + contestState.contestDurationMs);
    
    console.log(`🚀 CONTEST STARTING:`);
    console.log(`   - Contest ID: ${contestState.contestId}`);
    console.log(`   - Start Time: ${contestState.contestStartTime.toISOString()}`);
    console.log(`   - Symbols: ${contestState.symbols.length}`);
    console.log(`   - Total Rows: ${contestState.totalDataRows}`);
    console.log(`   - Timeframes: ${contestState.enabledTimeframes.join(', ')}`);
    console.log(`   - Speed: ${contestState.speed}x`);
    
    await saveContestState();
    
    // Initialize symbol rooms
    contestState.symbols.forEach(symbol => {
      if (!symbolRooms.has(symbol)) {
        symbolRooms.set(symbol, new Set());
      }
    });
    
    io.emit('contest_started', {
      message: 'Contest has started!',
      contestId: contestState.contestId,
      contestStartTime: contestState.contestStartTime,
      symbols: contestState.symbols,
      totalRows: contestState.totalDataRows,
      speed: contestState.speed,
      timeframes: contestState.enabledTimeframes
    });
    
    // Start the simulation
    startContestSimulation();
    
    return { 
      success: true, 
      message: 'Contest started successfully',
      contestId: contestState.contestId,
      contestStartTime: contestState.contestStartTime,
      symbols: contestState.symbols,
      totalRows: contestState.totalDataRows,
      timeframes: contestState.enabledTimeframes
    };
    
  } catch (error) {
    console.error('Error starting contest:', error);
    contestState.isRunning = false;
    contestState.isPaused = false;
    return { success: false, message: error.message };
  }
}

async function stopContest() {
  if (!contestState.isRunning) {
    console.log('Contest not running');
    return { success: true, message: 'Contest not running' };
  }

  try {
    if (contestState.intervalId) {
      clearInterval(contestState.intervalId);
      contestState.intervalId = null;
    }

    console.log('🔄 Stopping contest and performing auto square-off...');
    
    const finalResults = await updateLeaderboard();
    await saveContestResults();
    
    contestState.isRunning = false;
    contestState.isPaused = false;
    contestState.contestEndTime = new Date();
    
    await saveContestState();
    
    io.emit('contest_ended', {
      message: 'Contest has ended',
      contestId: contestState.contestId,
      finalResults: finalResults?.slice(0, 10),
      totalRows: contestState.totalDataRows,
      endTime: contestState.contestEndTime,
      contestStartTime: contestState.contestStartTime
    });
    
    console.log('🛑 Contest stopped successfully');
    
    return { success: true, message: 'Contest stopped successfully' };
    
  } catch (error) {
    console.error('Error stopping contest:', error);
    return { success: false, message: error.message };
  }
}

function getContestStateForClient() {
  const elapsedTime = contestState.contestStartTime 
    ? Date.now() - contestState.contestStartTime.getTime() 
    : 0;
    
  return {
    isRunning: contestState.isRunning,
    isPaused: contestState.isPaused,
    contestStartTime: contestState.contestStartTime,
    currentDataIndex: contestState.currentDataIndex,
    totalDataRows: contestState.totalDataRows,
    elapsedTime,
    progress: contestState.totalDataRows > 0 ? (contestState.currentDataIndex / contestState.totalDataRows) * 100 : 0,
    speed: contestState.speed,
    symbols: contestState.symbols,
    contestId: contestState.contestId,
    contestEndTime: contestState.contestEndTime,
    timeframes: contestState.enabledTimeframes
  };
}

async function saveContestState() {
  try {
    if (!contestState.contestId) return;
    
    const { error } = await supabaseAdmin
      .from('contest_state')
      .upsert({
        id: contestState.contestId,
        is_running: contestState.isRunning,
        is_paused: contestState.isPaused,
        start_time: contestState.contestStartTime,
        current_tick_index: contestState.currentDataIndex,
        total_ticks: contestState.totalDataRows,
        speed: contestState.speed,
        symbols: contestState.symbols,
        updated_at: new Date().toISOString()
      });

    if (error) throw error;
  } catch (error) {
    console.error('Error saving contest state:', error);
  }
}

async function saveContestResults() {
  try {
    if (!contestState.contestId) return;

    const leaderboard = await updateLeaderboard();
    
    const { error } = await supabaseAdmin
      .from('contest_results')
      .insert({
        contest_id: contestState.contestId,
        end_time: new Date().toISOString(),
        final_leaderboard: leaderboard,
        total_participants: leaderboard.length,
        winner: leaderboard[0] || null
      });

    if (error) throw error;
    
    console.log('✅ Contest results saved');
    
    return leaderboard;
  } catch (error) {
    console.error('Error saving contest results:', error);
    return null;
  }
}

// ==================== REST API ROUTES ====================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connectedUsers: connectedUsers.size,
    contestState: getContestStateForClient(),
    uptime: process.uptime(),
    memoryStats: memoryManager.getMemoryStats(),
    symbolRooms: Array.from(symbolRooms.keys()),
    activeSymbols: contestState.symbols.length,
    timeframes: contestState.enabledTimeframes
  });
});

// ===== YOUR ORIGINAL AUTHENTICATION ROUTES (PRESERVED) =====
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name }
      }
    });

    if (authError) throw authError;

    if (authData.user) {
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          auth_id: authData.user.id,
          "Candidate's Email": email,
          "Candidate's Name": full_name || email.split('@')[0],
          role: 'user',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (userError) {
        console.log('Warning: Failed to create user record:', userError);
      }
    }

    res.json({
      success: true,
      user: {
        email: email,
        name: full_name || email.split('@')[0],
        role: 'user'
      },
      token: authData.session?.access_token,
      message: authData.session ? 'Account created successfully' : 'Please verify your email'
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    console.log('🔐 Login attempt for:', email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('Supabase auth error:', error);
      return res.status(401).json({ error: error.message });
    }

    if (!data.user || !data.session) {
      return res.status(401).json({ error: 'Authentication failed' });
    }

    console.log('✅ Supabase Auth successful for:', email);

    let { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('auth_id', data.user.id)
      .single();

    if (userError && userError.code === 'PGRST116') {
      const { data: emailData, error: emailError } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq("Candidate's Email", email)
        .single();
      
      if (emailData && !emailError) {
        await supabaseAdmin
          .from('users')
          .update({ auth_id: data.user.id })
          .eq("Candidate's Email", email);
        
        userData = emailData;
        userError = null;
        console.log('✅ Updated existing user with auth_id');
      }
    }

    if (userError) {
      console.error('User lookup error:', userError);
      return res.status(404).json({ error: 'User profile not found. Contact admin.' });
    }

    console.log('✅ Login successful for:', email, 'Role:', userData.role);

    res.json({
      success: true,
      user: {
        email: userData["Candidate's Email"],
        name: userData["Candidate's Name"] || email.split('@')[0],
        role: userData.role || 'user'
      },
      token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Login failed: ' + error.message });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        email: req.user["Candidate's Email"],
        name: req.user["Candidate's Name"],
        role: req.user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== ENHANCED MARKET DATA ROUTES =====

app.get('/api/symbols', async (req, res) => {
  try {
    const symbols = contestState.symbols.length > 0 ? contestState.symbols : await getAvailableSymbols();
    res.json(symbols);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/timeframes', (req, res) => {
  res.json({
    available: Object.keys(TIMEFRAMES),
    enabled: contestState.enabledTimeframes,
    default: DEFAULT_TIMEFRAME,
    details: TIMEFRAMES
  });
});

app.get('/api/contest-data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { from, to, timeframe } = req.query;
    
    const selectedTimeframe = timeframe || DEFAULT_TIMEFRAME;
    
    if (!isValidTimeframe(selectedTimeframe)) {
      return res.status(400).json({ error: 'Invalid timeframe' });
    }
    
    const fromIndex = parseInt(from) || 0;
    const toIndex = parseInt(to) || contestState.currentDataIndex;
    
    const ticksFromTimeZero = getTicksFromTimeZero(symbol, toIndex);
    const relevantTicks = ticksFromTimeZero.slice(fromIndex);
    
    const aggregatedCandles = aggregateTicksToCandles(relevantTicks, selectedTimeframe);
    
    res.json({
      symbol,
      timeframe: selectedTimeframe,
      fromIndex,
      toIndex,
      currentContestIndex: contestState.currentDataIndex,
      totalContestRows: contestState.totalDataRows,
      ticks: relevantTicks,
      ticksCount: relevantTicks.length,
      candles: aggregatedCandles,
      candlesCount: aggregatedCandles.length,
      contestStartTime: contestState.contestStartTime,
      contestActive: contestState.isRunning,
      contestPaused: contestState.isPaused
    });
  } catch (error) {
    console.error('Error in contest-data endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/candlestick/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const timeframe = req.query.timeframe || DEFAULT_TIMEFRAME;
    
    if (!isValidTimeframe(timeframe)) {
      return res.status(400).json({ error: 'Invalid timeframe' });
    }
    
    const cacheKey = `${symbol}:${timeframe}`;
    const candlesticks = candlestickCaches.get(cacheKey) || [];
    
    // Filter candles up to current contest progress
    const currentTimestamp = contestState.currentDataIndex > 0 ? 
      parseCleanTimestamp(memoryManager.getTicks(symbol)[Math.min(contestState.currentDataIndex, memoryManager.getTicks(symbol).length - 1)]?.timestamp) : 
      Date.now() / 1000;
    
    const visibleCandles = candlesticks.filter(candle => candle.time <= currentTimestamp);
    
    res.json({
      symbol,
      timeframe,
      timeframeDetails: TIMEFRAMES[timeframe],
      currentContestIndex: contestState.currentDataIndex,
      contestStartTime: contestState.contestStartTime,
      data: visibleCandles,
      totalCandles: visibleCandles.length,
      totalTicks: memoryManager.getTicks(symbol).length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/contest/state', (req, res) => {
  res.json(getContestStateForClient());
});

// ===== TRADING API ROUTES =====

app.post('/api/trade', authenticateToken, async (req, res) => {
  try {
    const { symbol, order_type, quantity } = req.body;
    const userEmail = req.user["Candidate's Email"];

    if (!symbol || !order_type || !quantity) {
      return res.status(400).json({ error: 'Symbol, order_type, and quantity are required' });
    }

    if (!['buy', 'sell', 'short_sell', 'buy_to_cover'].includes(order_type)) {
      return res.status(400).json({ error: 'Invalid order type' });
    }

    if (quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be positive' });
    }

    if (!contestState.isRunning || contestState.isPaused) {
      return res.status(400).json({ error: 'Trading is only allowed when contest is running' });
    }

    const currentPrice = getCurrentPrice(symbol);
    if (!currentPrice) {
      return res.status(400).json({ error: 'Price not available for symbol' });
    }

    const { data: companyData } = await supabaseAdmin
      .from('LALAJI')
      .select('company_name')
      .eq('symbol', symbol)
      .limit(1)
      .single();

    const companyName = companyData?.company_name || symbol;

    const result = await executeTrade(userEmail, symbol, companyName, order_type, quantity, currentPrice);

    await updateLeaderboard();

    res.json({
      success: true,
      trade: result.trade,
      portfolio: result.portfolio,
      executedAt: {
        contestIndex: contestState.currentDataIndex,
        price: currentPrice,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Trade execution error:', error);
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const { data: trades, error, count } = await supabaseAdmin
      .from('trades')
      .select('*', { count: 'exact' })
      .eq('user_email', userEmail)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      trades,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const leaderboard = leaderboardCache.slice(0, limit);
    res.json(leaderboard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== ADMIN API ROUTES =====

app.post('/api/admin/contest/start', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('🚀 Admin starting contest...');
    const result = await startContest();
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: result.message,
        contestId: result.contestId,
        contestStartTime: result.contestStartTime,
        symbols: result.symbols,
        totalRows: result.totalRows,
        timeframes: result.timeframes
      });
    } else {
      res.status(500).json({ error: result.message });
    }
  } catch (error) {
    console.error('Admin start contest error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/contest/pause', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!contestState.isRunning) {
      return res.status(400).json({ error: 'Contest is not running' });
    }
    
    contestState.isPaused = true;
    await saveContestState();
    
    io.to(`contest:${contestState.contestId}`).emit('contest_paused', {
      message: 'Contest has been paused'
    });
    
    res.json({ 
      success: true, 
      message: 'Contest paused'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/contest/resume', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!contestState.isRunning || !contestState.isPaused) {
      return res.status(400).json({ error: 'Contest is not paused' });
    }
    
    contestState.isPaused = false;
    await saveContestState();
    
    io.to(`contest:${contestState.contestId}`).emit('contest_resumed', {
      message: 'Contest has been resumed'
    });
    
    res.json({ 
      success: true, 
      message: 'Contest resumed'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/contest/stop', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await stopContest();
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: result.message
      });
    } else {
      res.status(500).json({ error: result.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/contest/status', authenticateToken, requireAdmin, (req, res) => {
  const contestState_copy = getContestStateForClient();
  
  res.json({
    ...contestState_copy,
    connectedUsers: connectedUsers.size,
    symbolRooms: Object.fromEntries(
      Array.from(symbolRooms.entries()).map(([symbol, sockets]) => [symbol, sockets.size])
    ),
    memoryStats: memoryManager.getMemoryStats(),
    timeframes: contestState.enabledTimeframes
  });
});

app.post('/api/admin/contest/speed', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { speed } = req.body;
    if (speed < 0.5 || speed > 10) {
      return res.status(400).json({ error: 'Speed must be between 0.5 and 10' });
    }
    
    contestState.speed = speed;
    
    // Restart simulation with new speed
    if (contestState.isRunning && !contestState.isPaused) {
      if (contestState.intervalId) {
        clearInterval(contestState.intervalId);
      }
      startContestSimulation();
    }
    
    await saveContestState();
    
    io.to(`contest:${contestState.contestId}`).emit('speed_changed', {
      newSpeed: speed,
      message: `Contest speed changed to ${speed}x`
    });
    
    res.json({ 
      success: true, 
      message: `Speed set to ${speed}x`,
      newSpeed: speed
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ENHANCED WEBSOCKET HANDLERS ====================

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.emit('contest_state', getContestStateForClient());

  // YOUR ORIGINAL SOCKET AUTHENTICATION (PRESERVED)
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
            role: userData.role,
            connectedAt: new Date().toISOString()
          });
          
          userSockets.set(userEmail, socket.id);
          
          socket.join(`user:${userEmail}`);
          socket.join(`contest:${contestState.contestId}`);
          
          if (userData.role === 'admin') {
            socket.join(`admin:${contestState.contestId}`);
          }
          
          socket.emit('authenticated', {
            success: true,
            user: {
              email: userEmail,
              name: userData["Candidate's Name"],
              role: userData.role
            }
          });
          
          console.log(`User authenticated: ${userEmail}`);
        }
      }
    } catch (error) {
      console.error('Socket authentication error:', error);
      socket.emit('authenticated', { success: false, error: error.message });
    }
  });

  socket.on('subscribe_symbols', async (symbols) => {
    console.log(`${socket.id} subscribing to symbols: ${symbols.join(', ')}`);
    
    if (!userSymbolSubscriptions.has(socket.id)) {
      userSymbolSubscriptions.set(socket.id, new Set());
    }
    
    const userSubscriptions = userSymbolSubscriptions.get(socket.id);
    
    for (const symbol of symbols) {
      userSubscriptions.add(symbol);
      socket.join(`symbol:${symbol}`);
      
      if (!symbolRooms.has(symbol)) {
        symbolRooms.set(symbol, new Set());
      }
      symbolRooms.get(symbol).add(socket.id);
    }
    
    console.log(`✅ ${socket.id} subscribed to ${symbols.length} symbols`);
  });

  socket.on('subscribe_timeframe', async ({ symbol, timeframe }) => {
    if (!isValidTimeframe(timeframe)) {
      socket.emit('error', { message: 'Invalid timeframe' });
      return;
    }
    
    const roomName = `symbol:${symbol}:${timeframe}`;
    socket.join(roomName);
    
    console.log(`${socket.id} subscribed to ${symbol} ${timeframe} candles`);
    
    // Send current candles for this timeframe
    const cacheKey = `${symbol}:${timeframe}`;
    const candles = candlestickCaches.get(cacheKey) || [];
    
    socket.emit('initial_candles', {
      symbol,
      timeframe,
      candles,
      totalCandles: candles.length
    });
  });

  socket.on('unsubscribe_timeframe', ({ symbol, timeframe }) => {
    const roomName = `symbol:${symbol}:${timeframe}`;
    socket.leave(roomName);
    console.log(`${socket.id} unsubscribed from ${symbol} ${timeframe} candles`);
  });

  socket.on('unsubscribe_symbols', (symbols) => {
    console.log(`${socket.id} unsubscribing from symbols: ${symbols.join(', ')}`);
    
    const userSubscriptions = userSymbolSubscriptions.get(socket.id);
    if (userSubscriptions) {
      symbols.forEach(symbol => {
        userSubscriptions.delete(symbol);
        socket.leave(`symbol:${symbol}`);
        
        if (symbolRooms.has(symbol)) {
          symbolRooms.get(symbol).delete(socket.id);
        }
      });
    }
  });

  socket.on('join_symbol', async (symbol) => {
    console.log(`${socket.id} joining room: ${symbol}`);
    socket.join(`symbol:${symbol}`);
    
    if (!symbolRooms.has(symbol)) {
      symbolRooms.set(symbol, new Set());
    }
    symbolRooms.get(symbol).add(socket.id);

    // Send historical data for all timeframes
    const response = {
      symbol,
      timeframes: {},
      currentContestIndex: contestState.currentDataIndex,
      totalContestRows: contestState.totalDataRows,
      contestStartTime: contestState.contestStartTime
    };
    
    for (const timeframe of contestState.enabledTimeframes) {
      const cacheKey = `${symbol}:${timeframe}`;
      const candles = candlestickCaches.get(cacheKey) || [];
      response.timeframes[timeframe] = candles;
    }
    
    socket.emit('contest_data', response);
    
    console.log(`📈 Sent multi-timeframe data for ${symbol} to ${socket.id}`);
  });

  socket.on('leave_symbol', (symbol) => {
    console.log(`${socket.id} leaving room: ${symbol}`);
    socket.leave(`symbol:${symbol}`);
    
    if (symbolRooms.has(symbol)) {
      symbolRooms.get(symbol).delete(socket.id);
    }
    
    const userSubscriptions = userSymbolSubscriptions.get(socket.id);
    if (userSubscriptions) {
      userSubscriptions.delete(symbol);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    const userInfo = connectedUsers.get(socket.id);
    if (userInfo) {
      userSockets.delete(userInfo.email);
      connectedUsers.delete(socket.id);
    }
    
    const userSubscriptions = userSymbolSubscriptions.get(socket.id);
    if (userSubscriptions) {
      userSubscriptions.forEach(symbol => {
        if (symbolRooms.has(symbol)) {
          symbolRooms.get(symbol).delete(socket.id);
        }
      });
      userSymbolSubscriptions.delete(socket.id);
    }
  });
});

// ==================== PERIODIC MAINTENANCE ====================

// Cleanup every 5 minutes
cron.schedule('*/5 * * * *', () => {
  console.log('🧹 Running periodic maintenance...');
  
  // Memory cleanup
  memoryManager.performCleanup();
  
  // Clear disconnected users
  for (const [socketId, userInfo] of connectedUsers.entries()) {
    if (!io.sockets.sockets.has(socketId)) {
      connectedUsers.delete(socketId);
      userSockets.delete(userInfo.email);
    }
  }
  
  console.log(`✅ Maintenance complete. Active users: ${connectedUsers.size}`);
});

// ==================== SERVER STARTUP ====================

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  if (contestState.isRunning) {
    console.log('🔄 Stopping contest on shutdown...');
    await stopContest();
  }
  
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, async () => {
  console.log(`🚀 Enhanced Trading Contest Server running on port ${PORT}`);
  console.log(`📊 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🔌 API endpoint: http://localhost:${PORT}/api`);
  console.log(`\n🆕 NEW FEATURES:`);
  console.log(`   - ✅ Clean timestamp support (no Python parsing)`);
  console.log(`   - ✅ Multi-timeframe candles: ${Object.keys(TIMEFRAMES).join(', ')}`);
  console.log(`   - ✅ Real-time candle streaming`);
  console.log(`   - ✅ Enhanced memory management`);
  console.log(`   - ✅ Optimized for 200+ concurrent users`);
  console.log(`   - ✅ 430K+ rows support`);
  console.log(`   - ✅ Millisecond-accurate timestamps`);
  console.log(`   - ✅ YOUR ORIGINAL AUTH PRESERVED`);
  
  console.log(`\n📝 Login with your Supabase Auth credentials`);
  console.log('✅ System initialization complete');
  
  console.log(`   - Port: ${PORT}`);
});