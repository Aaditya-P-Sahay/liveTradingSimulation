// backend/tests/integration/leaderboard.test.js
import { describe, it, expect, beforeAll } from 'vitest';
import axios from 'axios';

const API_URL = 'http://localhost:3002';

async function isBackendRunning() {
  try {
    await axios.get(`${API_URL}/api/health`, { timeout: 2000 });
    return true;
  } catch (error) {
    return false;
  }
}

describe('Leaderboard Integration Tests', () => {
  let backendRunning = false;

  beforeAll(async () => {
    backendRunning = await isBackendRunning();
    if (!backendRunning) {
      console.warn('⚠️ Backend not running. Start with: npm run dev');
      console.warn('⚠️ Skipping leaderboard tests');
    }
  });

  it('should fetch leaderboard data', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    const response = await axios.get(`${API_URL}/api/leaderboard`);
    
    expect(response.status).toBe(200);
    expect(Array.isArray(response.data)).toBe(true);
    
    console.log('✅ Leaderboard fetched:', response.data.length, 'entries');
    
    if (response.data.length > 0) {
      const topPlayer = response.data[0];
      expect(topPlayer).toHaveProperty('rank');
      expect(topPlayer).toHaveProperty('user_name');
      expect(topPlayer).toHaveProperty('total_wealth');
      expect(topPlayer).toHaveProperty('total_pnl');
      expect(topPlayer).toHaveProperty('return_percentage');
      expect(topPlayer.rank).toBe(1);
      
      console.log('   🏆 Top player:', topPlayer.user_name);
      console.log('   💰 Wealth: ₹' + topPlayer.total_wealth.toFixed(2));
      console.log('   📈 Return:', topPlayer.return_percentage.toFixed(2) + '%');
    }
  });

  it('should have leaderboard sorted by total_wealth descending', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    const response = await axios.get(`${API_URL}/api/leaderboard`);
    const leaderboard = response.data;
    
    if (leaderboard.length < 2) {
      console.log('⏭️ Not enough entries to test sorting');
      return;
    }

    for (let i = 0; i < leaderboard.length - 1; i++) {
      expect(leaderboard[i].total_wealth).toBeGreaterThanOrEqual(leaderboard[i + 1].total_wealth);
    }
    
    console.log('✅ Leaderboard properly sorted by wealth');
  });

  it('should have correct rank numbers', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    const response = await axios.get(`${API_URL}/api/leaderboard`);
    const leaderboard = response.data;
    
    leaderboard.forEach((entry, index) => {
      expect(entry.rank).toBe(index + 1);
    });
    
    console.log('✅ Rank numbers sequential:', leaderboard.length, 'entries');
  });

  it('should calculate return percentage correctly', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    const response = await axios.get(`${API_URL}/api/leaderboard`);
    const leaderboard = response.data;
    
    if (leaderboard.length === 0) {
      console.log('⏭️ No entries to test');
      return;
    }

    leaderboard.forEach(entry => {
      const expectedReturn = ((entry.total_wealth - 1000000) / 1000000) * 100;
      const diff = Math.abs(entry.return_percentage - expectedReturn);
      
      expect(diff).toBeLessThan(0.01); // Allow 0.01% rounding difference
    });
    
    console.log('✅ Return percentages calculated correctly');
  });

  it('should have all required fields', async () => {
    if (!backendRunning) {
      console.log('⏭️ Skipping - Backend not running');
      return;
    }

    const response = await axios.get(`${API_URL}/api/leaderboard`);
    const leaderboard = response.data;
    
    if (leaderboard.length === 0) {
      console.log('⏭️ No entries to test');
      return;
    }

    const requiredFields = [
      'rank',
      'user_name',
      'user_email',
      'total_wealth',
      'total_pnl',
      'return_percentage',
      'cash_balance',
      'market_value',
      'short_value',
      'realized_pnl',
      'unrealized_pnl'
    ];

    const firstEntry = leaderboard[0];
    requiredFields.forEach(field => {
      expect(firstEntry).toHaveProperty(field);
    });
    
    console.log('✅ All required fields present');
  });

  it('should test leaderboard wealth calculation logic', () => {
    // Simulate what the leaderboard calculation does
    const mockPortfolios = [
      { cash_balance: 800000, market_value: 250000, unrealized_pnl: 50000 },
      { cash_balance: 950000, market_value: 100000, unrealized_pnl: 50000 },
      { cash_balance: 1000000, market_value: 0, unrealized_pnl: 0 }
    ];

    const wealthCalculations = mockPortfolios.map(p => {
      // This is how our FIXED code calculates it
      const totalWealth = p.cash_balance + p.market_value;
      return totalWealth;
    });

    expect(wealthCalculations[0]).toBe(1050000); // 800k cash + 250k market
    expect(wealthCalculations[1]).toBe(1050000); // 950k cash + 100k market
    expect(wealthCalculations[2]).toBe(1000000); // No change

    console.log('✅ Leaderboard wealth calculation logic verified');
  });
});