import { logger } from './logger';

/**
 * Memory monitoring utilities to track and prevent memory leaks
 */
export class MemoryMonitor {
  private static readonly HIGH_MEMORY_THRESHOLD_MB = 500;
  private startMemory: NodeJS.MemoryUsage;
  private snapshots: Array<{ timestamp: number; memory: NodeJS.MemoryUsage }> = [];
  private readonly maxSnapshots: number = 100;

  constructor() {
    this.startMemory = process.memoryUsage();
  }

  /**
   * Take a memory snapshot
   */
  snapshot(label?: string): NodeJS.MemoryUsage {
    const memory = process.memoryUsage();

    if (this.snapshots.length >= this.maxSnapshots) {
      this.snapshots.shift();
    }
    this.snapshots.push({
      timestamp: Date.now(),
      memory,
    });

    if (label) {
      logger.debug(`Memory snapshot [${label}]: ${this.formatMemory(memory)}`);
    }

    return memory;
  }

  /**
   * Get current memory usage
   */
  getCurrentMemory(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }

  /**
   * Get memory delta since start
   */
  getMemoryDelta(): {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  } {
    const current = process.memoryUsage();

    return {
      rss: current.rss - this.startMemory.rss,
      heapTotal: current.heapTotal - this.startMemory.heapTotal,
      heapUsed: current.heapUsed - this.startMemory.heapUsed,
      external: current.external - this.startMemory.external,
    };
  }

  /**
   * Check if memory usage is concerning
   */
  isMemoryHighUsage(): boolean {
    const current = this.getCurrentMemory();
    const heapUsedMB = current.heapUsed / 1024 / 1024;
    return heapUsedMB > MemoryMonitor.HIGH_MEMORY_THRESHOLD_MB;
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): {
    current: NodeJS.MemoryUsage;
    delta: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
    formatted: {
      current: string;
      delta: string;
    };
    isHighUsage: boolean;
  } {
    const current = this.getCurrentMemory();
    const delta = this.getMemoryDelta();

    return {
      current,
      delta,
      formatted: {
        current: this.formatMemory(current),
        delta: this.formatMemoryDelta(delta),
      },
      isHighUsage: this.isMemoryHighUsage(),
    };
  }

  /**
   * Format memory usage for display
   */
  formatMemory(memory: NodeJS.MemoryUsage): string {
    const rssMB = (memory.rss / 1024 / 1024).toFixed(2);
    const heapUsedMB = (memory.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (memory.heapTotal / 1024 / 1024).toFixed(2);

    return `RSS: ${rssMB}MB, Heap: ${heapUsedMB}/${heapTotalMB}MB`;
  }

  /**
   * Format memory delta for display
   */
  formatMemoryDelta(delta: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  }): string {
    const rssMB = (delta.rss / 1024 / 1024).toFixed(2);
    const heapUsedMB = (delta.heapUsed / 1024 / 1024).toFixed(2);

    const rssSign = delta.rss >= 0 ? '+' : '';
    const heapSign = delta.heapUsed >= 0 ? '+' : '';

    return `RSS: ${rssSign}${rssMB}MB, Heap: ${heapSign}${heapUsedMB}MB`;
  }

  /**
   * Log memory statistics
   */
  logMemoryStats(label?: string): void {
    const stats = this.getMemoryStats();
    const prefix = label ? `[${label}] ` : '';

    logger.info(`${prefix}Memory: ${stats.formatted.current}`);
    logger.info(`${prefix}Delta: ${stats.formatted.delta}`);

    if (stats.isHighUsage) {
      logger.warn(`${prefix}High memory usage detected!`);
    }
  }

  /**
   * Get memory trend (increasing/decreasing/stable)
   */
  getMemoryTrend(): 'increasing' | 'decreasing' | 'stable' | 'insufficient-data' {
    if (this.snapshots.length < 5) {
      return 'insufficient-data';
    }

    const recent = this.snapshots.slice(-5);
    const heapDeltas = [];

    for (let i = 1; i < recent.length; i++) {
      heapDeltas.push(recent[i].memory.heapUsed - recent[i - 1].memory.heapUsed);
    }

    const avgDelta = heapDeltas.reduce((a, b) => a + b, 0) / heapDeltas.length;

    // If average delta is more than 1MB, it's increasing
    if (avgDelta > 1024 * 1024) {
      return 'increasing';
    } else if (avgDelta < -1024 * 1024) {
      return 'decreasing';
    } else {
      return 'stable';
    }
  }

  /**
   * Force garbage collection if available
   */
  forceGC(): boolean {
    if (global.gc) {
      global.gc();
      logger.debug('Garbage collection forced');
      return true;
    } else {
      logger.debug('Garbage collection not available (run node with --expose-gc)');
      return false;
    }
  }

  /**
   * Start periodic memory monitoring
   */
  startPeriodicMonitoring(intervalMs: number = 60000): NodeJS.Timeout {
    return setInterval(() => {
      this.snapshot('periodic');

      const stats = this.getMemoryStats();
      if (stats.isHighUsage) {
        logger.warn('High memory usage detected during periodic monitoring');
        this.logMemoryStats('periodic');
      }

      const trend = this.getMemoryTrend();
      if (trend === 'increasing') {
        logger.warn('Memory usage is trending upward');
      }
    }, intervalMs);
  }

  /**
   * Clear all snapshots
   */
  clearSnapshots(): void {
    this.snapshots = [];
  }

  /**
   * Reset the start memory baseline
   */
  resetBaseline(): void {
    this.startMemory = process.memoryUsage();
    this.clearSnapshots();
  }
}

// Singleton instance
export const memoryMonitor = new MemoryMonitor();
