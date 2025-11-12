import { Contact } from '../types/contactsplus';
import { CsvParser, CsvData } from '../utils/csv-parser';
import { CsvContactMapper, ColumnMapping } from '../utils/csv-contact-mapper';
import { logger } from '../utils/logger';
import jaroWinkler from 'jaro-winkler';

/**
 * CSV import result
 */
export interface CsvImportResult {
  totalRows: number;
  parsedContacts: Contact[];
  matchedContacts: ContactMatch[];
  newContacts: Contact[];
  errors: string[];
}

/**
 * Contact match information
 */
export interface ContactMatch {
  csvContact: Contact;
  existingContact: Contact;
  similarityScore: number;
  matchDetails: {
    nameMatch: boolean;
    emailMatch: boolean;
    phoneMatch: boolean;
    companyMatch: boolean;
  };
  suggestedAction: 'merge' | 'skip' | 'new';
  mergedContact?: Contact; // Proposed merged version
}

/**
 * CSV Import Tool
 * Imports contacts from CSV and intelligently matches with existing contacts
 */
export class CsvImportTool {
  private parser: CsvParser;
  private mapper: CsvContactMapper;

  constructor() {
    this.parser = new CsvParser();
    this.mapper = new CsvContactMapper();
  }

  /**
   * Import CSV file and match with existing contacts
   */
  async importCsv(
    filePath: string,
    existingContacts: Contact[],
    customMapping?: ColumnMapping
  ): Promise<CsvImportResult> {
    const errors: string[] = [];

    try {
      // Parse CSV file
      logger.info(`Importing CSV from: ${filePath}`);
      const csvData = await this.parser.parseFile(filePath);

      // Validate CSV
      const validation = CsvParser.validate(csvData);
      if (!validation.valid) {
        errors.push(...validation.errors);
      }

      // Auto-detect or use custom mapping
      if (customMapping) {
        this.mapper.setMapping(customMapping);
      } else {
        const detectedMapping = this.mapper.detectMapping(csvData.headers);
        this.mapper.setMapping(detectedMapping);
      }

      // Transform CSV rows to contacts
      const csvObjects = this.parser.toObjects(csvData);
      const parsedContacts = csvObjects.map(row => this.mapper.transformRow(row));

      logger.info(`Parsed ${parsedContacts.length} contacts from CSV`);

      // Create blocking index for efficient duplicate detection
      const blockingIndex = this.createBlockingIndex(existingContacts);
      logger.info(`Created blocking index with ${blockingIndex.size} blocks`);

      // Match with existing contacts
      const matchedContacts: ContactMatch[] = [];
      const newContacts: Contact[] = [];

      for (const csvContact of parsedContacts) {
        // Get candidate contacts using blocking
        const candidates = this.getBlockedCandidates(csvContact, blockingIndex);
        logger.debug(`Contact has ${candidates.length} blocked candidates (vs ${existingContacts.length} total)`);

        const match = this.findBestMatch(csvContact, candidates);

        if (match && match.similarityScore >= 0.7) {
          // Found potential duplicate
          matchedContacts.push(match);
        } else {
          // New contact
          newContacts.push(csvContact);
        }
      }

      logger.info(
        `Import analysis: ${matchedContacts.length} potential matches, ${newContacts.length} new contacts`
      );

      return {
        totalRows: csvData.rowCount,
        parsedContacts,
        matchedContacts,
        newContacts,
        errors,
      };
    } catch (error) {
      logger.error('CSV import failed:', error);
      errors.push(error instanceof Error ? error.message : 'Unknown error');

      return {
        totalRows: 0,
        parsedContacts: [],
        matchedContacts: [],
        newContacts: [],
        errors,
      };
    }
  }

  /**
   * Create blocking index for efficient duplicate detection
   * Groups contacts by blocking keys to reduce comparison complexity from O(n²) to O(n×k)
   */
  private createBlockingIndex(contacts: Contact[]): Map<string, Contact[]> {
    const index = new Map<string, Contact[]>();

    for (const contact of contacts) {
      const keys = this.getBlockingKeys(contact);

      for (const key of keys) {
        if (!index.has(key)) {
          index.set(key, []);
        }
        // Avoid duplicates in the same block
        if (!index.get(key)!.includes(contact)) {
          index.get(key)!.push(contact);
        }
      }
    }

    return index;
  }

