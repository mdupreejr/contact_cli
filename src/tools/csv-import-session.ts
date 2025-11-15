import { Contact } from '../types/contactsplus';
import { CsvImportTool, CsvImportResult, ContactMatch } from './csv-import-tool';
import { ContactStore } from '../db/contact-store';
import { SyncQueue } from '../db/sync-queue';
import { ImportHistory } from '../db/import-history';
import { generateCsvRowHash } from '../db/contact-hash';
import { ColumnMapping } from '../utils/csv-contact-mapper';
import { logger } from '../utils/logger';
import * as path from 'path';

/**
 * Enhanced CSV import result with database integration
 */
export interface CsvImportSessionResult extends CsvImportResult {
  sessionId: string;
  skippedDuplicates: number;
  queuedOperations: number;
  savedToDb: number;
}

/**
 * User decisions from merge review
 */
export interface ImportDecisions {
  mergeDecisions: Array<{
    match: ContactMatch;
    action: 'merge' | 'skip' | 'new';
  }>;
  newContactDecisions: Contact[];
}

/**
 * CSV Import Session Manager
 * Manages CSV imports with database integration, deduplication, and queueing
 */
export class CsvImportSession {
  private csvImportTool: CsvImportTool;
  private contactStore: ContactStore;
  private syncQueue: SyncQueue;
  private importHistory: ImportHistory;

  constructor(
    contactStore: ContactStore,
    syncQueue: SyncQueue,
    importHistory: ImportHistory
  ) {
    this.csvImportTool = new CsvImportTool();
    this.contactStore = contactStore;
    this.syncQueue = syncQueue;
    this.importHistory = importHistory;
  }

  /**
   * Start CSV import session
   * Phase 1: Analyze CSV and detect duplicates (no database changes)
   */
  async analyzeImport(
    csvFilePath: string,
    customMapping?: ColumnMapping
  ): Promise<CsvImportSessionResult> {
    try {
      const filename = path.basename(csvFilePath);
      logger.info(`Starting CSV import analysis: ${filename}`);

      // Check if this CSV file has been imported before
      const alreadyImported = await this.importHistory.hasBeenImported(csvFilePath);
      if (alreadyImported) {
        logger.warn(`CSV file has been imported before: ${filename}`);
      }

      // Create import session
      const sessionId = await this.importHistory.createImportSession(
        filename,
        csvFilePath,
        0 // Will update after parsing
      );

      logger.info(`Import session created: ${sessionId}`);

      // Get existing contacts from local database (not API)
      const existingContacts = this.contactStore.getAllContacts();
      logger.info(`Loaded ${existingContacts.length} contacts from local database`);

      // Perform CSV import analysis
      const importResult = await this.csvImportTool.importCsv(
        csvFilePath,
        existingContacts,
        customMapping
      );

      // Check for CSV row duplicates
      const { filteredMatches, filteredNewContacts, skippedCount } =
        await this.filterDuplicateRows(
          sessionId,
          importResult.matchedContacts,
          importResult.newContacts
        );

      // Update import session with initial stats
      this.importHistory.updateImportSession(sessionId, {
        parsedContacts: importResult.parsedContacts.length,
        matchedContacts: filteredMatches.length,
        newContacts: filteredNewContacts.length,
      });

      logger.info(
        `Import analysis complete: ${filteredMatches.length} matches, ${filteredNewContacts.length} new, ${skippedCount} duplicate rows skipped`
      );

      return {
        ...importResult,
        matchedContacts: filteredMatches,
        newContacts: filteredNewContacts,
        sessionId,
        skippedDuplicates: skippedCount,
        queuedOperations: 0,
        savedToDb: 0,
      };
    } catch (error) {
      logger.error('CSV import analysis failed:', error);
      throw error;
    }
  }

