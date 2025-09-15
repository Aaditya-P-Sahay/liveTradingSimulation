import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.error('\n💡 Please check your .env file');
  process.exit(1);
}

console.log('✅ Environment variables loaded');
console.log(`🔗 Supabase URL: ${process.env.SUPABASE_URL}`);
console.log(`🔑 Using Anon Key (RLS is disabled)`);

const app = express();
const server = createServer(app);

// Configure Socket.IO
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000", process.env.FRONTEND_URL],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e6,
  allowEIO3: true
});

// Single Supabase client - works because RLS is disabled
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:3000", process.env.FRONTEND_URL],
  credentials: true
}));
app.use(express.json());

// ==================== GLOBAL MARKET STATE ====================
const globalMarketState = {
  isRunning: false,
  isPaused: false,
  startTime: null,
  currentTickIndex: 0,
  totalTicks: 0,
  speed: 2,
  intervalId: null,
  contestId: null,
  maxDuration: 60 * 60 * 1000,
  symbols: []
};

// In-memory data store
const stockDataCache = new Map();
const connectedUsers = new Set();
const userSockets = new Map();
const portfolioCache = new Map();
const leaderboardCache = [];

// ==================== CONTEST STATE PERSISTENCE ====================

async function saveContestState() {
  try {
    if (!globalMarketState.contestId) return;
    
    const { error } = await supabase
      .from('contest_state')
      .upsert({
        id: globalMarketState.contestId,
        is_running: globalMarketState.isRunning,
        is_paused: globalMarketState.isPaused,
        start_time: globalMarketState.startTime,
        current_tick_index: globalMarketState.currentTickIndex,
        total_ticks: globalMarketState.totalTicks,
        speed: globalMarketState.speed,
        symbols: globalMarketState.symbols,
        updated_at: new Date().toISOString()
      });

    if (error) throw error;
    console.log('✅ Contest state saved');
  } catch (error) {
    console.error('Error saving contest state:', error);
  }
}

