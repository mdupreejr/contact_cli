import { Contact } from '../types/contactsplus';
import { ContactDatabase, getDatabase } from './database';
import { generateContactHash } from './contact-hash';
import { logger } from '../utils/logger';

/**
 * Source of contact data
 */
export type ContactSource = 'api' | 'csv_import' | 'manual';

/**
 * Stored contact with metadata
 */
export interface StoredContact {
  contactId: string;
  contactData: Contact['contactData'];
  dataHash: string;
  syncedToApi: boolean;
  lastModified: string;
  source: ContactSource;
  importSessionId?: string;
  createdAt: string;
}

/**
 * Contact search filters
 */
export interface ContactSearchFilter {
  source?: ContactSource;
  syncedToApi?: boolean;
  importSessionId?: string;
  nameQuery?: string;
  emailQuery?: string;
  phoneQuery?: string;
  limit?: number;
  offset?: number;
}

/**
 * Contact Store
 * Manages local contact storage with SQLite
 */
export class ContactStore {
  private db: ContactDatabase;

  constructor(db?: ContactDatabase) {
    this.db = db || getDatabase();
  }

  /**
   * Get database instance for transactions
   */
  getDatabase(): ContactDatabase {
    return this.db;
  }

  /**
   * Save contact to local database
   */
  saveContact(
    contact: Contact,
    source: ContactSource,
    importSessionId?: string,
    syncedToApi: boolean = false
  ): string {
    const dataHash = generateContactHash(contact);

    try {
      const stmt = this.db.getConnection().prepare(`
        INSERT INTO contacts (contact_id, contact_data, data_hash, synced_to_api, source, import_session_id)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(contact_id) DO UPDATE SET
          contact_data = excluded.contact_data,
          data_hash = excluded.data_hash,
          synced_to_api = excluded.synced_to_api,
          last_modified = CURRENT_TIMESTAMP
      `);

      stmt.run(
        contact.contactId,
        JSON.stringify(contact.contactData),
        dataHash,
        syncedToApi ? 1 : 0,
        source,
        importSessionId || null
      );

      logger.debug(`Contact saved: ${contact.contactId} (source: ${source}, synced: ${syncedToApi})`);
      return dataHash;
    } catch (error) {
      logger.error('Failed to save contact:', { contactId: contact.contactId, error });
      throw new Error(`Failed to save contact: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Save multiple contacts in a transaction
   */
  saveContacts(
    contacts: Contact[],
    source: ContactSource,
    importSessionId?: string,
    syncedToApi: boolean = false
  ): number {
    return this.db.transaction(() => {
      let count = 0;
      for (const contact of contacts) {
        this.saveContact(contact, source, importSessionId, syncedToApi);
        count++;
      }
      return count;
    });
  }

  /**
   * Get contact by ID
   */
  getContact(contactId: string): Contact | null {
    try {
      const row = this.db.queryOne<{
        contact_id: string;
        contact_data: string;
      }>('SELECT contact_id, contact_data FROM contacts WHERE contact_id = ?', [contactId]);

      if (!row) {
        return null;
      }

      return {
        contactId: row.contact_id,
        contactData: JSON.parse(row.contact_data),
        contactMetadata: {
          tagIds: [] as string[],
          sharedBy: [] as string[],
        },
        etag: '',
        created: '',
        updated: '',
      };
    } catch (error) {
      logger.error('Failed to get contact:', { contactId, error });
      throw error;
    }
  }

  /**
   * Get contact by hash (for duplicate detection)
   */
  getContactByHash(dataHash: string): Contact | null {
    try {
      const row = this.db.queryOne<{
        contact_id: string;
        contact_data: string;
      }>('SELECT contact_id, contact_data FROM contacts WHERE data_hash = ?', [dataHash]);

      if (!row) {
        return null;
      }

      return {
        contactId: row.contact_id,
        contactData: JSON.parse(row.contact_data),
        contactMetadata: {
          tagIds: [] as string[],
          sharedBy: [] as string[],
        },
        etag: '',
        created: '',
        updated: '',
      };
    } catch (error) {
      logger.error('Failed to get contact by hash:', { dataHash, error });
      throw error;
    }
  }

  /**
   * Get all contacts
   */
  getAllContacts(limit?: number, offset?: number): Contact[] {
    try {
      let sql = 'SELECT contact_id, contact_data FROM contacts ORDER BY last_modified DESC';
      const params: any[] = [];

      if (limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(limit);

        if (offset !== undefined) {
          sql += ' OFFSET ?';
          params.push(offset);
        }
      }

      const rows = this.db.query<{
        contact_id: string;
        contact_data: string;
      }>(sql, params);

      return rows.map(row => ({
        contactId: row.contact_id,
        contactData: JSON.parse(row.contact_data),
        contactMetadata: {
          tagIds: [] as string[],
          sharedBy: [] as string[],
        },
        etag: '',
        created: '',
        updated: '',
      }));
    } catch (error) {
      logger.error('Failed to get all contacts:', error);
      throw error;
    }
  }

  /**
   * Search contacts with filters
   */
  searchContacts(filter: ContactSearchFilter): Contact[] {
    try {
      const conditions: string[] = [];
      const params: any[] = [];

      if (filter.source) {
        conditions.push('source = ?');
        params.push(filter.source);
      }

      if (filter.syncedToApi !== undefined) {
        conditions.push('synced_to_api = ?');
        params.push(filter.syncedToApi ? 1 : 0);
      }

      if (filter.importSessionId) {
        conditions.push('import_session_id = ?');
        params.push(filter.importSessionId);
      }

      // Text search requires JSON extraction (SQLite JSON functions)
      if (filter.nameQuery) {
        conditions.push(`(
          json_extract(contact_data, '$.name.givenName') LIKE ? ESCAPE '\\' OR
          json_extract(contact_data, '$.name.familyName') LIKE ? ESCAPE '\\'
        )`);
        const sanitizedName = this.sanitizeLikePattern(filter.nameQuery);
        const namePattern = `%${sanitizedName}%`;
        params.push(namePattern, namePattern);
      }

      if (filter.emailQuery) {
        conditions.push(`contact_data LIKE ? ESCAPE '\\'`);
        const sanitizedEmail = this.sanitizeLikePattern(filter.emailQuery);
        params.push(`%${sanitizedEmail}%`);
      }

      if (filter.phoneQuery) {
        const normalizedPhone = filter.phoneQuery.replace(/\D/g, '');
        const sanitizedPhone = this.sanitizeLikePattern(normalizedPhone);
        conditions.push(`contact_data LIKE ? ESCAPE '\\'`);
        params.push(`%${sanitizedPhone}%`);
      }

      let sql = 'SELECT contact_id, contact_data FROM contacts';

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY last_modified DESC';

      if (filter.limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(filter.limit);

        if (filter.offset !== undefined) {
          sql += ' OFFSET ?';
          params.push(filter.offset);
        }
      }

      const rows = this.db.query<{
        contact_id: string;
        contact_data: string;
      }>(sql, params);

      return rows.map(row => ({
        contactId: row.contact_id,
        contactData: JSON.parse(row.contact_data),
        contactMetadata: {
          tagIds: [] as string[],
          sharedBy: [] as string[],
        },
        etag: '',
        created: '',
        updated: '',
      }));
    } catch (error) {
      logger.error('Failed to search contacts:', { filter, error });
      throw error;
    }
  }

  /**
   * Get unsynced contacts
   */
  getUnsyncedContacts(): Contact[] {
    return this.searchContacts({ syncedToApi: false });
  }

  /**
   * Mark contact as synced
   */
  markContactSynced(contactId: string): void {
    try {
      this.db.execute(
        'UPDATE contacts SET synced_to_api = 1, last_modified = CURRENT_TIMESTAMP WHERE contact_id = ?',
        [contactId]
      );
      logger.debug(`Contact marked as synced: ${contactId}`);
    } catch (error) {
      logger.error('Failed to mark contact as synced:', { contactId, error });
      throw error;
    }
  }

  /**
   * Update contact data
   */
  updateContact(contact: Contact, syncedToApi?: boolean): string {
    const dataHash = generateContactHash(contact);

    try {
      const updateFields: string[] = [
        'contact_data = ?',
        'data_hash = ?',
        'last_modified = CURRENT_TIMESTAMP',
      ];
      const params: any[] = [
        JSON.stringify(contact.contactData),
        dataHash,
      ];

      if (syncedToApi !== undefined) {
        updateFields.push('synced_to_api = ?');
        params.push(syncedToApi ? 1 : 0);
      }

      params.push(contact.contactId);

      this.db.execute(
        `UPDATE contacts SET ${updateFields.join(', ')} WHERE contact_id = ?`,
        params
      );

      logger.debug(`Contact updated: ${contact.contactId}`);
      return dataHash;
    } catch (error) {
      logger.error('Failed to update contact:', { contactId: contact.contactId, error });
      throw error;
    }
  }

  /**
   * Delete contact
   */
  deleteContact(contactId: string): void {
    try {
      this.db.execute('DELETE FROM contacts WHERE contact_id = ?', [contactId]);
      logger.debug(`Contact deleted: ${contactId}`);
    } catch (error) {
      logger.error('Failed to delete contact:', { contactId, error });
      throw error;
    }
  }

  /**
   * Get contact metadata
   */
  getContactMetadata(contactId: string): StoredContact | null {
    try {
      const row = this.db.queryOne<{
        contact_id: string;
        contact_data: string;
        data_hash: string;
        synced_to_api: number;
        last_modified: string;
        source: string;
        import_session_id: string | null;
        created_at: string;
      }>('SELECT * FROM contacts WHERE contact_id = ?', [contactId]);

      if (!row) {
        return null;
      }

      return {
        contactId: row.contact_id,
        contactData: JSON.parse(row.contact_data),
        dataHash: row.data_hash,
        syncedToApi: row.synced_to_api === 1,
        lastModified: row.last_modified,
        source: row.source as ContactSource,
        importSessionId: row.import_session_id || undefined,
        createdAt: row.created_at,
      };
    } catch (error) {
      logger.error('Failed to get contact metadata:', { contactId, error });
      throw error;
    }
  }

  /**
   * Count contacts
   */
  countContacts(filter?: ContactSearchFilter): number {
    try {
      const conditions: string[] = [];
      const params: any[] = [];

      if (filter?.source) {
        conditions.push('source = ?');
        params.push(filter.source);
      }

      if (filter?.syncedToApi !== undefined) {
        conditions.push('synced_to_api = ?');
        params.push(filter.syncedToApi ? 1 : 0);
      }

      if (filter?.importSessionId) {
        conditions.push('import_session_id = ?');
        params.push(filter.importSessionId);
      }

      let sql = 'SELECT COUNT(*) as count FROM contacts';

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      const result = this.db.queryOne<{ count: number }>(sql, params);
      return result?.count || 0;
    } catch (error) {
      logger.error('Failed to count contacts:', { filter, error });
      throw error;
    }
  }

  /**
   * Check if contact exists
   */
  contactExists(contactId: string): boolean {
    try {
      const result = this.db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM contacts WHERE contact_id = ?',
        [contactId]
      );
      return (result?.count || 0) > 0;
    } catch (error) {
      logger.error('Failed to check contact existence:', { contactId, error });
      throw error;
    }
  }

  /**
   * Clear all contacts (use with caution!)
   */
  clearAllContacts(): number {
    try {
      const result = this.db.execute('DELETE FROM contacts');
      logger.warn(`All contacts cleared: ${result.changes} contacts deleted`);
      return result.changes;
    } catch (error) {
      logger.error('Failed to clear contacts:', error);
      throw error;
    }
  }

  /**
   * Sanitize LIKE pattern to prevent SQL wildcard injection
   * Escapes %, _, and \ characters
   */
  private sanitizeLikePattern(input: string): string {
    return input
      .replace(/\\/g, '\\\\')  // Escape backslash first
      .replace(/%/g, '\\%')    // Escape % wildcard
      .replace(/_/g, '\\_');   // Escape _ wildcard
  }
}

/**
 * Get contact store instance
 */
export function getContactStore(db?: ContactDatabase): ContactStore {
  return new ContactStore(db);
}
