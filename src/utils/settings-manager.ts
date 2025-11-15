import * as fs from 'fs';
import * as path from 'path';
import { AppSettings, DEFAULT_SETTINGS, SettingsValidationResult, SettingsValidationError } from '../types/settings';
import { logger } from './logger';
import { Validators } from './validators';

const SETTINGS_FILE = path.join(process.cwd(), '.contactsplus.settings.json');

/**
 * SettingsManager handles loading, saving, and validating application settings
 */
export class SettingsManager {
  private settings: AppSettings;
  private settingsPath: string;

  constructor(settingsPath?: string) {
    this.settingsPath = settingsPath || SETTINGS_FILE;
    this.settings = { ...DEFAULT_SETTINGS };
  }

  /**
   * Load settings from file, falling back to defaults and env variables
   */
  async load(): Promise<AppSettings> {
    try {
      // Try to load from settings file
      if (fs.existsSync(this.settingsPath)) {
        const fileContent = fs.readFileSync(this.settingsPath, 'utf-8');
        const fileSettings = JSON.parse(fileContent);

        // Merge with defaults (defaults first, then file settings)
        this.settings = this.mergeSettings(DEFAULT_SETTINGS as unknown as Record<string, unknown>, fileSettings) as unknown as AppSettings;
        logger.info(`Settings loaded from ${this.settingsPath}`);
      } else {
        logger.info('No settings file found, using defaults');
        this.settings = { ...DEFAULT_SETTINGS };
      }

      // Override with environment variables if present
      this.applyEnvironmentOverrides();

      return this.settings;
    } catch (error) {
      logger.error('Failed to load settings:', error);
      logger.warn('Using default settings');
      this.settings = { ...DEFAULT_SETTINGS };
      return this.settings;
    }
  }

