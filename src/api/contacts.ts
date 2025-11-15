import { ApiClient } from './client';
import {
  ContactsResponse,
  ScrollContactsRequest,
  SearchContactsRequest,
  Contact,
  AccountInfo,
} from '../types/contactsplus';
import { logger } from '../utils/logger';

const READONLY_MODE = process.env.READONLY_MODE === 'true';
const CONTACTS_JSON_FILE = process.env.CONTACTS_JSON_FILE;

export class ContactsApi {
  private client: ApiClient;

  constructor() {
    this.client = new ApiClient();
  }

  private async loadFromJSON(path: string): Promise<Contact[]> {
    const fs = require('fs');
    logger.info(`Loading contacts from JSON file: ${path}`);
    const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
    return Array.isArray(data) ? data : [data];
  }

  async getAccount(): Promise<AccountInfo> {
    try {
      logger.info('Fetching account information', { endpoint: '/api/v1/account.get' });
      const response = await this.client.post<{ account: AccountInfo }>('/api/v1/account.get', {});
      logger.info('Account information retrieved successfully', { accountId: response.account.accountId });
      return response.account;
    } catch (error) {
      logger.error('Failed to fetch account information', { endpoint: '/api/v1/account.get', error });
      throw error;
    }
  }

  async scrollContacts(request: ScrollContactsRequest = {}): Promise<ContactsResponse> {
    try {
      logger.debug('Scrolling contacts', { endpoint: '/api/v1/contacts.scroll', size: request.size, hasCursor: !!request.scrollCursor });
      const response = await this.client.post<ContactsResponse>('/api/v1/contacts.scroll', request);
      logger.debug('Contacts retrieved', { contactCount: response.contacts.length, hasMore: !!response.cursor });

      // Debug: Log field coverage for the first contact to verify we're getting all data
      if (response.contacts.length > 0 && process.env.DEBUG) {
        const sample = response.contacts[0];
        const fieldCounts = {
          contactData_keys: Object.keys(sample.contactData || {}).length,
          metadata_keys: Object.keys(sample.contactMetadata || {}).length,
          emails: sample.contactData?.emails?.length || 0,
          phones: sample.contactData?.phoneNumbers?.length || 0,
          addresses: sample.contactData?.addresses?.length || 0,
          organizations: sample.contactData?.organizations?.length || 0,
          urls: sample.contactData?.urls?.length || 0,
          ims: sample.contactData?.ims?.length || 0,
          items: sample.contactData?.items?.length || 0,
          dates: sample.contactData?.dates?.length || 0,
          relatedPeople: sample.contactData?.relatedPeople?.length || 0,
        };
        logger.debug('Sample contact field coverage', fieldCounts);
      }

      return response;
    } catch (error) {
      logger.error('Failed to scroll contacts', { endpoint: '/api/v1/contacts.scroll', error });
      throw error;
    }
  }

  async searchContacts(request: SearchContactsRequest): Promise<ContactsResponse> {
    try {
      logger.debug('Searching contacts', { endpoint: '/api/v1/contacts.search', searchQuery: request.searchQuery });
      const response = await this.client.post<ContactsResponse>('/api/v1/contacts.search', request);
      logger.debug('Search completed', { contactCount: response.contacts.length });
      return response;
    } catch (error) {
      logger.error('Failed to search contacts', { endpoint: '/api/v1/contacts.search', searchQuery: request.searchQuery, error });
      throw error;
    }
  }

  async getAllContacts(): Promise<Contact[]> {
    // If JSON file specified, load from file instead of API
    if (CONTACTS_JSON_FILE) {
      try {
        return await this.loadFromJSON(CONTACTS_JSON_FILE);
      } catch (error) {
        logger.error('Failed to load contacts from JSON', { filePath: CONTACTS_JSON_FILE, error });
        logger.info('Falling back to API');
      }
    }

    logger.info('Starting getAllContacts operation');
    const allContacts: Contact[] = [];
    let cursor: string | undefined;

    try {
      do {
        const response = await this.scrollContacts({
          size: 100,
          scrollCursor: cursor,
        });

        allContacts.push(...response.contacts);
        cursor = response.cursor;

        logger.debug('Fetched contacts batch', { batchSize: response.contacts.length, totalSoFar: allContacts.length });
      } while (cursor);

      logger.info('getAllContacts operation completed', { totalContacts: allContacts.length });
      return allContacts;
    } catch (error) {
      logger.error('getAllContacts operation failed', { totalFetchedBeforeError: allContacts.length, error });
      throw error;
    }
  }

  async getContactsByIds(contactIds: string[], teamId?: string): Promise<Contact[]> {
    try {
      logger.debug('Fetching contacts by IDs', { endpoint: '/api/v1/contacts.get', contactCount: contactIds.length, teamId });
      const response = await this.client.post<{ contacts: Contact[] }>('/api/v1/contacts.get', {
        contactIds,
        teamId,
      });
      logger.debug('Contacts fetched by IDs', { requestedCount: contactIds.length, retrievedCount: response.contacts.length });
      return response.contacts;
    } catch (error) {
      logger.error('Failed to fetch contacts by IDs', { endpoint: '/api/v1/contacts.get', contactCount: contactIds.length, error });
      throw error;
    }
  }

  async updateContact(contact: Contact): Promise<Contact> {
    if (READONLY_MODE) {
      logger.warn('READONLY_MODE enabled - skipping API update', { contactId: contact.contactId });
      return contact;
    }

    try {
      logger.info('Updating contact', { endpoint: '/api/v1/contacts.update', contactId: contact.contactId });
      const response = await this.client.post<{ contact: Contact }>('/api/v1/contacts.update', {
        contact: {
          contactId: contact.contactId,
          etag: contact.etag,
          contactData: contact.contactData,
        },
      });
      logger.info('Contact updated successfully', { contactId: contact.contactId, newEtag: response.contact.etag });
      return response.contact;
    } catch (error) {
      logger.error('Failed to update contact', { endpoint: '/api/v1/contacts.update', contactId: contact.contactId, error });
      throw error;
    }
  }

  async createContact(contact: Contact): Promise<Contact> {
    if (READONLY_MODE) {
      logger.warn('READONLY_MODE enabled - skipping API create', { contactName: contact.contactData?.name?.givenName });
      // In readonly mode, just return the contact with a generated ID
      return {
        ...contact,
        contactId: contact.contactId || `temp-${Date.now()}`,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      };
    }

    try {
      logger.info('Creating contact', { endpoint: '/api/v1/contacts.create', contactName: contact.contactData?.name?.givenName });
      const response = await this.client.post<{ contact: Contact }>('/api/v1/contacts.create', {
        contact: {
          contactData: contact.contactData,
          contactMetadata: contact.contactMetadata,
        },
      });
      logger.info('Contact created successfully', { contactId: response.contact.contactId });
      return response.contact;
    } catch (error) {
      logger.error('Failed to create contact', { endpoint: '/api/v1/contacts.create', contactName: contact.contactData?.name?.givenName, error });
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      logger.info('Logging out');
      await this.client.logout();
      logger.info('Logout completed successfully');
    } catch (error) {
      logger.error('Failed to logout', { error });
      throw error;
    }
  }

  cleanup(): void {
    try {
      this.client.cleanup();
    } catch (error) {
      logger.error('Failed to cleanup ContactsApi', { error });
    }
  }
}