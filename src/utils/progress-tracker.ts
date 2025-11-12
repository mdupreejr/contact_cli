import { EventEmitter } from 'events';

export interface ProgressUpdate {
  current: number;
  total: number;
  percentage: number;
  eta: number | null; // Estimated time remaining in milliseconds
  rate: number; // Items per second
  message?: string;
}

export class ProgressTracker extends EventEmitter {
  private current: number = 0;
  private total: number;
  private startTime: number;
  private lastUpdateTime: number;
  private lastUpdateCurrent: number = 0;
  private rates: number[] = []; // Rolling window for rate calculation
  private readonly maxRatesSamples = 10;
  private message?: string;

  constructor(total: number, message?: string) {
    super();
    this.total = total;
    this.message = message;
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
  }

  /**
   * Update progress by incrementing current count
   */
  increment(count: number = 1, message?: string): void {
    this.current += count;
    if (message) {
      this.message = message;
    }
    this.emitProgress();
  }

  /**
   * Set progress to a specific value
   */
  setCurrent(current: number, message?: string): void {
    this.current = current;
    if (message) {
      this.message = message;
    }
    this.emitProgress();
  }

  /**
   * Update the total count (useful for dynamic totals)
   */
  setTotal(total: number): void {
    this.total = total;
    this.emitProgress();
  }

  /**
   * Get current progress state
   */
  getProgress(): ProgressUpdate {
    const now = Date.now();
    const elapsed = now - this.startTime;
    const percentage = this.total > 0 ? (this.current / this.total) * 100 : 0;

    // Calculate rate (items per second)
    let rate = 0;
    if (elapsed > 0) {
      rate = (this.current / elapsed) * 1000; // Convert to items per second
    }

    // Calculate ETA
    let eta: number | null = null;
    if (rate > 0 && this.current < this.total) {
      const remaining = this.total - this.current;
      eta = (remaining / rate) * 1000; // Convert to milliseconds
    }

    return {
      current: this.current,
      total: this.total,
      percentage: Math.min(100, Math.max(0, percentage)),
      eta,
      rate,
      message: this.message,
    };
  }

  /**
   * Calculate moving average rate for better ETA estimation
   */
  private calculateMovingAverageRate(): number {
    const now = Date.now();
    const timeDelta = now - this.lastUpdateTime;

    if (timeDelta > 0) {
      const itemsDelta = this.current - this.lastUpdateCurrent;
      const instantRate = (itemsDelta / timeDelta) * 1000; // Items per second

      this.rates.push(instantRate);
      if (this.rates.length > this.maxRatesSamples) {
        this.rates.shift(); // Remove oldest rate
      }

      this.lastUpdateTime = now;
      this.lastUpdateCurrent = this.current;
    }

    // Calculate average rate
    if (this.rates.length === 0) {
      return 0;
    }

    const sum = this.rates.reduce((a, b) => a + b, 0);
    return sum / this.rates.length;
  }

  /**
   * Emit progress update event
   */
  private emitProgress(): void {
    const progress = this.getProgress();
    this.emit('progress', progress);
  }

  /**
   * Mark progress as complete
   */
  complete(message?: string): void {
    this.current = this.total;
    if (message) {
      this.message = message;
    }
    this.emitProgress();
    this.emit('complete', this.getProgress());
  }

  /**
   * Reset progress tracker
   */
  reset(total?: number, message?: string): void {
    this.current = 0;
    if (total !== undefined) {
      this.total = total;
    }
    if (message !== undefined) {
      this.message = message;
    }
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    this.lastUpdateCurrent = 0;
    this.rates = [];
    this.emitProgress();
  }

  /**
   * Check if progress is complete
   */
  isComplete(): boolean {
    return this.current >= this.total;
  }

  /**
   * Format time duration for display
   */
  static formatDuration(milliseconds: number): string {
    if (milliseconds < 0) {
      return 'calculating...';
    }

    const seconds = Math.floor(milliseconds / 1000);

    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
      return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  /**
   * Format progress for display
   */
  static formatProgress(progress: ProgressUpdate): string {
    const percentStr = progress.percentage.toFixed(1);
    const etaStr = progress.eta !== null ? ` (ETA: ${ProgressTracker.formatDuration(progress.eta)})` : '';
    const messageStr = progress.message ? ` - ${progress.message}` : '';

    return `${progress.current}/${progress.total} (${percentStr}%)${etaStr}${messageStr}`;
  }
}
