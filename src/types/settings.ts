/**
 * Application settings type definitions
 */

export interface AppSettings {
  // Data Source Settings
  dataSource: DataSourceSettings;

  // API Settings
  api: ApiSettings;

  // UI Settings
  ui: UiSettings;

  // Cache Settings (for future use)
  cache: CacheSettings;

  // Debug Settings
  debug: DebugSettings;
}

export interface DataSourceSettings {
  // Read-only mode - prevents API writes
  readOnlyMode: boolean;

  // Load contacts from JSON file instead of API
  jsonFilePath?: string;

  // Load contacts from CSV file instead of API
  csvFilePath?: string;

  // Preferred data source order: 'csv' | 'json' | 'api'
  preferredSource: 'csv' | 'json' | 'api';
}

export interface ApiSettings {
  // API base URL
  apiBase: string;

  // Auth base URL
  authBase: string;

  // Request timeout in milliseconds
  timeout: number;

  // Retry failed requests
  retryOnFailure: boolean;

  // Max retries
  maxRetries: number;
}

export interface UiSettings {
  // Log level: 'debug' | 'info' | 'warn' | 'error'
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // Auto-refresh interval in minutes (0 = disabled)
  autoRefreshMinutes: number;

  // Show welcome message on startup
  showWelcome: boolean;

  // Default page size for lists
  pageSize: number;
}

export interface CacheSettings {
  // Enable caching
  enabled: boolean;

  // Cache TTL in minutes
  ttlMinutes: number;

  // Cache directory
  cacheDir: string;

  // Max cache size in MB
  maxSizeMB: number;
}

export interface DebugSettings {
  // Enable debug mode
  enabled: boolean;

  // Log API requests
  logApiRequests: boolean;

  // Log API responses
  logApiResponses: boolean;

  // Enable performance profiling
  profiling: boolean;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: AppSettings = {
  dataSource: {
    readOnlyMode: false,
    preferredSource: 'api',
  },
  api: {
    apiBase: 'https://api.contactsplus.com',
    authBase: 'https://app.contactsplus.com',
    timeout: 30000,
    retryOnFailure: true,
    maxRetries: 3,
  },
  ui: {
    logLevel: 'info',
    autoRefreshMinutes: 0,
    showWelcome: true,
    pageSize: 50,
  },
  cache: {
    enabled: false,
    ttlMinutes: 60,
    cacheDir: '~/.contactsplus/cache',
    maxSizeMB: 100,
  },
  debug: {
    enabled: false,
    logApiRequests: false,
    logApiResponses: false,
    profiling: false,
  },
};

/**
 * Settings validation errors
 */
export interface SettingsValidationError {
  field: string;
  message: string;
}

/**
 * Settings validation result
 */
export interface SettingsValidationResult {
  valid: boolean;
  errors: SettingsValidationError[];
}