  /**
   * Save settings to file
   */
  async save(settings: AppSettings): Promise<void> {
    try {
      // Validate before saving
      const validation = this.validate(settings);
      if (!validation.valid) {
        throw new Error(`Invalid settings: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      // Ensure directory exists
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write atomically by writing to temp file first
      const tempPath = `${this.settingsPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.settingsPath);

      this.settings = settings;
      logger.info(`Settings saved to ${this.settingsPath}`);
    } catch (error) {
      logger.error('Failed to save settings:', error);
      throw error;
    }
  }

  /**
   * Get current settings
   */
  getSettings(): AppSettings {
    return { ...this.settings };
  }

  /**
   * Update specific settings
   */
  async updateSettings(updates: Partial<AppSettings>): Promise<void> {
    const newSettings = this.mergeSettings(this.settings as unknown as Record<string, unknown>, updates as unknown as Record<string, unknown>) as unknown as AppSettings;
    await this.save(newSettings);
  }

  /**
   * Reset to default settings
   */
  async reset(): Promise<void> {
    await this.save({ ...DEFAULT_SETTINGS });
  }

  /**
   * Validate settings
   */
  validate(settings: AppSettings): SettingsValidationResult {
    const errors: SettingsValidationError[] = [];

    // Validate data source settings
    if (settings.dataSource.jsonFilePath) {
      if (!fs.existsSync(settings.dataSource.jsonFilePath)) {
        errors.push({
          field: 'dataSource.jsonFilePath',
          message: `JSON file not found: ${settings.dataSource.jsonFilePath}`,
        });
      } else if (!Validators.hasExtension(settings.dataSource.jsonFilePath, '.json')) {
        errors.push({
          field: 'dataSource.jsonFilePath',
          message: 'JSON file must have .json extension',
        });
      }
    }

    if (settings.dataSource.csvFilePath) {
      if (!fs.existsSync(settings.dataSource.csvFilePath)) {
        errors.push({
          field: 'dataSource.csvFilePath',
          message: `CSV file not found: ${settings.dataSource.csvFilePath}`,
        });
      } else if (!Validators.hasExtension(settings.dataSource.csvFilePath, '.csv')) {
        errors.push({
          field: 'dataSource.csvFilePath',
          message: 'CSV file must have .csv extension',
        });
      }
    }

    // Validate API settings
    if (!Validators.isInRange(settings.api.timeout, 1000, 300000)) {
      errors.push({
        field: 'api.timeout',
        message: 'API timeout must be between 1000 and 300000 milliseconds',
      });
    }

    if (!Validators.isInRange(settings.api.maxRetries, 0, 10)) {
      errors.push({
        field: 'api.maxRetries',
        message: 'Max retries must be between 0 and 10',
      });
    }

    if (!Validators.isUrl(settings.api.apiBase)) {
      errors.push({
        field: 'api.apiBase',
        message: 'API base URL is invalid',
      });
    }

    if (!Validators.isUrl(settings.api.authBase)) {
      errors.push({
        field: 'api.authBase',
        message: 'Auth base URL is invalid',
      });
    }

    // Validate UI settings
    const validLogLevels = ['debug', 'info', 'warn', 'error'];
    if (!Validators.isOneOf(settings.ui.logLevel, validLogLevels)) {
      errors.push({
        field: 'ui.logLevel',
        message: `Log level must be one of: ${validLogLevels.join(', ')}`,
      });
    }

    if (!Validators.isInRange(settings.ui.autoRefreshMinutes, 0, 1440)) {
      errors.push({
        field: 'ui.autoRefreshMinutes',
        message: 'Auto refresh must be between 0 and 1440 minutes (24 hours)',
      });
    }

    if (!Validators.isInRange(settings.ui.pageSize, 10, 1000)) {
      errors.push({
        field: 'ui.pageSize',
        message: 'Page size must be between 10 and 1000',
      });
    }

    // Validate cache settings
    if (!Validators.isInRange(settings.cache.ttlMinutes, 1, 10080)) {
      errors.push({
        field: 'cache.ttlMinutes',
        message: 'Cache TTL must be between 1 and 10080 minutes (1 week)',
      });
    }

    if (!Validators.isInRange(settings.cache.maxSizeMB, 10, 10000)) {
      errors.push({
        field: 'cache.maxSizeMB',
        message: 'Cache max size must be between 10 and 10000 MB',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Deep merge two settings objects
   */
  private mergeSettings(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
    const result = { ...base };

    for (const key in override) {
      if (override.hasOwnProperty(key)) {
        if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
          result[key] = this.mergeSettings(
            (base[key] as Record<string, unknown>) || {},
            override[key] as Record<string, unknown>
          );
        } else {
          result[key] = override[key];
        }
      }
    }

    return result;
  }

  /**
   * Apply environment variable overrides
   */
  private applyEnvironmentOverrides(): void {
    // Data source overrides
    if (process.env.READONLY_MODE !== undefined) {
      this.settings.dataSource.readOnlyMode = process.env.READONLY_MODE === 'true';
    }

    if (process.env.CONTACTS_JSON_FILE) {
      this.settings.dataSource.jsonFilePath = process.env.CONTACTS_JSON_FILE;
      this.settings.dataSource.preferredSource = 'json';
    }

    if (process.env.CONTACTS_CSV_FILE) {
      this.settings.dataSource.csvFilePath = process.env.CONTACTS_CSV_FILE;
      this.settings.dataSource.preferredSource = 'csv';
    }

    // API overrides
    if (process.env.CONTACTSPLUS_API_BASE) {
      this.settings.api.apiBase = process.env.CONTACTSPLUS_API_BASE;
    }

    if (process.env.CONTACTSPLUS_AUTH_BASE) {
      this.settings.api.authBase = process.env.CONTACTSPLUS_AUTH_BASE;
    }

    // Debug overrides
    if (process.env.DEBUG !== undefined) {
      this.settings.debug.enabled = process.env.DEBUG === 'true';
      if (this.settings.debug.enabled) {
        this.settings.ui.logLevel = 'debug';
      }
    }
  }

  /**
   * Export settings to environment variables format
   */
  exportToEnv(settings: AppSettings): string {
    const lines: string[] = [];

    lines.push('# Data Source Settings');
    lines.push(`READONLY_MODE=${settings.dataSource.readOnlyMode}`);
    if (settings.dataSource.jsonFilePath) {
      lines.push(`CONTACTS_JSON_FILE=${settings.dataSource.jsonFilePath}`);
    }
    if (settings.dataSource.csvFilePath) {
      lines.push(`CONTACTS_CSV_FILE=${settings.dataSource.csvFilePath}`);
    }
    lines.push('');

    lines.push('# API Settings');
    lines.push(`CONTACTSPLUS_API_BASE=${settings.api.apiBase}`);
    lines.push(`CONTACTSPLUS_AUTH_BASE=${settings.api.authBase}`);
    lines.push('');

    lines.push('# Debug Settings');
    lines.push(`DEBUG=${settings.debug.enabled}`);
    lines.push('');

    return lines.join('\n');
  }
}

// Singleton instance
let settingsManager: SettingsManager | null = null;

export function getSettingsManager(): SettingsManager {
  if (!settingsManager) {
    settingsManager = new SettingsManager();
  }
  return settingsManager;
}
