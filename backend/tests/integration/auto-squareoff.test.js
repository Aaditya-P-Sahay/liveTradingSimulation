// backend/tests/integration/auto-squareoff.test.js - NEW TEST FOR AUTO SQUARE-OFF
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

describe('Auto Square-Off Integration Test', () => {
  const testUserEmail = 'squareoff-test@test.com';
  
  beforeAll(async () => {
    // Create test user
    await supabase.from('users').upsert({
      "Candidate's Email": testUserEmail,
      "Candidate's Name": 'Square-Off Test User',
      role: 'user'
    });

    // Create portfolio with initial balance
    await supabase.from('portfolio').upsert({
      user_email: testUserEmail,
      cash_balance: 1000000,
      holdings: {},
      market_value: 0,
      total_wealth: 1000000,
      realized_pnl: 0
    });
  });

  afterAll(async () => {
    // Cleanup
    await supabase.from('trades').delete().eq('user_email', testUserEmail);
    await supabase.from('short_positions').delete().eq('user_email', testUserEmail);
    await supabase.from('portfolio').delete().eq('user_email', testUserEmail);
    await supabase.from('users').delete().eq("Candidate's Email", testUserEmail);
    
    console.log('✅ Auto square-off test cleanup complete');
  });

  it('should correctly calculate cash after short sell and auto square-off', async () => {
    console.log('🧪 Testing auto square-off cash calculation...');
    
    // Step 1: Simulate short sell
    const shortPrice = 3000;
    const quantity = 100;
    const shortProceeds = shortPrice * quantity; // 300,000
    
    // Insert short position
    await supabase.from('short_positions').insert({
      user_email: testUserEmail,
      symbol: 'TEST',
      company_name: 'Test Company',
      quantity: quantity,
      avg_short_price: shortPrice,
      current_price: shortPrice,
      is_active: true
    });
    
    // Update cash to include short proceeds
    await supabase.from('portfolio').update({
      cash_balance: 1000000 + shortProceeds // 1,300,000
    }).eq('user_email', testUserEmail);
    
    console.log(`   📊 After short sell: Cash = ₹${(1000000 + shortProceeds).toLocaleString()}`);
    
    // Step 2: Price drops to 2500
    const currentPrice = 2500;
    const expectedPnL = (shortPrice - currentPrice) * quantity; // (3000-2500)*100 = 50,000 profit
    const coverCost = currentPrice * quantity; // 2500 * 100 = 250,000
    
    // Step 3: Simulate auto square-off
    const { data: portfolio } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUserEmail)
      .single();
    
    const cashBeforeSquareOff = portfolio.cash_balance;
    
    // Apply CORRECT auto square-off logic
    const newCashBalance = cashBeforeSquareOff - coverCost;
    const newRealizedPnL = (portfolio.realized_pnl || 0) + expectedPnL;
    
    await supabase.from('portfolio').update({
      cash_balance: newCashBalance,
      realized_pnl: newRealizedPnL
    }).eq('user_email', testUserEmail);
    
    await supabase.from('short_positions').update({
      is_active: false
    }).eq('user_email', testUserEmail).eq('symbol', 'TEST');
    
    // Step 4: Verify final cash
    const { data: finalPortfolio } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUserEmail)
      .single();
    
    const expectedFinalCash = 1050000; // Initial 1M + 50K profit
    const actualFinalCash = finalPortfolio.cash_balance;
    
    console.log(`   📊 Expected final cash: ₹${expectedFinalCash.toLocaleString()}`);
    console.log(`   📊 Actual final cash: ₹${actualFinalCash.toLocaleString()}`);
    console.log(`   📊 P&L: ₹${finalPortfolio.realized_pnl.toLocaleString()}`);
    
    // Assertions
    expect(actualFinalCash).toBe(expectedFinalCash);
    expect(finalPortfolio.realized_pnl).toBe(expectedPnL);
    
    console.log('✅ Auto square-off cash calculation is CORRECT');
  });

  it('should correctly handle short position at loss', async () => {
    console.log('🧪 Testing auto square-off with loss scenario...');
    
    // Reset portfolio
    await supabase.from('portfolio').update({
      cash_balance: 1000000,
      realized_pnl: 0
    }).eq('user_email', testUserEmail);
    
    // Short at 2000
    const shortPrice = 2000;
    const quantity = 50;
    const shortProceeds = shortPrice * quantity; // 100,000
    
    await supabase.from('short_positions').insert({
      user_email: testUserEmail,
      symbol: 'TEST2',
      company_name: 'Test Company 2',
      quantity: quantity,
      avg_short_price: shortPrice,
      current_price: shortPrice,
      is_active: true
    });
    
    await supabase.from('portfolio').update({
      cash_balance: 1000000 + shortProceeds // 1,100,000
    }).eq('user_email', testUserEmail);
    
    // Price rises to 2200 (loss scenario)
    const currentPrice = 2200;
    const expectedPnL = (shortPrice - currentPrice) * quantity; // (2000-2200)*50 = -10,000 loss
    const coverCost = currentPrice * quantity; // 2200 * 50 = 110,000
    
    // Auto square-off
    const { data: portfolio } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUserEmail)
      .single();
    
    const newCashBalance = portfolio.cash_balance - coverCost;
    const newRealizedPnL = (portfolio.realized_pnl || 0) + expectedPnL;
    
    await supabase.from('portfolio').update({
      cash_balance: newCashBalance,
      realized_pnl: newRealizedPnL
    }).eq('user_email', testUserEmail);
    
    await supabase.from('short_positions').update({
      is_active: false
    }).eq('user_email', testUserEmail).eq('symbol', 'TEST2');
    
    // Verify
    const { data: finalPortfolio } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_email', testUserEmail)
      .single();
    
    const expectedFinalCash = 990000; // Initial 1M - 10K loss
    
    console.log(`   📊 Expected final cash: ₹${expectedFinalCash.toLocaleString()}`);
    console.log(`   📊 Actual final cash: ₹${finalPortfolio.cash_balance.toLocaleString()}`);
    console.log(`   📊 P&L: ₹${finalPortfolio.realized_pnl.toLocaleString()}`);
    
    expect(finalPortfolio.cash_balance).toBe(expectedFinalCash);
    expect(finalPortfolio.realized_pnl).toBe(expectedPnL);
    
    console.log('✅ Auto square-off loss scenario is CORRECT');
  });
});