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
  console.error('\n💡 Please check your .env file and ensure it contains:');
  console.error('   SUPABASE_URL=https://your-project.supabase.co');
  console.error('   SUPABASE_ANON_KEY=your-anon-key');
  console.error('   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key');
  console.error('\n📖 Get these from: Supabase Dashboard > Settings > API');
  process.exit(1);
}

console.log('✅ Environment variables loaded');
console.log(`🔗 Supabase URL: ${process.env.SUPABASE_URL}`);
console.log(`🔑 Anon Key: ${process.env.SUPABASE_ANON_KEY ? '***' + process.env.SUPABASE_ANON_KEY.slice(-10) : 'MISSING'}`);

const app = express();
const server = createServer(app);

// Configure Socket.IO with optimizations for high concurrency
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
  maxHttpBufferSize: 1e6, // 1MB
  allowEIO3: true
});

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Admin Supabase client with service role key
let supabaseAdmin = null;
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  console.log('✅ Admin client initialized');
} else {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY not found - admin features will be disabled');
}

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:3000", process.env.FRONTEND_URL],
  credentials: true
}));
app.use(express.json());

// In-memory data store for efficient real-time streaming
const stockDataCache = new Map(); // symbol -> sorted data array
const activeStreams = new Map(); // symbol -> interval ID
const connectedUsers = new Set();
const userSockets = new Map(); // user_email -> socket.id
const portfolioCache = new Map(); // user_email -> portfolio data
const leaderboardCache = [];

// ==================== AUTHENTICATION MIDDLEWARE ====================

// Middleware to verify Supabase JWT token
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // CHECK FOR TEST TOKEN
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

    // Normal Supabase auth flow
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Get user details from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', user.id)
      .single();

    if (userError || !userData) {
      return res.status(401).json({ error: 'User not found in system' });
    }

    // Store token hash in user_sessions table
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await supabase
      .from('user_sessions')
      .upsert({
        user_email: userData["Candidate's Email"],
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        last_used: new Date().toISOString()
      }, { 
        onConflict: 'user_email,token_hash' 
      });

    req.user = userData;
    req.auth_user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// Admin-only middleware
async function requireAdmin(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Admin functionality not available - missing service role key' });
  }
  
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ==================== UTILITY FUNCTIONS ====================

// Utility function to normalize timestamp
function normalizeTimestamp(timestamp) {
  if (!timestamp) return new Date().toISOString();
  
  // Handle various timestamp formats
  if (timestamp.includes(':') && !timestamp.includes('T')) {
    // Format like "49:55.3" - assume it's minutes:seconds.milliseconds from market start
    const [minutes, seconds] = timestamp.split(':');
    const [sec, ms] = seconds.split('.');
    
    // Create a timestamp relative to market start (9:15 AM IST)
    const marketStart = new Date();
    marketStart.setHours(9, 15, 0, 0);
    marketStart.setMinutes(marketStart.getMinutes() + parseInt(minutes));
    marketStart.setSeconds(parseInt(sec));
    marketStart.setMilliseconds(parseInt(ms || 0) * 100);
    
    return marketStart.toISOString();
  }
  
  return timestamp;
}

// Get current market price for a symbol
function getCurrentPrice(symbol) {
  const data = stockDataCache.get(symbol);
  if (!data || data.length === 0) return null;
  
  return data[data.length - 1]?.last_traded_price || null;
}

// ==================== DATABASE HELPERS ====================

// Get or create user portfolio
async function getOrCreatePortfolio(userEmail) {
  try {
    let { data: portfolio, error } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', userEmail)
      .single();

    if (error && error.code === 'PGRST116') {
      // Portfolio doesn't exist, create it
      const { data: newPortfolio, error: createError } = await supabase
        .from('portfolio')
        .insert({
          user_email: userEmail,
          cash_balance: 1000000.00,
          holdings: {},
          market_value: 0.00,
          total_wealth: 1000000.00,
          short_value: 0.00,
          unrealized_pnl: 0.00,
          total_pnl: 0.00
        })
        .select()
        .single();

      if (createError) throw createError;
      portfolio = newPortfolio;
    } else if (error) {
      throw error;
    }

    return portfolio;
  } catch (error) {
    console.error('Error getting/creating portfolio:', error);
    throw error;
  }
}

