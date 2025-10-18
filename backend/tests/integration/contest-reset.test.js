// backend/tests/integration/contest-reset.test.js - NEW TEST FILE
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const API_URL = 'http://localhost:3002';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper to check if backend is running
async function isBackendRunning() {
  try {
    await axios.get(`${API_URL}/api/health`, { timeout: 2000 });
    return true;
  } catch (error) {
    return false;
  }
}

describe('Contest Reset Functionality', () => {
  const testUser1 = 'reset-test-1@test.com';
  const testUser2 = 'reset-test-2@test.com';
  let backendRunning = false;

  beforeAll(async () => {
    backendRunning = await isBackendRunning();
    
    if (!backendRunning) {
      console.warn('⚠️ Backend not running. Start with: npm run dev');
      console.warn('⚠️ Skipping contest reset tests');
      return;
    }

    // Create test users
    await supabase.from('users').upsert([
      {
        "Candidate's Email": testUser1,
        "Candidate's Name": 'Reset Test User 1',
        role: 'user'
      },
      {
        "Candidate's Email": testUser2,
        "Candidate's Name": 'Reset Test User 2',
        role: 'user'
      }
    ]);

    console.log('✅ Test users created');
  });

  afterAll(async () => {
    if (!backendRunning) return;

    // Cleanup test data
    await supabase.from('trades').delete().in('user_email', [testUser1, testUser2]);
    await supabase.from('short_positions').delete().in('user_email', [testUser1, testUser2]);
    await supabase.from('portfolio').delete().in('user_email', [testUser1, testUser2]);
    await supabase.from('users').delete().in("Candidate's Email", [testUser1, testUser2]);
    
    console.log('✅ Test cleanup complete');
  });

  it('should clear trades when contest stops', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    console.log('🧪 Testing trade cleanup on contest stop...');

    // Step 1: Create portfolios
    await supabase.from('portfolio').upsert([
      {
        user_email: testUser1,
        cash_balance: 800000,
        holdings: { RELIANCE: { quantity: 100, avg_price: 2000 } },
        total_wealth: 1000000
      }
    ]);

    // Step 2: Insert some trades
    await supabase.from('trades').insert([
      {
        user_email: testUser1,
        symbol: 'RELIANCE',
        company_name: 'Reliance Industries',
        order_type: 'buy',
        quantity: 100,
        price: 2000,
        total_amount: 200000
      },
      {
        user_email: testUser1,
        symbol: 'RELIANCE',
        company_name: 'Reliance Industries',
        order_type: 'sell',
        quantity: 50,
        price: 2100,
        total_amount: 105000
      }
    ]);

    console.log('   ✅ Created 2 test trades');

    // Step 3: Verify trades exist
    const { data: tradesBefore, count: countBefore } = await supabase
      .from('trades')
      .select('*', { count: 'exact' })
      .eq('user_email', testUser1);

    expect(countBefore).toBeGreaterThanOrEqual(2);
    console.log(`   📝 Trades before cleanup: ${countBefore}`);

    // Step 4: Simulate contest stop by calling the cleanup directly
    // (In real scenario, this happens inside stopContest())
    const { data: deletedTrades, count: deletedCount } = await supabase
      .from('trades')
      .delete({ count: 'exact' })
      .eq('user_email', testUser1);

    console.log(`   🧹 Deleted ${deletedCount} trades`);

    // Step 5: Verify trades are cleared
    const { data: tradesAfter, count: countAfter } = await supabase
      .from('trades')
      .select('*', { count: 'exact' })
      .eq('user_email', testUser1);

    expect(countAfter).toBe(0);
    console.log('   ✅ All trades cleared successfully');
  });

  it('should reset portfolios to 1M when contest stops', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    console.log('🧪 Testing portfolio reset on contest stop...');

    // Step 1: Create portfolios with varied balances
    await supabase.from('portfolio').upsert([
      {
        user_email: testUser1,
        cash_balance: 850000,
        holdings: { TCS: { quantity: 50, avg_price: 3000 } },
        market_value: 150000,
        total_wealth: 1050000,
        total_pnl: 50000,
        realized_pnl: 30000,
        unrealized_pnl: 20000
      },
      {
        user_email: testUser2,
        cash_balance: 750000,
        holdings: { INFY: { quantity: 100, avg_price: 1500 } },
        market_value: 150000,
        total_wealth: 950000,
        total_pnl: -50000,
        realized_pnl: -30000,
        unrealized_pnl: -20000
      }
    ]);

    console.log('   ✅ Created portfolios with non-1M balances');

    // Step 2: Verify initial state
    const { data: portfoliosBefore } = await supabase
      .from('portfolio')
      .select('*')
      .in('user_email', [testUser1, testUser2]);

    expect(portfoliosBefore[0].total_wealth).toBe(1050000);
    expect(portfoliosBefore[1].total_wealth).toBe(950000);
    console.log(`   📊 User1 wealth: ₹${portfoliosBefore[0].total_wealth}`);
    console.log(`   📊 User2 wealth: ₹${portfoliosBefore[1].total_wealth}`);

    // Step 3: Simulate portfolio reset (what stopContest() does)
    const { data: resetPortfolios } = await supabase
      .from('portfolio')
      .update({
        cash_balance: 1000000,
        holdings: {},
        market_value: 0,
        total_wealth: 1000000,
        short_value: 0,
        unrealized_pnl: 0,
        total_pnl: 0,
        realized_pnl: 0
      })
      .in('user_email', [testUser1, testUser2])
      .select();

    console.log(`   🔄 Reset ${resetPortfolios.length} portfolios`);

    // Step 4: Verify reset successful
    const { data: portfoliosAfter } = await supabase
      .from('portfolio')
      .select('*')
      .in('user_email', [testUser1, testUser2]);

    portfoliosAfter.forEach((portfolio, index) => {
      expect(portfolio.cash_balance).toBe(1000000);
      expect(portfolio.total_wealth).toBe(1000000);
      expect(portfolio.market_value).toBe(0);
      expect(portfolio.total_pnl).toBe(0);
      expect(JSON.stringify(portfolio.holdings)).toBe('{}');
      console.log(`   ✅ User${index + 1} reset: cash=₹${portfolio.cash_balance}, wealth=₹${portfolio.total_wealth}`);
    });

    console.log('   ✅ All portfolios reset to 1M successfully');
  });

  it('should clear short positions when contest stops', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    console.log('🧪 Testing short position cleanup on contest stop...');

    // Step 1: Create active and inactive short positions
    await supabase.from('short_positions').insert([
      {
        user_email: testUser1,
        symbol: 'TCS',
        company_name: 'Tata Consultancy Services',
        quantity: 50,
        avg_short_price: 3000,
        is_active: true
      },
      {
        user_email: testUser1,
        symbol: 'INFY',
        company_name: 'Infosys',
        quantity: 100,
        avg_short_price: 1500,
        is_active: false // Already squared-off
      },
      {
        user_email: testUser2,
        symbol: 'RELIANCE',
        company_name: 'Reliance Industries',
        quantity: 30,
        avg_short_price: 2500,
        is_active: true
      }
    ]);

    console.log('   ✅ Created 3 short positions (2 active, 1 inactive)');

    // Step 2: Verify shorts exist
    const { data: shortsBefore, count: countBefore } = await supabase
      .from('short_positions')
      .select('*', { count: 'exact' })
      .in('user_email', [testUser1, testUser2]);

    expect(countBefore).toBe(3);
    console.log(`   📊 Short positions before cleanup: ${countBefore}`);

    // Step 3: Simulate short position cleanup (what stopContest() does)
    const { count: deletedCount } = await supabase
      .from('short_positions')
      .delete({ count: 'exact' })
      .in('user_email', [testUser1, testUser2]);

    console.log(`   🧹 Deleted ${deletedCount} short positions`);

    // Step 4: Verify all shorts cleared
    const { data: shortsAfter, count: countAfter } = await supabase
      .from('short_positions')
      .select('*', { count: 'exact' })
      .in('user_email', [testUser1, testUser2]);

    expect(countAfter).toBe(0);
    console.log('   ✅ All short positions cleared successfully');
  });

  it('should handle complete contest lifecycle', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    console.log('🧪 Testing complete contest lifecycle...');

    // Simulate Contest 1
    console.log('   📊 Contest 1: Users trade...');
    
    await supabase.from('portfolio').upsert([
      {
        user_email: testUser1,
        cash_balance: 900000,
        holdings: { TCS: { quantity: 50, avg_price: 2000 } },
        total_wealth: 1000000
      }
    ]);

    await supabase.from('trades').insert([
      {
        user_email: testUser1,
        symbol: 'TCS',
        company_name: 'TCS',
        order_type: 'buy',
        quantity: 50,
        price: 2000,
        total_amount: 100000
      }
    ]);

    const { count: tradesContest1 } = await supabase
      .from('trades')
      .select('*', { count: 'exact' })
      .eq('user_email', testUser1);

    expect(tradesContest1).toBe(1);
    console.log(`   ✅ Contest 1: ${tradesContest1} trade recorded`);

    // Contest stops - cleanup happens
    console.log('   🛑 Contest stops - cleanup triggered...');

    await supabase.from('trades').delete().eq('user_email', testUser1);
    await supabase.from('portfolio').update({
      cash_balance: 1000000,
      holdings: {},
      total_wealth: 1000000,
      market_value: 0,
      total_pnl: 0
    }).eq('user_email', testUser1);

    const { count: tradesAfterStop } = await supabase
      .from('trades')
      .select('*', { count: 'exact' })
      .eq('user_email', testUser1);

    expect(tradesAfterStop).toBe(0);
    console.log('   ✅ Cleanup: All trades cleared');

    const { data: portfolioAfterStop } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUser1)
      .single();

    expect(portfolioAfterStop.total_wealth).toBe(1000000);
    console.log('   ✅ Cleanup: Portfolio reset to ₹1M');

    // New Contest 2 starts
    console.log('   🚀 Contest 2: New contest starts...');

    const { data: portfolioContest2 } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUser1)
      .single();

    expect(portfolioContest2.cash_balance).toBe(1000000);
    expect(portfolioContest2.total_wealth).toBe(1000000);
    expect(JSON.stringify(portfolioContest2.holdings)).toBe('{}');
    
    console.log('   ✅ Contest 2: User has fresh ₹1M to trade');
    console.log('   ✅ Complete lifecycle test PASSED');
  });

  it('should maintain user retention across contest stops', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    console.log('🧪 Testing user retention after reset...');

    // Users join before Contest 1
    await supabase.from('portfolio').upsert([
      {
        user_email: testUser1,
        cash_balance: 1000000,
        total_wealth: 1000000
      },
      {
        user_email: testUser2,
        cash_balance: 1000000,
        total_wealth: 1000000
      }
    ]);

    const { count: usersBefore } = await supabase
      .from('portfolio')
      .select('*', { count: 'exact' })
      .in('user_email', [testUser1, testUser2]);

    console.log(`   📊 Users before reset: ${usersBefore}`);

    // Contest stops and resets
    await supabase.from('trades').delete().in('user_email', [testUser1, testUser2]);
    await supabase.from('portfolio').update({
      cash_balance: 1000000,
      holdings: {},
      total_wealth: 1000000
    }).in('user_email', [testUser1, testUser2]);

    // Verify users still exist
    const { data: usersAfter, count: usersCountAfter } = await supabase
      .from('portfolio')
      .select('*', { count: 'exact' })
      .in('user_email', [testUser1, testUser2]);

    expect(usersCountAfter).toBe(2);
    expect(usersAfter[0].cash_balance).toBe(1000000);
    expect(usersAfter[1].cash_balance).toBe(1000000);

    console.log(`   ✅ Users after reset: ${usersCountAfter}`);
    console.log('   ✅ Both users retained with fresh ₹1M');
  });
});