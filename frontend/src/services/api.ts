const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

interface TimeframeInfo {
  available: string[];
  enabled: string[];
  default: string;
  details: Record<string, { seconds: number; label: string }>;
}

class ApiService {
  private authToken: string | null = null;

  setAuthToken(token: string | null) {
    this.authToken = token;
  }

  private async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_URL}${endpoint}`;
    
    const defaultHeaders: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      defaultHeaders.Authorization = `Bearer ${this.authToken}`;
    }

    const config: RequestInit = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API Request failed: ${endpoint}`, error);
      throw error;
    }
  }

  // Auth methods
  async login(email: string, password: string) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async getMe() {
    return this.request('/api/auth/me');
  }

  // Market data methods
  async getSymbols(): Promise<string[]> {
    return this.request('/api/symbols');
  }

  async getTimeframes(): Promise<TimeframeInfo> {
    return this.request('/api/timeframes');
  }

  async getCandlestick(symbol: string, timeframe = '30s') {
    return this.request(`/api/candlestick/${symbol}?timeframe=${timeframe}`);
  }

  async getContestState() {
    return this.request('/api/contest/state');
  }

  // Trading methods
  async placeTrade(tradeData: {
    symbol: string;
    order_type: string;
    quantity: number;
  }) {
    return this.request('/api/trade', {
      method: 'POST',
      body: JSON.stringify(tradeData),
    });
  }

  async getPortfolio() {
    return this.request('/api/portfolio');
  }

  async getTrades(page = 1, limit = 50) {
    return this.request(`/api/trades?page=${page}&limit=${limit}`);
  }

  async getShortPositions(activeOnly = true) {
    return this.request(`/api/shorts?active=${activeOnly}`);
  }

  async getLeaderboard(limit = 100) {
    return this.request(`/api/leaderboard?limit=${limit}`);
  }

  // Admin methods
  async startContest() {
    return this.request('/api/admin/contest/start', {
      method: 'POST',
    });
  }

  async stopContest() {
    return this.request('/api/admin/contest/stop', {
      method: 'POST',
    });
  }

  async getAdminStatus() {
    return this.request('/api/admin/contest/status');
  }

  async health() {
    return this.request('/api/health');
  }
  // Add these methods to the existing ApiService class

  async pauseContest() {
  return this.request('/api/admin/contest/pause', {
    method: 'POST',
  });
  }

  async resumeContest() {
  return this.request('/api/admin/contest/resume', {
    method: 'POST',
  });
  }
}

export const apiService = new ApiService();