async function loadContestState() {
  try {
    const { data, error } = await supabase
      .from('contest_state')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    
    if (data && data.is_running && !data.is_paused) {
      globalMarketState.contestId = data.id;
      globalMarketState.isRunning = data.is_running;
      globalMarketState.isPaused = data.is_paused;
      globalMarketState.startTime = new Date(data.start_time);
      globalMarketState.currentTickIndex = data.current_tick_index;
      globalMarketState.totalTicks = data.total_ticks;
      globalMarketState.speed = data.speed || 2;
      globalMarketState.symbols = data.symbols || [];
      
      console.log(`📊 Resuming contest from tick ${globalMarketState.currentTickIndex}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error loading contest state:', error);
    return false;
  }
}

// ==================== AUTHENTICATION MIDDLEWARE ====================

async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Check for test token
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
      if (decoded.test && decoded.exp > Date.now()) {
        const { data: userData } = await supabase
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
      // Not a test token
    }

    // Normal Supabase auth
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    if (userError || !userData) {
      return res.status(401).json({ error: 'User not found' });
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

// ==================== UTILITY FUNCTIONS ====================

function normalizeTimestamp(timestamp) {
  if (!timestamp) return new Date().toISOString();
  
  if (timestamp.includes(':') && !timestamp.includes('T')) {
    const [minutes, seconds] = timestamp.split(':');
    const [sec, ms] = seconds.split('.');
    
    const marketStart = new Date();
    marketStart.setHours(9, 15, 0, 0);
    marketStart.setMinutes(marketStart.getMinutes() + parseInt(minutes));
    marketStart.setSeconds(parseInt(sec));
    marketStart.setMilliseconds(parseInt(ms || 0) * 100);
    
    return marketStart.toISOString();
  }
  
  return timestamp;
}

function getCurrentPrice(symbol) {
  const data = stockDataCache.get(symbol);
  if (!data || data.length === 0) return null;
  
  const tickIndex = Math.min(globalMarketState.currentTickIndex, data.length - 1);
  return data[tickIndex]?.last_traded_price || null;
}

function getHistoricalDataUpToTick(symbol, endTick = null) {
  const data = stockDataCache.get(symbol);
  if (!data || data.length === 0) return [];
  
  const toTick = endTick !== null ? 
    Math.min(endTick, data.length - 1) : 
    Math.min(globalMarketState.currentTickIndex, data.length - 1);
  
  return data.slice(0, toTick + 1);
}

// ==================== PORTFOLIO & TRADING FUNCTIONS ====================

async function getOrCreatePortfolio(userEmail) {
  try {
    let { data: portfolio, error } = await supabase
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
        total_pnl: 0
      };

      const { data, error: insertError } = await supabase
        .from('portfolio')
        .insert(newPortfolio)
        .select()
        .single();

      if (insertError) throw insertError;
      portfolio = data;
    } else if (error) {
      throw error;
    }

    return portfolio;
  } catch (error) {
    console.error('Error getting/creating portfolio:', error);
    return null;
  }
}

async function updatePortfolio(userEmail) {
  try {
    const portfolio = await getOrCreatePortfolio(userEmail);
    if (!portfolio) return null;

    let marketValue = 0;
    let unrealizedPnl = 0;

    const holdings = portfolio.holdings || {};
    for (const [symbol, position] of Object.entries(holdings)) {
      const currentPrice = getCurrentPrice(symbol);
      if (currentPrice && position.quantity > 0) {
        const positionValue = currentPrice * position.quantity;
        marketValue += positionValue;
        unrealizedPnl += (currentPrice - position.avg_price) * position.quantity;
      }
    }

    const { data: shortPositions } = await supabase
      .from('short_positions')
      .select('*')
      .eq('user_email', userEmail)
      .eq('is_active', true);

    let shortValue = 0;
    let shortUnrealizedPnl = 0;

    if (shortPositions) {
      for (const short of shortPositions) {
        const currentPrice = getCurrentPrice(short.symbol);
        if (currentPrice) {
          const positionValue = currentPrice * short.quantity;
          shortValue += positionValue;
          shortUnrealizedPnl += (short.avg_short_price - currentPrice) * short.quantity;
        }
      }
    }

    const totalUnrealizedPnl = unrealizedPnl + shortUnrealizedPnl;
    const totalWealth = portfolio.cash_balance + marketValue - shortValue;

    const { data: updatedPortfolio, error } = await supabase
      .from('portfolio')
      .update({
        market_value: marketValue,
        short_value: shortValue,
        unrealized_pnl: totalUnrealizedPnl,
        total_wealth: totalWealth,
        total_pnl: totalUnrealizedPnl + (portfolio.realized_pnl || 0),
        last_updated: new Date().toISOString()
      })
      .eq('user_email', userEmail)
      .select()
      .single();

    if (error) throw error;

    portfolioCache.set(userEmail, updatedPortfolio);
    
    const socketId = userSockets.get(userEmail);
    if (socketId) {
      io.to(socketId).emit('portfolio_update', updatedPortfolio);
    }

    return updatedPortfolio;
  } catch (error) {
    console.error('Error updating portfolio:', error);
    return null;
  }
}

async function executeTrade(userEmail, symbol, companyName, orderType, quantity, price) {
  try {
    const portfolio = await getOrCreatePortfolio(userEmail);
    if (!portfolio) throw new Error('Failed to get portfolio');

    const totalAmount = price * quantity;
    
    if (orderType === 'buy') {
      if (portfolio.cash_balance < totalAmount) {
        throw new Error('Insufficient cash balance');
      }
      
      const holdings = portfolio.holdings || {};
      if (holdings[symbol]) {
        const newQuantity = holdings[symbol].quantity + quantity;
        const newAvgPrice = ((holdings[symbol].avg_price * holdings[symbol].quantity) + (price * quantity)) / newQuantity;
        holdings[symbol] = {
          quantity: newQuantity,
          avg_price: newAvgPrice,
          company_name: companyName
        };
      } else {
        holdings[symbol] = {
          quantity,
          avg_price: price,
          company_name: companyName
        };
      }
      
      await supabase
        .from('portfolio')
        .update({
          cash_balance: portfolio.cash_balance - totalAmount,
          holdings
        })
        .eq('user_email', userEmail);
        
    } else if (orderType === 'sell') {
      const holdings = portfolio.holdings || {};
      if (!holdings[symbol] || holdings[symbol].quantity < quantity) {
        throw new Error('Insufficient holdings');
      }
      
      holdings[symbol].quantity -= quantity;
      if (holdings[symbol].quantity === 0) {
        delete holdings[symbol];
      }
      
      await supabase
        .from('portfolio')
        .update({
          cash_balance: portfolio.cash_balance + totalAmount,
          holdings
        })
        .eq('user_email', userEmail);
    }
    
    const { data: trade, error } = await supabase
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

    const updatedPortfolio = await updatePortfolio(userEmail);

    return { trade, portfolio: updatedPortfolio };
  } catch (error) {
    console.error('Trade execution error:', error);
    throw error;
  }
}

async function updateLeaderboard() {
  try {
    const { data, error } = await supabase
      .from('portfolio')
      .select('*')
      .order('total_wealth', { ascending: false });

    if (error) throw error;

    const { data: users } = await supabase
      .from('users')
      .select('*');

    const userMap = new Map(users?.map(u => [u["Candidate's Email"], u]) || []);

    const leaderboard = (data || []).map((p, index) => ({
      rank: index + 1,
      user_name: userMap.get(p.user_email)?.["Candidate's Name"] || p.user_email,
      user_email: p.user_email,
      total_wealth: p.total_wealth,
      total_pnl: p.total_pnl,
      return_percentage: ((p.total_wealth - 1000000) / 1000000) * 100
    }));

    leaderboardCache.length = 0;
    leaderboardCache.push(...leaderboard);

    return leaderboard;
  } catch (error) {
    console.error('Error updating leaderboard:', error);
    return [];
  }
}

async function saveContestResults() {
  try {
    if (!globalMarketState.contestId) return;

    const leaderboard = await updateLeaderboard();
    
    const { error } = await supabase
      .from('contest_results')
      .insert({
        contest_id: globalMarketState.contestId,
        end_time: new Date().toISOString(),
        final_leaderboard: leaderboard,
        total_participants: leaderboard.length,
        winner: leaderboard[0] || null
      });

    if (error) throw error;
    
    console.log('✅ Contest results saved');
    console.log('🏆 Winner:', leaderboard[0]?.user_name || 'No participants');
    
    return leaderboard;
  } catch (error) {
    console.error('Error saving contest results:', error);
    return null;
  }
}

// ==================== MARKET DATA FUNCTIONS ====================

async function loadStockData(symbol) {
  try {
    console.log(`Loading data for ${symbol}...`);
    
    let allData = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('LALAJI')
        .select('*')
        .eq('symbol', symbol)
        .order('unique_id', { ascending: true })
        .range(from, from + batchSize - 1);
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        allData = allData.concat(data);
        from += batchSize;
        hasMore = data.length === batchSize;
        console.log(`  Loaded batch: ${data.length} rows (total so far: ${allData.length})`);
      } else {
        hasMore = false;
      }
    }

    if (allData.length === 0) {
      console.log(`No data found for ${symbol}`);
      return [];
    }

    const processedData = allData.map(row => ({
      ...row,
      normalized_timestamp: normalizeTimestamp(row.timestamp),
      last_traded_price: parseFloat(row.last_traded_price) || 0,
      volume_traded: parseInt(row.volume_traded) || 0,
      high_price: parseFloat(row.high_price) || 0,
      low_price: parseFloat(row.low_price) || 0,
      close_price: parseFloat(row.close_price) || 0,
      open_price: parseFloat(row.open_price) || 0,
      average_traded_price: parseFloat(row.average_traded_price) || 0
    })).sort((a, b) => new Date(a.normalized_timestamp) - new Date(b.normalized_timestamp));

    stockDataCache.set(symbol, processedData);
    console.log(`✅ Loaded ${processedData.length} total data points for ${symbol}`);
    
    if (globalMarketState.totalTicks === 0 || processedData.length < globalMarketState.totalTicks) {
      globalMarketState.totalTicks = processedData.length;
    }
    
    return processedData;
  } catch (error) {
    console.error(`Error loading data for ${symbol}:`, error);
    return [];
  }
}

async function getAvailableSymbols() {
  try {
    console.log('Fetching unique symbols from database...');
    
    const uniqueSymbols = new Set();
    let lastId = 0;
    let batchCount = 0;
    let noNewSymbolsCount = 0;
    let previousSize = 0;
    
    while (batchCount < 100) {
      const { data: batch, error } = await supabase
        .from('LALAJI')
        .select('unique_id, symbol')
        .gt('unique_id', lastId)
        .order('unique_id', { ascending: true })
        .limit(1000);
      
      if (error) {
        console.error('Error fetching batch:', error);
        break;
      }
      
      if (!batch || batch.length === 0) {
        break;
      }
      
      previousSize = uniqueSymbols.size;
      
      batch.forEach(row => {
        if (row.symbol) {
          uniqueSymbols.add(row.symbol);
        }
      });
      
      console.log(`  Batch ${++batchCount}: ${batch.length} rows, ${uniqueSymbols.size} unique symbols so far`);
      
      if (uniqueSymbols.size === previousSize) {
        noNewSymbolsCount++;
        if (noNewSymbolsCount >= 3) {
          console.log('  No new symbols found in 3 batches, stopping search');
          break;
        }
      } else {
        noNewSymbolsCount = 0;
      }
      
      lastId = batch[batch.length - 1].unique_id;
      
      if (batch.length < 1000) {
        break;
      }
    }
    
    const symbols = Array.from(uniqueSymbols).sort();
    console.log(`✅ Found ${symbols.length} unique symbols: ${symbols.join(', ')}`);
    return symbols;
    
  } catch (error) {
    console.error('Error fetching symbols:', error);
    return [];
  }
}

// ==================== GLOBAL MARKET SIMULATION ====================

async function startGlobalMarketSimulation() {
  if (globalMarketState.isRunning && !globalMarketState.isPaused) {
    console.log('Market simulation already running');
    return;
  }

  if (globalMarketState.isPaused) {
    globalMarketState.isPaused = false;
    console.log('📊 Resuming market simulation');
    await saveContestState();
    return;
  }

  globalMarketState.isRunning = true;
  globalMarketState.isPaused = false;
  globalMarketState.startTime = new Date();
  globalMarketState.currentTickIndex = 0;
  globalMarketState.contestId = crypto.randomUUID();
  
  const symbols = await getAvailableSymbols();
  globalMarketState.symbols = symbols;
  
  console.log('📊 Loading market data for all symbols...');
  for (const symbol of symbols) {
    await loadStockData(symbol);
  }
  
  console.log(`🚀 Starting global market simulation at ${globalMarketState.speed}x speed`);
  console.log(`📈 Total ticks: ${globalMarketState.totalTicks}`);
  console.log(`⏱️  Expected duration: ${(globalMarketState.totalTicks * 500) / 60000} minutes`);
  
  await saveContestState();
  
  globalMarketState.intervalId = setInterval(async () => {
    if (globalMarketState.isPaused) return;
    
    const elapsedTime = Date.now() - globalMarketState.startTime.getTime();
    if (elapsedTime >= globalMarketState.maxDuration) {
      console.log('⏰ Contest duration reached (1 hour). Stopping simulation.');
      await stopGlobalMarketSimulation();
      return;
    }
    
    if (globalMarketState.currentTickIndex >= globalMarketState.totalTicks) {
      console.log('📊 All market data exhausted. Stopping simulation.');
      await stopGlobalMarketSimulation();
      return;
    }
    
    globalMarketState.currentTickIndex++;
    
    const tickData = {};
    for (const symbol of globalMarketState.symbols) {
      const price = getCurrentPrice(symbol);
      if (price) {
        tickData[symbol] = price;
      }
    }
    
    io.emit('market_tick', {
      tickIndex: globalMarketState.currentTickIndex,
      totalTicks: globalMarketState.totalTicks,
      timestamp: new Date().toISOString(),
      prices: tickData,
      progress: (globalMarketState.currentTickIndex / globalMarketState.totalTicks) * 100
    });
    
    for (const symbol of globalMarketState.symbols) {
      const data = stockDataCache.get(symbol);
      if (data && data[globalMarketState.currentTickIndex]) {
        io.to(symbol).emit('symbol_tick', {
          symbol,
          data: data[globalMarketState.currentTickIndex],
          tickIndex: globalMarketState.currentTickIndex
        });
      }
    }
    
    if (globalMarketState.currentTickIndex % 100 === 0) {
      await saveContestState();
      await updateLeaderboard();
    }
    
  }, 500 / globalMarketState.speed);
}

async function stopGlobalMarketSimulation() {
  if (!globalMarketState.isRunning) {
    console.log('Market simulation not running');
    return;
  }

  if (globalMarketState.intervalId) {
    clearInterval(globalMarketState.intervalId);
    globalMarketState.intervalId = null;
  }

  globalMarketState.isRunning = false;
  globalMarketState.isPaused = false;
  
  const finalResults = await saveContestResults();
  
  io.emit('market_stopped', {
    message: 'Market simulation has ended',
    finalResults: finalResults?.slice(0, 10)
  });
  
  await saveContestState();
  
  console.log('🛑 Market simulation stopped');
}

function groupIntoCandlesticks(data, interval) {
  if (!data || data.length === 0) return [];
  
  const intervalMs = getIntervalMs(interval);
  const candlesticks = [];
  let currentCandle = null;
  
  data.forEach(tick => {
    const tickTime = new Date(tick.normalized_timestamp || tick.timestamp).getTime();
    const candleTime = Math.floor(tickTime / intervalMs) * intervalMs;
    
    if (!currentCandle || currentCandle.time !== candleTime) {
      if (currentCandle) {
        candlesticks.push(currentCandle);
      }
      currentCandle = {
        time: new Date(candleTime).toISOString(),
        open: tick.last_traded_price,
        high: tick.last_traded_price,
        low: tick.last_traded_price,
        close: tick.last_traded_price,
        volume: tick.volume_traded
      };
    } else {
      currentCandle.high = Math.max(currentCandle.high, tick.last_traded_price);
      currentCandle.low = Math.min(currentCandle.low, tick.last_traded_price);
      currentCandle.close = tick.last_traded_price;
      currentCandle.volume += tick.volume_traded;
    }
  });

  if (currentCandle) {
    candlesticks.push(currentCandle);
  }

  return candlesticks;
}

function getIntervalMs(interval) {
  const intervals = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000
  };
  return intervals[interval] || intervals['1m'];
}

// ==================== REST API ROUTES ====================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connectedUsers: connectedUsers.size,
    marketState: {
      isRunning: globalMarketState.isRunning,
      isPaused: globalMarketState.isPaused,
      currentTick: globalMarketState.currentTickIndex,
      totalTicks: globalMarketState.totalTicks
    },
    uptime: process.uptime()
  });
});

// ==================== AUTH ENDPOINTS ====================

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

    const { data: userData, error: userError } = await supabase
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

    if (userError) throw userError;

    res.json({
      success: true,
      user: userData,
      token: authData.session?.access_token
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

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', data.user.id)
      .single();

    res.json({
      success: true,
      user: userData || { email: data.user.email },
      token: data.session.access_token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== MARKET DATA ROUTES =====

app.get('/api/symbols', async (req, res) => {
  try {
    const symbols = await getAvailableSymbols();
    res.json(symbols);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history/:symbol/range', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { from, to } = req.query;
    
    let data = stockDataCache.get(symbol);
    
    if (!data) {
      data = await loadStockData(symbol);
    }
    
    const fromTick = parseInt(from) || 0;
    const toTick = parseInt(to) || globalMarketState.currentTickIndex;
    
    const rangeData = data.slice(fromTick, Math.min(toTick + 1, data.length));
    
    res.json({
      symbol,
      fromTick,
      toTick,
      currentMarketTick: globalMarketState.currentTickIndex,
      data: rangeData,
      count: rangeData.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const offset = (page - 1) * limit;

    let data = stockDataCache.get(symbol);
    
    if (!data) {
      data = await loadStockData(symbol);
    }

    const availableData = getHistoricalDataUpToTick(symbol);
    const totalRecords = availableData.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const paginatedData = availableData.slice(offset, offset + limit);

    res.json({
      symbol,
      data: paginatedData,
      currentMarketTick: globalMarketState.currentTickIndex,
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/candlestick/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const interval = req.query.interval || '1m';
    
    const data = getHistoricalDataUpToTick(symbol);
    const candlesticks = groupIntoCandlesticks(data, interval);
    
    res.json({
      symbol,
      interval,
      currentMarketTick: globalMarketState.currentTickIndex,
      data: candlesticks
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/state', (req, res) => {
  const elapsedTime = globalMarketState.startTime 
    ? Date.now() - globalMarketState.startTime.getTime() 
    : 0;
    
  res.json({
    isRunning: globalMarketState.isRunning,
    isPaused: globalMarketState.isPaused,
    startTime: globalMarketState.startTime,
    currentTickIndex: globalMarketState.currentTickIndex,
    totalTicks: globalMarketState.totalTicks,
    elapsedTime,
    progress: (globalMarketState.currentTickIndex / globalMarketState.totalTicks) * 100,
    speed: globalMarketState.speed,
    symbols: globalMarketState.symbols,
    contestId: globalMarketState.contestId
  });
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

    if (!globalMarketState.isRunning || globalMarketState.isPaused) {
      return res.status(400).json({ error: 'Market is not currently active' });
    }

    const currentPrice = getCurrentPrice(symbol);
    if (!currentPrice) {
      return res.status(400).json({ error: 'Price not available for symbol' });
    }

    const { data: companyData } = await supabase
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
        tickIndex: globalMarketState.currentTickIndex,
        price: currentPrice
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
    const portfolio = await updatePortfolio(userEmail);
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

    const { data: trades, error, count } = await supabase
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
    await startGlobalMarketSimulation();
    
    const safeState = {
      isRunning: globalMarketState.isRunning,
      isPaused: globalMarketState.isPaused,
      startTime: globalMarketState.startTime,
      currentTickIndex: globalMarketState.currentTickIndex,
      totalTicks: globalMarketState.totalTicks,
      speed: globalMarketState.speed,
      contestId: globalMarketState.contestId,
      symbols: globalMarketState.symbols
    };
    
    res.json({ 
      success: true, 
      message: 'Contest started successfully',
      state: safeState
    });
  } catch (error) {
    console.error('Start contest error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/contest/pause', authenticateToken, requireAdmin, async (req, res) => {
  try {
    globalMarketState.isPaused = true;
    await saveContestState();
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
    globalMarketState.isPaused = false;
    await saveContestState();
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
    await stopGlobalMarketSimulation();
    res.json({ 
      success: true, 
      message: 'Contest stopped'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/contest/status', authenticateToken, requireAdmin, (req, res) => {
  const safeState = {
    isRunning: globalMarketState.isRunning,
    isPaused: globalMarketState.isPaused,
    startTime: globalMarketState.startTime,
    currentTickIndex: globalMarketState.currentTickIndex,
    totalTicks: globalMarketState.totalTicks,
    speed: globalMarketState.speed,
    contestId: globalMarketState.contestId,
    symbols: globalMarketState.symbols
  };
  res.json(safeState);
});

app.post('/api/admin/contest/speed', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { speed } = req.body;
    if (speed < 0.5 || speed > 10) {
      return res.status(400).json({ error: 'Speed must be between 0.5 and 10' });
    }
    
    globalMarketState.speed = speed;
    
    if (globalMarketState.isRunning && globalMarketState.intervalId) {
      clearInterval(globalMarketState.intervalId);
    }
    
    await saveContestState();
    res.json({ 
      success: true, 
      message: `Speed set to ${speed}x`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== WEBSOCKET HANDLERS ====================

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  connectedUsers.add(socket.id);

  const elapsedTime = globalMarketState.startTime 
    ? Date.now() - globalMarketState.startTime.getTime() 
    : 0;
    
  socket.emit('market_state', {
    isRunning: globalMarketState.isRunning,
    isPaused: globalMarketState.isPaused,
    currentTickIndex: globalMarketState.currentTickIndex,
    totalTicks: globalMarketState.totalTicks,
    elapsedTime,
    progress: (globalMarketState.currentTickIndex / globalMarketState.totalTicks) * 100,
    speed: globalMarketState.speed
  });

  socket.on('join_symbol', async (symbol) => {
    console.log(`${socket.id} joining room: ${symbol}`);
    
    const rooms = Array.from(socket.rooms).filter(room => room !== socket.id);
    rooms.forEach(room => socket.leave(room));
    
    socket.join(symbol);
    
    if (!stockDataCache.has(symbol)) {
      await loadStockData(symbol);
    }

    const historicalData = getHistoricalDataUpToTick(symbol);
    socket.emit('historical_data', {
      symbol,
      data: historicalData.slice(-100),
      total: historicalData.length,
      currentMarketTick: globalMarketState.currentTickIndex
    });
  });

  socket.on('leave_symbol', (symbol) => {
    console.log(`${socket.id} leaving room: ${symbol}`);
    socket.leave(symbol);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    connectedUsers.delete(socket.id);
  });
});

// ==================== SERVER STARTUP ====================

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await stopGlobalMarketSimulation();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`🚀 Trading Contest Server running on port ${PORT}`);
  console.log(`📊 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🔌 API endpoint: http://localhost:${PORT}/api`);
  
  const resumed = await loadContestState();
  if (resumed) {
    console.log('📊 Found previous contest state, resuming...');
    await startGlobalMarketSimulation();
  } else {
    console.log('⏸️  No active contest. Start one using admin API.');
  }
  
  await updateLeaderboard();
  console.log('✅ System initialization complete');
});