  /**
   * Get blocking keys for a contact (used for efficient candidate selection)
   */
  private getBlockingKeys(contact: Contact): string[] {
    const keys: string[] = [];
    const name = this.getFullName(contact).toLowerCase();

    // Name prefix blocking (first 3 characters)
    if (name.length >= 3) {
      keys.push(`name:${name.substring(0, 3)}`);
    }

    // Email domain blocking
    const emails = contact.contactData?.emails || [];
    for (const email of emails) {
      const domain = email.value.split('@')[1];
      if (domain) {
        keys.push(`email:${domain.toLowerCase()}`);
      }
    }

    // Phone area code blocking (first 3-4 digits after country code)
    const phones = this.normalizePhones(contact.contactData?.phoneNumbers?.map(p => p.value) || []);
    for (const phone of phones) {
      if (phone.length >= 4) {
        // Use first 4 digits as blocking key
        keys.push(`phone:${phone.substring(0, 4)}`);
      }
    }

    // Company name blocking (first 3 characters)
    const company = contact.contactData?.organizations?.[0]?.name || '';
    if (company.length >= 3) {
      keys.push(`company:${company.toLowerCase().substring(0, 3)}`);
    }

    // If no blocking keys found, use a default key to ensure contact is still compared
    if (keys.length === 0) {
      keys.push('default');
    }

    return keys;
  }

  /**
   * Get candidate contacts for comparison using blocking index
   */
  private getBlockedCandidates(contact: Contact, blockingIndex: Map<string, Contact[]>): Contact[] {
    const candidateKeys = this.getBlockingKeys(contact);
    const candidates = new Set<Contact>();

    for (const key of candidateKeys) {
      const blocked = blockingIndex.get(key) || [];
      blocked.forEach(c => candidates.add(c));
    }

    return Array.from(candidates);
  }