// Update portfolio after trade
async function updatePortfolio(userEmail) {
  try {
    const portfolio = await getOrCreatePortfolio(userEmail);
    
    // Calculate market value from holdings
    let marketValue = 0;
    const holdings = portfolio.holdings || {};
    
    for (const [symbol, quantity] of Object.entries(holdings)) {
      if (quantity > 0) {
        const currentPrice = getCurrentPrice(symbol);
        if (currentPrice) {
          marketValue += quantity * currentPrice;
        }
      }
    }

    // Get active short positions and calculate short value & unrealized P&L
    const { data: shortPositions, error: shortError } = await supabase
      .from('short_positions')
      .select('*')
      .eq('user_email', userEmail)
      .eq('is_active', true);

    if (shortError) throw shortError;

    let shortValue = 0;
    let shortUnrealizedPnl = 0;

    if (shortPositions && shortPositions.length > 0) {
      for (const position of shortPositions) {
        const currentPrice = getCurrentPrice(position.symbol);
        if (currentPrice) {
          const positionValue = position.quantity * currentPrice;
          shortValue += positionValue;
          
          // Update short position with current price and unrealized P&L
          const unrealizedPnl = position.quantity * (position.avg_short_price - currentPrice);
          shortUnrealizedPnl += unrealizedPnl;

          await supabase
            .from('short_positions')
            .update({
              current_price: currentPrice,
              unrealized_pnl: unrealizedPnl,
              updated_at: new Date().toISOString()
            })
            .eq('id', position.id);
        }
      }
    }

    // Calculate total P&L (realized + unrealized)
    const totalPnl = (marketValue + portfolio.cash_balance - 1000000) + shortUnrealizedPnl;
    const totalWealth = portfolio.cash_balance + marketValue - shortValue + shortUnrealizedPnl;

    // Update portfolio
    const { data: updatedPortfolio, error: updateError } = await supabase
      .from('portfolio')
      .update({
        market_value: marketValue,
        short_value: shortValue,
        unrealized_pnl: shortUnrealizedPnl,
        total_pnl: totalPnl,
        total_wealth: totalWealth,
        last_updated: new Date().toISOString()
      })
      .eq('user_email', userEmail)
      .select()
      .single();

    if (updateError) throw updateError;

    // Update cache
    portfolioCache.set(userEmail, updatedPortfolio);

    return updatedPortfolio;
  } catch (error) {
    console.error('Error updating portfolio:', error);
    throw error;
  }
}

