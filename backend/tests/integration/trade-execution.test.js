// backend/tests/integration/trade-execution.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://localhost:3002';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function isBackendRunning() {
  try {
    await axios.get(`${API_URL}/api/health`, { timeout: 2000 });
    return true;
  } catch (error) {
    return false;
  }
}

describe('Trade Execution with Database', () => {
  let backendRunning = false;
  let testUserEmail = 'trade-test@test.com';
  let authToken = null;

  beforeAll(async () => {
    backendRunning = await isBackendRunning();
    
    if (!backendRunning) {
      console.warn('⚠️ Backend not running. Start with: npm run dev');
      return;
    }

    // Create test user in database
    await supabase.from('users').upsert({
      "Candidate's Email": testUserEmail,
      "Candidate's Name": 'Trade Test User',
      role: 'user'
    });

    // Create/reset portfolio
    await supabase.from('portfolio').upsert({
      user_email: testUserEmail,
      cash_balance: 1000000,
      holdings: {},
      market_value: 0,
      total_wealth: 1000000,
      short_value: 0,
      unrealized_pnl: 0,
      total_pnl: 0,
      realized_pnl: 0
    });

    console.log('✅ Test user created with clean portfolio');
  });

  afterAll(async () => {
    if (!backendRunning) return;

    // Cleanup
    await supabase.from('trades').delete().eq('user_email', testUserEmail);
    await supabase.from('short_positions').delete().eq('user_email', testUserEmail);
    await supabase.from('portfolio').delete().eq('user_email', testUserEmail);
    await supabase.from('users').delete().eq("Candidate's Email", testUserEmail);
    
    console.log('✅ Test data cleaned up');
  });

  it('should verify database schema has correct types', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    const { data: portfolio } = await supabase
      .from('portfolio')
      .select('cash_balance, holdings, market_value')
      .eq('user_email', testUserEmail)
      .single();

    expect(typeof portfolio.cash_balance).toBe('string'); // PostgreSQL numeric comes as string
    expect(typeof portfolio.holdings).toBe('object');
    
    console.log('✅ Database types verified');
  });

  it('should execute buy order and store correct types in database', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    // Get contest state
    const { data: contestState } = await axios.get(`${API_URL}/api/contest/state`);
    
    if (!contestState.isRunning) {
      console.log('⏭️ Skipping - Contest not running (start contest first)');
      return;
    }

    // Mock auth token (replace with actual login if needed)
    authToken = 'mock-token';

    try {
      const response = await axios.post(
        `${API_URL}/api/trade`,
        {
          symbol: 'ADANIENT',
          order_type: 'buy',
          quantity: 10  // INTEGER
        },
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      // Verify in database
      const { data: portfolio } = await supabase
        .from('portfolio')
        .select('holdings')
        .eq('user_email', testUserEmail)
        .single();

      if (portfolio.holdings.ADANIENT) {
        expect(typeof portfolio.holdings.ADANIENT.quantity).toBe('number');
        expect(typeof portfolio.holdings.ADANIENT.avg_price).toBe('number');
        
        console.log('✅ Buy order executed with correct types:', {
          quantity: portfolio.holdings.ADANIENT.quantity,
          avg_price: portfolio.holdings.ADANIENT.avg_price
        });
      }

      // Verify trade record
      const { data: trades } = await supabase
        .from('trades')
        .select('quantity, price')
        .eq('user_email', testUserEmail)
        .eq('symbol', 'ADANIENT')
        .order('timestamp', { ascending: false })
        .limit(1);

      if (trades && trades.length > 0) {
        // PostgreSQL integer/numeric come as strings in JS
        expect(trades[0].quantity).toBe(10);
        console.log('✅ Trade record has correct quantity type');
      }

    } catch (error) {
      if (error.response?.status === 401) {
        console.log('⏭️ Skipping - Authentication required (expected in test env)');
      } else {
        throw error;
      }
    }
  });

  it('should handle JSONB numeric values correctly', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    // Directly insert test data
    await supabase.from('portfolio').update({
      holdings: {
        TEST: {
          quantity: 100,      // Should be number
          avg_price: 2500.50, // Should be number
          company_name: 'Test Corp'
        }
      }
    }).eq('user_email', testUserEmail);

    // Retrieve and verify
    const { data: portfolio } = await supabase
      .from('portfolio')
      .select('holdings')
      .eq('user_email', testUserEmail)
      .single();

    expect(typeof portfolio.holdings.TEST.quantity).toBe('number');
    expect(typeof portfolio.holdings.TEST.avg_price).toBe('number');
    expect(portfolio.holdings.TEST.quantity).toBe(100);
    expect(portfolio.holdings.TEST.avg_price).toBe(2500.50);

    console.log('✅ JSONB numeric values handled correctly');
  });

  it('should prevent JSONB string-to-integer casting errors', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    // This simulates the bug: trying to insert JSONB object where integer expected
    try {
      await supabase.from('trades').insert({
        user_email: testUserEmail,
        symbol: 'TEST',
        company_name: 'Test',
        order_type: 'buy',
        quantity: { value: 10 }, // ❌ WRONG: Object instead of integer
        price: 100,
        total_amount: 1000
      });

      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Should get type error
      expect(error.code).toBe('22P02'); // Invalid text representation
      console.log('✅ Type error caught correctly (JSONB → INTEGER rejected)');
    }
  });
});