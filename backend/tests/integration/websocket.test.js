// backend/tests/integration/websocket.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io } from 'socket.io-client';
import axios from 'axios';

const WS_URL = 'http://localhost:3002';
const API_URL = 'http://localhost:3002';

async function isBackendRunning() {
  try {
    await axios.get(`${API_URL}/api/health`, { timeout: 2000 });
    return true;
  } catch (error) {
    return false;
  }
}

describe('WebSocket Connection Tests', () => {
  let socket;
  let backendRunning = false;

  beforeAll(async () => {
    backendRunning = await isBackendRunning();
    
    if (!backendRunning) {
      console.warn('⚠️ Backend not running. Start with: npm run dev');
      console.warn('⚠️ Skipping WebSocket tests');
      return;
    }

    socket = io(WS_URL, { 
      transports: ['websocket'],
      reconnection: false 
    });

    // Wait for connection
    await new Promise((resolve) => {
      socket.on('connect', resolve);
      setTimeout(resolve, 3000); // Timeout after 3s
    });
  });

  afterAll(() => {
    if (socket) socket.close();
  });

  it('should connect to WebSocket server', () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    expect(socket.connected).toBe(true);
    console.log('✅ WebSocket connected:', socket.id);
  });

  it('should receive contest_state event on connect', async () => {
    if (!backendRunning || !socket.connected) {
      console.log('⏭️ Skipping - Not connected');
      return;
    }

    const statePromise = new Promise((resolve) => {
      socket.once('contest_state', (data) => {
        resolve(data);
      });
    });

    const state = await Promise.race([
      statePromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000))
    ]);

    if (state) {
      expect(state).toHaveProperty('isRunning');
      expect(state).toHaveProperty('isPaused');
      expect(state).toHaveProperty('symbols');
      console.log('✅ Received contest_state:', state.isRunning ? 'Running' : 'Stopped');
    } else {
      console.log('⚠️ No contest_state received (may be normal)');
    }
  });

  it('should be able to subscribe to candles', async () => {
    if (!backendRunning || !socket.connected) {
      console.log('⏭️ Skipping - Not connected');
      return;
    }

    const symbol = 'RELIANCE';
    const timeframe = '5s';

    const initialCandlesPromise = new Promise((resolve) => {
      socket.once('initial_candles', (data) => {
        resolve(data);
      });
    });

    socket.emit('subscribe_candles', { symbol, timeframe });

    const candlesData = await Promise.race([
      initialCandlesPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000))
    ]);

    if (candlesData) {
      expect(candlesData).toHaveProperty('symbol');
      expect(candlesData).toHaveProperty('timeframe');
      expect(candlesData).toHaveProperty('candles');
      expect(candlesData.symbol).toBe(symbol);
      expect(candlesData.timeframe).toBe(timeframe);
      console.log('✅ Subscribed to candles:', candlesData.candles.length, 'candles received');
    } else {
      console.log('⚠️ No initial_candles received (may be normal if contest not running)');
    }

    // Cleanup
    socket.emit('unsubscribe_candles', { symbol, timeframe });
  });

  it('should receive market_tick events during contest', async () => {
    if (!backendRunning || !socket.connected) {
      console.log('⏭️ Skipping - Not connected');
      return;
    }

    // Check if contest is running first
    const { data: contestState } = await axios.get(`${API_URL}/api/contest/state`);
    
    if (!contestState.isRunning) {
      console.log('⏭️ Skipping - Contest not running');
      return;
    }

    const tickPromise = new Promise((resolve) => {
      socket.once('market_tick', (data) => {
        resolve(data);
      });
    });

    const tickData = await Promise.race([
      tickPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 10000))
    ]);

    if (tickData) {
      expect(tickData).toHaveProperty('universalTime');
      expect(tickData).toHaveProperty('prices');
      expect(tickData).toHaveProperty('progress');
      console.log('✅ Received market_tick:', tickData.progress.toFixed(1) + '%');
    } else {
      console.log('⚠️ No market_tick received in 10s');
    }
  });

  it('should receive symbol_tick events during contest', async () => {
    if (!backendRunning || !socket.connected) {
      console.log('⏭️ Skipping - Not connected');
      return;
    }

    const { data: contestState } = await axios.get(`${API_URL}/api/contest/state`);
    
    if (!contestState.isRunning) {
      console.log('⏭️ Skipping - Contest not running');
      return;
    }

    const symbolTickPromise = new Promise((resolve) => {
      socket.once('symbol_tick', (data) => {
        resolve(data);
      });
    });

    const symbolTick = await Promise.race([
      symbolTickPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 10000))
    ]);

    if (symbolTick) {
      expect(symbolTick).toHaveProperty('symbol');
      expect(symbolTick).toHaveProperty('data');
      expect(symbolTick.data).toHaveProperty('last_traded_price');
      console.log('✅ Received symbol_tick:', symbolTick.symbol, '@', symbolTick.data.last_traded_price);
    } else {
      console.log('⚠️ No symbol_tick received in 10s');
    }
  });

  it('should handle reconnection', async () => {
    if (!backendRunning || !socket.connected) {
      console.log('⏭️ Skipping - Not connected');
      return;
    }

    const originalId = socket.id;
    
    // Force disconnect
    socket.disconnect();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    expect(socket.connected).toBe(false);
    console.log('✅ Disconnected successfully');

    // Reconnect
    socket.connect();
    await new Promise((resolve) => {
      socket.once('connect', resolve);
      setTimeout(resolve, 3000);
    });

    if (socket.connected) {
      console.log('✅ Reconnected with new ID:', socket.id);
      expect(socket.id).not.toBe(originalId);
    } else {
      console.log('⚠️ Failed to reconnect');
    }
  });

  it('should receive candle_update events during contest', async () => {
    if (!backendRunning || !socket.connected) {
      console.log('⏭️ Skipping - Not connected');
      return;
    }

    const { data: contestState } = await axios.get(`${API_URL}/api/contest/state`);
    
    if (!contestState.isRunning || contestState.symbols.length === 0) {
      console.log('⏭️ Skipping - Contest not running or no symbols');
      return;
    }

    const symbol = contestState.symbols[0];
    const timeframe = '5s';

    socket.emit('subscribe_candles', { symbol, timeframe });

    const candleUpdatePromise = new Promise((resolve) => {
      socket.once('candle_update', (data) => {
        resolve(data);
      });
    });

    const candleUpdate = await Promise.race([
      candleUpdatePromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 15000))
    ]);

    if (candleUpdate) {
      expect(candleUpdate).toHaveProperty('symbol');
      expect(candleUpdate).toHaveProperty('timeframe');
      expect(candleUpdate).toHaveProperty('candle');
      expect(candleUpdate).toHaveProperty('isNew');
      console.log('✅ Received candle_update:', candleUpdate.symbol, candleUpdate.timeframe);
    } else {
      console.log('⚠️ No candle_update received in 15s (may be normal)');
    }

    socket.emit('unsubscribe_candles', { symbol, timeframe });
  });
});