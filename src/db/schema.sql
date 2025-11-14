-- ContactsPlus Local Database Schema
-- This database stores contacts locally and manages sync queue with API

-- Main contacts table (local cache + imports)
CREATE TABLE IF NOT EXISTS contacts (
  contact_id TEXT PRIMARY KEY,
  contact_data JSON NOT NULL,
  data_hash TEXT NOT NULL,
  synced_to_api BOOLEAN DEFAULT FALSE,
  last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL, -- 'api', 'csv_import', 'manual'
  import_session_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for hash-based duplicate detection
CREATE INDEX IF NOT EXISTS idx_contacts_hash ON contacts(data_hash);

-- Index for finding unsynced contacts
CREATE INDEX IF NOT EXISTS idx_contacts_unsynced ON contacts(synced_to_api) WHERE synced_to_api = 0;

-- Index for import session tracking
CREATE INDEX IF NOT EXISTS idx_contacts_import_session ON contacts(import_session_id);

-- Sync queue table (manual approval workflow)
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL,
  operation TEXT NOT NULL, -- 'create', 'update', 'delete'
  data_before JSON, -- NULL for create operations
  data_after JSON, -- NULL for delete operations
  data_hash_after TEXT,
  reviewed BOOLEAN DEFAULT FALSE,
  approved BOOLEAN,
  sync_status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'syncing', 'synced', 'failed'
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  synced_at TIMESTAMP,
  retry_count INTEGER DEFAULT 0,
  import_session_id TEXT
);

-- Index for finding pending items
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(sync_status);

-- Index for finding items needing review
CREATE INDEX IF NOT EXISTS idx_sync_queue_reviewed ON sync_queue(reviewed);

-- Import history table (audit trail)
CREATE TABLE IF NOT EXISTS import_history (
  session_id TEXT PRIMARY KEY,
  csv_filename TEXT NOT NULL,
  csv_hash TEXT NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  total_rows INTEGER NOT NULL,
  parsed_contacts INTEGER DEFAULT 0,
  matched_contacts INTEGER DEFAULT 0,
  new_contacts INTEGER DEFAULT 0,
  queued_operations INTEGER DEFAULT 0,
  synced_operations INTEGER DEFAULT 0,
  failed_operations INTEGER DEFAULT 0,
  status TEXT DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed', 'cancelled'
  error_message TEXT
);

-- CSV row hashes table (prevent re-analyzing duplicates)
CREATE TABLE IF NOT EXISTS csv_row_hashes (
  row_hash TEXT PRIMARY KEY,
  import_session_id TEXT NOT NULL,
  contact_id TEXT,
  decision TEXT, -- 'merge', 'skip', 'new'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (import_session_id) REFERENCES import_history(session_id)
);

-- Index for finding rows from specific import
CREATE INDEX IF NOT EXISTS idx_csv_row_hashes_session ON csv_row_hashes(import_session_id);

-- Metadata table (database version and settings)
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert initial schema version
INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', '1');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('created_at', datetime('now'));
