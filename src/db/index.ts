/**
 * Database Module Exports
 * Central export point for all database-related functionality
 */

// Database core
export { ContactDatabase, getDatabase } from './database';

// Contact storage
export {
  ContactStore,
  getContactStore,
  ContactSource,
  StoredContact,
  ContactSearchFilter,
} from './contact-store';

// Sync queue
export {
  SyncQueue,
  getSyncQueue,
  SyncOperation,
  SyncStatus,
  SyncQueueItem,
  SyncQueueFilter,
} from './sync-queue';

// Import history
export {
  ImportHistory,
  getImportHistory,
  ImportStatus,
  ImportSession,
  CsvRowHashEntry,
  ImportDecision,
} from './import-history';

// Sync engine
export {
  SyncEngine,
  getSyncEngine,
  SyncItemResult,
  SyncSessionResult,
  SyncProgressCallback,
  SyncConflict,
} from './sync-engine';

// Hash utilities
export {
  generateContactHash,
  generateCsvRowHash,
  compareContactHashes,
  verifyContactHash,
  generateFileHash,
  generateFileHashFromPath,
} from './contact-hash';
