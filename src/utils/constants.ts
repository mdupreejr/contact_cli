/**
 * Application-wide constants
 *
 * This file contains all magic numbers extracted from the codebase
 * for better maintainability and clarity.
 */

// =============================================================================
// API Configuration
// =============================================================================

export const DEFAULT_API_TIMEOUT = 30000; // 30 seconds
export const DEFAULT_OAUTH_TIMEOUT = 300000; // 5 minutes (300000ms)
export const OAUTH_CLEANUP_DELAY = 500; // milliseconds

// =============================================================================
// CSV Limits
// =============================================================================

export const MAX_CSV_ROWS = 100000; // Maximum 100,000 rows
export const MAX_CSV_COLUMNS = 100; // Maximum 100 columns
export const MAX_CSV_CELL_LENGTH = 10000; // Maximum 10,000 characters per cell
export const MAX_CSV_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_CSV_CONTENT_LENGTH = 100 * 1024 * 1024; // 100MB
export const CSV_PREVIEW_LENGTH = 50; // Characters to show in preview

// =============================================================================
// Field Validation Limits
// =============================================================================

export const MAX_PHONE_LENGTH = 50;
export const MAX_NAME_LENGTH = 500;

// =============================================================================
// UI Constants
// =============================================================================

export const MESSAGE_DISPLAY_DURATION = 2000; // 2 seconds
export const PROGRESS_HIDE_DELAY = 500; // milliseconds
export const PROGRESS_INDICATOR_WIDTH = 60; // characters
export const PROGRESS_INDICATOR_HEIGHT = 11; // lines

// =============================================================================
// Retry Configuration
// =============================================================================

export const DEFAULT_RETRY_DELAY = 1000; // 1 second
export const MAX_RETRY_DELAY = 30000; // 30 seconds
export const SYNC_TIMEOUT = 30000; // 30 seconds

// =============================================================================
// Background Analysis
// =============================================================================

export const BACKGROUND_ANALYSIS_INTERVAL = 30; // minutes
export const BACKGROUND_ANALYSIS_MAX_SUGGESTIONS = 50;
export const BACKGROUND_ANALYSIS_IDLE_THRESHOLD = 60000; // 1 minute (60000ms)

// =============================================================================
// Token Management
// =============================================================================

export const TOKEN_SAFETY_BUFFER = 60 * 1000; // 60 seconds
export const TOKEN_REFRESH_WINDOW = 10 * 60 * 1000; // 10 minutes

// =============================================================================
// Memory and Performance
// =============================================================================

export const HIGH_MEMORY_THRESHOLD_MB = 500;
export const MAX_MEMORY_SNAPSHOTS = 100;
export const MEMORY_MONITOR_INTERVAL = 60000; // 60 seconds
export const MEMORY_LEAK_THRESHOLD = 1024 * 1024; // 1MB
export const BYTES_PER_KB = 1024;
export const BYTES_PER_MB = 1024 * 1024;

// =============================================================================
// Logging and History
// =============================================================================

export const MAX_LOG_BUFFER_SIZE = 1000;
export const MAX_LOG_ENTRIES = 100; // For in-memory log buffer
export const LOG_RETENTION_DAYS = 90;
export const LOG_FILE_MAX_SIZE_MB = 10;
export const LOG_MAX_ROTATED_FILES = 5;

// =============================================================================
// Pagination and Limits
// =============================================================================

export const DEFAULT_PAGE_SIZE = 50;
export const API_BATCH_SIZE = 100;
export const MAX_PAGE_SIZE = 1000;
export const MIN_PAGE_SIZE = 10;
export const SEMANTIC_SEARCH_RESULTS = 20;

// =============================================================================
// Time Conversions
// =============================================================================

export const MILLISECONDS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const DAYS_PER_YEAR = 365;

// =============================================================================
// Validation and Scoring
// =============================================================================

// CSV Import similarity thresholds
export const SIMILARITY_HIGH_THRESHOLD = 0.85; // High confidence merge
export const SIMILARITY_MEDIUM_THRESHOLD = 0.7; // User should review
export const SIMILARITY_NAME_THRESHOLD = 0.85; // Name matching

// Similarity scoring weights
export const WEIGHT_NAME_SIMILARITY = 0.35;
export const WEIGHT_EMAIL_MATCH = 0.30;
export const WEIGHT_PHONE_MATCH = 0.20;
export const WEIGHT_COMPANY_SIMILARITY = 0.15;
export const COMPANY_SIMILARITY_THRESHOLD = 0.8;

