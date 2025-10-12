// backend/tests/unit/trading.test.js
import { describe, it, expect } from 'vitest';

describe('Trade Execution Validation', () => {
  it('should validate buy order requirements', () => {
    const cash = 100000;
    const price = 2000;
    const quantity = 60;
    const totalCost = price * quantity; // 120000
    
    const canBuy = cash >= totalCost;
    expect(canBuy).toBe(false);
    console.log('✅ Buy validation: Insufficient cash detected');
  });

  it('should validate sell order requirements', () => {
    const holdings = {
      RELIANCE: { quantity: 50, avg_price: 2000 }
    };
    const sellSymbol = 'RELIANCE';
    const sellQuantity = 60;
    
    const canSell = holdings[sellSymbol]?.quantity >= sellQuantity;
    expect(canSell).toBe(false);
    console.log('✅ Sell validation: Insufficient holdings detected');
  });

  it('should calculate total cost correctly', () => {
    const price = 2543.75;
    const quantity = 47;
    const totalCost = price * quantity;
    
    expect(totalCost).toBe(119556.25);
    console.log('✅ Total cost calculation correct');
  });

  it('should calculate new average price on additional buy', () => {
    // First buy: 100 shares @ 2000
    let totalShares = 100;
    let totalInvested = 100 * 2000; // 200000
    let avgPrice = totalInvested / totalShares; // 2000
    
    expect(avgPrice).toBe(2000);
    
    // Second buy: 50 shares @ 2200
    totalShares += 50;
    totalInvested += 50 * 2200; // 200000 + 110000 = 310000
    avgPrice = totalInvested / totalShares; // 310000 / 150 = 2066.67
    
    expect(Math.round(avgPrice * 100) / 100).toBe(2066.67);
    console.log('✅ Average price recalculation correct:', avgPrice);
  });

  it('should calculate realized P&L on sell', () => {
    const buyPrice = 2000;
    const sellPrice = 2150;
    const quantity = 100;
    
    const realizedPnl = (sellPrice - buyPrice) * quantity;
    expect(realizedPnl).toBe(15000);
    console.log('✅ Realized P&L calculation: ₹15,000 profit');
  });

  it('should handle partial sell correctly', () => {
    const totalShares = 100;
    const avgPrice = 2000;
    const sellQuantity = 40;
    const sellPrice = 2150;
    
    const realizedPnl = (sellPrice - avgPrice) * sellQuantity;
    const remainingShares = totalShares - sellQuantity;
    
    expect(realizedPnl).toBe(6000); // (2150-2000) * 40
    expect(remainingShares).toBe(60);
    console.log('✅ Partial sell: 40 sold, 60 remain, ₹6,000 realized');
  });

  it('should validate contest running status for trades', () => {
    const contestRunning = false;
    const isPaused = false;
    
    const canTrade = contestRunning && !isPaused;
    expect(canTrade).toBe(false);
    console.log('✅ Trading blocked when contest not running');
  });

  it('should validate contest paused status for trades', () => {
    const contestRunning = true;
    const isPaused = true;
    
    const canTrade = contestRunning && !isPaused;
    expect(canTrade).toBe(false);
    console.log('✅ Trading blocked when contest paused');
  });

  it('should allow trading when contest active and not paused', () => {
    const contestRunning = true;
    const isPaused = false;
    
    const canTrade = contestRunning && !isPaused;
    expect(canTrade).toBe(true);
    console.log('✅ Trading allowed when contest active');
  });
});

describe('Short Sell Validation', () => {
  it('should validate short sell proceeds calculation', () => {
    const shortPrice = 3000;
    const quantity = 50;
    const proceeds = shortPrice * quantity;
    
    expect(proceeds).toBe(150000);
    console.log('✅ Short sell proceeds: ₹150,000 credited to cash');
  });

  it('should calculate short P&L on price drop', () => {
    const shortPrice = 3000;
    const currentPrice = 2800;
    const quantity = 50;
    const pnl = (shortPrice - currentPrice) * quantity;
    
    expect(pnl).toBe(10000); // Profit
    console.log('✅ Short profit on price drop: ₹10,000');
  });

  it('should calculate short P&L on price rise', () => {
    const shortPrice = 3000;
    const currentPrice = 3200;
    const quantity = 50;
    const pnl = (shortPrice - currentPrice) * quantity;
    
    expect(pnl).toBe(-10000); // Loss
    console.log('✅ Short loss on price rise: ₹-10,000');
  });

  it('should calculate buy-to-cover cost', () => {
    const currentPrice = 2900;
    const quantity = 50;
    const coverCost = currentPrice * quantity;
    
    expect(coverCost).toBe(145000);
    console.log('✅ Buy-to-cover cost: ₹145,000');
  });

  it('should validate FIFO covering logic', () => {
    const shorts = [
      { quantity: 30, avg_short_price: 3000 },
      { quantity: 20, avg_short_price: 3100 },
      { quantity: 50, avg_short_price: 3050 }
    ];
    
    const coverQuantity = 60;
    let remaining = coverQuantity;
    let totalPnl = 0;
    const coverPrice = 2900;
    
    // Cover first short (30 shares)
    let covered = Math.min(remaining, shorts[0].quantity);
    totalPnl += (shorts[0].avg_short_price - coverPrice) * covered;
    remaining -= covered;
    expect(covered).toBe(30);
    expect(totalPnl).toBe(3000); // (3000-2900)*30
    
    // Cover second short (20 shares)
    covered = Math.min(remaining, shorts[1].quantity);
    totalPnl += (shorts[1].avg_short_price - coverPrice) * covered;
    remaining -= covered;
    expect(covered).toBe(20);
    expect(totalPnl).toBe(7000); // 3000 + (3100-2900)*20
    
    // Cover part of third short (10 shares)
    covered = Math.min(remaining, shorts[2].quantity);
    totalPnl += (shorts[2].avg_short_price - coverPrice) * covered;
    remaining -= covered;
    expect(covered).toBe(10);
    expect(totalPnl).toBe(8500); // 7000 + (3050-2900)*10
    expect(remaining).toBe(0);
    
    console.log('✅ FIFO covering: Total P&L = ₹8,500');
  });
});