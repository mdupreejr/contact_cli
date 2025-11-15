import { Contact, ContactName } from '../types/contactsplus';
import { ContactsApi } from '../api/contacts';
import { logger } from '../utils/logger';
import { getSyncQueue } from '../db/sync-queue';
import { getContactStore } from '../db/contact-store';

export interface DuplicateNameIssue {
  contact: Contact;
  duplicateWords: string[];
  suggestedFix: ContactName;
}

export type ProgressCallback = (current: number, total: number, message: string) => void;

export class DuplicateNameFixer {
  private contactsApi: ContactsApi;

  constructor(contactsApi: ContactsApi) {
    this.contactsApi = contactsApi;
  }

  /**
   * Analyzes contacts and finds those with duplicate words in their names
   */
  findDuplicateNames(contacts: Contact[], progressCallback?: ProgressCallback): DuplicateNameIssue[] {
    const issues: DuplicateNameIssue[] = [];

    logger.info(`Starting duplicate name analysis on ${contacts.length} contacts`);

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];

      if (progressCallback && (i % 100 === 0 || i === contacts.length - 1)) {
        const contactName = this.formatNameForDisplay(contact.contactData?.name || {});
        progressCallback(i + 1, contacts.length, `Checking: ${contactName}`);
      }

      const name = contact.contactData?.name;
      if (!name) continue;

      const duplicates = this.detectDuplicateWordsInName(name);
      if (duplicates.length > 0) {
        const suggestedFix = this.suggestNameFix(name, duplicates);
        issues.push({
          contact,
          duplicateWords: duplicates,
          suggestedFix,
        });

        if (progressCallback) {
          const contactName = this.formatNameForDisplay(name);
          progressCallback(i + 1, contacts.length, `Found duplicate in: ${contactName}`);
        }
      }
    }

    logger.info(`Found ${issues.length} contacts with duplicate name words`);

    if (progressCallback) {
      progressCallback(contacts.length, contacts.length, `Analysis complete: ${issues.length} issues found`);
    }

    return issues;
  }

  /**
   * Detects duplicate words within a contact name
   */
  private detectDuplicateWordsInName(name: ContactName): string[] {
    const nameParts = [
      name.prefix,
      name.givenName,
      name.middleName,
      name.familyName,
      name.suffix,
    ].filter(Boolean);

    if (nameParts.length === 0) return [];

    // Convert to lowercase for comparison
    const lowerParts = nameParts.map(part => part!.toLowerCase().trim());
    const duplicates: string[] = [];
    const seen = new Set<string>();

    for (const part of lowerParts) {
      if (seen.has(part)) {
        duplicates.push(part);
      } else {
        seen.add(part);
      }
    }

    return duplicates;
  }

  /**
   * Suggests a fix by removing duplicate words
   */
  private suggestNameFix(originalName: ContactName, duplicates: string[]): ContactName {
    const duplicateSet = new Set(duplicates.map(d => d.toLowerCase()));
    
    // Create a copy of the original name
    const fixed: ContactName = { ...originalName };
    
    // Remove duplicates, keeping the first occurrence
    const seenWords = new Set<string>();
    
    // Process each field in order of preference
    const fields: (keyof ContactName)[] = ['prefix', 'givenName', 'middleName', 'familyName', 'suffix'];
    
    for (const field of fields) {
      const value = fixed[field];
      if (!value) continue;
      
      const lowerValue = value.toLowerCase().trim();
      
      if (duplicateSet.has(lowerValue)) {
        if (seenWords.has(lowerValue)) {
          // This is a duplicate, remove it
          fixed[field] = '';
        } else {
          // First occurrence, keep it
          seenWords.add(lowerValue);
        }
      }
    }

    // Clean up empty strings
    for (const field of fields) {
      if (fixed[field] === '') {
        delete (fixed as any)[field];
      }
    }

    return fixed;
  }

  /**
   * Queues the suggested fix for a contact (does not apply directly)
   * @deprecated Use the UI tools menu which properly queues changes
   */
  async applyFix(contact: Contact, suggestedName: ContactName): Promise<Contact> {
    const updatedContact = {
      ...contact,
      contactData: {
        ...contact.contactData,
        name: suggestedName,
      },
    };

    try {
      // Queue the change instead of applying directly
      const syncQueue = getSyncQueue();
      const contactStore = getContactStore();

      // Check if this exact change is already in the queue
      const existingQueueItems = syncQueue.getQueueItems({
        syncStatus: ['pending', 'approved'],
      });

      const alreadyQueued = existingQueueItems.some(item => {
        if (item.contactId !== contact.contactId) return false;
        if (!item.dataAfter?.name) return false;

        const queuedName = item.dataAfter.name;
        return queuedName.givenName === suggestedName.givenName &&
               queuedName.familyName === suggestedName.familyName &&
               queuedName.middleName === suggestedName.middleName &&
               queuedName.prefix === suggestedName.prefix &&
               queuedName.suffix === suggestedName.suffix;
      });

      if (alreadyQueued) {
        logger.info(`Duplicate name fix already queued for contact: ${contact.contactId}`);
        return updatedContact;
      }

      // Add to sync queue
      syncQueue.addToQueue(
        contact.contactId,
        'update',
        updatedContact.contactData,
        contact.contactData,
        undefined
      );

      // Update local contact store
      contactStore.saveContact(
        updatedContact,
        'manual',
        undefined,
        false // Not synced to API yet
      );

      logger.info(`Queued duplicate name fix for contact: ${contact.contactId}`);
      return updatedContact;
    } catch (error) {
      logger.error(`Failed to queue duplicate name fix for contact ${contact.contactId}:`, error);
      throw error;
    }
  }

  /**
   * Formats a name for display
   */
  formatNameForDisplay(name: ContactName): string {
    const parts = [
      name.prefix,
      name.givenName,
      name.middleName,
      name.familyName,
      name.suffix,
    ].filter(Boolean);
    
    return parts.join(' ') || 'Unnamed';
  }

  /**
   * Gets a summary of the duplicate issue
   */
  getIssueSummary(issue: DuplicateNameIssue): string {
    const original = this.formatNameForDisplay(issue.contact.contactData?.name || {});
    const suggested = this.formatNameForDisplay(issue.suggestedFix);
    const duplicates = issue.duplicateWords.join(', ');
    
    return `Original: "${original}" → Suggested: "${suggested}" (Duplicates: ${duplicates})`;
  }
}