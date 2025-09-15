import { io, Socket } from 'socket.io-client';

interface StockTick {
  data: {
    symbol: string;
    timestamp: string;
    last_traded_price: number;
    open_price: number;
    high_price: number;
    low_price: number;
  };
}

interface HistoricalDataResponse {
  symbol: string;
  data: Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

class WebSocketService {
  private socket: Socket | null = null;
  private subscriptions: Map<string, Set<(data: StockTick) => void>> = new Map();
  private historicalSubscriptions: Map<string, Set<(data: HistoricalDataResponse) => void>> = new Map();
  private connectionListeners: Set<(connected: boolean) => void> = new Set();
  private currentSymbol: string | null = null;

  connect(url: string) {
    if (this.socket) return;

    this.socket = io(url, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.notifyConnectionListeners(true);
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      this.notifyConnectionListeners(false);
    });

    this.socket.on('stock_tick', (tick: StockTick) => {
      this.handleTick(tick);
    });

    this.socket.on('historical_data', (data: HistoricalDataResponse) => {
      this.handleHistoricalData(data);
    });
  }

  disconnect() {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket = null;
    this.subscriptions.clear();
    this.historicalSubscriptions.clear();
    this.connectionListeners.clear();
    this.currentSymbol = null;
  }

  private notifyConnectionListeners(connected: boolean) {
    this.connectionListeners.forEach(listener => listener(connected));
  }

  private handleTick(tick: StockTick) {
    const symbol = tick.data.symbol;
    const listeners = this.subscriptions.get(symbol);
    if (listeners) {
      listeners.forEach(listener => listener(tick));
    }
  }

  private handleHistoricalData(data: HistoricalDataResponse) {
    const symbol = data.symbol;
    const listeners = this.historicalSubscriptions.get(symbol);
    if (listeners) {
      listeners.forEach(listener => listener(data));
    }
  }

  joinSymbol(symbol: string) {
    if (!this.socket?.connected) {
      console.warn('Cannot join symbol: WebSocket not connected');
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
    this.subscriptions.delete(symbol);
    
    console.log(`📊 Left symbol room: ${symbol}`);
  }

  // Subscribe to real-time ticks for a symbol
  subscribeToTicks(symbol: string, callback: (data: StockTick) => void) {
    if (!this.subscriptions.has(symbol)) {
      this.subscriptions.set(symbol, new Set());
    }
    this.subscriptions.get(symbol)!.add(callback);

    // Auto-join the symbol room
    this.joinSymbol(symbol);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscriptions.get(symbol);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(symbol);
          this.leaveSymbol(symbol);
        }
      }
    };
  }

  // Subscribe to historical data for a symbol
  subscribeToHistoricalData(symbol: string, callback: (data: HistoricalDataResponse) => void) {
    if (!this.historicalSubscriptions.has(symbol)) {
      this.historicalSubscriptions.set(symbol, new Set());
    }
    this.historicalSubscriptions.get(symbol)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.historicalSubscriptions.get(symbol);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.historicalSubscriptions.delete(symbol);
        }
      }
    };
  }

  // Subscribe to connection status changes
  subscribeToConnection(callback: (connected: boolean) => void) {
    this.connectionListeners.add(callback);

    // Immediately notify of current status if socket exists
    if (this.socket) {
      callback(this.socket.connected);
    }

    // Return unsubscribe function
    return () => {
      this.connectionListeners.delete(callback);
    };
  }

  // Request historical data for a symbol
  requestHistoricalData(symbol: string, period: string = '1D') {
    if (!this.socket?.connected) {
      console.warn('Cannot request historical data: WebSocket not connected');
      return;
    }

    this.socket.emit('request_historical', { symbol, period });
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