#!/usr/bin/env node

import { ContactsApi } from './api/contacts';
import { Screen } from './ui/screen';
import { logger, LogLevel } from './utils/logger';
import { Contact, AccountInfo } from './types/contactsplus';

class ContactsPlusApp {
  private contactsApi: ContactsApi;
  private screen: Screen;
  private contacts: Contact[] = [];
  private accountInfo?: AccountInfo;

  constructor() {
    this.contactsApi = new ContactsApi();
    this.screen = new Screen(this.contactsApi);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.screen.on('refresh', () => {
      this.refreshData();
    });

    this.screen.on('contactsUpdated', (updatedContacts: Contact[]) => {
      this.contacts = updatedContacts;
      this.screen.updateHeader(this.accountInfo, this.contacts.length);
    });

    // Handle process termination gracefully
    process.on('SIGINT', () => {
      this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.cleanup();
      process.exit(0);
    });

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      this.cleanup();
      process.exit(1);
    });

    process.on('unhandledRejection', (error) => {
      logger.error('Unhandled rejection:', error);
      this.cleanup();
      process.exit(1);
    });
  }

  async start(): Promise<void> {
    try {
      // Set log level based on environment
      if (process.env.DEBUG) {
        logger.setLevel(LogLevel.DEBUG);
      }

      logger.info('Starting ContactsPlus CLI...');
      
      // Show loading screen
      this.screen.showLoading('Authenticating...');
      this.screen.render();
      
      // Enable UI mode to prevent console interference
      logger.setUIMode(true);

      // Load account info
      await this.loadAccountInfo();
      
      // Load contacts
      await this.loadContacts();
      
      // Focus the UI
      this.screen.focus();
      
      logger.info('Application started successfully');
    } catch (error) {
      logger.error('Failed to start application:', error);
      this.screen.showError(error instanceof Error ? error.message : 'Unknown error occurred');
    }
  }

  private async loadAccountInfo(): Promise<void> {
    try {
      this.screen.showLoading('Loading account information...');
      const startTime = Date.now();
      this.accountInfo = await this.contactsApi.getAccount();
      const loadTime = Date.now() - startTime;
      
      // Record successful API call and load time
      this.screen.recordApiCall(true);
      this.screen.recordLoadTime(loadTime);
      
      this.screen.updateHeader(this.accountInfo);
      logger.info('Account information loaded');
    } catch (error) {
      logger.error('Failed to load account information:', error);
      this.screen.recordApiCall(false);
      // Don't fail the entire app if account info fails
      this.screen.updateHeader();
    }
  }

  private async loadContacts(): Promise<void> {
    try {
      this.screen.showLoading('Loading contacts...');
      const startTime = Date.now();
      this.contacts = await this.contactsApi.getAllContacts();
      const loadTime = Date.now() - startTime;
      
      // Record successful API call and load time
      this.screen.recordApiCall(true);
      this.screen.recordLoadTime(loadTime);
      
      this.screen.setContacts(this.contacts);
      this.screen.updateHeader(this.accountInfo, this.contacts.length);
      
      logger.info(`Loaded ${this.contacts.length} contacts`);
    } catch (error) {
      logger.error('Failed to load contacts:', error);
      this.screen.recordApiCall(false);
      throw new Error('Failed to load contacts. Please check your authentication and try again.');
    }
  }

  private async refreshData(): Promise<void> {
    logger.info('Refreshing data...');
    await this.loadAccountInfo();
    await this.loadContacts();
  }

  private cleanup(): void {
    logger.setUIMode(false); // Disable UI mode to allow console output
    logger.info('Cleaning up...');
    if (this.screen) {
      this.screen.destroy();
    }
  }
}

// Handle command line arguments
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Handle help command
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
ContactsPlus CLI - Manage your contacts from the terminal

Usage:
  contactsplus [options]

Options:
  --help, -h     Show this help message
  --logout       Clear stored authentication tokens
  --debug        Enable debug logging

Keyboard shortcuts:
  ↑↓             Navigate contacts
  Enter          View contact details
  /              Search contacts
  t              Open tools menu
  s              Open statistics dashboard
  l              Open logging screen
  r              Refresh data
  q, Esc         Quit application

For more information, visit: https://contactsplus.com
`);
    process.exit(0);
  }

  // Handle logout command
  if (args.includes('--logout')) {
    try {
      const contactsApi = new ContactsApi();
      await contactsApi.logout();
      console.log('Successfully logged out. Your authentication tokens have been cleared.');
      process.exit(0);
    } catch (error) {
      console.error('Failed to logout:', error);
      process.exit(1);
    }
  }

  // Enable debug mode if requested
  if (args.includes('--debug')) {
    process.env.DEBUG = 'true';
  }

  // Start the application
  const app = new ContactsPlusApp();
  await app.start();
}

// Run the application
if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to start application:', error);
    process.exit(1);
  });
}