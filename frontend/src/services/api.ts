// frontend/src/services/api.ts
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ContestDataResponse {
  symbol: string;
  timeframe: string;
  fromIndex: number;
  toIndex: number;
  currentContestIndex: number;
  totalContestRows: number;
  ticks: any[];
  ticksCount: number;
  candles: any[];
  candlesCount: number;
  contestStartTime: string;
  contestActive: boolean;
  contestPaused: boolean;
}

interface TimeframeInfo {
  available: string[];
  enabled: string[];
  default: string;
  details: Record<string, { seconds: number; label: string }>;
}

class ApiService {
  private authToken: string | null = null;

  // YOUR ORIGINAL METHOD (PRESERVED)
  setAuthToken(token: string | null) {
    this.authToken = token;
  }

  // YOUR ORIGINAL REQUEST METHOD (PRESERVED)
  private async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
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

  // YOUR ORIGINAL AUTH METHODS (PRESERVED)
  async login(email: string, password: string) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async signup(email: string, password: string, full_name: string) {
    return this.request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name }),
    });
  }

  async logout() {
    return this.request('/api/auth/logout', {
      method: 'POST',
    });
  }

  async getMe() {
    return this.request('/api/auth/me');
  }

  // NEW: Timeframe methods
  async getTimeframes(): Promise<TimeframeInfo> {
    return this.request('/api/timeframes');
  }

  // YOUR ORIGINAL + ENHANCED MARKET DATA METHODS
  async getSymbols(): Promise<string[]> {
    return this.request('/api/symbols');
  }

  async getContestData(
    symbol: string,
    from?: number,
    to?: number,
    timeframe?: string
  ): Promise<ContestDataResponse> {
    const params = new URLSearchParams();
    if (from !== undefined) params.append('from', from.toString());
    if (to !== undefined) params.append('to', to.toString());
    if (timeframe) params.append('timeframe', timeframe);
    
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/api/contest-data/${symbol}${query}`);
  }

  async getHistory(symbol: string, page = 1, limit = 1000) {
    return this.request(`/api/history/${symbol}?page=${page}&limit=${limit}`);
  }

  // ENHANCED: Candlestick with timeframe support
  async getCandlestick(symbol: string, timeframe = '30s') {
    return this.request(`/api/candlestick/${symbol}?timeframe=${timeframe}`);
  }

  async getContestState() {
    return this.request('/api/contest/state');
  }

  // YOUR ORIGINAL TRADING METHODS (PRESERVED)
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

  // YOUR ORIGINAL ADMIN METHODS (PRESERVED)
  async startContest() {
    return this.request('/api/admin/contest/start', {
      method: 'POST',
    });
  }

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

  async stopContest() {
    return this.request('/api/admin/contest/stop', {
      method: 'POST',
    });
  }

  async getAdminStatus() {
    return this.request('/api/admin/contest/status');
  }

  async setContestSpeed(speed: number) {
    return this.request('/api/admin/contest/speed', {
      method: 'POST',
      body: JSON.stringify({ speed }),
    });
  }

  async createTestUser() {
    return this.request('/api/test/create-test-user', {
      method: 'POST',
    });
  }

  async health() {
    return this.request('/api/health');
  }
}

export const apiService = new ApiService();