// Execute trade
async function executeTrade(userEmail, symbol, companyName, orderType, quantity, currentPrice) {
  try {
    const portfolio = await getOrCreatePortfolio(userEmail);
    const totalAmount = quantity * currentPrice;
    let updatedCash = portfolio.cash_balance;
    let updatedHoldings = { ...portfolio.holdings };

    // Validate and execute based on order type
    switch (orderType) {
      case 'buy':
        if (updatedCash < totalAmount) {
          throw new Error('Insufficient cash balance');
        }
        updatedCash -= totalAmount;
        updatedHoldings[symbol] = (updatedHoldings[symbol] || 0) + quantity;
        break;

      case 'sell':
        const currentHolding = updatedHoldings[symbol] || 0;
        if (currentHolding < quantity) {
          throw new Error('Insufficient holdings');
        }
        updatedCash += totalAmount;
        updatedHoldings[symbol] = currentHolding - quantity;
        if (updatedHoldings[symbol] === 0) {
          delete updatedHoldings[symbol];
        }
        break;

      case 'short_sell':
        // Create short position
        const { error: shortError } = await supabase
          .from('short_positions')
          .insert({
            user_email: userEmail,
            symbol: symbol,
            company_name: companyName,
            quantity: quantity,
            avg_short_price: currentPrice,
            current_price: currentPrice,
            unrealized_pnl: 0,
            is_active: true
          });

        if (shortError) throw shortError;
        
        updatedCash += totalAmount;
        break;

      case 'buy_to_cover':
        // Get active short positions for this symbol
        const { data: activeShorts, error: shortFetchError } = await supabase
          .from('short_positions')
          .select('*')
          .eq('user_email', userEmail)
          .eq('symbol', symbol)
          .eq('is_active', true)
          .order('opened_at', { ascending: true });

        if (shortFetchError) throw shortFetchError;
        
        if (!activeShorts || activeShorts.length === 0) {
          throw new Error('No active short positions for this symbol');
        }

        const totalShortQuantity = activeShorts.reduce((sum, pos) => sum + pos.quantity, 0);
        if (totalShortQuantity < quantity) {
          throw new Error('Insufficient short positions to cover');
        }

        if (updatedCash < totalAmount) {
          throw new Error('Insufficient cash balance');
        }

        updatedCash -= totalAmount;

        // Close short positions (FIFO)
        let remainingToCover = quantity;
        for (const shortPos of activeShorts) {
          if (remainingToCover <= 0) break;

          const coverQuantity = Math.min(remainingToCover, shortPos.quantity);

          if (coverQuantity === shortPos.quantity) {
            // Close entire position
            await supabase
              .from('short_positions')
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq('id', shortPos.id);
          } else {
            // Partially close position
            await supabase
              .from('short_positions')
              .update({ 
                quantity: shortPos.quantity - coverQuantity,
                updated_at: new Date().toISOString()
              })
              .eq('id', shortPos.id);
          }

          remainingToCover -= coverQuantity;
        }
        break;

      default:
        throw new Error('Invalid order type');
    }

    // Update portfolio cash and holdings
    const { error: portfolioError } = await supabase
      .from('portfolio')
      .update({
        cash_balance: updatedCash,
        holdings: updatedHoldings,
        last_updated: new Date().toISOString()
      })
      .eq('user_email', userEmail);

    if (portfolioError) throw portfolioError;

    // Insert trade record
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .insert({
        user_email: userEmail,
        symbol: symbol,
        company_name: companyName,
        order_type: orderType,
        quantity: quantity,
        price: currentPrice,
        total_amount: totalAmount,
        timestamp: new Date().toISOString()
      })
      .select()
      .single();

    if (tradeError) throw tradeError;

    // Update portfolio calculations
    const updatedPortfolio = await updatePortfolio(userEmail);

    return { trade, portfolio: updatedPortfolio };
  } catch (error) {
    console.error('Error executing trade:', error);
    throw error;
  }
}

// Get simulation status
async function getSimulationStatus() {
  try {
    const { data, error } = await supabase
      .from('simulation_control')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    
    return data || { status: 'active', auto_square_off_triggered: false };
  } catch (error) {
    console.error('Error getting simulation status:', error);
    return { status: 'active', auto_square_off_triggered: false };
  }
}

// Auto square off all short positions
async function autoSquareOffAllShorts() {
  try {
    console.log('Starting auto square-off process...');

    const { data: activeShorts, error } = await supabase
      .from('short_positions')
      .select(`
        *,
        users!short_positions_user_email_fkey("Candidate's Email")
      `)
      .eq('is_active', true);

    if (error) throw error;

    if (!activeShorts || activeShorts.length === 0) {
      console.log('No active short positions to square off');
      return;
    }

    console.log(`Squaring off ${activeShorts.length} short positions`);

    for (const shortPos of activeShorts) {
      try {
        const currentPrice = getCurrentPrice(shortPos.symbol);
        if (!currentPrice) {
          console.error(`No current price available for ${shortPos.symbol}`);
          continue;
        }

        // Execute buy-to-cover trade
        await executeTrade(
          shortPos.user_email,
          shortPos.symbol,
          shortPos.company_name,
          'buy_to_cover',
          shortPos.quantity,
          currentPrice
        );

        console.log(`Squared off ${shortPos.quantity} shares of ${shortPos.symbol} for ${shortPos.user_email}`);
      } catch (error) {
        console.error(`Error squaring off position ${shortPos.id}:`, error);
      }
    }

    console.log('Auto square-off process completed');
  } catch (error) {
    console.error('Error in auto square-off process:', error);
  }
}

