import * as crypto from 'crypto';
import { Contact } from '../types/contactsplus';
import { logger } from '../utils/logger';
import { FieldParser } from '../utils/field-parser';

/**
 * Generate SHA-256 hash from contact data for duplicate detection
 *
 * This creates a normalized, stable hash that:
 * - Ignores contactId and metadata (timestamps, etags)
 * - Normalizes phone numbers (removes formatting)
 * - Normalizes emails (lowercase)
 * - Sorts arrays for consistent ordering
 * - Trims whitespace
 */
export function generateContactHash(contact: Contact): string {
  try {
    const normalized = normalizeContactForHashing(contact);
    const json = JSON.stringify(normalized);
    return crypto.createHash('sha256').update(json).digest('hex');
  } catch (error) {
    logger.error('Failed to generate contact hash:', error);
    throw new Error('Contact hash generation failed');
  }
}

/**
 * Generate hash from CSV row data
 */
export function generateCsvRowHash(row: Record<string, string>): string {
  try {
    // Sort keys for consistent ordering
    const sortedKeys = Object.keys(row).sort();
    const normalized: Record<string, string> = {};

    for (const key of sortedKeys) {
      const value = row[key]?.trim() || '';
      if (value) {
        normalized[key] = value;
      }
    }

    const json = JSON.stringify(normalized);
    return crypto.createHash('sha256').update(json).digest('hex');
  } catch (error) {
    logger.error('Failed to generate CSV row hash:', error);
    throw new Error('CSV row hash generation failed');
  }
}

/**
 * Normalize contact data for consistent hashing
 */
function normalizeContactForHashing(contact: Contact): any {
  const data = contact.contactData;
  const normalized: any = {};

  // Name (sorted fields, trimmed, lowercase)
  if (data.name) {
    const name: any = {};
    if (data.name.prefix) name.prefix = data.name.prefix.trim().toLowerCase();
    if (data.name.givenName) name.givenName = data.name.givenName.trim().toLowerCase();
    if (data.name.middleName) name.middleName = data.name.middleName.trim().toLowerCase();
    if (data.name.familyName) name.familyName = data.name.familyName.trim().toLowerCase();
    if (data.name.suffix) name.suffix = data.name.suffix.trim().toLowerCase();
    if (Object.keys(name).length > 0) {
      normalized.name = name;
    }
  }

  // Emails (normalized, sorted)
  if (data.emails && data.emails.length > 0) {
    normalized.emails = data.emails
      .map(email => ({
        value: email.value.trim().toLowerCase(),
        type: email.type?.trim().toLowerCase() || 'other',
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }

  // Phone numbers (digits only, sorted)
  if (data.phoneNumbers && data.phoneNumbers.length > 0) {
    normalized.phoneNumbers = data.phoneNumbers
      .map(phone => ({
        value: FieldParser.normalizePhone(phone.value),
        type: phone.type?.trim().toLowerCase() || 'other',
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }

  // Organizations (normalized, sorted)
  if (data.organizations && data.organizations.length > 0) {
    normalized.organizations = data.organizations
      .map(org => {
        const normalizedOrg: any = {};
        if (org.name) normalizedOrg.name = org.name.trim().toLowerCase();
        if (org.title) normalizedOrg.title = org.title.trim().toLowerCase();
        if (org.department) normalizedOrg.department = org.department.trim().toLowerCase();
        return normalizedOrg;
      })
      .filter(org => Object.keys(org).length > 0)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  // Addresses (normalized, sorted)
  if (data.addresses && data.addresses.length > 0) {
    normalized.addresses = data.addresses
      .map(addr => {
        const normalizedAddr: any = {};
        if (addr.street) normalizedAddr.street = addr.street.trim().toLowerCase();
        if (addr.city) normalizedAddr.city = addr.city.trim().toLowerCase();
        if (addr.region) normalizedAddr.region = addr.region.trim().toLowerCase();
        if (addr.postalCode) normalizedAddr.postalCode = addr.postalCode.trim().replace(/\s+/g, '');
        if (addr.country) normalizedAddr.country = addr.country.trim().toLowerCase();
        if (addr.type) normalizedAddr.type = addr.type.trim().toLowerCase();
        return normalizedAddr;
      })
      .filter(addr => Object.keys(addr).length > 0)
      .sort((a, b) => {
        const aKey = `${a.street || ''}|${a.city || ''}`;
        const bKey = `${b.street || ''}|${b.city || ''}`;
        return aKey.localeCompare(bKey);
      });
  }

  // URLs (normalized, sorted)
  if (data.urls && data.urls.length > 0) {
    normalized.urls = data.urls
      .map(url => url.value.trim().toLowerCase())
      .sort()
      .map(value => ({ value }));
  }

  // Birthday (normalized)
  if (data.birthday) {
    const birthday: any = {};
    if (data.birthday.year) birthday.year = data.birthday.year;
    if (data.birthday.month) birthday.month = data.birthday.month;
    if (data.birthday.day) birthday.day = data.birthday.day;
    if (Object.keys(birthday).length > 0) {
      normalized.birthday = birthday;
    }
  }

  // Notes (trimmed, normalized whitespace)
  if (data.notes) {
    normalized.notes = data.notes.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  return normalized;
}

/**
 * Compare two contact hashes
 */
export function compareContactHashes(hash1: string, hash2: string): boolean {
  return hash1 === hash2;
}

/**
 * Verify contact hash matches current data
 */
export function verifyContactHash(contact: Contact, expectedHash: string): boolean {
  const actualHash = generateContactHash(contact);
  return actualHash === expectedHash;
}

/**
 * Generate hash from file content (for CSV file deduplication)
 */
export function generateFileHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generate hash from file path
 */
export async function generateFileHashFromPath(filePath: string): Promise<string> {
  const fs = await import('fs/promises');
  const content = await fs.readFile(filePath, 'utf-8');
  return generateFileHash(content);
}
