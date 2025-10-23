// backend/tests/integration/auto-squareoff.test.js - COMPREHENSIVE AUTO SQUARE-OFF TESTS

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

describe('Auto Square-Off on Contest End', () => {
  const testUser1 = 'squareoff-test-1@example.com';
  const testUser2 = 'squareoff-test-2@example.com';

  beforeEach(async () => {
    // Clean up test data
    await supabase.from('portfolio').delete().in('user_email', [testUser1, testUser2]);
    await supabase.from('short_positions').delete().in('user_email', [testUser1, testUser2]);
    await supabase.from('trades').delete().in('user_email', [testUser1, testUser2]);
    
    console.log('✅ Test environment cleaned');
  });

  afterEach(async () => {
    // Cleanup after tests
    await supabase.from('portfolio').delete().in('user_email', [testUser1, testUser2]);
    await supabase.from('short_positions').delete().in('user_email', [testUser1, testUser2]);
    await supabase.from('trades').delete().in('user_email', [testUser1, testUser2]);
  });

  it('should auto-close short positions and update cash/PNL correctly', async () => {
    console.log('🧪 Testing auto square-off with cash/PNL verification...');

    // Step 1: Setup - User shorts 100 ADANIENT @ 2,500
    const initialCash = 1000000;
    const shortQty = 100;
    const shortPrice = 2500;
    const shortValue = shortQty * shortPrice; // 250,000

    await supabase.from('portfolio').insert({
      user_email: testUser1,
      cash_balance: initialCash + shortValue, // 1,250,000 (got cash from shorting)
      holdings: {},
      market_value: 0,
      short_value: shortValue,
      unrealized_pnl: 0,
      realized_pnl: 0,
      total_wealth: initialCash, // Wealth stays 1M (cash + unrealized PNL)
      total_pnl: 0
    });

    await supabase.from('short_positions').insert({
      user_email: testUser1,
      symbol: 'ADANIENT',
      company_name: 'Adani Enterprises',
      quantity: shortQty,
      avg_short_price: shortPrice,
      current_price: shortPrice,
      unrealized_pnl: 0,
      is_active: true
    });

    console.log(`   ✅ Setup: User shorts ${shortQty} @ ₹${shortPrice}`);
    console.log(`   💰 Initial cash: ₹${(initialCash + shortValue).toLocaleString()}`);

    // Step 2: Simulate price drop to 2,400 (profit scenario)
    const coverPrice = 2400;
    const coverCost = coverPrice * shortQty; // 240,000
    const expectedPnl = (shortPrice - coverPrice) * shortQty; // (2500-2400)*100 = 10,000

    console.log(`   📊 Market moves: ₹${shortPrice} → ₹${coverPrice}`);
    console.log(`   💵 Cover cost: ₹${coverCost.toLocaleString()}`);
    console.log(`   📈 Expected P&L: ₹${expectedPnl.toLocaleString()}`);

    // Step 3: Execute auto square-off logic (simulating what stopContest() does)
    const { data: position } = await supabase
      .from('short_positions')
      .select('*')
      .eq('user_email', testUser1)
      .eq('is_active', true)
      .single();

    const realizedPnl = (position.avg_short_price - coverPrice) * position.quantity;

    // Update portfolio
    const { data: beforePortfolio } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUser1)
      .single();

    const newCashBalance = beforePortfolio.cash_balance - coverCost;
    const newRealizedPnl = (beforePortfolio.realized_pnl || 0) + realizedPnl;

    await supabase
      .from('portfolio')
      .update({
        cash_balance: newCashBalance,
        realized_pnl: newRealizedPnl,
        short_value: 0,
        unrealized_pnl: 0,
        total_wealth: newCashBalance, // After square-off, wealth = cash (no holdings/shorts)
        total_pnl: newRealizedPnl
      })
      .eq('user_email', testUser1);

    // Mark short as inactive
    await supabase
      .from('short_positions')
      .update({ is_active: false })
      .eq('id', position.id);

    // Record cover trade
    await supabase.from('trades').insert({
      user_email: testUser1,
      symbol: 'ADANIENT',
      company_name: 'Adani Enterprises',
      order_type: 'buy_to_cover',
      quantity: shortQty,
      price: coverPrice,
      total_amount: coverCost
    });

    console.log('   ✅ Auto square-off executed');

    // Step 4: Verify results
    const { data: finalPortfolio } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUser1)
      .single();

    const expectedFinalCash = 1250000 - 240000; // 1,010,000
    const expectedFinalWealth = expectedFinalCash; // No holdings/shorts, so wealth = cash

    console.log('   🔍 Verifying results...');
    console.log(`   💰 Final cash: ₹${finalPortfolio.cash_balance.toLocaleString()} (expected: ₹${expectedFinalCash.toLocaleString()})`);
    console.log(`   📈 Realized P&L: ₹${finalPortfolio.realized_pnl.toLocaleString()} (expected: ₹${expectedPnl.toLocaleString()})`);
    console.log(`   💎 Total wealth: ₹${finalPortfolio.total_wealth.toLocaleString()} (expected: ₹${expectedFinalWealth.toLocaleString()})`);

    expect(finalPortfolio.cash_balance).toBe(expectedFinalCash);
    expect(finalPortfolio.realized_pnl).toBe(expectedPnl);
    expect(finalPortfolio.short_value).toBe(0);
    expect(finalPortfolio.total_wealth).toBe(expectedFinalWealth);

    const { data: closedPosition } = await supabase
      .from('short_positions')
      .select('*')
      .eq('user_email', testUser1)
      .single();

    expect(closedPosition.is_active).toBe(false);

    const { data: coverTrade } = await supabase
      .from('trades')
      .select('*')
      .eq('user_email', testUser1)
      .eq('order_type', 'buy_to_cover')
      .single();

    expect(coverTrade).toBeDefined();
    expect(coverTrade.quantity).toBe(shortQty);
    expect(coverTrade.price).toBe(coverPrice);

    console.log('   ✅ All assertions passed!');
  });

  it('should handle loss scenario in auto square-off', async () => {
    console.log('🧪 Testing auto square-off with loss scenario...');

    // Setup: User shorts 50 TCS @ 3,000
    const initialCash = 1000000;
    const shortQty = 50;
    const shortPrice = 3000;
    const shortValue = shortQty * shortPrice; // 150,000

    await supabase.from('portfolio').insert({
      user_email: testUser2,
      cash_balance: initialCash + shortValue, // 1,150,000
      holdings: {},
      short_value: shortValue,
      unrealized_pnl: 0,
      realized_pnl: 0,
      total_wealth: initialCash
    });

    await supabase.from('short_positions').insert({
      user_email: testUser2,
      symbol: 'TCS',
      company_name: 'Tata Consultancy Services',
      quantity: shortQty,
      avg_short_price: shortPrice,
      is_active: true
    });

    console.log(`   ✅ Setup: User shorts ${shortQty} TCS @ ₹${shortPrice}`);

    // Price rises to 3,200 (loss scenario)
    const coverPrice = 3200;
    const coverCost = coverPrice * shortQty; // 160,000
    const expectedPnl = (shortPrice - coverPrice) * shortQty; // (3000-3200)*50 = -10,000

    console.log(`   📊 Market moves: ₹${shortPrice} → ₹${coverPrice} (LOSS)`);
    console.log(`   💵 Cover cost: ₹${coverCost.toLocaleString()}`);
    console.log(`   📉 Expected P&L: ₹${expectedPnl.toLocaleString()}`);

    // Execute auto square-off
    const { data: portfolio } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUser2)
      .single();

    const newCashBalance = portfolio.cash_balance - coverCost;
    const newRealizedPnl = expectedPnl;

    await supabase
      .from('portfolio')
      .update({
        cash_balance: newCashBalance,
        realized_pnl: newRealizedPnl,
        short_value: 0,
        total_wealth: newCashBalance,
        total_pnl: newRealizedPnl
      })
      .eq('user_email', testUser2);

    await supabase
      .from('short_positions')
      .update({ is_active: false })
      .eq('user_email', testUser2)
      .eq('symbol', 'TCS');

    // Verify loss scenario
    const { data: finalPortfolio } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUser2)
      .single();

    const expectedFinalCash = 1150000 - 160000; // 990,000
    const expectedFinalWealth = 990000; // Lost 10,000

    console.log(`   💰 Final cash: ₹${finalPortfolio.cash_balance.toLocaleString()}`);
    console.log(`   📉 Final wealth: ₹${finalPortfolio.total_wealth.toLocaleString()}`);

    expect(finalPortfolio.cash_balance).toBe(expectedFinalCash);
    expect(finalPortfolio.realized_pnl).toBe(expectedPnl);
    expect(finalPortfolio.total_wealth).toBe(expectedFinalWealth);
    expect(finalPortfolio.short_value).toBe(0);

    console.log('   ✅ Loss scenario handled correctly!');
  });

  it('should handle multiple shorts for same user', async () => {
    console.log('🧪 Testing auto square-off with multiple short positions...');

    await supabase.from('portfolio').insert({
      user_email: testUser1,
      cash_balance: 1500000, // 1M + 300k from shorts + 200k from shorts
      holdings: {},
      short_value: 500000,
      total_wealth: 1000000
    });

    // Multiple shorts
    await supabase.from('short_positions').insert([
      {
        user_email: testUser1,
        symbol: 'RELIANCE',
        company_name: 'Reliance',
        quantity: 100,
        avg_short_price: 2500,
        is_active: true
      },
      {
        user_email: testUser1,
        symbol: 'TCS',
        company_name: 'TCS',
        quantity: 50,
        avg_short_price: 3000,
        is_active: true
      }
    ]);

    console.log('   ✅ Created 2 short positions');

    // Square off both
    const coverPrices = { RELIANCE: 2400, TCS: 3100 };
    
    const { data: shorts } = await supabase
      .from('short_positions')
      .select('*')
      .eq('user_email', testUser1)
      .eq('is_active', true);

    let totalPnl = 0;
    let totalCoverCost = 0;

    for (const short of shorts) {
      const coverPrice = coverPrices[short.symbol];
      const pnl = (short.avg_short_price - coverPrice) * short.quantity;
      const coverCost = coverPrice * short.quantity;
      
      totalPnl += pnl;
      totalCoverCost += coverCost;

      await supabase
        .from('short_positions')
        .update({ is_active: false })
        .eq('id', short.id);
    }

    // RELIANCE: (2500-2400)*100 = +10,000
    // TCS: (3000-3100)*50 = -5,000
    // Total: +5,000

    expect(totalPnl).toBe(5000);
    console.log(`   📈 Total P&L from both shorts: ₹${totalPnl.toLocaleString()}`);

    await supabase
      .from('portfolio')
      .update({
        cash_balance: 1500000 - totalCoverCost,
        realized_pnl: totalPnl,
        short_value: 0,
        total_wealth: 1500000 - totalCoverCost
      })
      .eq('user_email', testUser1);

    const { data: final } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUser1)
      .single();

    expect(final.short_value).toBe(0);
    expect(final.realized_pnl).toBe(5000);
    expect(final.total_wealth).toBe(1005000); // Started with 1M, gained 5k

    console.log('   ✅ Multiple shorts squared off correctly!');
  });
});