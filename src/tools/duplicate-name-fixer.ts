import { Contact, ContactName } from '../types/contactsplus';
import { ContactsApi } from '../api/contacts';
import { logger } from '../utils/logger';

export interface DuplicateNameIssue {
  contact: Contact;
  duplicateWords: string[];
  suggestedFix: ContactName;
}

export class DuplicateNameFixer {
  private contactsApi: ContactsApi;

  constructor(contactsApi: ContactsApi) {
    this.contactsApi = contactsApi;
  }

  /**
   * Analyzes contacts and finds those with duplicate words in their names
   */
  findDuplicateNames(contacts: Contact[]): DuplicateNameIssue[] {
    const issues: DuplicateNameIssue[] = [];

    for (const contact of contacts) {
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
      }
    }

    logger.info(`Found ${issues.length} contacts with duplicate name words`);
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
   * Applies the suggested fix to a contact
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
      const result = await this.contactsApi.updateContact(updatedContact);
      logger.info(`Successfully fixed duplicate name for contact: ${contact.contactId}`);
      return result;
    } catch (error) {
      logger.error(`Failed to fix duplicate name for contact ${contact.contactId}:`, error);
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