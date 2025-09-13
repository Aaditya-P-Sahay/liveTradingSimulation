// src/components/PerformanceMonitor.tsx
import React, { useEffect, useState } from 'react';
import { Monitor, Zap, Clock, Wifi, Database } from 'lucide-react';

interface PerformanceMetrics {
  fps: number;
  memoryUsage: number;
  networkLatency: number;
  renderTime: number;
  wsConnectionStatus: 'connected' | 'connecting' | 'disconnected';
  dataPoints: number;
}

interface PerformanceMonitorProps {
  isVisible?: boolean;
  onToggle?: () => void;
  className?: string;
}

export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  isVisible = false,
  onToggle,
  className = ''
}) => {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 0,
    memoryUsage: 0,
    networkLatency: 0,
    renderTime: 0,
    wsConnectionStatus: 'disconnected',
    dataPoints: 0
  });

  const [isExpanded, setIsExpanded] = useState(false);

  // FPS monitoring
  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let animationFrameId: number;

    const measureFPS = () => {
      frameCount++;
      const currentTime = performance.now();
      
      if (currentTime - lastTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
        setMetrics(prev => ({ ...prev, fps }));
        
        frameCount = 0;
        lastTime = currentTime;
      }
      
      animationFrameId = requestAnimationFrame(measureFPS);
    };

    if (isVisible) {
      animationFrameId = requestAnimationFrame(measureFPS);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isVisible]);

  // Memory usage monitoring
  useEffect(() => {
    const measureMemory = () => {
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        const memoryUsage = Math.round(memory.usedJSHeapSize / 1048576); // MB
        setMetrics(prev => ({ ...prev, memoryUsage }));
      }
    };

    if (isVisible) {
      measureMemory();
      const interval = setInterval(measureMemory, 2000);
      return () => clearInterval(interval);
    }
  }, [isVisible]);

  // Network latency monitoring
  useEffect(() => {
    const measureLatency = async () => {
      try {
        const start = performance.now();
        await fetch('/api/health', { method: 'HEAD' });
        const latency = Math.round(performance.now() - start);
        setMetrics(prev => ({ ...prev, networkLatency: latency }));
      } catch (error) {
        setMetrics(prev => ({ ...prev, networkLatency: -1 }));
      }
    };

    if (isVisible) {
      measureLatency();
      const interval = setInterval(measureLatency, 5000);
      return () => clearInterval(interval);
    }
  }, [isVisible]);

  // Render time monitoring
  useEffect(() => {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        if (entry.entryType === 'measure' && entry.name.includes('React')) {
          setMetrics(prev => ({ ...prev, renderTime: Math.round(entry.duration) }));
        }
      }
    });

    if (isVisible && 'PerformanceObserver' in window) {
      observer.observe({ entryTypes: ['measure'] });
      return () => observer.disconnect();
    }
  }, [isVisible]);

  const getStatusColor = (value: number, thresholds: { good: number; warning: number }) => {
    if (value <= thresholds.good) return 'text-green-600';
    if (value <= thresholds.warning) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getMemoryColor = (mb: number) => {
    if (mb < 50) return 'text-green-600';
    if (mb < 100) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getLatencyColor = (ms: number) => {
    if (ms < 0) return 'text-red-600';
    if (ms < 100) return 'text-green-600';
    if (ms < 300) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className={`fixed bottom-4 right-4 z-50 ${className}`}>
      <div className="bg-black bg-opacity-80 text-white rounded-lg shadow-2xl backdrop-blur-sm">
        {/* Toggle Button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full p-3 flex items-center justify-between hover:bg-white hover:bg-opacity-10 rounded-lg transition-colors"
        >
          <div className="flex items-center">
            <Monitor className="w-5 h-5 mr-2" />
            <span className="font-medium">Performance</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1">
              <Zap className={`w-3 h-3 ${getStatusColor(metrics.fps, { good: 55, warning: 30 })}`} />
              <span className="text-xs">{metrics.fps}</span>
            </div>
            <div className={`w-2 h-2 rounded-full ${
              metrics.wsConnectionStatus === 'connected' ? 'bg-green-400' :
              metrics.wsConnectionStatus === 'connecting' ? 'bg-yellow-400' : 'bg-red-400'
            }`} />
          </div>
        </button>

        {/* Expanded Metrics */}
        {isExpanded && (
          <div className="p-4 border-t border-gray-600 space-y-3">
            {/* FPS */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Zap className="w-4 h-4 mr-2 text-blue-400" />
                <span className="text-sm">FPS</span>
              </div>
              <span className={`font-mono text-sm ${getStatusColor(metrics.fps, { good: 55, warning: 30 })}`}>
                {metrics.fps}
              </span>
            </div>

            {/* Memory Usage */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Database className="w-4 h-4 mr-2 text-purple-400" />
                <span className="text-sm">Memory</span>
              </div>
              <span className={`font-mono text-sm ${getMemoryColor(metrics.memoryUsage)}`}>
                {metrics.memoryUsage}MB
              </span>
            </div>

            {/* Network Latency */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Wifi className="w-4 h-4 mr-2 text-green-400" />
                <span className="text-sm">Latency</span>
              </div>
              <span className={`font-mono text-sm ${getLatencyColor(metrics.networkLatency)}`}>
                {metrics.networkLatency < 0 ? 'Error' : `${metrics.networkLatency}ms`}
              </span>
            </div>

            {/* Render Time */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Clock className="w-4 h-4 mr-2 text-orange-400" />
                <span className="text-sm">Render</span>
              </div>
              <span className={`font-mono text-sm ${getStatusColor(metrics.renderTime, { good: 16, warning: 50 })}`}>
                {metrics.renderTime}ms
              </span>
            </div>

            {/* Performance Score */}
            <div className="border-t border-gray-600 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Score</span>
                <span className={`font-bold ${
                  metrics.fps > 50 && metrics.memoryUsage < 100 && metrics.networkLatency < 200 
                    ? 'text-green-400' 
                    : metrics.fps > 30 && metrics.memoryUsage < 150 && metrics.networkLatency < 500
                    ? 'text-yellow-400'
                    : 'text-red-400'
                }`}>
                  {metrics.fps > 50 && metrics.memoryUsage < 100 && metrics.networkLatency < 200 
                    ? 'Excellent' 
                    : metrics.fps > 30 && metrics.memoryUsage < 150 && metrics.networkLatency < 500
                    ? 'Good'
                    : 'Poor'}
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="border-t border-gray-600 pt-3 space-y-2">
              <button
                onClick={() => {
                  if ('gc' in window) {
                    (window as any).gc();
                  } else {
                    console.log('Garbage collection not available');
                  }
                }}
                className="w-full text-xs bg-gray-700 hover:bg-gray-600 py-1 px-2 rounded transition-colors"
              >
                Force GC
              </button>
              <button
                onClick={() => {
                  const entries = performance.getEntriesByType('navigation');
                  console.log('Navigation timing:', entries);
                }}
                className="w-full text-xs bg-gray-700 hover:bg-gray-600 py-1 px-2 rounded transition-colors"
              >
                Log Timing
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Hook for using performance monitoring
export const usePerformanceMonitoring = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);

  useEffect(() => {
    // Enable monitoring in development or when explicitly enabled
    const shouldMonitor = process.env.NODE_ENV === 'development' || 
                         localStorage.getItem('enablePerformanceMonitoring') === 'true';
    
    setIsMonitoring(shouldMonitor);

    // Global keyboard shortcut to toggle monitoring (Ctrl+Shift+P)
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'P') {
        event.preventDefault();
        const newState = !isMonitoring;
        setIsMonitoring(newState);
        localStorage.setItem('enablePerformanceMonitoring', newState.toString());
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isMonitoring]);

  return {
    isMonitoring,
    toggleMonitoring: () => {
      const newState = !isMonitoring;
      setIsMonitoring(newState);
      localStorage.setItem('enablePerformanceMonitoring', newState.toString());
    }
  };
};