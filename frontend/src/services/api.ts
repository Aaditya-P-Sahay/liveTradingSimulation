const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ContestDataResponse {
  symbol: string;
  fromTick: number;
  toTick: number;
  currentContestTick: number;
  totalContestTicks: number;
  ticks: any[];
  ticksCount: number;
  candles: any[];
  candlesCount: number;
  intervalSeconds: number;
  contestStartTime: string;
  marketStartTime: string;
  contestActive: boolean;
  contestPaused: boolean;
}

class ApiService {
  private authToken: string | null = null;

  setAuthToken(token: string | null) {
    this.authToken = token;
  }

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

  // Auth methods
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

  // Market data methods
  async getSymbols(): Promise<string[]> {
    return this.request('/api/symbols');
  }

  async getContestData(
    symbol: string,
    from?: number,
    to?: number,
    interval?: number
  ): Promise<ContestDataResponse> {
    const params = new URLSearchParams();
    if (from !== undefined) params.append('from', from.toString());
    if (to !== undefined) params.append('to', to.toString());
    if (interval !== undefined) params.append('interval', interval.toString());
    
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/api/contest-data/${symbol}${query}`);
  }

  async getHistory(symbol: string, page = 1, limit = 1000) {
    return this.request(`/api/history/${symbol}?page=${page}&limit=${limit}`);
  }

  async getCandlestick(symbol: string, interval = '30s') {
    return this.request(`/api/candlestick/${symbol}?interval=${interval}`);
  }

  async getContestState() {
    return this.request('/api/contest/state');
  }

  // Trading methods
  async executeTrade(symbol: string, order_type: string, quantity: number) {
    return this.request('/api/trade', {
      method: 'POST',
      body: JSON.stringify({ symbol, order_type, quantity }),
    });
  }

  async getPortfolio() {
    return this.request('/api/portfolio');
  }

  async getTrades(page = 1, limit = 50) {
    return this.request(`/api/trades?page=${page}&limit=${limit}`);
  }

  async getShorts(activeOnly = true) {
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