  /**
   * Find best matching existing contact for CSV contact
   */
  private findBestMatch(csvContact: Contact, existingContacts: Contact[]): ContactMatch | null {
    let bestMatch: ContactMatch | null = null;
    let bestScore = 0;

    for (const existingContact of existingContacts) {
      const score = this.calculateSimilarity(csvContact, existingContact);

      if (score > bestScore) {
        bestScore = score;

        const matchDetails = this.getMatchDetails(csvContact, existingContact);

        bestMatch = {
          csvContact,
          existingContact,
          similarityScore: score,
          matchDetails,
          suggestedAction: score >= 0.85 ? 'merge' : score >= 0.7 ? 'merge' : 'new',
          mergedContact: this.createMergedContact(csvContact, existingContact),
        };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate similarity score between two contacts
   * Returns a score between 0 and 1, where 1 is a perfect match
   */
  private calculateSimilarity(contact1: Contact, contact2: Contact): number {
    let score = 0;
    let totalWeight = 0;

    // Name similarity (weight: 0.35)
    const name1 = this.getFullName(contact1);
    const name2 = this.getFullName(contact2);
    if (name1 && name2) {
      const nameSimilarity = jaroWinkler(name1.toLowerCase(), name2.toLowerCase());
      score += nameSimilarity * 0.35;
      totalWeight += 0.35;
    }

    // Email match (weight: 0.30)
    const emails1 = contact1.contactData?.emails?.map(e => e.value.toLowerCase()) || [];
    const emails2 = contact2.contactData?.emails?.map(e => e.value.toLowerCase()) || [];
    if (emails1.length > 0 && emails2.length > 0) {
      const emailMatch = emails1.some(e1 => emails2.includes(e1));
      score += emailMatch ? 0.30 : 0;
      totalWeight += 0.30;
    }

    // Phone match (weight: 0.20)
    const phones1 = this.normalizePhones(contact1.contactData?.phoneNumbers?.map(p => p.value) || []);
    const phones2 = this.normalizePhones(contact2.contactData?.phoneNumbers?.map(p => p.value) || []);
    if (phones1.length > 0 && phones2.length > 0) {
      const phoneMatch = phones1.some(p1 => phones2.includes(p1));
      score += phoneMatch ? 0.20 : 0;
      totalWeight += 0.20;
    }

    // Company similarity (weight: 0.15)
    const company1 = contact1.contactData?.organizations?.[0]?.name || '';
    const company2 = contact2.contactData?.organizations?.[0]?.name || '';
    if (company1 && company2) {
      const companySimilarity = jaroWinkler(company1.toLowerCase(), company2.toLowerCase());
      score += companySimilarity > 0.8 ? 0.15 : 0;
      totalWeight += 0.15;
    }

    // Return normalized score (don't divide by totalWeight - weights already sum correctly)
    return totalWeight > 0 ? score : 0;
  }

  /**
   * Get match details for display
   */
  private getMatchDetails(
    csvContact: Contact,
    existingContact: Contact
  ): ContactMatch['matchDetails'] {
    const emails1 = csvContact.contactData?.emails?.map(e => e.value.toLowerCase()) || [];
    const emails2 = existingContact.contactData?.emails?.map(e => e.value.toLowerCase()) || [];
    const emailMatch = emails1.some(e1 => emails2.includes(e1));

    const phones1 = this.normalizePhones(csvContact.contactData?.phoneNumbers?.map(p => p.value) || []);
    const phones2 = this.normalizePhones(existingContact.contactData?.phoneNumbers?.map(p => p.value) || []);
    const phoneMatch = phones1.some(p1 => phones2.includes(p1));

    const name1 = this.getFullName(csvContact);
    const name2 = this.getFullName(existingContact);
    const nameMatch = name1 && name2 ? jaroWinkler(name1.toLowerCase(), name2.toLowerCase()) > 0.85 : false;

    const company1 = csvContact.contactData?.organizations?.[0]?.name || '';
    const company2 = existingContact.contactData?.organizations?.[0]?.name || '';
    const companyMatch = company1 && company2 ? jaroWinkler(company1.toLowerCase(), company2.toLowerCase()) > 0.8 : false;

    return {
      nameMatch,
      emailMatch,
      phoneMatch,
      companyMatch,
    };
  }

  /**
   * Create merged contact by combining CSV and existing contact data
   * Public method to allow re-merging when contacts are updated during import
   */
  createMergedContact(csvContact: Contact, existingContact: Contact): Contact {
    // Start with existing contact as base
    const merged: Contact = JSON.parse(JSON.stringify(existingContact));

    // Merge name (prefer existing if present)
    if (csvContact.contactData?.name) {
      merged.contactData.name = {
        ...csvContact.contactData.name,
        ...merged.contactData.name,
      };
    }

    // Merge emails (add new ones)
    if (csvContact.contactData?.emails) {
      const existingEmails = merged.contactData.emails?.map(e => e.value.toLowerCase()) || [];
      const newEmails = csvContact.contactData.emails.filter(
        e => !existingEmails.includes(e.value.toLowerCase())
      );
      merged.contactData.emails = [...(merged.contactData.emails || []), ...newEmails];
    }

    // Merge phones (add new ones)
    if (csvContact.contactData?.phoneNumbers) {
      const existingPhones = this.normalizePhones(merged.contactData.phoneNumbers?.map(p => p.value) || []);
      const newPhones = csvContact.contactData.phoneNumbers.filter(
        p => !existingPhones.includes(this.normalizePhone(p.value))
      );
      merged.contactData.phoneNumbers = [...(merged.contactData.phoneNumbers || []), ...newPhones];
    }

    // Merge organizations (avoid duplicates)
    if (csvContact.contactData?.organizations && csvContact.contactData.organizations.length > 0) {
      const existingOrgs = merged.contactData.organizations || [];
      const existingOrgNames = new Set(
        existingOrgs.map(o => (o.name || '').toLowerCase().trim()).filter(Boolean)
      );

      const newOrgs = csvContact.contactData.organizations.filter(org =>
        !org.name || !existingOrgNames.has(org.name.toLowerCase().trim())
      );

      merged.contactData.organizations = [...existingOrgs, ...newOrgs];
    }

    // Merge addresses (avoid duplicates based on street + city)
    if (csvContact.contactData?.addresses && csvContact.contactData.addresses.length > 0) {
      const existingAddrs = merged.contactData.addresses || [];
      const existingAddrKeys = new Set(
        existingAddrs.map(a =>
          `${(a.street || '').toLowerCase().trim()}|${(a.city || '').toLowerCase().trim()}`
        ).filter(key => key !== '|')
      );

      const newAddrs = csvContact.contactData.addresses.filter(addr => {
        const key = `${(addr.street || '').toLowerCase().trim()}|${(addr.city || '').toLowerCase().trim()}`;
        return key !== '|' && !existingAddrKeys.has(key);
      });

      merged.contactData.addresses = [...existingAddrs, ...newAddrs];
    }

    // Merge notes (append)
    if (csvContact.contactData?.notes) {
      if (merged.contactData.notes) {
        merged.contactData.notes += `\n\n[From CSV Import]\n${csvContact.contactData.notes}`;
      } else {
        merged.contactData.notes = csvContact.contactData.notes;
      }
    }

    return merged;
  }

  /**
   * Get full name from contact
   */
  private getFullName(contact: Contact): string {
    const name = contact.contactData?.name;
    if (!name) return '';

    const parts = [name.givenName, name.middleName, name.familyName].filter(Boolean);
    return parts.join(' ');
  }

  /**
   * Normalize phone numbers for comparison
   */
  private normalizePhones(phones: string[]): string[] {
    return phones.map(p => this.normalizePhone(p));
  }

  /**
   * Normalize a single phone number
   */
  private normalizePhone(phone: string): string {
    // Remove all non-digit characters
    return phone.replace(/\D/g, '');
  }

  /**
   * Get current column mapping
   */
  getMapping(): ColumnMapping {
    return this.mapper.getMapping();
  }

  /**
   * Set custom column mapping
   */
  setMapping(mapping: ColumnMapping): void {
    this.mapper.setMapping(mapping);
  }
}