// Completeness scoring (out of 100)
export const SCORE_NAME_FIELD = 25;
export const SCORE_EMAIL_FIELD = 25;
export const SCORE_PHONE_FIELD = 20;
export const SCORE_ORGANIZATION_FIELD = 15;
export const SCORE_ADDRESS_FIELD = 10;

// Phone normalization
export const PHONE_CONFIDENCE_US_10_DIGIT = 0.9;
export const PHONE_CONFIDENCE_DETECTED = 0.9;
export const PHONE_CONFIDENCE_REDUCTION = 0.85;
export const PHONE_CONFIDENCE_BOOST = 0.05;

// =============================================================================
// Settings Validation Ranges
// =============================================================================

export const API_TIMEOUT_MIN = 1000; // 1 second
export const API_TIMEOUT_MAX = 300000; // 5 minutes
export const API_MAX_RETRIES_MIN = 0;
export const API_MAX_RETRIES_MAX = 10;
export const AUTO_REFRESH_MIN = 0;
export const AUTO_REFRESH_MAX = 1440; // 24 hours in minutes
export const CACHE_TTL_MIN = 1; // 1 minute
export const CACHE_TTL_MAX = 10080; // 1 week in minutes
export const CACHE_SIZE_MIN_MB = 10;
export const CACHE_SIZE_MAX_MB = 10000;

// =============================================================================
// OAuth and Security
// =============================================================================

export const OAUTH_STATE_BYTES = 32; // For crypto.randomBytes
export const OAUTH_CODE_VERIFIER_BYTES = 32;
export const DEFAULT_OAUTH_PORT = 3000;
export const HTTP_STATUS_UNAUTHORIZED = 401;
export const HTTP_STATUS_OK = 200;
export const HTTP_STATUS_BAD_REQUEST = 400;
export const HTTP_STATUS_NOT_FOUND = 404;
export const HTTP_STATUS_SERVER_ERROR = 500;

// =============================================================================
// Tool Execution
// =============================================================================

export const MAX_TOOL_DEPTH = 50; // Recursion depth limit

// =============================================================================
// Crypto and Hashing
// =============================================================================

export const HASH_SUBSTRING_LENGTH = 16; // For temp ID generation
export const RANDOM_STRING_LENGTH = 9; // For batch ID generation

// =============================================================================
// Machine Learning
// =============================================================================

export const ML_LEARNING_RATE = 0.01;
export const ML_EPOCHS = 1000;
export const ML_LOG_INTERVAL = 100; // Log every 100 epochs
export const ML_MIN_TRAINING_SAMPLES = 10;
export const ML_EPSILON = 1e-10; // Prevent log(0)

// =============================================================================
// Duplicate Detection
// =============================================================================

export const DEDUPE_DEFAULT_LIMIT = 50;
export const DEDUPE_BATCH_PROGRESS_INTERVAL = 100; // Report progress every 100 contacts

// =============================================================================
// Duration Formatting
// =============================================================================

export const DURATION_MINUTE_THRESHOLD = 60; // seconds
export const DURATION_HOUR_THRESHOLD = 60; // minutes

// =============================================================================
// UTF-16 Encoding
// =============================================================================

export const UTF16_BYTES_PER_CHAR = 2; // JavaScript uses UTF-16

// =============================================================================
// Progress Tracking
// =============================================================================

export const MAX_RATE_SAMPLES = 10;
export const PERCENTAGE_MIN = 0;
export const PERCENTAGE_MAX = 100;

// =============================================================================
// Cache and Cleanup
// =============================================================================

export const DEFAULT_CLEANUP_MINUTES = 60; // Clean up completed batches after 1 hour

// =============================================================================
// Sync Configuration
// =============================================================================

export const DEFAULT_AUTO_SYNC_INTERVAL = 30; // minutes

// =============================================================================
// File Browser UI
// =============================================================================

export const FILE_BROWSER_WIDTH_PERCENT = 80;
export const FILE_BROWSER_HEIGHT_PERCENT = 80;

// =============================================================================
// Screen Layout Percentages
// =============================================================================

export const SCREEN_FULL_WIDTH = 100;
export const SCREEN_LEFT_PANEL_WIDTH = 40;
export const SCREEN_RIGHT_PANEL_WIDTH = 60;
export const SCREEN_PANEL_HEIGHT = 80;
export const SCREEN_FOOTER_WIDTH = 50;
export const SCREEN_FOOTER_HEIGHT = 60;
