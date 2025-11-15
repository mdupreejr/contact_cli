import { Contact } from '../types/contactsplus';
import { ContactsApi } from '../api/contacts';
import { ContactStore, getContactStore } from './contact-store';
import { SyncQueue, getSyncQueue, SyncQueueItem } from './sync-queue';
import { generateContactHash, compareContactHashes } from './contact-hash';
import { logger } from '../utils/logger';
import { ContactDatabase, getDatabase } from './database';

/**
 * Sync result for a single item
 */
export interface SyncItemResult {
  queueId: number;
  contactId: string;
  operation: string;
  success: boolean;
  error?: string;
  apiContact?: Contact;
}

/**
 * Overall sync session result
 */
export interface SyncSessionResult {
  totalItems: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  results: SyncItemResult[];
  startTime: Date;
  endTime: Date;
  durationMs: number;
}

/**
 * Sync progress callback
 */
export type SyncProgressCallback = (progress: {
  current: number;
  total: number;
  currentItem: SyncQueueItem;
  result?: SyncItemResult;
  step?: string;
}) => void;

/**
 * Sync conflict information
 */
export interface SyncConflict {
  queueItem: SyncQueueItem;
  localHash: string;
  apiHash: string;
  localContact: Contact | null;
  apiContact: Contact | null;
  reason: 'hash_mismatch' | 'not_found' | 'api_error';
}

/**
 * Sync Engine
 * Handles syncing contacts from local database to API with conflict detection
 */
export class SyncEngine {
  private api: ContactsApi;
  private contactStore: ContactStore;
  private syncQueue: SyncQueue;
  private db: ContactDatabase;

  // Retry configuration
  private maxRetries: number = 3;
  private baseRetryDelayMs: number = 1000;
  private maxRetryDelayMs: number = 30000;

  constructor(api: ContactsApi, db?: ContactDatabase) {
    this.api = api;
    this.db = db || getDatabase();
    this.contactStore = getContactStore(this.db);
    this.syncQueue = getSyncQueue(this.db);
  }

  /**
   * Sync all approved items in the queue
   */
  async syncApprovedItems(
    progressCallback?: SyncProgressCallback
  ): Promise<SyncSessionResult> {
    const startTime = new Date();
    const approvedItems = this.syncQueue.getApprovedItems();

    logger.info(`Starting sync session: ${approvedItems.length} approved items`);

    const results: SyncItemResult[] = [];
    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < approvedItems.length; i++) {
      const item = approvedItems[i];

      // Notify progress
      if (progressCallback) {
        progressCallback({
          current: i + 1,
          total: approvedItems.length,
          currentItem: item,
        });
      }

      try {
        const result = await this.syncQueueItem(item, i, approvedItems.length, progressCallback);
        results.push(result);

        if (result.success) {
          successCount++;
          // Notify completion
          if (progressCallback) {
            progressCallback({
              current: i + 1,
              total: approvedItems.length,
              currentItem: item,
              result,
              step: '✓ Completed',
            });
          }
        } else {
          failureCount++;
          // Notify failure
          if (progressCallback) {
            progressCallback({
              current: i + 1,
              total: approvedItems.length,
              currentItem: item,
              result,
              step: `✗ Failed: ${result.error}`,
            });
          }
        }
      } catch (error) {
        logger.error('Unexpected error syncing item', { queueId: item.id, contactId: item.contactId, operation: item.operation, error });

        const result: SyncItemResult = {
          queueId: item.id,
          contactId: item.contactId,
          operation: item.operation,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };

        results.push(result);
        failureCount++;

        // Mark as failed in queue
        this.syncQueue.markItemFailed(item.id, result.error!);
      }
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const sessionResult: SyncSessionResult = {
      totalItems: approvedItems.length,
      successCount,
      failureCount,
      skippedCount,
      results,
      startTime,
      endTime,
      durationMs,
    };

    logger.info(
      `Sync session completed: ${successCount} succeeded, ${failureCount} failed, ${skippedCount} skipped (${durationMs}ms)`
    );

    return sessionResult;
  }

