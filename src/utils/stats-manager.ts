import { Contact } from '../types/contactsplus';
import { logger } from './logger';
import { getDatabase } from '../db/database';

export interface ContactStats {
  total: number;
  withEmails: number;
  withPhones: number;
  withAddresses: number;
  withOrganizations: number;
  withUrls: number;
  withNotes: number;
  withBirthdays: number;
  withPhotos: number;
  companyContacts: number;
  personalContacts: number;
}

export interface FieldStats {
  emails: {
    total: number;
    unique: number;
    domains: { [domain: string]: number };
    types: { [type: string]: number };
  };
  phones: {
    total: number;
    unique: number;
    countries: { [country: string]: number };
    types: { [type: string]: number };
    normalized: number;
    needsNormalization: number;
  };
  organizations: {
    total: number;
    unique: number;
    topCompanies: Array<{ name: string; count: number }>;
    withTitles: number;
  };
  addresses: {
    total: number;
    countries: { [country: string]: number };
    cities: { [city: string]: number };
    types: { [type: string]: number };
  };
}

export interface QualityMetrics {
  completenessScore: number; // 0-100
  duplicateScore: number; // 0-100 (lower is better)
  standardizationScore: number; // 0-100
  missingFields: {
    noEmail: number;
    noPhone: number;
    noAddress: number;
    noOrganization: number;
    incompleteNames: number;
  };
  dataIssues: {
    duplicateNames: number;
    invalidEmails: number;
    invalidPhones: number;
    emptyFields: number;
  };
}

export interface AppMetrics {
  startTime: Date;
  uptime: string;
  memoryUsage: NodeJS.MemoryUsage;
  apiCalls: {
    total: number;
    successful: number;
    failed: number;
    lastCall: Date | null;
  };
  userActions: {
    contactsViewed: number;
    searchesPerformed: number;
    toolsRun: number;
    refreshes: number;
  };
  performance: {
    avgLoadTime: number;
    avgSearchTime: number;
  };
}

export class StatsManager {
  private contacts: Contact[] = [];
  private appStartTime: Date = new Date();
  private apiCallCount = { total: 0, successful: 0, failed: 0, lastCall: null as Date | null };
  private userActions = { contactsViewed: 0, searchesPerformed: 0, toolsRun: 0, refreshes: 0 };
  private performanceMetrics = { loadTimes: [] as number[], searchTimes: [] as number[] };

  constructor() {
    logger.info('Stats manager initialized');
    this.loadPersistedStats();
  }

