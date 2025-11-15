export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private uiMode = false;
  private logBuffer: string[] = [];

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setUIMode(enabled: boolean): void {
    this.uiMode = enabled;
    if (!enabled && this.logBuffer.length > 0) {
      // Flush buffered logs when UI mode is disabled
      this.logBuffer.forEach(log => console.log(log));
      this.logBuffer = [];
    }
  }

  private log(level: string, message: string, ...args: unknown[]): void {
    const logMessage = `[${level}] ${message}${args.length ? ' ' + args.join(' ') : ''}`;

    if (this.uiMode) {
      // Buffer logs when UI is active to prevent interference
      this.logBuffer.push(logMessage);
      // Keep buffer size reasonable
      if (this.logBuffer.length > 100) {
        this.logBuffer.shift();
      }
    } else {
      console.log(logMessage);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.ERROR) {
      this.log('ERROR', message, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.WARN) {
      this.log('WARN', message, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.INFO) {
      this.log('INFO', message, ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      this.log('DEBUG', message, ...args);
    }
  }

  getBufferedLogs(): string[] {
    return [...this.logBuffer];
  }

  clearBuffer(): void {
    this.logBuffer = [];
  }
}

export const logger = new Logger();