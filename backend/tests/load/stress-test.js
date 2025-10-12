// backend/tests/load/stress-test.js
import { io } from 'socket.io-client';
import axios from 'axios';

const WS_URL = 'http://localhost:3002';
const API_URL = 'http://localhost:3002';
const NUM_CLIENTS = 50;

async function isBackendRunning() {
  try {
    await axios.get(`${API_URL}/api/health`, { timeout: 2000 });
    return true;
  } catch (error) {
    return false;
  }
}

async function runLoadTest() {
  console.log('🔍 Checking if backend is running...');
  
  const running = await isBackendRunning();
  if (!running) {
    console.error('❌ Backend is not running!');
    console.error('   Start the backend first: npm run dev');
    process.exit(1);
  }

  console.log(`✅ Backend is running`);
  console.log(`🔥 Starting load test with ${NUM_CLIENTS} concurrent users...\n`);

  const clients = [];
  const metrics = {
    connectionsSuccessful: 0,
    connectionsFailed: 0,
    ticksReceived: 0,
    tradesExecuted: 0,
    tradesFailed: 0,
    avgResponseTime: []
  };

  for (let i = 0; i < NUM_CLIENTS; i++) {
    const client = io(WS_URL, {
      transports: ['websocket'],
      reconnection: false
    });

    client.on('connect', () => {
      metrics.connectionsSuccessful++;
      if (i % 10 === 0) {
        console.log(`✅ Client ${i + 1}/${NUM_CLIENTS} connected`);
      }
    });

    client.on('connect_error', () => {
      metrics.connectionsFailed++;
      console.log(`❌ Client ${i + 1}/${NUM_CLIENTS} failed to connect`);
    });

    client.on('market_tick', () => {
      metrics.ticksReceived++;
    });

    clients.push(client);
  }

  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log(`\n📊 Connection Results:`);
  console.log(`   ✅ Successful: ${metrics.connectionsSuccessful}/${NUM_CLIENTS}`);
  console.log(`   ❌ Failed: ${metrics.connectionsFailed}/${NUM_CLIENTS}`);

  console.log(`\n📡 Monitoring WebSocket tick rate for 30 seconds...`);
  const initialTicks = metrics.ticksReceived;
  await new Promise(resolve => setTimeout(resolve, 30000));
  const tickRate = (metrics.ticksReceived - initialTicks) / 30;
  
  console.log(`\n📊 WebSocket Performance:`);
  console.log(`   📡 Tick rate: ${tickRate.toFixed(1)} ticks/sec across ${NUM_CLIENTS} clients`);
  console.log(`   📦 Total ticks received: ${metrics.ticksReceived}`);

  clients.forEach(client => client.close());

  console.log(`\n✅ Load test complete!\n`);

  const passThresholds = {
    connectionSuccessRate: 0.95,
    minTickRate: 0.1
  };

  const connSuccessRate = metrics.connectionsSuccessful / NUM_CLIENTS;

  console.log(`📋 Test Results:`);
  console.log(`   Connection Success Rate: ${(connSuccessRate * 100).toFixed(1)}% ${connSuccessRate >= passThresholds.connectionSuccessRate ? '✅' : '❌'}`);
  console.log(`   Tick Rate: ${tickRate.toFixed(1)}/s ${tickRate >= passThresholds.minTickRate ? '✅' : '❌'}`);

  process.exit(connSuccessRate >= passThresholds.connectionSuccessRate && tickRate >= passThresholds.minTickRate ? 0 : 1);
}

runLoadTest().catch(error => {
  console.error('❌ Load test failed:', error.message);
  process.exit(1);
});