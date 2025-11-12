import { Contact, ContactData } from '../types/contactsplus';
import { logger } from './logger';
import * as crypto from 'crypto';

/**
 * Column mapping configuration
 */
export interface ColumnMapping {
  // Name fields
  firstName?: string;
  lastName?: string;
  middleName?: string;
  fullName?: string;
  prefix?: string;
  suffix?: string;

  // Contact fields
  email?: string;
  phone?: string;
  mobile?: string;
  workPhone?: string;
  homePhone?: string;

  // Organization
  company?: string;
  jobTitle?: string;

  // Address
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;

  // Other
  notes?: string;
  website?: string;
  birthday?: string;
}

/**
 * CSV row to Contact transformer
 */
export class CsvContactMapper {
  private mapping: ColumnMapping;

  constructor(mapping?: ColumnMapping) {
    this.mapping = mapping || {};
  }

  /**
   * Auto-detect column mapping from CSV headers
   */
  detectMapping(headers: string[]): ColumnMapping {
    const mapping: ColumnMapping = {};
    const lowerHeaders = headers.map(h => h.toLowerCase().trim());

    for (let i = 0; i < headers.length; i++) {
      const header = lowerHeaders[i];
      const originalHeader = headers[i];

      // Name fields
      if (this.matchesAny(header, ['first name', 'firstname', 'given name', 'givenname'])) {
        mapping.firstName = originalHeader;
      } else if (this.matchesAny(header, ['last name', 'lastname', 'family name', 'familyname', 'surname'])) {
        mapping.lastName = originalHeader;
      } else if (this.matchesAny(header, ['middle name', 'middlename'])) {
        mapping.middleName = originalHeader;
      } else if (this.matchesAny(header, ['full name', 'fullname', 'name', 'display name'])) {
        mapping.fullName = originalHeader;
      } else if (this.matchesAny(header, ['prefix', 'title'])) {
        mapping.prefix = originalHeader;
      } else if (this.matchesAny(header, ['suffix'])) {
        mapping.suffix = originalHeader;
      }

      // Contact fields
      else if (this.matchesAny(header, ['email', 'e-mail', 'email address', 'mail'])) {
        mapping.email = originalHeader;
      } else if (this.matchesAny(header, ['phone', 'telephone', 'phone number'])) {
        mapping.phone = originalHeader;
      } else if (this.matchesAny(header, ['mobile', 'cell', 'cell phone', 'mobile phone'])) {
        mapping.mobile = originalHeader;
      } else if (this.matchesAny(header, ['work phone', 'business phone', 'office phone'])) {
        mapping.workPhone = originalHeader;
      } else if (this.matchesAny(header, ['home phone'])) {
        mapping.homePhone = originalHeader;
      }

      // Organization
      else if (this.matchesAny(header, ['company', 'organization', 'organisation', 'employer'])) {
        mapping.company = originalHeader;
      } else if (this.matchesAny(header, ['job title', 'title', 'position', 'role'])) {
        mapping.jobTitle = originalHeader;
      }

      // Address
      else if (this.matchesAny(header, ['street', 'address', 'street address', 'address line 1'])) {
        mapping.street = originalHeader;
      } else if (this.matchesAny(header, ['city', 'town'])) {
        mapping.city = originalHeader;
      } else if (this.matchesAny(header, ['state', 'province', 'region'])) {
        mapping.state = originalHeader;
      } else if (this.matchesAny(header, ['zip', 'zipcode', 'postal code', 'postcode'])) {
        mapping.zip = originalHeader;
      } else if (this.matchesAny(header, ['country'])) {
        mapping.country = originalHeader;
      }

      // Other
      else if (this.matchesAny(header, ['notes', 'comments', 'description'])) {
        mapping.notes = originalHeader;
      } else if (this.matchesAny(header, ['website', 'url', 'web', 'homepage'])) {
        mapping.website = originalHeader;
      } else if (this.matchesAny(header, ['birthday', 'birth date', 'date of birth', 'dob'])) {
        mapping.birthday = originalHeader;
      }
    }

    logger.info('Auto-detected column mapping:', mapping);
    return mapping;
  }

