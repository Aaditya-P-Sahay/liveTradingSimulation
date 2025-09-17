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

const app = express();
const server = createServer(app);

// Configure Socket.IO with multi-room support
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000", "http://localhost:5174", process.env.FRONTEND_URL],
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

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:3000", "http://localhost:5174", process.env.FRONTEND_URL],
  credentials: true
}));
app.use(express.json());

// ==================== CONTEST STATE MANAGEMENT ====================
const contestState = {
  isRunning: false,
  isPaused: false,
  contestId: null,
  
  // Timeline management
  dataStartTime: null,        // When market data begins (first tick)
  contestStartTime: null,     // When contest officially starts
  adminStartTime: null,       // When admin clicked start
  
  // Data management
  currentDataTick: 0,         // Current position in dataset
  totalDataTicks: 0,          // Total ticks in dataset
  contestDurationTicks: 3600, // Contest length (1 hour = 3600 ticks)
  speed: 2,                   // Playback speed multiplier
  
  // Data and state
  symbols: [],
  intervalId: null,
  maxDuration: 60 * 60 * 1000 // 1 hour maximum
};

// In-memory data stores
const stockDataCache = new Map();      // symbol -> array of tick data
const connectedUsers = new Map();      // socketId -> userInfo
const userSockets = new Map();         // userEmail -> socketId
const portfolioCache = new Map();      // userEmail -> portfolio
const leaderboardCache = [];

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
  
  const tickIndex = Math.min(contestState.currentDataTick, data.length - 1);
  return data[tickIndex]?.last_traded_price || null;
}

function getContestDataUpToTick(symbol, endTick = null) {
  const data = stockDataCache.get(symbol);
  if (!data || data.length === 0) return [];
  
  const toTick = endTick !== null ? 
    Math.min(endTick, data.length - 1) : 
    Math.min(contestState.currentDataTick, data.length - 1);
  
  return data.slice(0, toTick + 1);
}

// ==================== AUTHENTICATION MIDDLEWARE ====================

