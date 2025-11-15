import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';

/**
 * Log rotation utility to prevent log files from growing unbounded
 */
export class LogRotation {
  private readonly maxFileSizeBytes: number;
  private readonly maxRotatedFiles: number;

  /**
   * @param maxFileSizeMB Maximum size of log file before rotation (in MB)
   * @param maxRotatedFiles Maximum number of rotated files to keep
   */
  constructor(maxFileSizeMB: number = 10, maxRotatedFiles: number = 5) {
    this.maxFileSizeBytes = maxFileSizeMB * 1024 * 1024;
    this.maxRotatedFiles = maxRotatedFiles;
  }

  /**
   * Check if a log file needs rotation and rotate if necessary
   * @param logFilePath Path to the log file
   * @returns true if rotation was performed
   */
  async rotateIfNeeded(logFilePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(logFilePath);

      if (stats.size >= this.maxFileSizeBytes) {
        await this.rotate(logFilePath);
        return true;
      }

      return false;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        // File doesn't exist yet, no rotation needed
        return false;
      }
      logger.error('Error checking log file for rotation:', error);
      return false;
    }
  }

  /**
   * Rotate the log file
   */
  private async rotate(logFilePath: string): Promise<void> {
    const dir = path.dirname(logFilePath);
    const basename = path.basename(logFilePath);

    // Prevent path traversal
    if (basename.includes('..') || basename.includes('/') || basename.includes('\\')) {
      throw new Error('Invalid log file basename: contains path traversal characters');
    }

    // Shift existing rotated files
    for (let i = this.maxRotatedFiles - 1; i >= 1; i--) {
      const oldFile = path.join(dir, `${basename}.${i}`);
      const newFile = path.join(dir, `${basename}.${i + 1}`);

      try {
        await fs.access(oldFile);
        if (i === this.maxRotatedFiles - 1) {
          // Delete the oldest file
          await fs.unlink(oldFile);
        } else {
          // Rename to next number
          await fs.rename(oldFile, newFile);
        }
      } catch (error) {
        // File doesn't exist, skip
      }
    }

    // Rotate current log to .1
    const rotatedFile = path.join(dir, `${basename}.1`);
    await fs.rename(logFilePath, rotatedFile);

    logger.info(`Rotated log file: ${logFilePath} -> ${rotatedFile}`);
  }

  /**
   * Clean up old log files beyond the retention limit
   */
  async cleanup(logFilePath: string): Promise<number> {
    const dir = path.dirname(logFilePath);
    const basename = path.basename(logFilePath);
    let cleanedCount = 0;

    for (let i = this.maxRotatedFiles + 1; i <= 100; i++) {
      const oldFile = path.join(dir, `${basename}.${i}`);

      try {
        await fs.unlink(oldFile);
        cleanedCount++;
      } catch (error) {
        // File doesn't exist or can't be deleted, stop searching
        break;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} old rotated log files`);
    }

    return cleanedCount;
  }

  /**
   * Get total size of all log files (current + rotated)
   */
  async getTotalLogSize(logFilePath: string): Promise<number> {
    const dir = path.dirname(logFilePath);
    const basename = path.basename(logFilePath);
    let totalSize = 0;

    // Check main log file
    try {
      const stats = await fs.stat(logFilePath);
      totalSize += stats.size;
    } catch (error) {
      // File doesn't exist
    }

    // Check rotated files
    for (let i = 1; i <= this.maxRotatedFiles; i++) {
      const rotatedFile = path.join(dir, `${basename}.${i}`);

      try {
        const stats = await fs.stat(rotatedFile);
        totalSize += stats.size;
      } catch (error) {
        // File doesn't exist
      }
    }

    return totalSize;
  }
}

// Singleton instance with default settings
export const logRotation = new LogRotation();
