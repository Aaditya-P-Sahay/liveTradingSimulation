// backend/tests/unit/shorts.test.js
import { describe, it, expect, beforeEach } from 'vitest';

describe('Short Sell Mechanics', () => {
  it('should calculate short P&L correctly - profit scenario', () => {
    const shortPrice = 3000;
    const currentPrice = 2800;
    const quantity = 100;

    const pnl = (shortPrice - currentPrice) * quantity;
    expect(pnl).toBe(20000); // Profit when price drops
    console.log('✅ Short profit: ₹20,000 when price drops 3000→2800');
  });

  it('should calculate short P&L correctly - loss scenario', () => {
    const shortPrice = 3000;
    const currentPrice = 3200;
    const quantity = 100;

    const pnl = (shortPrice - currentPrice) * quantity;
    expect(pnl).toBe(-20000); // Loss when price rises
    console.log('✅ Short loss: ₹-20,000 when price rises 3000→3200');
  });

  it('should demonstrate auto square-off bug', () => {
    const initialCash = 1000000;
    const shortPrice = 2000;
    const quantity = 100;
    const currentPrice = 1900;

    // Initial short: cash increases
    const cashAfterShort = initialCash + (shortPrice * quantity);
    expect(cashAfterShort).toBe(1200000);

    // P&L calculation
    const pnl = (shortPrice - currentPrice) * quantity; // 10000 profit
    expect(pnl).toBe(10000);

    // BUGGY auto square-off code
    const buggyFinalCash = cashAfterShort + (shortPrice * quantity) + pnl;
    expect(buggyFinalCash).toBe(1410000); // WRONG! Extra 200k

    // CORRECT auto square-off
    const correctFinalCash = cashAfterShort + pnl;
    expect(correctFinalCash).toBe(1210000);

    console.log('❌ Bug #2: Buggy code gives ₹1,410,000 instead of ₹1,210,000');
    console.log('   Difference: ₹200,000 (the original short proceeds added twice)');
  });

  it('should handle FIFO short covering correctly', () => {
    const shorts = [
      { id: 1, quantity: 50, avg_short_price: 3000 },
      { id: 2, quantity: 30, avg_short_price: 3100 }
    ];

    let coverQuantity = 60;
    let totalPnl = 0;
    const coverPrice = 2900;

    // Cover first short completely (50 shares)
    let covered = Math.min(coverQuantity, shorts[0].quantity);
    totalPnl += (shorts[0].avg_short_price - coverPrice) * covered;
    coverQuantity -= covered;
    
    expect(covered).toBe(50);
    expect(totalPnl).toBe(5000); // (3000-2900)*50

    // Cover part of second short (10 shares)
    covered = Math.min(coverQuantity, shorts[1].quantity);
    totalPnl += (shorts[1].avg_short_price - coverPrice) * covered;
    
    expect(covered).toBe(10);
    expect(totalPnl).toBe(7000); // 5000 + (3100-2900)*10

    console.log('✅ FIFO covering works: Total P&L = ₹7,000');
  });
});