async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Check for test token first (for development)
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
      // Not a test token, continue with normal auth
    }

    // Normal Supabase auth
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('Token verification failed:', error);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // FIXED: Try both auth_id lookup and email lookup for existing users
    let { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    // If not found by auth_id, try email (for existing users)
    if (userError && userError.code === 'PGRST116') {
      const { data: emailData, error: emailError } = await supabase
        .from('users')
        .select('*')
        .eq("Candidate's Email", user.email)
        .single();
      
      if (emailData && !emailError) {
        // Update the user record with auth_id for future lookups
        await supabase
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
        total_pnl: 0,
        realized_pnl: 0
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

async function updatePortfolioValues(userEmail) {
  try {
    const portfolio = await getOrCreatePortfolio(userEmail);
    if (!portfolio) return null;

    // Calculate long positions value
    let longMarketValue = 0;
    let longUnrealizedPnl = 0;

    const holdings = portfolio.holdings || {};
    for (const [symbol, position] of Object.entries(holdings)) {
      const currentPrice = getCurrentPrice(symbol);
      if (currentPrice && position.quantity > 0) {
        const positionValue = currentPrice * position.quantity;
        longMarketValue += positionValue;
        longUnrealizedPnl += (currentPrice - position.avg_price) * position.quantity;
        
        // Update holdings with current values
        holdings[symbol] = {
          ...position,
          current_price: currentPrice,
          market_value: positionValue,
          unrealized_pnl: (currentPrice - position.avg_price) * position.quantity
        };
      }
    }

    // Calculate short positions value
    const { data: shortPositions } = await supabase
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
          // For short positions: profit when price goes down
          shortUnrealizedPnl += (short.avg_short_price - currentPrice) * short.quantity;
          
          // Update short position
          await supabase
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

    // FIXED: Correct total wealth calculation
    // Total Wealth = Cash + Long Market Value - Short Liability + All Unrealized P&L
    const totalUnrealizedPnl = longUnrealizedPnl + shortUnrealizedPnl;
    const totalWealth = portfolio.cash_balance + longMarketValue - shortMarketValue + totalUnrealizedPnl;
    const totalPnl = totalUnrealizedPnl + (portfolio.realized_pnl || 0);

    const { data: updatedPortfolio, error } = await supabase
      .from('portfolio')
      .update({
        holdings,
        market_value: longMarketValue,
        short_value: shortMarketValue,
        unrealized_pnl: totalUnrealizedPnl,
        total_wealth: totalWealth,
        total_pnl: totalPnl,
        last_updated: new Date().toISOString()
      })
      .eq('user_email', userEmail)
      .select()
      .single();

    if (error) throw error;

    portfolioCache.set(userEmail, updatedPortfolio);
    
    // Send portfolio update to user's socket
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

async function openShortPosition(userEmail, symbol, companyName, quantity, price) {
  try {
    const totalAmount = quantity * price;
    
    // Create short position record
    const { data: shortPosition, error } = await supabase
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
      })
      .select()
      .single();

    if (error) throw error;

    // Add cash from short sale to portfolio
    const portfolio = await getOrCreatePortfolio(userEmail);
    await supabase
      .from('portfolio')
      .update({
        cash_balance: portfolio.cash_balance + totalAmount
      })
      .eq('user_email', userEmail);

    return shortPosition;
  } catch (error) {
    console.error('Error opening short position:', error);
    throw error;
  }
}

async function closeShortPosition(userEmail, symbol, quantity, price) {
  try {
    // Get active short positions for this symbol
    const { data: shortPositions } = await supabase
      .from('short_positions')
      .select('*')
      .eq('user_email', userEmail)
      .eq('symbol', symbol)
      .eq('is_active', true)
      .order('opened_at', { ascending: true });

    if (!shortPositions || shortPositions.length === 0) {
      throw new Error('No active short positions found for this symbol');
    }

    let remainingQuantity = quantity;
    let totalCost = 0;
    let totalRealizedPnl = 0;

    for (const position of shortPositions) {
      if (remainingQuantity <= 0) break;
      
      const quantityToCover = Math.min(remainingQuantity, position.quantity);
      const cost = quantityToCover * price;
      const pnl = (position.avg_short_price - price) * quantityToCover;
      
      totalCost += cost;
      totalRealizedPnl += pnl;
      remainingQuantity -= quantityToCover;
      
      if (quantityToCover === position.quantity) {
        // Close entire position
        await supabase
          .from('short_positions')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', position.id);
      } else {
        // Partially close position
        await supabase
          .from('short_positions')
          .update({
            quantity: position.quantity - quantityToCover,
            updated_at: new Date().toISOString()
          })
          .eq('id', position.id);
      }
    }

    if (remainingQuantity > 0) {
      throw new Error(`Insufficient short positions. Missing ${remainingQuantity} shares`);
    }

    // Update portfolio cash and realized P&L
    const portfolio = await getOrCreatePortfolio(userEmail);
    await supabase
      .from('portfolio')
      .update({
        cash_balance: portfolio.cash_balance - totalCost,
        realized_pnl: (portfolio.realized_pnl || 0) + totalRealizedPnl
      })
      .eq('user_email', userEmail);

    return { totalCost, totalRealizedPnl };
  } catch (error) {
    console.error('Error closing short position:', error);
    throw error;
  }
}

async function executeTrade(userEmail, symbol, companyName, orderType, quantity, price) {
  try {
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
      
      await supabase
        .from('portfolio')
        .update({
          cash_balance: portfolio.cash_balance - totalAmount,
          holdings
        })
        .eq('user_email', userEmail);
        
    } else if (orderType === 'sell') {
      const portfolio = await getOrCreatePortfolio(userEmail);
      const holdings = portfolio.holdings || {};
      
      if (!holdings[symbol] || holdings[symbol].quantity < quantity) {
        throw new Error('Insufficient holdings');
      }
      
      const position = holdings[symbol];
      const realizedPnl = (price - position.avg_price) * quantity;
      
      holdings[symbol].quantity -= quantity;
      if (holdings[symbol].quantity === 0) {
        delete holdings[symbol];
      } else {
        holdings[symbol].market_value = holdings[symbol].quantity * price;
        holdings[symbol].unrealized_pnl = (price - holdings[symbol].avg_price) * holdings[symbol].quantity;
      }
      
      await supabase
        .from('portfolio')
        .update({
          cash_balance: portfolio.cash_balance + totalAmount,
          holdings,
          realized_pnl: (portfolio.realized_pnl || 0) + realizedPnl
        })
        .eq('user_email', userEmail);
        
    } else if (orderType === 'short_sell') {
      await openShortPosition(userEmail, symbol, companyName, quantity, price);
      
    } else if (orderType === 'buy_to_cover') {
      await closeShortPosition(userEmail, symbol, quantity, price);
    }
    
    // Record the trade
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

    const updatedPortfolio = await updatePortfolioValues(userEmail);

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
      return_percentage: ((p.total_wealth - 1000000) / 1000000) * 100,
      cash_balance: p.cash_balance,
      market_value: p.market_value,
      short_value: p.short_value
    }));

    leaderboardCache.length = 0;
    leaderboardCache.push(...leaderboard);

    // Broadcast leaderboard update to all contest participants
    io.to(`contest:${contestState.contestId}`).emit('leaderboard_update', leaderboard.slice(0, 10));

    return leaderboard;
  } catch (error) {
    console.error('Error updating leaderboard:', error);
    return [];
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
    
    // Update contest total ticks to minimum across all symbols
    if (contestState.totalDataTicks === 0) {
      contestState.totalDataTicks = processedData.length;
    } else {
      contestState.totalDataTicks = Math.min(contestState.totalDataTicks, processedData.length);
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
      
      batch.forEach(row => {
        if (row.symbol) {
          uniqueSymbols.add(row.symbol);
        }
      });
      
      console.log(`  Batch ${++batchCount}: ${batch.length} rows, ${uniqueSymbols.size} unique symbols so far`);
      
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

// ==================== CONTEST STATE PERSISTENCE ====================

async function saveContestState() {
  try {
    if (!contestState.contestId) return;
    
    const { error } = await supabase
      .from('contest_state')
      .upsert({
        id: contestState.contestId,
        is_running: contestState.isRunning,
        is_paused: contestState.isPaused,
        start_time: contestState.contestStartTime,
        current_tick_index: contestState.currentDataTick,
        total_ticks: contestState.totalDataTicks,
        speed: contestState.speed,
        symbols: contestState.symbols,
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
      contestState.contestId = data.id;
      contestState.isRunning = data.is_running;
      contestState.isPaused = data.is_paused;
      contestState.contestStartTime = new Date(data.start_time);
      contestState.currentDataTick = data.current_tick_index;
      contestState.totalDataTicks = data.total_ticks;
      contestState.speed = data.speed || 2;
      contestState.symbols = data.symbols || [];
      
      console.log(`📊 Resuming contest from tick ${contestState.currentDataTick}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error loading contest state:', error);
    return false;
  }
}

async function saveContestResults() {
  try {
    if (!contestState.contestId) return;

    const leaderboard = await updateLeaderboard();
    
    const { error } = await supabase
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
    console.log('🏆 Winner:', leaderboard[0]?.user_name || 'No participants');
    
    return leaderboard;
  } catch (error) {
    console.error('Error saving contest results:', error);
    return null;
  }
}

// ==================== CONTEST MANAGEMENT ====================

async function startContest() {
  if (contestState.isRunning && !contestState.isPaused) {
    console.log('Contest already running');
    return;
  }

  if (contestState.isPaused) {
    contestState.isPaused = false;
    console.log('📊 Resuming contest');
    await saveContestState();
    return;
  }

  contestState.isRunning = true;
  contestState.isPaused = false;
  contestState.contestId = crypto.randomUUID();
  contestState.adminStartTime = new Date();
  contestState.contestStartTime = new Date();
  contestState.currentDataTick = 0;
  
  const symbols = await getAvailableSymbols();
  contestState.symbols = symbols;
  
  console.log('📊 Loading market data for all symbols...');
  for (const symbol of symbols) {
    await loadStockData(symbol);
  }
  
  // Set data start time to first tick
  if (symbols.length > 0 && stockDataCache.has(symbols[0])) {
    const firstData = stockDataCache.get(symbols[0])[0];
    contestState.dataStartTime = new Date(firstData.normalized_timestamp);
  }
  
  console.log(`🚀 Starting contest at ${contestState.speed}x speed`);
  console.log(`📈 Total ticks: ${contestState.totalDataTicks}`);
  console.log(`⏱️  Expected duration: ${(contestState.totalDataTicks * 500 / contestState.speed) / 60000} minutes`);
  
  await saveContestState();
  
  // Start the contest simulation
  contestState.intervalId = setInterval(async () => {
    if (contestState.isPaused) return;
    
    const elapsedTime = Date.now() - contestState.adminStartTime.getTime();
    if (elapsedTime >= contestState.maxDuration) {
      console.log('⏰ Contest duration reached (1 hour). Stopping contest.');
      await stopContest();
      return;
    }
    
    if (contestState.currentDataTick >= contestState.totalDataTicks) {
      console.log('📊 All market data exhausted. Stopping contest.');
      await stopContest();
      return;
    }
    
    contestState.currentDataTick++;
    
    // Broadcast current tick data to all symbol rooms
    const tickData = {};
    for (const symbol of contestState.symbols) {
      const price = getCurrentPrice(symbol);
      if (price) {
        tickData[symbol] = price;
        
        // Get current tick data
        const data = stockDataCache.get(symbol);
        if (data && data[contestState.currentDataTick]) {
          // Send to symbol-specific rooms
          io.to(`symbol:${symbol}`).emit('symbol_tick', {
            symbol,
            data: data[contestState.currentDataTick],
            tickIndex: contestState.currentDataTick,
            totalTicks: contestState.totalDataTicks,
            progress: (contestState.currentDataTick / contestState.totalDataTicks) * 100
          });
        }
      }
    }
    
    // Broadcast market-wide tick to contest room
    io.to(`contest:${contestState.contestId}`).emit('market_tick', {
      tickIndex: contestState.currentDataTick,
      totalTicks: contestState.totalDataTicks,
      timestamp: new Date().toISOString(),
      prices: tickData,
      progress: (contestState.currentDataTick / contestState.totalDataTicks) * 100,
      contestStartTime: contestState.contestStartTime,
      dataStartTime: contestState.dataStartTime
    });
    
    // Update portfolios and leaderboard periodically
    if (contestState.currentDataTick % 10 === 0) {
      // Update all user portfolios
      const portfolios = Array.from(portfolioCache.keys());
      for (const userEmail of portfolios) {
        await updatePortfolioValues(userEmail);
      }
    }
    
    if (contestState.currentDataTick % 100 === 0) {
      await saveContestState();
      await updateLeaderboard();
    }
    
  }, 500 / contestState.speed);
}

async function stopContest() {
  if (!contestState.isRunning) {
    console.log('Contest not running');
    return;
  }

  if (contestState.intervalId) {
    clearInterval(contestState.intervalId);
    contestState.intervalId = null;
  }

  contestState.isRunning = false;
  contestState.isPaused = false;
  
  const finalResults = await saveContestResults();
  
  io.to(`contest:${contestState.contestId}`).emit('contest_ended', {
    message: 'Contest has ended',
    finalResults: finalResults?.slice(0, 10),
    totalTicks: contestState.totalDataTicks,
    endTime: new Date().toISOString()
  });
  
  await saveContestState();
  
  console.log('🛑 Contest stopped');
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
    contestState: {
      isRunning: contestState.isRunning,
      isPaused: contestState.isPaused,
      currentTick: contestState.currentDataTick,
      totalTicks: contestState.totalDataTicks,
      contestId: contestState.contestId
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

    if (authData.user) {
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

    // FIXED: Try both auth_id and email lookup
    let { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', data.user.id)
      .single();

    // If not found by auth_id, try email lookup for existing users
    if (userError && userError.code === 'PGRST116') {
      const { data: emailData, error: emailError } = await supabase
        .from('users')
        .select('*')
        .eq("Candidate's Email", email)
        .single();
      
      if (emailData && !emailError) {
        // Update user with auth_id for future lookups
        await supabase
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

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// TEMPORARY TEST ENDPOINT - REMOVE IN PRODUCTION
app.post('/api/test/create-test-user', async (req, res) => {
  try {
    const testEmail = `test_${Date.now()}@example.com`;
    const testUser = {
      "Candidate's Email": testEmail,
      "Candidate's Name": "Test User",
      auth_id: crypto.randomUUID(),
      role: "user",
      created_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('users')
      .insert(testUser)
      .select()
      .single();
    
    if (error) throw error;
    
    const fakeToken = Buffer.from(JSON.stringify({
      email: testEmail,
      test: true,
      exp: Date.now() + 86400000
    })).toString('base64');
    
    res.json({
      user: data,
      token: fakeToken
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== MARKET DATA ROUTES =====

app.get('/api/symbols', async (req, res) => {
  try {
    const symbols = contestState.symbols.length > 0 ? contestState.symbols : await getAvailableSymbols();
    res.json(symbols);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// FIXED: Contest data endpoint - returns data from contest start (tick 0) to current
app.get('/api/contest-data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { from, to } = req.query;
    
    let data = stockDataCache.get(symbol);
    if (!data) {
      data = await loadStockData(symbol);
    }
    
    const fromTick = parseInt(from) || 0;
    const toTick = parseInt(to) || contestState.currentDataTick;
    
    const contestData = data.slice(fromTick, Math.min(toTick + 1, data.length));
    
    res.json({
      symbol,
      fromTick,
      toTick,
      currentContestTick: contestState.currentDataTick,
      totalContestTicks: contestState.totalDataTicks,
      data: contestData,
      count: contestData.length,
      contestStartTime: contestState.contestStartTime,
      dataStartTime: contestState.dataStartTime,
      contestActive: contestState.isRunning
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

    const availableData = getContestDataUpToTick(symbol);
    const totalRecords = availableData.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const paginatedData = availableData.slice(offset, offset + limit);

    res.json({
      symbol,
      data: paginatedData,
      currentContestTick: contestState.currentDataTick,
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
    
    const data = getContestDataUpToTick(symbol);
    const candlesticks = groupIntoCandlesticks(data, interval);
    
    res.json({
      symbol,
      interval,
      currentContestTick: contestState.currentDataTick,
      data: candlesticks
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/contest/state', (req, res) => {
  const elapsedTime = contestState.adminStartTime 
    ? Date.now() - contestState.adminStartTime.getTime() 
    : 0;
    
  res.json({
    isRunning: contestState.isRunning,
    isPaused: contestState.isPaused,
    contestStartTime: contestState.contestStartTime,
    adminStartTime: contestState.adminStartTime,
    dataStartTime: contestState.dataStartTime,
    currentDataTick: contestState.currentDataTick,
    totalDataTicks: contestState.totalDataTicks,
    elapsedTime,
    progress: (contestState.currentDataTick / contestState.totalDataTicks) * 100,
    speed: contestState.speed,
    symbols: contestState.symbols,
    contestId: contestState.contestId
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

    if (!contestState.isRunning || contestState.isPaused) {
      return res.status(400).json({ error: 'Contest is not currently active' });
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
        contestTick: contestState.currentDataTick,
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

app.get('/api/shorts', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user["Candidate's Email"];
    const activeOnly = req.query.active === 'true';
    
    let query = supabase
      .from('short_positions')
      .select('*')
      .eq('user_email', userEmail)
      .order('opened_at', { ascending: false });
    
    if (activeOnly) {
      query = query.eq('is_active', true);
    }
    
    const { data: shorts, error } = await query;
    
    if (error) throw error;
    
    res.json({
      shorts,
      count: shorts.length
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
    await startContest();
    
    res.json({ 
      success: true, 
      message: 'Contest started successfully',
      state: {
        isRunning: contestState.isRunning,
        isPaused: contestState.isPaused,
        contestStartTime: contestState.contestStartTime,
        currentDataTick: contestState.currentDataTick,
        totalDataTicks: contestState.totalDataTicks,
        speed: contestState.speed,
        contestId: contestState.contestId,
        symbols: contestState.symbols
      }
    });
  } catch (error) {
    console.error('Start contest error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/contest/pause', authenticateToken, requireAdmin, async (req, res) => {
  try {
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
    await stopContest();
    res.json({ 
      success: true, 
      message: 'Contest stopped'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/contest/status', authenticateToken, requireAdmin, (req, res) => {
  res.json({
    isRunning: contestState.isRunning,
    isPaused: contestState.isPaused,
    contestStartTime: contestState.contestStartTime,
    adminStartTime: contestState.adminStartTime,
    dataStartTime: contestState.dataStartTime,
    currentDataTick: contestState.currentDataTick,
    totalDataTicks: contestState.totalDataTicks,
    speed: contestState.speed,
    contestId: contestState.contestId,
    symbols: contestState.symbols
  });
});

app.post('/api/admin/contest/speed', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { speed } = req.body;
    if (speed < 0.5 || speed > 10) {
      return res.status(400).json({ error: 'Speed must be between 0.5 and 10' });
    }
    
    contestState.speed = speed;
    
    if (contestState.isRunning && contestState.intervalId) {
      clearInterval(contestState.intervalId);
      await startContest(); // This will restart with new speed
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

  // Send initial contest state
  socket.emit('contest_state', {
    isRunning: contestState.isRunning,
    isPaused: contestState.isPaused,
    currentDataTick: contestState.currentDataTick,
    totalDataTicks: contestState.totalDataTicks,
    contestStartTime: contestState.contestStartTime,
    dataStartTime: contestState.dataStartTime,
    progress: (contestState.currentDataTick / contestState.totalDataTicks) * 100,
    speed: contestState.speed,
    contestId: contestState.contestId
  });

  // Handle user authentication for personalized rooms
  socket.on('authenticate', async (token) => {
    try {
      // Verify token and get user info
      const { data: { user }, error } = await supabase.auth.getUser(token);
      
      if (!error && user) {
        // Find user in database
        let { data: userData } = await supabase
          .from('users')
          .select('*')
          .eq('auth_id', user.id)
          .single();
        
        if (!userData) {
          const { data: emailData } = await supabase
            .from('users')
            .select('*')
            .eq("Candidate's Email", user.email)
            .single();
          userData = emailData;
        }
        
        if (userData) {
          const userEmail = userData["Candidate's Email"];
          
          // Store user connection
          connectedUsers.set(socket.id, {
            email: userEmail,
            name: userData["Candidate's Name"],
            role: userData.role,
            connectedAt: new Date().toISOString()
          });
          
          userSockets.set(userEmail, socket.id);
          
          // Join user-specific room and contest room
          socket.join(`user:${userEmail}`);
          socket.join(`contest:${contestState.contestId}`);
          
          // Join admin room if admin
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

  // Handle symbol subscription (multiple symbols supported)
  socket.on('subscribe_symbols', (symbols) => {
    console.log(`${socket.id} subscribing to symbols: ${symbols.join(', ')}`);
    
    symbols.forEach(symbol => {
      socket.join(`symbol:${symbol}`);
      
      // Send current contest data for this symbol
      if (stockDataCache.has(symbol)) {
        const contestData = getContestDataUpToTick(symbol);
        socket.emit('contest_data', {
          symbol,
          data: contestData,
          total: contestData.length,
          currentContestTick: contestState.currentDataTick,
          totalContestTicks: contestState.totalDataTicks,
          contestStartTime: contestState.contestStartTime,
          dataStartTime: contestState.dataStartTime
        });
      }
    });
  });

  socket.on('unsubscribe_symbols', (symbols) => {
    console.log(`${socket.id} unsubscribing from symbols: ${symbols.join(', ')}`);
    symbols.forEach(symbol => {
      socket.leave(`symbol:${symbol}`);
    });
  });

  // Legacy support for single symbol subscription
  socket.on('join_symbol', async (symbol) => {
    console.log(`${socket.id} joining room: ${symbol}`);
    socket.join(`symbol:${symbol}`);
    
    if (!stockDataCache.has(symbol)) {
      await loadStockData(symbol);
    }

    // FIXED: Send complete contest data from start to current tick
    const contestData = getContestDataUpToTick(symbol);
    socket.emit('contest_data', {
      symbol,
      data: contestData,
      total: contestData.length,
      currentContestTick: contestState.currentDataTick,
      totalContestTicks: contestState.totalDataTicks,
      contestStartTime: contestState.contestStartTime,
      dataStartTime: contestState.dataStartTime
    });
  });

  socket.on('leave_symbol', (symbol) => {
    console.log(`${socket.id} leaving room: ${symbol}`);
    socket.leave(`symbol:${symbol}`);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Clean up user mappings
    const userInfo = connectedUsers.get(socket.id);
    if (userInfo) {
      userSockets.delete(userInfo.email);
      connectedUsers.delete(socket.id);
    }
  });
});

// ==================== SERVER STARTUP ====================

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await stopContest();
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
  console.log(`\n📝 Login with your Supabase Auth credentials`);
  
  const resumed = await loadContestState();
  if (resumed) {
    console.log('📊 Found previous contest state, resuming...');
    await startContest();
  } else {
    console.log('⏸️  No active contest. Start one using admin API.');
  }
  
  await updateLeaderboard();
  console.log('✅ System initialization complete');
});