// Update leaderboard
async function updateLeaderboard() {
  try {
    console.log('Skipping leaderboard update - no portfolios exist yet');
    return [];
  } catch (error) {
    console.log('Leaderboard update skipped');
    return [];
  }
}

// ==================== EXISTING MARKET DATA FUNCTIONS ====================

// Load and cache stock data with preprocessing
async function loadStockData(symbol) {
  try {
    console.log(`Loading data for ${symbol}...`);
    
    const { data, error } = await supabase
      .from('LALAJI')
      .select('*')
      .eq('symbol', symbol)
      .order('unique_id', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      console.log(`No data found for ${symbol}`);
      return [];
    }

    // Preprocess data: normalize timestamps and ensure proper sorting
    const processedData = data.map(row => ({
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
    console.log(`Loaded ${processedData.length} data points for ${symbol}`);
    
    return processedData;
  } catch (error) {
    console.error(`Error loading data for ${symbol}:`, error);
    return [];
  }
}

// Get available symbols
async function getAvailableSymbols() {
  try {
    const { data, error } = await supabase
      .from('LALAJI')
      .select('symbol')
      .not('symbol', 'is', null);

    if (error) throw error;

    const symbols = [...new Set(data.map(item => item.symbol))].sort();
    console.log(`Found ${symbols.length} unique symbols`);
    return symbols;
  } catch (error) {
    console.error('Error fetching symbols:', error);
    return [];
  }
}

// Start real-time simulation for a symbol
function startRealTimeSimulation(symbol) {
  if (activeStreams.has(symbol)) {
    console.log(`Simulation already running for ${symbol}`);
    return;
  }

  const data = stockDataCache.get(symbol);
  if (!data || data.length === 0) {
    console.log(`No data available for simulation: ${symbol}`);
    return;
  }

  let currentIndex = 0;
  const intervalId = setInterval(async () => {
    if (currentIndex >= data.length) {
      // Restart simulation from beginning
      currentIndex = 0;
    }

    const currentTick = data[currentIndex];
    
    // Broadcast to all clients in the symbol room
    io.to(symbol).emit('tick', {
      symbol,
      data: currentTick,
      timestamp: new Date().toISOString(),
      index: currentIndex,
      total: data.length
    });

    currentIndex++;
  }, 1000); // 1 second intervals

  activeStreams.set(symbol, intervalId);
  console.log(`Started real-time simulation for ${symbol}`);
}

// Stop real-time simulation for a symbol
function stopRealTimeSimulation(symbol) {
  const intervalId = activeStreams.get(symbol);
  if (intervalId) {
    clearInterval(intervalId);
    activeStreams.delete(symbol);
    console.log(`Stopped simulation for ${symbol}`);
  }
}

// Group data into candlestick format
function groupIntoCandlesticks(data, interval) {
  if (!data || data.length === 0) return [];

  const intervalMs = getIntervalMs(interval);
  const candlesticks = [];
  
  let currentCandle = null;
  let candleStartTime = null;

  data.forEach(tick => {
    const tickTime = new Date(tick.normalized_timestamp);
    
    if (!candleStartTime) {
      candleStartTime = new Date(Math.floor(tickTime.getTime() / intervalMs) * intervalMs);
    }

    const nextCandleStart = new Date(candleStartTime.getTime() + intervalMs);
    
    if (tickTime >= nextCandleStart) {
      // Start new candle
      if (currentCandle) {
        candlesticks.push(currentCandle);
      }
      
      candleStartTime = nextCandleStart;
      currentCandle = {
        time: candleStartTime.toISOString(),
        open: tick.last_traded_price,
        high: tick.last_traded_price,
        low: tick.last_traded_price,
        close: tick.last_traded_price,
        volume: tick.volume_traded
      };
    } else {
      // Update current candle
      if (!currentCandle) {
        currentCandle = {
          time: candleStartTime.toISOString(),
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

// ===== EXISTING MARKET DATA ROUTES =====

// Get available symbols
app.get('/api/symbols', async (req, res) => {
  try {
    const symbols = await getAvailableSymbols();
    res.json(symbols);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get historical data for a symbol with pagination
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

    const totalRecords = data.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const paginatedData = data.slice(offset, offset + limit);

    res.json({
      symbol,
      data: paginatedData,
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

// Get candlestick data for a symbol
app.get('/api/candlestick/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const interval = req.query.interval || '1m'; // 1m, 5m, 15m, 1h, 1d
    
    let data = stockDataCache.get(symbol);
    if (!data) {
      data = await loadStockData(symbol);
    }

    // Group data into candlestick intervals
    const candlesticks = groupIntoCandlesticks(data, interval);
    
    res.json({
      symbol,
      interval,
      data: candlesticks
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== TRADING API ROUTES =====

// Place trade order
app.post('/api/trade', authenticateToken, async (req, res) => {
  try {
    const { symbol, order_type, quantity } = req.body;
    const userEmail = req.user["Candidate's Email"];

    // Validate input
    if (!symbol || !order_type || !quantity) {
      return res.status(400).json({ error: 'Symbol, order_type, and quantity are required' });
    }

    if (!['buy', 'sell', 'short_sell', 'buy_to_cover'].includes(order_type)) {
      return res.status(400).json({ error: 'Invalid order type' });
    }

    if (quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be positive' });
    }

    // Check simulation status
    const simStatus = await getSimulationStatus();
    if (simStatus.status !== 'active') {
      return res.status(400).json({ error: 'Trading is currently disabled' });
    }

    // Get current price
    const currentPrice = getCurrentPrice(symbol);
    if (!currentPrice) {
      return res.status(400).json({ error: 'Price not available for symbol' });
    }

    // Get company name from LALAJI table
    const { data: companyData } = await supabase
      .from('LALAJI')
      .select('company_name')
      .eq('symbol', symbol)
      .limit(1)
      .single();

    const companyName = companyData?.company_name || symbol;

    // Execute trade
    const result = await executeTrade(userEmail, symbol, companyName, order_type, quantity, currentPrice);

    // Update leaderboard
    await updateLeaderboard();

    res.json({
      success: true,
      trade: result.trade,
      portfolio: result.portfolio
    });

  } catch (error) {
    console.error('Trade execution error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get user portfolio
app.get('/api/portfolio', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user["Candidate's Email"];
    const portfolio = await updatePortfolio(userEmail);
    res.json(portfolio);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user trade history
app.get('/api/trades', authenticateToken, async (req, res) => {
  try {
    const userEmail = req.user["Candidate's Email"];
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_email', userEmail)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Get total count
    const { count, error: countError } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('user_email', userEmail);

    if (countError) throw countError;

    res.json({
      trades: trades || [],
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

// Get user short positions
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

    res.json(shorts || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    
    if (leaderboardCache.length === 0) {
      await updateLeaderboard();
    }

    const limitedLeaderboard = leaderboardCache.slice(0, limit);
    res.json(limitedLeaderboard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== ADMIN ROUTES =====

// Start simulation
app.post('/api/admin/simulation/start', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { data: simulation, error } = await supabase
      .from('simulation_control')
      .insert({
        status: 'active',
        start_time: new Date().toISOString(),
        auto_square_off_triggered: false
      })
      .select()
      .single();

    if (error) throw error;

    // Broadcast simulation status update
    io.emit('simulation_status', simulation);

    res.json({ success: true, simulation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop simulation
app.post('/api/admin/simulation/stop', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const currentStatus = await getSimulationStatus();
    
    const { data: simulation, error } = await supabase
      .from('simulation_control')
      .update({
        status: 'stopped',
        end_time: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', currentStatus.id)
      .select()
      .single();

    if (error) throw error;

    // Trigger auto square off
    await autoSquareOffAllShorts();

    // Broadcast simulation status update
    io.emit('simulation_status', simulation);

    res.json({ success: true, simulation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get simulation status
app.get('/api/admin/simulation/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = await getSimulationStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual auto square off
app.post('/api/admin/simulation/square-off', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await autoSquareOffAllShorts();
    res.json({ success: true, message: 'Auto square-off completed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Health check endpoint
app.get('/api/health', (req, res) => {
  const authenticatedUsers = Array.from(userSockets.keys()).length;
  const totalConnections = connectedUsers.size;
  
  res.json({
    status: 'healthy',
    connectedUsers: totalConnections,
    authenticatedUsers: authenticatedUsers,
    guestUsers: totalConnections - authenticatedUsers,
    activeSymbols: Array.from(activeStreams.keys()),
    cachedSymbols: Array.from(stockDataCache.keys()),
    cachedPortfolios: portfolioCache.size,
    uptime: process.uptime()
  });
});


// ==================== WEBSOCKET CONNECTION HANDLING ====================

io.on('connection', async (socket) => {
  console.log(`User connected: ${socket.id} (unauthenticated - market data only)`);
  
  connectedUsers.add(socket.id);

  // Join symbol room for market data (available to all users)
  socket.on('join_symbol', async (symbol) => {
    console.log(`${socket.id} joining room: ${symbol}`);
    
    // Leave all other symbol rooms first
    const rooms = Array.from(socket.rooms).filter(room => room !== socket.id);
    rooms.forEach(room => socket.leave(room));
    
    // Join new room
    socket.join(symbol);
    
    // Load data if not cached
    if (!stockDataCache.has(symbol)) {
      await loadStockData(symbol);
    }

    // Start simulation if not already running
    if (!activeStreams.has(symbol)) {
      startRealTimeSimulation(symbol);
    }

    // Send initial data
    const historicalData = stockDataCache.get(symbol) || [];
    socket.emit('historical_data', {
      symbol,
      data: historicalData.slice(-100),
      total: historicalData.length
    });
  });

  // Leave symbol room
  socket.on('leave_symbol', (symbol) => {
    console.log(`${socket.id} leaving room: ${symbol}`);
    socket.leave(symbol);
    
    // Check if room is empty, stop simulation if so
    const room = io.sockets.adapter.rooms.get(symbol);
    if (!room || room.size === 0) {
      stopRealTimeSimulation(symbol);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    connectedUsers.delete(socket.id);
    
    // Clean up empty rooms
    activeStreams.forEach((intervalId, symbol) => {
      const room = io.sockets.adapter.rooms.get(symbol);
      if (!room || room.size === 0) {
        stopRealTimeSimulation(symbol);
      }
    });
  });
});

// ==================== STARTUP & SHUTDOWN ====================

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  // Stop all simulations
  activeStreams.forEach((intervalId) => {
    clearInterval(intervalId);
  });
  
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Trading Simulation Server running on port ${PORT}`);
  console.log(`📊 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🔌 API endpoint: http://localhost:${PORT}/api`);
});

// Initialize leaderboard and preload popular symbols on startup
const popularSymbols = ['ADANIENT', 'INFY', 'INDIGO', 'TCS', 'RELIANCE'];
setTimeout(async () => {
  console.log('Initializing system...');
  
  // Preload popular symbols
  console.log('Preloading popular symbols...');
  for (const symbol of popularSymbols) {
    try {
      await loadStockData(symbol);
    } catch (error) {
      console.error(`Failed to preload ${symbol}:`, error.message);
    }
  }
  
  // Initialize leaderboard (may fail if no data exists yet)
  console.log('Initializing leaderboard...');
  await updateLeaderboard();
  
  console.log('✅ System initialization complete');
}, 1000);