import { Contact } from '../types/contactsplus';
import { ContactDatabase, getDatabase } from './database';
import { generateContactHash } from './contact-hash';
import { logger } from '../utils/logger';

/**
 * Sync operation types
 */
export type SyncOperation = 'create' | 'update' | 'delete';

/**
 * Sync status types
 */
export type SyncStatus = 'pending' | 'approved' | 'syncing' | 'synced' | 'failed';

/**
 * Sync queue item
 */
export interface SyncQueueItem {
  id: number;
  contactId: string;
  operation: SyncOperation;
  dataBefore?: Contact['contactData'];
  dataAfter?: Contact['contactData'];
  dataHashAfter?: string;
  reviewed: boolean;
  approved?: boolean;
  syncStatus: SyncStatus;
  errorMessage?: string;
  createdAt: string;
  reviewedAt?: string;
  syncedAt?: string;
  retryCount: number;
  importSessionId?: string;
}

/**
 * Sync queue filters
 */
export interface SyncQueueFilter {
  syncStatus?: SyncStatus | SyncStatus[];
  reviewed?: boolean;
  approved?: boolean;
  operation?: SyncOperation;
  importSessionId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Sync Queue Store
 * Manages manual approval queue for syncing contacts to API
 */
export class SyncQueue {
  private db: ContactDatabase;

  constructor(db?: ContactDatabase) {
    this.db = db || getDatabase();
  }