  /**
   * Transform CSV row to Contact object
   */
  transformRow(row: Record<string, string>): Contact {
    const contactData: ContactData = {};

    // Name
    contactData.name = {};
    if (this.mapping.firstName) {
      contactData.name.givenName = row[this.mapping.firstName];
    }
    if (this.mapping.lastName) {
      contactData.name.familyName = row[this.mapping.lastName];
    }
    if (this.mapping.middleName) {
      contactData.name.middleName = row[this.mapping.middleName];
    }
    if (this.mapping.prefix) {
      contactData.name.prefix = row[this.mapping.prefix];
    }
    if (this.mapping.suffix) {
      contactData.name.suffix = row[this.mapping.suffix];
    }

    // Handle full name if no first/last name
    if (this.mapping.fullName && !contactData.name.givenName && !contactData.name.familyName) {
      const fullName = row[this.mapping.fullName];
      const parts = this.parseFullName(fullName);
      contactData.name = { ...contactData.name, ...parts };
    }

    // Emails
    if (this.mapping.email && row[this.mapping.email]) {
      contactData.emails = [
        {
          type: 'work',
          value: row[this.mapping.email],
        },
      ];
    }

    // Phone numbers
    contactData.phoneNumbers = [];
    if (this.mapping.phone && row[this.mapping.phone]) {
      contactData.phoneNumbers.push({
        type: 'other',
        value: row[this.mapping.phone],
      });
    }
    if (this.mapping.mobile && row[this.mapping.mobile]) {
      contactData.phoneNumbers.push({
        type: 'mobile',
        value: row[this.mapping.mobile],
      });
    }
    if (this.mapping.workPhone && row[this.mapping.workPhone]) {
      contactData.phoneNumbers.push({
        type: 'work',
        value: row[this.mapping.workPhone],
      });
    }
    if (this.mapping.homePhone && row[this.mapping.homePhone]) {
      contactData.phoneNumbers.push({
        type: 'home',
        value: row[this.mapping.homePhone],
      });
    }

    // Organization
    if ((this.mapping.company && row[this.mapping.company]) || (this.mapping.jobTitle && row[this.mapping.jobTitle])) {
      contactData.organizations = [
        {
          name: this.mapping.company ? row[this.mapping.company] : undefined,
          title: this.mapping.jobTitle ? row[this.mapping.jobTitle] : undefined,
        },
      ];
    }

    // Address
    if (
      this.mapping.street ||
      this.mapping.city ||
      this.mapping.state ||
      this.mapping.zip ||
      this.mapping.country
    ) {
      const hasAddressData =
        (this.mapping.street && row[this.mapping.street]) ||
        (this.mapping.city && row[this.mapping.city]) ||
        (this.mapping.state && row[this.mapping.state]) ||
        (this.mapping.zip && row[this.mapping.zip]) ||
        (this.mapping.country && row[this.mapping.country]);

      if (hasAddressData) {
        contactData.addresses = [
          {
            type: 'work',
            street: this.mapping.street ? row[this.mapping.street] : undefined,
            city: this.mapping.city ? row[this.mapping.city] : undefined,
            region: this.mapping.state ? row[this.mapping.state] : undefined,
            postalCode: this.mapping.zip ? row[this.mapping.zip] : undefined,
            country: this.mapping.country ? row[this.mapping.country] : undefined,
          },
        ];
      }
    }

    // URLs
    if (this.mapping.website && row[this.mapping.website]) {
      contactData.urls = [
        {
          type: 'work',
          value: row[this.mapping.website],
        },
      ];
    }

    // Notes
    if (this.mapping.notes && row[this.mapping.notes]) {
      contactData.notes = row[this.mapping.notes];
    }

    // Generate a temporary ID for CSV contacts
    const tempId = this.generateTempId(row);

    // Create Contact object
    const contact: Contact = {
      contactId: tempId,
      etag: '',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      contactData,
      contactMetadata: {
        tagIds: [],
        sharedBy: [],
      },
    };

    return contact;
  }

  /**
   * Parse full name into components
   */
  private parseFullName(fullName: string): { givenName?: string; familyName?: string; middleName?: string } {
    if (!fullName) return {};

    const parts = fullName.trim().split(/\s+/);

    if (parts.length === 1) {
      return { givenName: parts[0] };
    } else if (parts.length === 2) {
      return { givenName: parts[0], familyName: parts[1] };
    } else if (parts.length >= 3) {
      return {
        givenName: parts[0],
        middleName: parts.slice(1, -1).join(' '),
        familyName: parts[parts.length - 1],
      };
    }

    return {};
  }

  /**
   * Generate temporary ID for CSV contact
   */
  private generateTempId(row: Record<string, string>): string {
    const hash = crypto.createHash('md5');
    const data = JSON.stringify(row);
    hash.update(data);
    return `csv-${hash.digest('hex').substring(0, 16)}`;
  }

  /**
   * Check if header matches any of the patterns
   */
  private matchesAny(header: string, patterns: string[]): boolean {
    return patterns.some(pattern => header === pattern || header.includes(pattern));
  }

  /**
   * Set custom mapping
   */
  setMapping(mapping: ColumnMapping): void {
    this.mapping = mapping;
  }

  /**
   * Get current mapping
   */
  getMapping(): ColumnMapping {
    return { ...this.mapping };
  }
}
