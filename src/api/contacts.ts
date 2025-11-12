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
      logger.debug('Fetching account information');
      const response = await this.client.post<{ account: AccountInfo }>('/api/v1/account.get', {});
      return response.account;
    } catch (error) {
      logger.error('Failed to fetch account information:', error);
      throw new Error('Failed to fetch account information');
    }
  }

  async scrollContacts(request: ScrollContactsRequest = {}): Promise<ContactsResponse> {
    try {
      logger.debug('Scrolling contacts', request);
      const response = await this.client.post<ContactsResponse>('/api/v1/contacts.scroll', request);
      
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
        logger.debug('Sample contact field coverage:', fieldCounts);
      }
      
      return response;
    } catch (error) {
      logger.error('Failed to scroll contacts:', error);
      throw new Error('Failed to fetch contacts');
    }
  }

  async searchContacts(request: SearchContactsRequest): Promise<ContactsResponse> {
    try {
      logger.debug('Searching contacts', request);
      const response = await this.client.post<ContactsResponse>('/api/v1/contacts.search', request);
      return response;
    } catch (error) {
      logger.error('Failed to search contacts:', error);
      throw new Error('Failed to search contacts');
    }
  }

  async getAllContacts(): Promise<Contact[]> {
    // If JSON file specified, load from file instead of API
    if (CONTACTS_JSON_FILE) {
      try {
        return await this.loadFromJSON(CONTACTS_JSON_FILE);
      } catch (error) {
        logger.error(`Failed to load contacts from JSON: ${error}`);
        logger.info('Falling back to API...');
      }
    }

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

        logger.debug(`Fetched ${response.contacts.length} contacts, total: ${allContacts.length}`);
      } while (cursor);

      logger.info(`Successfully loaded ${allContacts.length} contacts`);
      return allContacts;
    } catch (error) {
      logger.error('Failed to fetch all contacts:', error);
      throw error;
    }
  }

  async getContactsByIds(contactIds: string[], teamId?: string): Promise<Contact[]> {
    try {
      logger.debug('Fetching contacts by IDs', { contactIds, teamId });
      const response = await this.client.post<{ contacts: Contact[] }>('/api/v1/contacts.get', {
        contactIds,
        teamId,
      });
      return response.contacts;
    } catch (error) {
      logger.error('Failed to fetch contacts by IDs:', error);
      throw new Error('Failed to fetch contacts by IDs');
    }
  }

  async updateContact(contact: Contact): Promise<Contact> {
    if (READONLY_MODE) {
      logger.warn('READONLY_MODE enabled - skipping API update');
      return contact;
    }

    try {
      logger.debug('Updating contact', { contactId: contact.contactId });
      const response = await this.client.post<{ contact: Contact }>('/api/v1/contacts.update', {
        contact: {
          contactId: contact.contactId,
          etag: contact.etag,
          contactData: contact.contactData,
        },
      });
      logger.info(`Contact updated successfully: ${contact.contactId}`);
      return response.contact;
    } catch (error) {
      logger.error('Failed to update contact:', error);
      throw new Error('Failed to update contact');
    }
  }

  async logout(): Promise<void> {
    await this.client.logout();
  }
}