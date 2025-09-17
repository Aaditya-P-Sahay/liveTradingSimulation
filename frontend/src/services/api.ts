import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Create axios instance with interceptor
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const apiService = {
  // Market Data (Public)
  async getSymbols() {
    const { data } = await api.get('/symbols');
    return data;
  },

  async getHistory(symbol: string, page = 1, limit = 100) {
    const { data } = await api.get(`/history/${symbol}?page=${page}&limit=${limit}`);
    return data;
  },

  // NEW: Contest data endpoint for proper timeline
  async getContestData(symbol: string, from = 0, to?: number) {
    const url = to !== undefined 
      ? `/contest-data/${symbol}?from=${from}&to=${to}`
      : `/contest-data/${symbol}?from=${from}`;
    const { data } = await api.get(url);
    return data;
  },

  async getCandlestick(symbol: string, interval = '1m') {
    const { data } = await api.get(`/candlestick/${symbol}?interval=${interval}`);
    return data;
  },

  async getContestState() {
    const { data } = await api.get('/contest/state');
    return data;
  },

  // Trading (Protected)
  async placeTrade(trade: { symbol: string; order_type: string; quantity: number }) {
    const { data } = await api.post('/trade', trade);
    return data;
  },

  async getPortfolio() {
    const { data } = await api.get('/portfolio');
    return data;
  },

  async getTrades(page = 1, limit = 50) {
    const { data } = await api.get(`/trades?page=${page}&limit=${limit}`);
    return data;
  },

  // NEW: Short positions endpoint
  async getShortPositions(activeOnly = false) {
    const url = activeOnly ? '/shorts?active=true' : '/shorts';
    const { data } = await api.get(url);
    return data;
  },

  async getLeaderboard(limit = 100) {
    const { data } = await api.get(`/leaderboard?limit=${limit}`);
    return data;
  },

  // Health check
  async getHealth() {
    const { data } = await api.get('/health');
    return data;
  }
};