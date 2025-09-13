// src/services/api.ts

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export interface StockData {
  unique_id: number;
  timestamp: string;
  normalized_timestamp?: string;
  symbol: string;
  company_name: string;
  token: number;
  last_traded_price: number;
  volume_traded: number;
  exchange_timestamp: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  total_buy_quantity: string;
  total_sell_quantity: string;
  average_traded_price: number;
  subscription_mode: string;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface HistoryResponse {
  symbol: string;
  data: StockData[];
  pagination: PaginationInfo;
}

export interface CandlestickData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandlestickResponse {
  symbol: string;
  interval: string;
  data: CandlestickData[];
}

export interface HealthStatus {
  status: string;
  connectedUsers: number;
  activeSymbols: string[];
  cachedSymbols: string[];
  uptime: number;
}

class ApiService {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        ...options,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  // Get list of available symbols
  async getSymbols(): Promise<string[]> {
    return this.request<string[]>('/symbols');
  }

  // Get historical data for a symbol with pagination
  async getHistory(symbol: string, page: number = 1, limit: number = 1000): Promise<HistoryResponse> {
    return this.request<HistoryResponse>(`/history/${symbol}?page=${page}&limit=${limit}`);
  }

  // Get all historical data for a symbol (auto-paginated)
  async getAllHistory(symbol: string): Promise<StockData[]> {
    let allData: StockData[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getHistory(symbol, page, 1000);
      allData = allData.concat(response.data);
      hasMore = response.pagination.hasNext;
      page++;

      // Safety break to avoid infinite loops
      if (page > 100) {
        console.warn('Stopping pagination at page 100 to avoid infinite loop');
        break;
      }
    }

    return allData;
  }

  // Get candlestick data for a symbol
  async getCandlestickData(symbol: string, interval: string = '1m'): Promise<CandlestickResponse> {
    return this.request<CandlestickResponse>(`/candlestick/${symbol}?interval=${interval}`);
  }

  // Get server health status
  async getHealth(): Promise<HealthStatus> {
    return this.request<HealthStatus>('/health');
  }

  // Search symbols (client-side filtering)
  async searchSymbols(query: string): Promise<string[]> {
    const symbols = await this.getSymbols();
    return symbols.filter(symbol => 
      symbol.toLowerCase().includes(query.toLowerCase())
    );
  }
}

// Export singleton instance
export const apiService = new ApiService();