  /**
   * Sync a single item by queue ID
   */
  async syncItem(queueId: number): Promise<SyncItemResult> {
    const item = this.syncQueue.getQueueItem(queueId);
    if (!item) {
      return {
        queueId,
        contactId: '',
        operation: '',
        success: false,
        error: 'Queue item not found',
      };
    }

    const SYNC_TIMEOUT_MS = 30000; // 30 seconds
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<SyncItemResult>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Sync timeout after 30 seconds')), SYNC_TIMEOUT_MS);
    });

    const syncPromise = this.syncQueueItem(item, 0, 1, undefined);

    try {
      const result = await Promise.race([syncPromise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.syncQueue.markItemFailed(queueId, errorMessage);
      return {
        queueId,
        contactId: item.contactId,
        operation: item.operation,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Sync a single queue item with retry logic
   */
  private async syncQueueItem(item: SyncQueueItem, index: number, total: number, progressCallback?: SyncProgressCallback): Promise<SyncItemResult> {
    let lastError: string | undefined;

    // Try up to maxRetries times
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // Mark as syncing on first attempt (with optimistic locking)
        if (attempt === 0) {
          if (progressCallback) {
            progressCallback({ current: index + 1, total, currentItem: item, step: 'Preparing to sync...' });
          }

          const marked = this.syncQueue.markItemSyncing(item.id);
          if (!marked) {
            // Item is already being synced by another process - skip it
            return {
              queueId: item.id,
              contactId: item.contactId,
              operation: item.operation,
              success: false,
              error: 'Item already being synced by another process',
            };
          }
        }

        // Perform sync operation
        const apiContact = await this.performSyncOperation(item, index, total, progressCallback);

        // Mark as synced
        this.syncQueue.markItemSynced(item.id);

        // Update local contact as synced
        if (apiContact) {
          this.contactStore.saveContact(apiContact, 'api', item.importSessionId, true);
        }

        return {
          queueId: item.id,
          contactId: item.contactId,
          operation: item.operation,
          success: true,
          apiContact,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        logger.warn('Sync attempt failed', {
          queueId: item.id,
          contactId: item.contactId,
          operation: item.operation,
          attempt: attempt + 1,
          maxAttempts: this.maxRetries + 1,
          error: lastError
        });

        // If we have retries left, wait before trying again
        if (attempt < this.maxRetries) {
          const delayMs = this.calculateRetryDelay(attempt);
          logger.debug('Waiting before retry', { delayMs, nextAttempt: attempt + 2 });
          await this.sleep(delayMs);
        }
      }
    }

    // All retries exhausted
    this.syncQueue.markItemFailed(item.id, lastError || 'Unknown error after retries');

    return {
      queueId: item.id,
      contactId: item.contactId,
      operation: item.operation,
      success: false,
      error: lastError,
    };
  }

  /**
   * Perform the actual sync operation (create, update, or delete)
   */
  private async performSyncOperation(item: SyncQueueItem, index: number, total: number, progressCallback?: SyncProgressCallback): Promise<Contact | undefined> {
    switch (item.operation) {
      case 'create':
        return await this.performCreate(item, index, total, progressCallback);

      case 'update':
        return await this.performUpdate(item, index, total, progressCallback);

      case 'delete':
        await this.performDelete(item);
        return undefined;

      default:
        throw new Error(`Unknown operation: ${item.operation}`);
    }
  }

  /**
   * Create contact in API
   */
  private async performCreate(item: SyncQueueItem, index: number, total: number, progressCallback?: SyncProgressCallback): Promise<Contact> {
    if (!item.dataAfter) {
      throw new Error('Create operation requires dataAfter');
    }

    const contactToCreate: Contact = {
      contactId: item.contactId,
      contactData: item.dataAfter,
      contactMetadata: {
        tagIds: [] as string[],
        sharedBy: [] as string[],
      },
      etag: '',
      created: '',
      updated: '',
    };

    if (progressCallback) {
      progressCallback({ current: index + 1, total, currentItem: item, step: 'Submitting new contact to API...' });
    }

    logger.info('Creating contact in API', { contactId: item.contactId, queueId: item.id });
    const createdContact = await this.api.createContact(contactToCreate);

    if (progressCallback) {
      progressCallback({ current: index + 1, total, currentItem: item, step: 'Contact created successfully' });
    }

    logger.info('Contact created in API successfully', { contactId: createdContact.contactId, queueId: item.id });
    return createdContact;
  }

  /**
   * Update contact in API with conflict detection
   */
  private async performUpdate(item: SyncQueueItem, index: number, total: number, progressCallback?: SyncProgressCallback): Promise<Contact> {
    if (!item.dataAfter) {
      throw new Error('Update operation requires dataAfter');
    }

    if (progressCallback) {
      progressCallback({ current: index + 1, total, currentItem: item, step: 'Connecting to API...' });
    }

    // Fetch current contact from API to check for conflicts
    logger.debug('Fetching current contact from API', { contactId: item.contactId, queueId: item.id });
    const contacts = await this.api.getContactsByIds([item.contactId]);

    if (progressCallback) {
      progressCallback({ current: index + 1, total, currentItem: item, step: 'Verifying contact exists...' });
    }

    if (contacts.length === 0) {
      logger.error('Contact not found in API', { contactId: item.contactId, queueId: item.id });
      throw new Error(`Contact not found in API: ${item.contactId}`);
    }
    const apiContact = contacts[0];

    if (progressCallback) {
      progressCallback({ current: index + 1, total, currentItem: item, step: 'Checking for conflicts...' });
    }

    // Check for conflicts by comparing hashes
    const apiHash = generateContactHash(apiContact);
    const expectedHash = item.dataBefore ?
      generateContactHash({
        contactId: item.contactId,
        contactData: item.dataBefore,
        contactMetadata: { tagIds: [] as string[], sharedBy: [] as string[] },
        etag: '',
        created: '',
        updated: '',
      }) : null;

    // Log conflict detection but continue with merge strategy
    if (expectedHash && !compareContactHashes(apiHash, expectedHash)) {
      logger.warn('Contact modified in API since queued - using current etag for update', {
        contactId: item.contactId,
        queueId: item.id,
        apiEtag: apiContact.etag
      });
    }

    // Proceed with update using current API etag (merge strategy)
    if (progressCallback) {
      progressCallback({ current: index + 1, total, currentItem: item, step: 'Submitting changes to API...' });
    }

    const contactToUpdate: Contact = {
      ...apiContact,
      contactData: item.dataAfter,
    };

    logger.info('Updating contact in API', { contactId: item.contactId, queueId: item.id });
    const updatedContact = await this.api.updateContact(contactToUpdate);

    if (progressCallback) {
      progressCallback({ current: index + 1, total, currentItem: item, step: 'Update accepted, verifying...' });
    }

    logger.info('Contact updated in API successfully', { contactId: updatedContact.contactId, queueId: item.id });
    return updatedContact;
  }

  /**
   * Delete contact from API
   * Note: ContactsPlus API doesn't support delete operations yet
   */
  private async performDelete(item: SyncQueueItem): Promise<void> {
    logger.warn('Delete operation not supported by API', { contactId: item.contactId, queueId: item.id });
    throw new Error('Delete operation is not supported by the ContactsPlus API');
  }

  /**
   * Detect conflicts for all approved items before syncing
   */
  async detectConflicts(): Promise<SyncConflict[]> {
    const approvedItems = this.syncQueue.getApprovedItems();
    const conflicts: SyncConflict[] = [];

    logger.info(`Checking for conflicts in ${approvedItems.length} approved items`);

    for (const item of approvedItems) {
      if (item.operation === 'create') {
        // Create operations don't have conflicts
        continue;
      }

      try {
        // Fetch current API state
        const contacts = await this.api.getContactsByIds([item.contactId]);
        if (contacts.length === 0) {
          const localContact = this.contactStore.getContact(item.contactId);
          conflicts.push({
            queueItem: item,
            localHash: localContact ? generateContactHash(localContact) : '',
            apiHash: '',
            localContact: localContact || null,
            apiContact: null,
            reason: 'not_found',
          });
          continue;
        }
        const apiContact = contacts[0];
        const apiHash = generateContactHash(apiContact);

        // Get local contact
        const localContact = this.contactStore.getContact(item.contactId);
        if (!localContact) {
          conflicts.push({
            queueItem: item,
            localHash: '',
            apiHash,
            localContact: null,
            apiContact,
            reason: 'not_found',
          });
          continue;
        }

        const localHash = generateContactHash(localContact);

        // Check if hashes match
        if (!compareContactHashes(localHash, apiHash)) {
          conflicts.push({
            queueItem: item,
            localHash,
            apiHash,
            localContact,
            apiContact,
            reason: 'hash_mismatch',
          });
        }
      } catch (error) {
        logger.error('Error checking conflict for contact', { contactId: item.contactId, queueId: item.id, error });

        const localContact = this.contactStore.getContact(item.contactId);
        if (localContact) {
          conflicts.push({
            queueItem: item,
            localHash: generateContactHash(localContact),
            apiHash: '',
            localContact,
            apiContact: localContact, // Use local as placeholder
            reason: 'api_error',
          });
        }
      }
    }

    logger.info(`Found ${conflicts.length} conflicts`);
    return conflicts;
  }

  /**
   * Resume failed syncs (retry all failed items)
   */
  async resumeFailedSyncs(progressCallback?: SyncProgressCallback): Promise<SyncSessionResult> {
    logger.info('Resuming failed syncs...');

    const failedItems = this.syncQueue.getFailedItems();

    if (failedItems.length === 0) {
      logger.info('No failed items to resume');
      return {
        totalItems: 0,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
        results: [],
        startTime: new Date(),
        endTime: new Date(),
        durationMs: 0,
      };
    }

    // Reset failed items to approved status
    for (const item of failedItems) {
      this.syncQueue.retryFailedItem(item.id);
    }

    // Sync them
    return await this.syncApprovedItems(progressCallback);
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateRetryDelay(attempt: number): number {
    // Exponential backoff: baseDelay * 2^attempt, capped at maxRetryDelay
    const delay = this.baseRetryDelayMs * Math.pow(2, attempt);
    return Math.min(delay, this.maxRetryDelayMs);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Set retry configuration
   */
  setRetryConfig(maxRetries: number, baseDelayMs: number, maxDelayMs: number): void {
    this.maxRetries = maxRetries;
    this.baseRetryDelayMs = baseDelayMs;
    this.maxRetryDelayMs = maxDelayMs;
    logger.debug(`Retry config updated: maxRetries=${maxRetries}, baseDelay=${baseDelayMs}ms, maxDelay=${maxDelayMs}ms`);
  }

  /**
   * Get current sync statistics
   */
  getSyncStats(): {
    queueStats: {
      total: number;
      pending: number;
      approved: number;
      syncing: number;
      synced: number;
      failed: number;
    };
    lastSyncTime?: Date;
    pendingCount: number;
    failedCount: number;
  } {
    const queueStats = this.syncQueue.getQueueStats();

    return {
      queueStats,
      pendingCount: queueStats.pending,
      failedCount: queueStats.failed,
    };
  }
}

/**
 * Get sync engine instance
 */
export function getSyncEngine(api: ContactsApi, db?: ContactDatabase): SyncEngine {
  return new SyncEngine(api, db);
}
