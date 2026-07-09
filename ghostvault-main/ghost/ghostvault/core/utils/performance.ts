/**
 * MODULE: Performance Monitoring Utilities
 *
 * Responsibilities:
 *  - Track performance metrics
 *  - Monitor operation durations
 *  - Detect performance regressions
 *
 * Used by:
 *  - All modules that need performance monitoring
 *
 * Depends on:
 *  - core/utils/logger.ts
 *
 * @module core/utils/performance
 */

import { getLogger } from './logger.js';

const logger = getLogger('performance');

/**
 * Performance metric data
 */
export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Performance statistics
 */
export interface PerformanceStats {
  count: number;
  totalDuration: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  lastDuration: number;
}

/**
 * Performance tracker class
 */
export class PerformanceTracker {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private enabled = true;

  /**
   * Enable or disable tracking
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Start tracking an operation
   */
  start(name: string): () => void {
    if (!this.enabled) {
      return () => {};
    }

    const startTime = performance.now();

    return () => {
      const duration = performance.now() - startTime;
      this.recordMetric(name, duration);
    };
  }

  /**
   * Record a performance metric
   */
  recordMetric(name: string, duration: number, metadata?: Record<string, unknown>): void {
    if (!this.enabled) {
      return;
    }

    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
      metadata,
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    this.metrics.get(name)!.push(metric);

    // Keep only last 1000 metrics per name
    const metrics = this.metrics.get(name)!;
    if (metrics.length > 1000) {
      metrics.shift();
    }
  }

  /**
   * Get statistics for a metric
   */
  getStats(name: string): PerformanceStats | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const durations = metrics.map(m => m.duration);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);

    return {
      count: metrics.length,
      totalDuration,
      averageDuration: totalDuration / metrics.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      lastDuration: durations[durations.length - 1],
    };
  }

  /**
   * Get all metric names
   */
  getMetricNames(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    logger.info('Performance metrics cleared');
  }

  /**
   * Clear metrics for a specific name
   */
  clearMetric(name: string): void {
    this.metrics.delete(name);
    logger.info('Performance metric cleared', { name });
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, PerformanceMetric[]> {
    return new Map(this.metrics);
  }

  /**
   * Log statistics for all metrics
   */
  logStats(): void {
    for (const name of this.getMetricNames()) {
      const stats = this.getStats(name);
      if (stats) {
        logger.info('Performance stats', {
          name,
          ...stats,
        });
      }
    }
  }
}

// Global performance tracker instance
const globalTracker = new PerformanceTracker();

/**
 * Get the global performance tracker
 */
export function getPerformanceTracker(): PerformanceTracker {
  return globalTracker;
}

/**
 * Measure the duration of an async function
 */
export async function measureAsync<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const stop = globalTracker.start(name);
  try {
    const result = await fn();
    stop();
    return result;
  } catch (error) {
    stop();
    throw error;
  }
}

/**
 * Measure the duration of a sync function
 */
export function measureSync<T>(
  name: string,
  fn: () => T,
  metadata?: Record<string, unknown>
): T {
  const stop = globalTracker.start(name);
  try {
    const result = fn();
    stop();
    return result;
  } catch (error) {
    stop();
    throw error;
  }
}

/**
 * Create a performance-measured version of a function
 */
export function withPerformance<T extends (...args: unknown[]) => unknown>(
  name: string,
  fn: T,
  metadata?: Record<string, unknown>
): T {
  return ((...args: unknown[]) => {
    const stop = globalTracker.start(name);
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        return result
          .then(r => {
            stop();
            return r;
          })
          .catch(e => {
            stop();
            throw e;
          });
      }
      stop();
      return result;
    } catch (error) {
      stop();
      throw error;
    }
  }) as T;
}

/**
 * Memory usage monitoring
 */
export class MemoryMonitor {
  private samples: number[] = [];
  private maxSamples = 100;
  private enabled = false;