  /**
   * Apply import decisions and queue operations
   * Phase 2: Queue changes for manual review (still no API changes)
   */
  async applyDecisions(
    sessionId: string,
    decisions: ImportDecisions
  ): Promise<{
    queuedOperations: number;
    savedToDb: number;
  }> {
    logger.info(`Applying import decisions for session: ${sessionId}`);

    // Wrap entire operation in a transaction for atomicity
    return this.contactStore.getDatabase().transaction(() => {
      let queuedOperations = 0;
      let savedToDb = 0;

      try {
        // Process merge decisions
        for (const decision of decisions.mergeDecisions) {
          const { match, action } = decision;

          // Save CSV row hash to prevent re-import
          const rowHash = this.generateContactHash(match.csvContact);
          this.importHistory.addCsvRowHash(
            rowHash,
            sessionId,
            match.csvContact.contactId,
            action
          );

          switch (action) {
            case 'merge':
              // Save merged contact to local DB (not synced yet)
              if (match.mergedContact) {
                this.contactStore.saveContact(
                  match.mergedContact,
                  'csv_import',
                  sessionId,
                  false // Not synced to API yet
                );
                savedToDb++;

                // Queue update operation for API sync
                this.syncQueue.addToQueue(
                  match.existingContact.contactId,
                  'update',
                  match.mergedContact.contactData,
                  match.existingContact.contactData,
                  sessionId
                );
                queuedOperations++;
              }
              break;

            case 'skip':
              // Do nothing - keep existing contact
              logger.debug(`Skipping contact: ${match.csvContact.contactId}`);
              break;

            case 'new':
              // Treat as new contact even though match was found
              this.contactStore.saveContact(
                match.csvContact,
                'csv_import',
                sessionId,
                false
              );
              savedToDb++;

              this.syncQueue.addToQueue(
                match.csvContact.contactId,
                'create',
                match.csvContact.contactData,
                undefined,
                sessionId
              );
              queuedOperations++;
              break;
          }
        }

        // Process new contacts
        for (const contact of decisions.newContactDecisions) {
          // Save CSV row hash
          const rowHash = this.generateContactHash(contact);
          this.importHistory.addCsvRowHash(
            rowHash,
            sessionId,
            contact.contactId,
            'new'
          );

          // Save to local DB
          this.contactStore.saveContact(
            contact,
            'csv_import',
            sessionId,
            false
          );
          savedToDb++;

          // Queue create operation
          this.syncQueue.addToQueue(
            contact.contactId,
            'create',
            contact.contactData,
            undefined,
            sessionId
          );
          queuedOperations++;
        }

        // Update import session stats
        this.importHistory.updateImportSession(sessionId, {
          queuedOperations,
        });

        // Mark session as completed (queued phase)
        this.importHistory.completeImportSession(sessionId, 'completed');

        logger.info(
          `Import decisions applied: ${savedToDb} saved to DB, ${queuedOperations} queued for sync`
        );

        return {
          queuedOperations,
          savedToDb,
        };
      } catch (error) {
        logger.error('Failed to apply import decisions:', error);
        this.importHistory.completeImportSession(
          sessionId,
          'failed',
          error instanceof Error ? error.message : 'Unknown error'
        );
        throw error;
      }
    });
  }

  /**
   * Filter out CSV rows that have already been imported
   */
  private async filterDuplicateRows(
    sessionId: string,
    matches: ContactMatch[],
    newContacts: Contact[]
  ): Promise<{
    filteredMatches: ContactMatch[];
    filteredNewContacts: Contact[];
    skippedCount: number;
  }> {
    let skippedCount = 0;

    // Filter matches
    const filteredMatches = matches.filter(match => {
      const hash = this.generateContactHash(match.csvContact);
      const exists = this.importHistory.csvRowHashExists(hash);

      if (exists) {
        logger.debug(`Skipping duplicate CSV row: ${hash.substring(0, 8)}...`);
        skippedCount++;
        return false;
      }

      return true;
    });

    // Filter new contacts
    const filteredNewContacts = newContacts.filter(contact => {
      const hash = this.generateContactHash(contact);
      const exists = this.importHistory.csvRowHashExists(hash);

      if (exists) {
        logger.debug(`Skipping duplicate CSV row: ${hash.substring(0, 8)}...`);
        skippedCount++;
        return false;
      }

      return true;
    });

    return {
      filteredMatches,
      filteredNewContacts,
      skippedCount,
    };
  }

  /**
   * Generate hash for contact (simplified wrapper)
   */
  private generateContactHash(contact: Contact): string {
    // For CSV contacts, we'll hash the contact data
    // This is a simplified version - in practice, you'd want to hash the original CSV row
    return generateCsvRowHash({
      name: contact.contactData.name?.givenName || '',
      email: contact.contactData.emails?.[0]?.value || '',
      phone: contact.contactData.phoneNumbers?.[0]?.value || '',
    });
  }

  /**
   * Cancel import session
   */
  cancelSession(sessionId: string): void {
    logger.info(`Cancelling import session: ${sessionId}`);
    this.importHistory.completeImportSession(sessionId, 'cancelled');
  }

  /**
   * Get import session status
   */
  getSessionStatus(sessionId: string) {
    return this.importHistory.getImportSession(sessionId);
  }

  /**
   * Get CSV import tool for direct access
   */
  getCsvImportTool(): CsvImportTool {
    return this.csvImportTool;
  }
}

/**
 * Create CSV import session
 */
export function createCsvImportSession(
  contactStore: ContactStore,
  syncQueue: SyncQueue,
  importHistory: ImportHistory
): CsvImportSession {
  return new CsvImportSession(contactStore, syncQueue, importHistory);
}