  /**
   * Add item to sync queue
   */
  addToQueue(
    contactId: string,
    operation: SyncOperation,
    dataAfter?: Contact['contactData'],
    dataBefore?: Contact['contactData'],
    importSessionId?: string
  ): number {
    try {
      const dataHashAfter = dataAfter ? generateContactHash({
        contactId,
        contactData: dataAfter,
        contactMetadata: { tagIds: [] as string[], sharedBy: [] as string[] },
        etag: '',
        created: '',
        updated: ''
      }) : null;

      const result = this.db.execute(
        `INSERT INTO sync_queue (
          contact_id, operation, data_before, data_after, data_hash_after, import_session_id
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          contactId,
          operation,
          dataBefore ? JSON.stringify(dataBefore) : null,
          dataAfter ? JSON.stringify(dataAfter) : null,
          dataHashAfter,
          importSessionId || null,
        ]
      );

      const queueId = Number(result.lastInsertRowid);
      logger.debug(`Added to sync queue: ${operation} ${contactId} (queue_id: ${queueId})`);
      return queueId;
    } catch (error) {
      logger.error('Failed to add to sync queue:', { contactId, operation, error });
      throw new Error(`Failed to add to sync queue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add multiple items to queue in a transaction
   */
  addMultipleToQueue(
    items: Array<{
      contactId: string;
      operation: SyncOperation;
      dataAfter?: Contact['contactData'];
      dataBefore?: Contact['contactData'];
      importSessionId?: string;
    }>
  ): number[] {
    return this.db.transaction(() => {
      const ids: number[] = [];
      for (const item of items) {
        const id = this.addToQueue(
          item.contactId,
          item.operation,
          item.dataAfter,
          item.dataBefore,
          item.importSessionId
        );
        ids.push(id);
      }
      return ids;
    });
  }

  /**
   * Get queue item by ID
   */
  getQueueItem(id: number): SyncQueueItem | null {
    try {
      const row = this.db.queryOne<any>(
        'SELECT * FROM sync_queue WHERE id = ?',
        [id]
      );

      if (!row) {
        return null;
      }

      return this.mapRowToQueueItem(row);
    } catch (error) {
      logger.error('Failed to get queue item:', { id, error });
      throw error;
    }
  }

  /**
   * Get queue items with filters
   */
  getQueueItems(filter?: SyncQueueFilter): SyncQueueItem[] {
    try {
      const conditions: string[] = [];
      const params: any[] = [];

      if (filter?.syncStatus) {
        if (Array.isArray(filter.syncStatus)) {
          const placeholders = filter.syncStatus.map(() => '?').join(',');
          conditions.push(`sync_status IN (${placeholders})`);
          params.push(...filter.syncStatus);
        } else {
          conditions.push('sync_status = ?');
          params.push(filter.syncStatus);
        }
      }

      if (filter?.reviewed !== undefined) {
        conditions.push('reviewed = ?');
        params.push(filter.reviewed ? 1 : 0);
      }

      if (filter?.approved !== undefined) {
        conditions.push('approved = ?');
        params.push(filter.approved ? 1 : 0);
      }

      if (filter?.operation) {
        conditions.push('operation = ?');
        params.push(filter.operation);
      }

      if (filter?.importSessionId) {
        conditions.push('import_session_id = ?');
        params.push(filter.importSessionId);
      }

      let sql = 'SELECT * FROM sync_queue';

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY created_at ASC';

      if (filter?.limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(filter.limit);

        if (filter?.offset !== undefined) {
          sql += ' OFFSET ?';
          params.push(filter.offset);
        }
      }

      const rows = this.db.query<any>(sql, params);
      return rows.map(row => this.mapRowToQueueItem(row));
    } catch (error) {
      logger.error('Failed to get queue items:', { filter, error });
      throw error;
    }
  }

  /**
   * Get pending queue items (not reviewed)
   */
  getPendingItems(): SyncQueueItem[] {
    return this.getQueueItems({ syncStatus: 'pending', reviewed: false });
  }

  /**
   * Get approved queue items (ready to sync)
   */
  getApprovedItems(): SyncQueueItem[] {
    return this.getQueueItems({ syncStatus: 'approved', approved: true });
  }

  /**
   * Get failed queue items
   */
  getFailedItems(): SyncQueueItem[] {
    return this.getQueueItems({ syncStatus: 'failed' });
  }

  /**
   * Approve queue item
   */
  approveQueueItem(id: number): void {
    try {
      this.db.execute(
        `UPDATE sync_queue SET
          reviewed = 1,
          approved = 1,
          sync_status = 'approved',
          reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [id]
      );
      logger.debug(`Queue item approved: ${id}`);
    } catch (error) {
      logger.error('Failed to approve queue item:', { id, error });
      throw error;
    }
  }

  /**
   * Approve multiple queue items
   */
  approveMultiple(ids: number[]): void {
    this.db.transaction(() => {
      for (const id of ids) {
        this.approveQueueItem(id);
      }
    });
  }

  /**
   * Reject queue item
   */
  rejectQueueItem(id: number): void {
    try {
      this.db.execute(
        `UPDATE sync_queue SET
          reviewed = 1,
          approved = 0,
          sync_status = 'pending',
          reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [id]
      );
      logger.debug(`Queue item rejected: ${id}`);
    } catch (error) {
      logger.error('Failed to reject queue item:', { id, error });
      throw error;
    }
  }

  /**
   * Reject multiple queue items
   */
  rejectMultiple(ids: number[]): void {
    this.db.transaction(() => {
      for (const id of ids) {
        this.rejectQueueItem(id);
      }
    });
  }

  /**
   * Mark queue item as syncing
   * Uses optimistic locking to prevent race conditions
   * @returns true if successful, false if item is already being synced
   */
  markItemSyncing(id: number): boolean {
    try {
      // Only update if current status is 'approved' (optimistic locking)
      const result = this.db.execute(
        `UPDATE sync_queue
         SET sync_status = 'syncing'
         WHERE id = ? AND sync_status = 'approved'`,
        [id]
      );

      if (result.changes === 0) {
        logger.warn(`Cannot mark item as syncing - not in approved state: ${id}`);
        return false;
      }

      logger.debug(`Queue item marked as syncing: ${id}`);
      return true;
    } catch (error) {
      logger.error('Failed to mark item as syncing:', { id, error });
      throw error;
    }
  }

  /**
   * Mark queue item as synced
   */
  markItemSynced(id: number): void {
    try {
      this.db.execute(
        `UPDATE sync_queue SET
          sync_status = 'synced',
          synced_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [id]
      );
      logger.debug(`Queue item marked as synced: ${id}`);
    } catch (error) {
      logger.error('Failed to mark item as synced:', { id, error });
      throw error;
    }
  }

  /**
   * Mark queue item as failed
   */
  markItemFailed(id: number, errorMessage: string): void {
    try {
      this.db.execute(
        `UPDATE sync_queue SET
          sync_status = 'failed',
          error_message = ?,
          retry_count = retry_count + 1
        WHERE id = ?`,
        [errorMessage, id]
      );
      logger.debug(`Queue item marked as failed: ${id}`);
    } catch (error) {
      logger.error('Failed to mark item as failed:', { id, error });
      throw error;
    }
  }

  /**
   * Reset failed item for retry
   */
  retryFailedItem(id: number): void {
    try {
      this.db.execute(
        `UPDATE sync_queue SET
          sync_status = 'approved',
          error_message = NULL
        WHERE id = ?`,
        [id]
      );
      logger.debug(`Queue item reset for retry: ${id}`);
    } catch (error) {
      logger.error('Failed to retry item:', { id, error });
      throw error;
    }
  }

  /**
   * Delete queue item
   */
  deleteQueueItem(id: number): void {
    try {
      this.db.execute('DELETE FROM sync_queue WHERE id = ?', [id]);
      logger.debug(`Queue item deleted: ${id}`);
    } catch (error) {
      logger.error('Failed to delete queue item:', { id, error });
      throw error;
    }
  }

  /**
   * Clear synced items (cleanup)
   */
  clearSyncedItems(): number {
    try {
      const result = this.db.execute('DELETE FROM sync_queue WHERE sync_status = ?', ['synced']);
      logger.info(`Cleared ${result.changes} synced queue items`);
      return result.changes;
    } catch (error) {
      logger.error('Failed to clear synced items:', error);
      throw error;
    }
  }

  /**
   * Count queue items
   */
  countQueueItems(filter?: SyncQueueFilter): number {
    try {
      const conditions: string[] = [];
      const params: any[] = [];

      if (filter?.syncStatus) {
        if (Array.isArray(filter.syncStatus)) {
          const placeholders = filter.syncStatus.map(() => '?').join(',');
          conditions.push(`sync_status IN (${placeholders})`);
          params.push(...filter.syncStatus);
        } else {
          conditions.push('sync_status = ?');
          params.push(filter.syncStatus);
        }
      }

      if (filter?.reviewed !== undefined) {
        conditions.push('reviewed = ?');
        params.push(filter.reviewed ? 1 : 0);
      }

      if (filter?.approved !== undefined) {
        conditions.push('approved = ?');
        params.push(filter.approved ? 1 : 0);
      }

      if (filter?.operation) {
        conditions.push('operation = ?');
        params.push(filter.operation);
      }

      let sql = 'SELECT COUNT(*) as count FROM sync_queue';

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      const result = this.db.queryOne<{ count: number }>(sql, params);
      return result?.count || 0;
    } catch (error) {
      logger.error('Failed to count queue items:', { filter, error });
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    total: number;
    pending: number;
    approved: number;
    syncing: number;
    synced: number;
    failed: number;
  } {
    return {
      total: this.countQueueItems(),
      pending: this.countQueueItems({ syncStatus: 'pending' }),
      approved: this.countQueueItems({ syncStatus: 'approved' }),
      syncing: this.countQueueItems({ syncStatus: 'syncing' }),
      synced: this.countQueueItems({ syncStatus: 'synced' }),
      failed: this.countQueueItems({ syncStatus: 'failed' }),
    };
  }

  /**
   * Map database row to queue item
   */
  private mapRowToQueueItem(row: any): SyncQueueItem {
    return {
      id: row.id,
      contactId: row.contact_id,
      operation: row.operation,
      dataBefore: row.data_before ? JSON.parse(row.data_before) : undefined,
      dataAfter: row.data_after ? JSON.parse(row.data_after) : undefined,
      dataHashAfter: row.data_hash_after || undefined,
      reviewed: row.reviewed === 1,
      approved: row.approved === 1 ? true : row.approved === 0 ? false : undefined,
      syncStatus: row.sync_status,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at || undefined,
      syncedAt: row.synced_at || undefined,
      retryCount: row.retry_count,
      importSessionId: row.import_session_id || undefined,
    };
  }
}

/**
 * Get sync queue instance
 */
export function getSyncQueue(db?: ContactDatabase): SyncQueue {
  return new SyncQueue(db);
}
