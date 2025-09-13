// src/services/websocket.ts
import { io, Socket } from 'socket.io-client';

export interface StockTick {
  symbol: string;
  data: {
    unique_id: number;
    timestamp: string;
    normalized_timestamp: string;
    symbol: string;
    company_name: string;
    last_traded_price: number;
    volume_traded: number;
    high_price: number;
    low_price: number;
    close_price: number;
    open_price: number;
    average_traded_price: number;
  };
  timestamp: string;
  index: number;
  total: number;
}

export interface HistoricalDataResponse {
  symbol: string;
  data: StockTick['data'][];
  total: number;
}

class WebSocketService {
  private socket: Socket | null = null;
  private subscribers = new Map<string, Set<(data: StockTick) => void>>();
  private historicalSubscribers = new Map<string, Set<(data: HistoricalDataResponse) => void>>();
  private connectionCallbacks = new Set<(connected: boolean) => void>();
  private currentSymbol: string | null = null;

  connect(serverUrl: string = 'http://localhost:3001') {
    if (this.socket?.connected) {
      return;
    }

    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      timeout: 20000,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('✅ Connected to WebSocket server');
      this.connectionCallbacks.forEach(callback => callback(true));
    });

    this.socket.on('disconnect', () => {
      console.log('❌ Disconnected from WebSocket server');
      this.connectionCallbacks.forEach(callback => callback(false));
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.connectionCallbacks.forEach(callback => callback(false));
    });

    // Handle real-time stock ticks
    this.socket.on('tick', (data: StockTick) => {
      const callbacks = this.subscribers.get(data.symbol);
      if (callbacks) {
        callbacks.forEach(callback => callback(data));
      }
    });

    // Handle historical data
    this.socket.on('historical_data', (data: HistoricalDataResponse) => {
      const callbacks = this.historicalSubscribers.get(data.symbol);
      if (callbacks) {
        callbacks.forEach(callback => callback(data));
      }
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.currentSymbol = null;
    }
  }

  joinSymbol(symbol: string) {
    if (!this.socket?.connected) {
      console.error('Socket not connected');
      return;
    }

    if (this.currentSymbol === symbol) {
      return; // Already subscribed to this symbol
    }

    // Leave current symbol if any
    if (this.currentSymbol) {
      this.socket.emit('leave_symbol', this.currentSymbol);
    }

    // Join new symbol room
    this.socket.emit('join_symbol', symbol);
    this.currentSymbol = symbol;
    
    console.log(`📊 Joined symbol room: ${symbol}`);
  }

  leaveSymbol(symbol: string) {
    if (!this.socket?.connected) {
      return;
    }

    this.socket.emit('leave_symbol', symbol);
    if (this.currentSymbol === symbol) {
      this.currentSymbol = null;
    }
    
    console.log(`📊 Left symbol room: ${symbol}`);
  }

  // Subscribe to real-time ticks for a symbol
  subscribeToTicks(symbol: string, callback: (data: StockTick) => void) {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, new Set());
    }
    this.subscribers.get(symbol)!.add(callback);

    // Auto-join the symbol room
    this.joinSymbol(symbol);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscribers.get(symbol);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscribers.delete(symbol);
          this.leaveSymbol(symbol);
        }
      }
    };
  }

  // Subscribe to historical data for a symbol
  subscribeToHistoricalData(symbol: string, callback: (data: HistoricalDataResponse) => void) {
    if (!this.historicalSubscribers.has(symbol)) {
      this.historicalSubscribers.set(symbol, new Set());
    }
    this.historicalSubscribers.get(symbol)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.historicalSubscribers.get(symbol);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.historicalSubscribers.delete(symbol);
        }
      }
    };
  }

  // Subscribe to connection status changes
  subscribeToConnection(callback: (connected: boolean) => void) {
    this.connectionCallbacks.add(callback);

    // Return unsubscribe function
    return () => {
      this.connectionCallbacks.delete(callback);
    };
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getCurrentSymbol(): string | null {
    return this.currentSymbol;
  }
}

// Export singleton instance
export const webSocketService = new WebSocketService();