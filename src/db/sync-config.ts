import { ContactDatabase, getDatabase } from './database';
import { logger } from '../utils/logger';

/**
 * Sync configuration settings
 */
export interface SyncConfig {
  autoSync: boolean;
  autoSyncInterval: number; // minutes
  maxRetries: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  conflictResolution: 'manual' | 'local' | 'remote';
  syncOnStartup: boolean;
  syncOnImport: boolean;
}

/**
 * Default sync configuration
 */
const DEFAULT_CONFIG: SyncConfig = {
  autoSync: false,
  autoSyncInterval: 30,
  maxRetries: 3,
  retryDelayMs: 1000,
  maxRetryDelayMs: 30000,
  conflictResolution: 'manual',
  syncOnStartup: false,
  syncOnImport: false,
};

/**
 * Sync Configuration Manager
 * Manages sync settings and auto-sync scheduling
 */
export class SyncConfigManager {
  private db: ContactDatabase;
  private config: SyncConfig;
  private autoSyncTimer: NodeJS.Timeout | null = null;
  private onAutoSyncCallback: (() => Promise<void>) | null = null;

  constructor(db?: ContactDatabase) {
    this.db = db || getDatabase();
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from database
   */
  private loadConfig(): SyncConfig {
    try {
      const configJson = this.db.queryOne<{ value: string }>(
        'SELECT value FROM metadata WHERE key = ?',
        ['sync_config']
      );

      if (configJson) {
        const loaded = JSON.parse(configJson.value);
        logger.debug('Loaded sync config from database');
        return { ...DEFAULT_CONFIG, ...loaded };
      }
    } catch (error) {
      logger.warn('Failed to load sync config, using defaults:', error);
    }

    return { ...DEFAULT_CONFIG };
  }

  /**
   * Save configuration to database
   */
  private saveConfig(): void {
    try {
      this.db.execute(
        `INSERT OR REPLACE INTO metadata (key, value, updated_at)
         VALUES (?, ?, datetime('now'))`,
        ['sync_config', JSON.stringify(this.config)]
      );
      logger.debug('Saved sync config to database');
    } catch (error) {
      logger.error('Failed to save sync config:', error);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SyncConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();

    // Restart auto-sync if setting changed
    if ('autoSync' in updates || 'autoSyncInterval' in updates) {
      this.stopAutoSync();
      if (this.config.autoSync && this.onAutoSyncCallback) {
        this.startAutoSync(this.onAutoSyncCallback);
      }
    }

    logger.info('Sync config updated:', updates);
  }

  /**
   * Set auto-sync callback and start if enabled
   */
  setAutoSyncCallback(callback: () => Promise<void>): void {
    this.onAutoSyncCallback = callback;

    if (this.config.autoSync) {
      this.startAutoSync(callback);
    }
  }

  /**
   * Start auto-sync timer
   */
  private startAutoSync(callback: () => Promise<void>): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
    }

    const intervalMs = this.config.autoSyncInterval * 60 * 1000;

    this.autoSyncTimer = setInterval(async () => {
      logger.info('Auto-sync triggered');
      try {
        await callback();
      } catch (error) {
        logger.error('Auto-sync failed:', error);
      }
    }, intervalMs);

    logger.info(`Auto-sync enabled: every ${this.config.autoSyncInterval} minutes`);
  }

  /**
   * Stop auto-sync timer
   */
  private stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
      logger.info('Auto-sync disabled');
    }
  }

  /**
   * Enable auto-sync
   */
  enableAutoSync(intervalMinutes?: number): void {
    const updates: Partial<SyncConfig> = { autoSync: true };
    if (intervalMinutes !== undefined) {
      updates.autoSyncInterval = intervalMinutes;
    }
    this.updateConfig(updates);
  }

  /**
   * Disable auto-sync
   */
  disableAutoSync(): void {
    this.updateConfig({ autoSync: false });
  }

  /**
   * Set retry configuration
   */
  setRetryConfig(maxRetries: number, retryDelayMs: number, maxRetryDelayMs: number): void {
    this.updateConfig({
      maxRetries,
      retryDelayMs,
      maxRetryDelayMs,
    });
  }

  /**
   * Set conflict resolution strategy
   */
  setConflictResolution(strategy: 'manual' | 'local' | 'remote'): void {
    this.updateConfig({ conflictResolution: strategy });
  }

  /**
   * Enable/disable sync on startup
   */
  setSyncOnStartup(enabled: boolean): void {
    this.updateConfig({ syncOnStartup: enabled });
  }

  /**
   * Enable/disable sync after import
   */
  setSyncOnImport(enabled: boolean): void {
    this.updateConfig({ syncOnImport: enabled });
  }

  /**
   * Reset to defaults
   */
  resetToDefaults(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.saveConfig();
    this.stopAutoSync();
    logger.info('Sync config reset to defaults');
  }

  /**
   * Cleanup (stop auto-sync)
   */
  cleanup(): void {
    this.stopAutoSync();
  }
}

/**
 * Get sync config manager instance
 */
export function getSyncConfigManager(db?: ContactDatabase): SyncConfigManager {
  return new SyncConfigManager(db);
}