  /**
   * Load statistics from database on startup
   */
  private loadPersistedStats(): void {
    try {
      const db = getDatabase();

      // Load API call statistics
      const apiStats = db.queryOne<{ total: number; successful: number; failed: number }>(
        'SELECT COUNT(*) as total, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed FROM api_calls'
      );

      if (apiStats) {
        this.apiCallCount.total = apiStats.total || 0;
        this.apiCallCount.successful = apiStats.successful || 0;
        this.apiCallCount.failed = apiStats.failed || 0;
      }

      // Load last API call timestamp
      const lastCall = db.queryOne<{ timestamp: string }>(
        'SELECT timestamp FROM api_calls ORDER BY timestamp DESC LIMIT 1'
      );
      if (lastCall) {
        this.apiCallCount.lastCall = new Date(lastCall.timestamp);
      }

      // Load contact view count
      const viewCount = db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM contact_views'
      );
      if (viewCount) {
        this.userActions.contactsViewed = viewCount.count || 0;
      }

      logger.info(`Loaded persisted stats: ${this.apiCallCount.total} API calls, ${this.userActions.contactsViewed} contact views`);
    } catch (error) {
      logger.error('Failed to load persisted statistics:', error);
      // Continue with default values
    }
  }

  setContacts(contacts: Contact[]): void {
    this.contacts = contacts;
    logger.debug(`Updated contacts data for stats: ${contacts.length} contacts`);
  }

  // API call tracking
  recordApiCall(success: boolean, endpoint?: string): void {
    this.apiCallCount.total++;
    this.apiCallCount.lastCall = new Date();
    if (success) {
      this.apiCallCount.successful++;
    } else {
      this.apiCallCount.failed++;
    }

    // Persist to database
    try {
      const db = getDatabase();
      db.execute(
        'INSERT INTO api_calls (endpoint, success, timestamp) VALUES (?, ?, datetime(\'now\'))',
        [endpoint || 'unknown', success ? 1 : 0]
      );
    } catch (error) {
      logger.error('Failed to persist API call to database:', error);
    }
  }

  // User action tracking
  recordContactView(contactId?: string): void {
    this.userActions.contactsViewed++;

    // Persist to database
    try {
      const db = getDatabase();
      db.execute(
        'INSERT INTO contact_views (contact_id, timestamp) VALUES (?, datetime(\'now\'))',
        [contactId || 'unknown']
      );
    } catch (error) {
      logger.error('Failed to persist contact view to database:', error);
    }
  }

  recordSearch(): void {
    this.userActions.searchesPerformed++;
  }

  recordToolRun(): void {
    this.userActions.toolsRun++;
  }

  recordRefresh(): void {
    this.userActions.refreshes++;
  }

  // Performance tracking
  recordLoadTime(timeMs: number): void {
    this.performanceMetrics.loadTimes.push(timeMs);
    // Keep only last 100 measurements
    if (this.performanceMetrics.loadTimes.length > 100) {
      this.performanceMetrics.loadTimes.shift();
    }
  }

  recordSearchTime(timeMs: number): void {
    this.performanceMetrics.searchTimes.push(timeMs);
    if (this.performanceMetrics.searchTimes.length > 100) {
      this.performanceMetrics.searchTimes.shift();
    }
  }

  // Main stats calculation methods
  getContactStats(): ContactStats {
    if (!this.contacts.length) {
      return this.getEmptyContactStats();
    }

    return {
      total: this.contacts.length,
      withEmails: this.countContactsWithField('emails'),
      withPhones: this.countContactsWithField('phoneNumbers'),
      withAddresses: this.countContactsWithField('addresses'),
      withOrganizations: this.countContactsWithField('organizations'),
      withUrls: this.countContactsWithField('urls'),
      withNotes: this.countContactsWithNotes(),
      withBirthdays: this.countContactsWithBirthday(),
      withPhotos: this.countContactsWithPhotos(),
      companyContacts: this.countCompanyContacts(),
      personalContacts: this.contacts.length - this.countCompanyContacts(),
    };
  }

  getFieldStats(): FieldStats {
    return {
      emails: this.getEmailStats(),
      phones: this.getPhoneStats(),
      organizations: this.getOrganizationStats(),
      addresses: this.getAddressStats(),
    };
  }

  getQualityMetrics(): QualityMetrics {
    const missing = this.getMissingFieldsCount();
    const issues = this.getDataIssuesCount();
    
    return {
      completenessScore: this.calculateCompletenessScore(),
      duplicateScore: this.calculateDuplicateScore(),
      standardizationScore: this.calculateStandardizationScore(),
      missingFields: missing,
      dataIssues: issues,
    };
  }

  getAppMetrics(): AppMetrics {
    return {
      startTime: this.appStartTime,
      uptime: this.getUptime(),
      memoryUsage: process.memoryUsage(),
      apiCalls: { ...this.apiCallCount },
      userActions: { ...this.userActions },
      performance: {
        avgLoadTime: this.calculateAverage(this.performanceMetrics.loadTimes),
        avgSearchTime: this.calculateAverage(this.performanceMetrics.searchTimes),
      },
    };
  }

  // Helper methods for contact stats
  private countContactsWithField(fieldName: keyof Contact['contactData']): number {
    return this.contacts.filter(contact => {
      const field = contact.contactData?.[fieldName] as any[];
      return field && Array.isArray(field) && field.length > 0;
    }).length;
  }

  private countContactsWithNotes(): number {
    return this.contacts.filter(contact => 
      contact.contactData?.notes && contact.contactData.notes.trim().length > 0
    ).length;
  }

  private countContactsWithBirthday(): number {
    return this.contacts.filter(contact => 
      contact.contactData?.birthday && 
      (contact.contactData.birthday.month || contact.contactData.birthday.day)
    ).length;
  }

  private countContactsWithPhotos(): number {
    return this.contacts.filter(contact => {
      const photoField = (contact.contactData as any)?.photos;
      return photoField && Array.isArray(photoField) && photoField.length > 0;
    }).length;
  }

  private countCompanyContacts(): number {
    return this.contacts.filter(contact => 
      contact.contactMetadata?.companyContact === true
    ).length;
  }

  // Field statistics
  private getEmailStats() {
    const allEmails = this.contacts.flatMap(c => c.contactData?.emails || []);
    const uniqueEmails = new Set(allEmails.map(e => e.value.toLowerCase()));
    const domains: { [domain: string]: number } = {};
    const types: { [type: string]: number } = {};

    allEmails.forEach(email => {
      // Extract domain
      const domain = email.value.split('@')[1]?.toLowerCase();
      if (domain) {
        domains[domain] = (domains[domain] || 0) + 1;
      }

      // Count types
      const type = email.type || 'unknown';
      types[type] = (types[type] || 0) + 1;
    });

    return {
      total: allEmails.length,
      unique: uniqueEmails.size,
      domains,
      types,
    };
  }

  private getPhoneStats() {
    const allPhones = this.contacts.flatMap(c => c.contactData?.phoneNumbers || []);
    const uniquePhones = new Set(allPhones.map(p => p.value));
    const countries: { [country: string]: number } = {};
    const types: { [type: string]: number } = {};
    let normalized = 0;
    let needsNormalization = 0;

    allPhones.forEach(phone => {
      // Detect if normalized (starts with +)
      if (phone.value.startsWith('+')) {
        normalized++;
      } else {
        needsNormalization++;
      }

      // Extract country (rough estimation)
      if (phone.value.startsWith('+1')) {
        countries['US'] = (countries['US'] || 0) + 1;
      } else if (phone.value.startsWith('+44')) {
        countries['UK'] = (countries['UK'] || 0) + 1;
      } else if (phone.value.startsWith('+')) {
        const countryCode = phone.value.slice(1, 4);
        countries[`+${countryCode}`] = (countries[`+${countryCode}`] || 0) + 1;
      } else {
        countries['Unknown'] = (countries['Unknown'] || 0) + 1;
      }

      // Count types
      const type = phone.type || 'unknown';
      types[type] = (types[type] || 0) + 1;
    });

    return {
      total: allPhones.length,
      unique: uniquePhones.size,
      countries,
      types,
      normalized,
      needsNormalization,
    };
  }

  private getOrganizationStats() {
    const allOrgs = this.contacts.flatMap(c => c.contactData?.organizations || []);
    const uniqueOrgs = new Set(allOrgs.map(o => o.name?.toLowerCase()).filter(Boolean));
    const orgCounts: { [name: string]: number } = {};
    let withTitles = 0;

    allOrgs.forEach(org => {
      if (org.name) {
        const name = org.name.toLowerCase();
        orgCounts[name] = (orgCounts[name] || 0) + 1;
      }
      if (org.title) {
        withTitles++;
      }
    });

    const topCompanies = Object.entries(orgCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total: allOrgs.length,
      unique: uniqueOrgs.size,
      topCompanies,
      withTitles,
    };
  }

  private getAddressStats() {
    const allAddresses = this.contacts.flatMap(c => c.contactData?.addresses || []);
    const countries: { [country: string]: number } = {};
    const cities: { [city: string]: number } = {};
    const types: { [type: string]: number } = {};

    allAddresses.forEach(addr => {
      if (addr.country) {
        countries[addr.country] = (countries[addr.country] || 0) + 1;
      }
      if (addr.city) {
        cities[addr.city] = (cities[addr.city] || 0) + 1;
      }

      const type = addr.type || 'unknown';
      types[type] = (types[type] || 0) + 1;
    });

    return {
      total: allAddresses.length,
      countries,
      cities,
      types,
    };
  }

  // Quality metrics calculations
  private calculateCompletenessScore(): number {
    if (!this.contacts.length) return 0;

    let totalScore = 0;
    this.contacts.forEach(contact => {
      let score = 0;
      const data = contact.contactData;

      // Name (25 points)
      if (data?.name?.givenName || data?.name?.familyName) score += 25;

      // Email (25 points)
      if (data?.emails?.length) score += 25;

      // Phone (20 points)
      if (data?.phoneNumbers?.length) score += 20;

      // Organization (15 points)
      if (data?.organizations?.length) score += 15;

      // Address (10 points)
      if (data?.addresses?.length) score += 10;

      // Notes/additional info (5 points)
      if (data?.notes || data?.urls?.length || data?.dates?.length) score += 5;

      totalScore += score;
    });

    return Math.round(totalScore / this.contacts.length);
  }

  private calculateDuplicateScore(): number {
    // Lower is better - percentage of potential duplicates
    const names = new Set();
    const emails = new Set();
    let duplicates = 0;

    this.contacts.forEach(contact => {
      const name = this.getContactDisplayName(contact).toLowerCase();
      const email = contact.contactData?.emails?.[0]?.value?.toLowerCase();

      if (name && names.has(name)) duplicates++;
      if (email && emails.has(email)) duplicates++;

      if (name) names.add(name);
      if (email) emails.add(email);
    });

    return this.contacts.length > 0 ? Math.round((duplicates / this.contacts.length) * 100) : 0;
  }

  private calculateStandardizationScore(): number {
    if (!this.contacts.length) return 100;

    let standardizedFields = 0;
    let totalFields = 0;

    this.contacts.forEach(contact => {
      // Check phone number standardization
      contact.contactData?.phoneNumbers?.forEach(phone => {
        totalFields++;
        if (phone.value.startsWith('+')) standardizedFields++;
      });

      // Check email standardization (lowercase)
      contact.contactData?.emails?.forEach(email => {
        totalFields++;
        if (email.value === email.value.toLowerCase()) standardizedFields++;
      });
    });

    return totalFields > 0 ? Math.round((standardizedFields / totalFields) * 100) : 100;
  }

  private getMissingFieldsCount() {
    return {
      noEmail: this.contacts.filter(c => !c.contactData?.emails?.length).length,
      noPhone: this.contacts.filter(c => !c.contactData?.phoneNumbers?.length).length,
      noAddress: this.contacts.filter(c => !c.contactData?.addresses?.length).length,
      noOrganization: this.contacts.filter(c => !c.contactData?.organizations?.length).length,
      incompleteNames: this.contacts.filter(c => 
        !c.contactData?.name?.givenName && !c.contactData?.name?.familyName
      ).length,
    };
  }

  private getDataIssuesCount() {
    let duplicateNames = 0;
    let invalidEmails = 0;
    let invalidPhones = 0;
    let emptyFields = 0;

    const seenNames = new Set<string>();
    
    this.contacts.forEach(contact => {
      // Check for duplicate names
      const name = this.getContactDisplayName(contact);
      if (name !== 'Unknown Contact') {
        if (seenNames.has(name.toLowerCase())) {
          duplicateNames++;
        }
        seenNames.add(name.toLowerCase());
      }

      // Check for invalid emails
      contact.contactData?.emails?.forEach(email => {
        if (!email.value.includes('@') || !email.value.includes('.')) {
          invalidEmails++;
        }
      });

      // Check for invalid phones (very basic check)
      contact.contactData?.phoneNumbers?.forEach(phone => {
        if (phone.value.replace(/\D/g, '').length < 7) {
          invalidPhones++;
        }
      });

      // Count empty fields
      if (!contact.contactData?.name?.givenName && !contact.contactData?.name?.familyName) emptyFields++;
    });

    return {
      duplicateNames,
      invalidEmails,
      invalidPhones,
      emptyFields,
    };
  }

  // Utility methods
  private getContactDisplayName(contact: Contact): string {
    const name = contact.contactData?.name;
    if (name && (name.givenName || name.familyName)) {
      const parts = [name.prefix, name.givenName, name.middleName, name.familyName, name.suffix]
        .filter(Boolean);
      if (parts.length > 0) {
        return parts.join(' ');
      }
    }
    
    if (contact.contactData?.emails?.[0]?.value) {
      return contact.contactData.emails[0].value;
    }
    
    if (contact.contactData?.organizations?.[0]?.name) {
      return contact.contactData.organizations[0].name;
    }

    return 'Unknown Contact';
  }

  private getUptime(): string {
    const uptimeMs = Date.now() - this.appStartTime.getTime();
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return Math.round(numbers.reduce((a, b) => a + b, 0) / numbers.length);
  }

  private getEmptyContactStats(): ContactStats {
    return {
      total: 0,
      withEmails: 0,
      withPhones: 0,
      withAddresses: 0,
      withOrganizations: 0,
      withUrls: 0,
      withNotes: 0,
      withBirthdays: 0,
      withPhotos: 0,
      companyContacts: 0,
      personalContacts: 0,
    };
  }
}