  /**
   * Enable or disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Record current memory usage
   */
  recordSample(): void {
    if (!this.enabled) {
      return;
    }

    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (performance as any).memory;
      const usedJSHeapSize = memory?.usedJSHeapSize || 0;
      this.samples.push(usedJSHeapSize);

      if (this.samples.length > this.maxSamples) {
        this.samples.shift();
      }
    }
  }

  /**
   * Get memory statistics
   */
  getStats(): { min: number; max: number; average: number; current: number } | null {
    if (this.samples.length === 0) {
      return null;
    }

    const min = Math.min(...this.samples);
    const max = Math.max(...this.samples);
    const average = this.samples.reduce((sum, s) => sum + s, 0) / this.samples.length;
    const current = this.samples[this.samples.length - 1];

    return { min, max, average, current };
  }

  /**
   * Clear samples
   */
  clear(): void {
    this.samples = [];
  }

  /**
   * Check if memory usage is trending upward
   */
  isTrendingUp(threshold: number = 0.1): boolean {
    if (this.samples.length < 10) {
      return false;
    }

    const recent = this.samples.slice(-5);
    const older = this.samples.slice(-10, -5);

    const recentAvg = recent.reduce((sum, s) => sum + s, 0) / recent.length;
    const olderAvg = older.reduce((sum, s) => sum + s, 0) / older.length;

    return (recentAvg - olderAvg) / olderAvg > threshold;
  }
}

// Global memory monitor instance
const globalMemoryMonitor = new MemoryMonitor();

/**
 * Get the global memory monitor
 */
export function getMemoryMonitor(): MemoryMonitor {
  return globalMemoryMonitor;
}

/**
 * Start periodic memory monitoring
 */
export function startMemoryMonitoring(intervalMs: number = 1000): () => void {
  globalMemoryMonitor.setEnabled(true);
  const interval = setInterval(() => {
    globalMemoryMonitor.recordSample();
  }, intervalMs);

  return () => {
    clearInterval(interval);
    globalMemoryMonitor.setEnabled(false);
  };
}

/**
 * Performance budget configuration
 */
export interface PerformanceBudget {
  maxDuration: number;
  maxMemory: number;
  warningThreshold: number;
}

/**
 * Check if operation exceeds performance budget
 */
export function checkPerformanceBudget(
  duration: number,
  budget: PerformanceBudget
): { withinBudget: boolean; exceededBy?: number; warning?: boolean } {
  const exceededBy = duration - budget.maxDuration;
  const withinBudget = exceededBy <= 0;
  const warning = !withinBudget && exceededBy < budget.warningThreshold;

  return {
    withinBudget,
    exceededBy: withinBudget ? undefined : exceededBy,
    warning,
  };
}

/**
 * Performance regression detection
 */
export class RegressionDetector {
  private baselines: Map<string, number> = new Map();
  private threshold = 0.2; // 20% degradation threshold

  /**
   * Set baseline for a metric
   */
  setBaseline(name: string, value: number): void {
    this.baselines.set(name, value);
    logger.info('Performance baseline set', { name, value });
  }

  /**
   * Check for regression
   */
  checkRegression(name: string, currentValue: number): {
    hasRegression: boolean;
    degradation?: number;
  } {
    const baseline = this.baselines.get(name);
    if (baseline === undefined) {
      return { hasRegression: false };
    }

    const degradation = (currentValue - baseline) / baseline;
    const hasRegression = degradation > this.threshold;

    if (hasRegression) {
      logger.warn('Performance regression detected', {
        name,
        baseline,
        currentValue,
        degradation: `${(degradation * 100).toFixed(2)}%`,
      });
    }

    return { hasRegression, degradation };
  }

  /**
   * Set regression threshold
   */
  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  /**
   * Clear all baselines
   */
  clear(): void {
    this.baselines.clear();
  }
}

// Global regression detector instance
const globalRegressionDetector = new RegressionDetector();

/**
 * Get the global regression detector
 */
export function getRegressionDetector(): RegressionDetector {
  return globalRegressionDetector;
}
