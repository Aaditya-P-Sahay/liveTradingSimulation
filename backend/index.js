import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

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
  const intervalId = setInterval(() => {
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

// REST API Routes

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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    connectedUsers: connectedUsers.size,
    activeSymbols: Array.from(activeStreams.keys()),
    cachedSymbols: Array.from(stockDataCache.keys()),
    uptime: process.uptime()
  });
});

// WebSocket Connection Handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  connectedUsers.add(socket.id);

  // Join symbol room
  socket.on('join_symbol', async (symbol) => {
    console.log(`${socket.id} joining room: ${symbol}`);
    
    // Leave all other rooms first
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
      data: historicalData.slice(-100), // Send last 100 points for initial chart
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
  console.log(`🚀 Stock Market Simulator Server running on port ${PORT}`);
  console.log(`📊 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🔌 API endpoint: http://localhost:${PORT}/api`);
});

// Preload some popular symbols on startup
const popularSymbols = ['ADANIENT', 'INFY', 'INDIGO', 'TCS', 'RELIANCE'];
setTimeout(async () => {
  console.log('Preloading popular symbols...');
  for (const symbol of popularSymbols) {
    try {
      await loadStockData(symbol);
    } catch (error) {
      console.error(`Failed to preload ${symbol}:`, error.message);
    }
  }
  console.log('Preloading complete');
}, 1000);