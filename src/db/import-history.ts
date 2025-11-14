import { ContactDatabase, getDatabase } from './database';
import { generateCsvRowHash, generateFileHashFromPath } from './contact-hash';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Import status types
 */
export type ImportStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Import session information
 */
export interface ImportSession {
  sessionId: string;
  csvFilename: string;
  csvHash: string;
  startedAt: string;
  completedAt?: string;
  totalRows: number;
  parsedContacts: number;
  matchedContacts: number;
  newContacts: number;
  queuedOperations: number;
  syncedOperations: number;
  failedOperations: number;
  status: ImportStatus;
  errorMessage?: string;
}

/**
 * CSV row hash entry
 */
export interface CsvRowHashEntry {
  rowHash: string;
  importSessionId: string;
  contactId?: string;
  decision?: 'merge' | 'skip' | 'new';
  createdAt: string;
}

/**
 * Import decision (for CSV row hash tracking)
 */
export type ImportDecision = 'merge' | 'skip' | 'new';

/**
 * Import History Store
 * Manages import session tracking and CSV row hash deduplication
 */
export class ImportHistory {
  private db: ContactDatabase;

  constructor(db?: ContactDatabase) {
    this.db = db || getDatabase();
  }

  /**
   * Create new import session
   */
  async createImportSession(
    csvFilename: string,
    csvFilePath: string,
    totalRows: number
  ): Promise<string> {
    try {
      const sessionId = uuidv4();
      const csvHash = await generateFileHashFromPath(csvFilePath);

      this.db.execute(
        `INSERT INTO import_history (
          session_id, csv_filename, csv_hash, total_rows, status
        ) VALUES (?, ?, ?, ?, 'in_progress')`,
        [sessionId, csvFilename, csvHash, totalRows]
      );

      logger.info(`Import session created: ${sessionId} (${csvFilename}, ${totalRows} rows)`);
      return sessionId;
    } catch (error) {
      logger.error('Failed to create import session:', { csvFilename, error });
      throw new Error(`Failed to create import session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update import session statistics
   */
  updateImportSession(
    sessionId: string,
    stats: {
      parsedContacts?: number;
      matchedContacts?: number;
      newContacts?: number;
      queuedOperations?: number;
      syncedOperations?: number;
      failedOperations?: number;
    }
  ): void {
    try {
      const updates: string[] = [];
      const params: any[] = [];

      if (stats.parsedContacts !== undefined) {
        updates.push('parsed_contacts = ?');
        params.push(stats.parsedContacts);
      }

      if (stats.matchedContacts !== undefined) {
        updates.push('matched_contacts = ?');
        params.push(stats.matchedContacts);
      }

      if (stats.newContacts !== undefined) {
        updates.push('new_contacts = ?');
        params.push(stats.newContacts);
      }

      if (stats.queuedOperations !== undefined) {
        updates.push('queued_operations = ?');
        params.push(stats.queuedOperations);
      }

      if (stats.syncedOperations !== undefined) {
        updates.push('synced_operations = ?');
        params.push(stats.syncedOperations);
      }

      if (stats.failedOperations !== undefined) {
        updates.push('failed_operations = ?');
        params.push(stats.failedOperations);
      }

      if (updates.length === 0) {
        return;
      }

      params.push(sessionId);

      this.db.execute(
        `UPDATE import_history SET ${updates.join(', ')} WHERE session_id = ?`,
        params
      );

      logger.debug(`Import session updated: ${sessionId}`);
    } catch (error) {
      logger.error('Failed to update import session:', { sessionId, error });
      throw error;
    }
  }

  /**
   * Complete import session
   */
  completeImportSession(sessionId: string, status: ImportStatus = 'completed', errorMessage?: string): void {
    try {
      this.db.execute(
        `UPDATE import_history SET
          status = ?,
          completed_at = CURRENT_TIMESTAMP,
          error_message = ?
        WHERE session_id = ?`,
        [status, errorMessage || null, sessionId]
      );

      logger.info(`Import session ${status}: ${sessionId}`);
    } catch (error) {
      logger.error('Failed to complete import session:', { sessionId, error });
      throw error;
    }
  }

  /**
   * Get import session by ID
   */
  getImportSession(sessionId: string): ImportSession | null {
    try {
      const row = this.db.queryOne<any>(
        'SELECT * FROM import_history WHERE session_id = ?',
        [sessionId]
      );

      if (!row) {
        return null;
      }

      return this.mapRowToImportSession(row);
    } catch (error) {
      logger.error('Failed to get import session:', { sessionId, error });
      throw error;
    }
  }

  /**
   * Get all import sessions
   */
  getAllImportSessions(limit?: number, offset?: number): ImportSession[] {
    try {
      let sql = 'SELECT * FROM import_history ORDER BY started_at DESC';
      const params: any[] = [];

      if (limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(limit);

        if (offset !== undefined) {
          sql += ' OFFSET ?';
          params.push(offset);
        }
      }

      const rows = this.db.query<any>(sql, params);
      return rows.map(row => this.mapRowToImportSession(row));
    } catch (error) {
      logger.error('Failed to get import sessions:', error);
      throw error;
    }
  }

  /**
   * Check if CSV file has been imported before
   */
  async hasBeenImported(csvFilePath: string): Promise<boolean> {
    try {
      const csvHash = await generateFileHashFromPath(csvFilePath);
      const result = this.db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM import_history WHERE csv_hash = ?',
        [csvHash]
      );
      return (result?.count || 0) > 0;
    } catch (error) {
      logger.error('Failed to check if CSV has been imported:', { csvFilePath, error });
      throw error;
    }
  }

  /**
   * Add CSV row hash (for duplicate detection)
   */
  addCsvRowHash(
    rowHash: string,
    importSessionId: string,
    contactId?: string,
    decision?: ImportDecision
  ): void {
    try {
      this.db.execute(
        `INSERT OR IGNORE INTO csv_row_hashes (
          row_hash, import_session_id, contact_id, decision
        ) VALUES (?, ?, ?, ?)`,
        [rowHash, importSessionId, contactId || null, decision || null]
      );

      logger.debug(`CSV row hash added: ${rowHash.substring(0, 8)}...`);
    } catch (error) {
      logger.error('Failed to add CSV row hash:', { rowHash, error });
      throw error;
    }
  }

  /**
   * Add multiple CSV row hashes in a transaction
   */
  addMultipleCsvRowHashes(
    hashes: Array<{
      rowHash: string;
      importSessionId: string;
      contactId?: string;
      decision?: ImportDecision;
    }>
  ): void {
    this.db.transaction(() => {
      for (const hash of hashes) {
        this.addCsvRowHash(hash.rowHash, hash.importSessionId, hash.contactId, hash.decision);
      }
    });
  }

  /**
   * Check if CSV row hash exists (already imported)
   */
  csvRowHashExists(rowHash: string): boolean {
    try {
      const result = this.db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM csv_row_hashes WHERE row_hash = ?',
        [rowHash]
      );
      return (result?.count || 0) > 0;
    } catch (error) {
      logger.error('Failed to check CSV row hash:', { rowHash, error });
      throw error;
    }
  }

  /**
   * Get CSV row hash entry
   */
  getCsvRowHash(rowHash: string): CsvRowHashEntry | null {
    try {
      const row = this.db.queryOne<any>(
        'SELECT * FROM csv_row_hashes WHERE row_hash = ?',
        [rowHash]
      );

      if (!row) {
        return null;
      }

      return {
        rowHash: row.row_hash,
        importSessionId: row.import_session_id,
        contactId: row.contact_id || undefined,
        decision: row.decision || undefined,
        createdAt: row.created_at,
      };
    } catch (error) {
      logger.error('Failed to get CSV row hash:', { rowHash, error });
      throw error;
    }
  }

  /**
   * Get all CSV row hashes for import session
   */
  getCsvRowHashesForSession(importSessionId: string): CsvRowHashEntry[] {
    try {
      const rows = this.db.query<any>(
        'SELECT * FROM csv_row_hashes WHERE import_session_id = ?',
        [importSessionId]
      );

      return rows.map(row => ({
        rowHash: row.row_hash,
        importSessionId: row.import_session_id,
        contactId: row.contact_id || undefined,
        decision: row.decision || undefined,
        createdAt: row.created_at,
      }));
    } catch (error) {
      logger.error('Failed to get CSV row hashes for session:', { importSessionId, error });
      throw error;
    }
  }

  /**
   * Generate hash for CSV row
   */
  generateRowHash(row: Record<string, string>): string {
    return generateCsvRowHash(row);
  }

  /**
   * Count import sessions
   */
  countImportSessions(): number {
    try {
      const result = this.db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM import_history'
      );
      return result?.count || 0;
    } catch (error) {
      logger.error('Failed to count import sessions:', error);
      throw error;
    }
  }

  /**
   * Get import statistics
   */
  getImportStats(): {
    totalImports: number;
    completedImports: number;
    failedImports: number;
    totalRowsImported: number;
    totalContactsCreated: number;
  } {
    try {
      const totalImports = this.countImportSessions();
      const completedImports = this.db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM import_history WHERE status = ?',
        ['completed']
      )?.count || 0;
      const failedImports = this.db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM import_history WHERE status = ?',
        ['failed']
      )?.count || 0;
      const totalRowsImported = this.db.queryOne<{ total: number }>(
        'SELECT SUM(total_rows) as total FROM import_history WHERE status = ?',
        ['completed']
      )?.total || 0;
      const totalContactsCreated = this.db.queryOne<{ total: number }>(
        'SELECT SUM(new_contacts) as total FROM import_history WHERE status = ?',
        ['completed']
      )?.total || 0;

      return {
        totalImports,
        completedImports,
        failedImports,
        totalRowsImported,
        totalContactsCreated,
      };
    } catch (error) {
      logger.error('Failed to get import stats:', error);
      throw error;
    }
  }

  /**
   * Delete import session and associated data
   */
  deleteImportSession(sessionId: string): void {
    try {
      this.db.transaction(() => {
        // Delete CSV row hashes
        this.db.execute('DELETE FROM csv_row_hashes WHERE import_session_id = ?', [sessionId]);

        // Delete import session
        this.db.execute('DELETE FROM import_history WHERE session_id = ?', [sessionId]);
      });

      logger.info(`Import session deleted: ${sessionId}`);
    } catch (error) {
      logger.error('Failed to delete import session:', { sessionId, error });
      throw error;
    }
  }

  /**
   * Map database row to import session
   */
  private mapRowToImportSession(row: any): ImportSession {
    return {
      sessionId: row.session_id,
      csvFilename: row.csv_filename,
      csvHash: row.csv_hash,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      totalRows: row.total_rows,
      parsedContacts: row.parsed_contacts,
      matchedContacts: row.matched_contacts,
      newContacts: row.new_contacts,
      queuedOperations: row.queued_operations,
      syncedOperations: row.synced_operations,
      failedOperations: row.failed_operations,
      status: row.status,
      errorMessage: row.error_message || undefined,
    };
  }
}

/**
 * Get import history instance
 */
export function getImportHistory(db?: ContactDatabase): ImportHistory {
  return new ImportHistory(db);
}
