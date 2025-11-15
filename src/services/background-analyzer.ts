import { Contact } from '../types/contactsplus';
import { ContactsApi } from '../api/contacts';
import { DuplicateNameFixer } from '../tools/duplicate-name-fixer';
import { PhoneNormalizationTool } from '../tools/phone-normalization-tool';
import { CompanyNameCleaningTool } from '../tools/company-name-cleaning-tool';
import { EmailValidationTool } from '../tools/email-validation-tool';
import { getSyncQueue, SyncQueue } from '../db/sync-queue';
import { getContactStore } from '../db/contact-store';
import { logger } from '../utils/logger';
import { ToolSuggestion } from '../types/tools';
import { FieldParser } from '../utils/field-parser';
import {
  BACKGROUND_ANALYSIS_INTERVAL,
  BACKGROUND_ANALYSIS_MAX_SUGGESTIONS,
  BACKGROUND_ANALYSIS_IDLE_THRESHOLD,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from '../utils/constants';

export interface AnalysisConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxSuggestionsPerRun: number;
  enabledTools: {
    duplicateNames: boolean;
    phoneNormalization: boolean;
    companyNameCleaning: boolean;
    emailValidation: boolean;
  };
}

export interface AnalysisStats {
  lastRunTime?: string;
  totalRuns: number;
  totalSuggestionsQueued: number;
  contactsAnalyzed: number;
  isRunning: boolean;
}

export class BackgroundAnalyzer {
  private contactsApi: ContactsApi;
  private config: AnalysisConfig;
  private stats: AnalysisStats;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;
  private lastUserActivity = Date.now();
  private idleThresholdMs = BACKGROUND_ANALYSIS_IDLE_THRESHOLD; // 1 minute of idle time before running

  constructor(contactsApi: ContactsApi, config?: Partial<AnalysisConfig>) {
    this.contactsApi = contactsApi;
    this.config = {
      enabled: true,
      intervalMinutes: BACKGROUND_ANALYSIS_INTERVAL, // Run every 30 minutes when idle
      maxSuggestionsPerRun: BACKGROUND_ANALYSIS_MAX_SUGGESTIONS, // Don't overwhelm the queue
      enabledTools: {
        duplicateNames: true,
        phoneNormalization: true,
        companyNameCleaning: true,
        emailValidation: true,
      },
      ...config,
    };
    this.stats = {
      totalRuns: 0,
      totalSuggestionsQueued: 0,
      contactsAnalyzed: 0,
      isRunning: false,
    };
  }

  /**
   * Start the background analysis service
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Background analyzer already running');
      return;
    }

    logger.info('Starting background analyzer service', {
      interval: `${this.config.intervalMinutes} minutes`,
      idleThreshold: `${this.idleThresholdMs / MILLISECONDS_PER_SECOND} seconds`,
    });

    // Run immediately on start if idle
    this.checkAndRun().catch((error) => {
      logger.error('Initial background analysis failed:', error);
    });

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      this.checkAndRun().catch((error) => {
        logger.error('Periodic background analysis failed:', error);
      });
    }, this.config.intervalMinutes * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND);
  }

  /**
   * Stop the background analysis service
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('Background analyzer service stopped');
    }
  }

  /**
   * Mark user activity to prevent running during active use
   */
  markUserActivity(): void {
    this.lastUserActivity = Date.now();
  }

  /**
   * Check if system is idle and run analysis if so
   */
  private async checkAndRun(): Promise<void> {
    try {
      if (!this.config.enabled) {
        return;
      }

      if (this.isRunning) {
        logger.debug('Background analysis already in progress, skipping');
        return;
      }

      const idleTime = Date.now() - this.lastUserActivity;
      if (idleTime < this.idleThresholdMs) {
        logger.debug('System not idle yet, skipping background analysis', {
          idleTime: `${Math.floor(idleTime / MILLISECONDS_PER_SECOND)}s`,
          threshold: `${this.idleThresholdMs / MILLISECONDS_PER_SECOND}s`,
        });
        return;
      }

      await this.runAnalysis();
    } catch (error) {
      logger.error('Error in checkAndRun:', error);
    }
  }

  /**
   * Run the analysis pipeline
   */
  private async runAnalysis(): Promise<void> {
    this.isRunning = true;
    this.stats.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('Starting background contact analysis...');

      // Load contacts from local store first (faster than API)
      const contactStore = getContactStore();
      const storedContacts = contactStore.getAllContacts();

      // Convert stored contacts to Contact format
      const contacts: Contact[] = storedContacts.map((sc) => ({
        contactId: sc.contactId,
        contactData: sc.contactData,
        contactMetadata: { tagIds: [] as string[], sharedBy: [] as string[] },
        etag: '',
        created: sc.created || new Date().toISOString(),
        updated: sc.updated || new Date().toISOString(),
      }));

      if (contacts.length === 0) {
        logger.info('No contacts to analyze');
        return;
      }

      logger.info(`Analyzing ${contacts.length} contacts...`);
      this.stats.contactsAnalyzed = contacts.length;

      let totalSuggestions = 0;
      const syncQueue = getSyncQueue();

      // Run enabled tools
      if (this.config.enabledTools.duplicateNames) {
        totalSuggestions += await this.analyzeDuplicateNames(contacts, syncQueue);
        if (totalSuggestions >= this.config.maxSuggestionsPerRun) {
          logger.info('Reached max suggestions limit, stopping analysis');
          return;
        }
      }

      if (this.config.enabledTools.phoneNormalization) {
        totalSuggestions += await this.analyzePhoneNumbers(contacts, syncQueue);
        if (totalSuggestions >= this.config.maxSuggestionsPerRun) {
          logger.info('Reached max suggestions limit, stopping analysis');
          return;
        }
      }

      if (this.config.enabledTools.companyNameCleaning) {
        totalSuggestions += await this.analyzeCompanyNames(contacts, syncQueue);
        if (totalSuggestions >= this.config.maxSuggestionsPerRun) {
          logger.info('Reached max suggestions limit, stopping analysis');
          return;
        }
      }

      if (this.config.enabledTools.emailValidation) {
        totalSuggestions += await this.analyzeEmails(contacts, syncQueue);
      }

      this.stats.totalRuns++;
      this.stats.totalSuggestionsQueued += totalSuggestions;
      this.stats.lastRunTime = new Date().toISOString();

      const duration = Date.now() - startTime;
      logger.info('Background analysis complete', {
        duration: `${duration}ms`,
        suggestionsQueued: totalSuggestions,
        totalRuns: this.stats.totalRuns,
      });

    } catch (error) {
      logger.error('Background analysis failed:', error);
    } finally {
      this.isRunning = false;
      this.stats.isRunning = false;
    }
  }

  private async analyzeDuplicateNames(contacts: Contact[], syncQueue: SyncQueue): Promise<number> {
    try {
      const fixer = new DuplicateNameFixer(this.contactsApi);
      const issues = fixer.findDuplicateNames(contacts);

      if (issues.length === 0) {
        return 0;
      }

      logger.info(`Found ${issues.length} duplicate name issues`);
      let queued = 0;

      for (const issue of issues) {
        // Check if already in queue
        const existingItems = syncQueue.getQueueItems({
          syncStatus: ['pending', 'approved'],
        });

        const alreadyQueued = existingItems.some((item) => {
          if (item.contactId !== issue.contact.contactId) return false;
          if (!item.dataAfter?.name) return false;

          const queuedName = item.dataAfter.name;
          const suggestedName = issue.suggestedFix;

          return queuedName.givenName === suggestedName.givenName &&
                 queuedName.familyName === suggestedName.familyName;
        });

        if (!alreadyQueued) {
          const updatedContactData = {
            ...issue.contact.contactData,
            name: issue.suggestedFix,
          };

          syncQueue.addToQueue(
            issue.contact.contactId,
            'update',
            updatedContactData,
            issue.contact.contactData,
            'background_analysis'
          );

          queued++;
          if (queued >= this.config.maxSuggestionsPerRun) break;
        }
      }

      logger.info(`Queued ${queued} duplicate name fixes`);
      return queued;
    } catch (error) {
      logger.error('Error analyzing duplicate names:', error);
      return 0;
    }
  }

  private async analyzePhoneNumbers(contacts: Contact[], syncQueue: SyncQueue): Promise<number> {
    try {
      const tool = new PhoneNormalizationTool();
      const result = await tool.batchAnalyze(contacts);

      if (result.totalSuggestions === 0) {
        return 0;
      }

      logger.info(`Found ${result.totalSuggestions} phone normalization suggestions`);
      let queued = 0;

      for (const contactResult of result.results) {
        if (contactResult.suggestions.length === 0) continue;

        const contact = contacts.find(c => c.contactId === contactResult.contactId);
        if (!contact) continue;

        // Queue each suggestion
        for (const suggestion of contactResult.suggestions) {
          const updatedContact = this.applyToolSuggestion(contact, suggestion);

          syncQueue.addToQueue(
            contact.contactId,
            'update',
            updatedContact.contactData,
            contact.contactData,
            'background_analysis'
          );

          queued++;
          if (queued >= this.config.maxSuggestionsPerRun) return queued;
        }
      }

      logger.info(`Queued ${queued} phone normalization fixes`);
      return queued;
    } catch (error) {
      logger.error('Error analyzing phone numbers:', error);
      return 0;
    }
  }

  private async analyzeCompanyNames(contacts: Contact[], syncQueue: SyncQueue): Promise<number> {
    try {
      const tool = new CompanyNameCleaningTool();
      const result = await tool.batchAnalyze(contacts);

      if (result.totalSuggestions === 0) {
        return 0;
      }

      logger.info(`Found ${result.totalSuggestions} company name cleaning suggestions`);
      let queued = 0;

      for (const contactResult of result.results) {
        if (contactResult.suggestions.length === 0) continue;

        const contact = contacts.find(c => c.contactId === contactResult.contactId);
        if (!contact) continue;

        for (const suggestion of contactResult.suggestions) {
          const updatedContact = this.applyToolSuggestion(contact, suggestion);

          syncQueue.addToQueue(
            contact.contactId,
            'update',
            updatedContact.contactData,
            contact.contactData,
            'background_analysis'
          );

          queued++;
          if (queued >= this.config.maxSuggestionsPerRun) return queued;
        }
      }

      logger.info(`Queued ${queued} company name fixes`);
      return queued;
    } catch (error) {
      logger.error('Error analyzing company names:', error);
      return 0;
    }
  }

  private async analyzeEmails(contacts: Contact[], syncQueue: SyncQueue): Promise<number> {
    try {
      const tool = new EmailValidationTool();
      const result = await tool.batchAnalyze(contacts);

      if (result.totalSuggestions === 0) {
        return 0;
      }

      logger.info(`Found ${result.totalSuggestions} email validation suggestions`);
      let queued = 0;

      for (const contactResult of result.results) {
        if (contactResult.suggestions.length === 0) continue;

        const contact = contacts.find(c => c.contactId === contactResult.contactId);
        if (!contact) continue;

        for (const suggestion of contactResult.suggestions) {
          const updatedContact = this.applyToolSuggestion(contact, suggestion);

          syncQueue.addToQueue(
            contact.contactId,
            'update',
            updatedContact.contactData,
            contact.contactData,
            'background_analysis'
          );

          queued++;
          if (queued >= this.config.maxSuggestionsPerRun) return queued;
        }
      }

      logger.info(`Queued ${queued} email validation fixes`);
      return queued;
    } catch (error) {
      logger.error('Error analyzing emails:', error);
      return 0;
    }
  }

  private applyToolSuggestion(contact: Contact, suggestion: ToolSuggestion): Contact {
    const updatedContact = JSON.parse(JSON.stringify(contact)); // Deep clone
    FieldParser.applyFieldPath(updatedContact.contactData, suggestion.field, suggestion.suggestedValue);
    return updatedContact;
  }

  /**
   * Get current statistics
   */
  getStats(): AnalysisStats {
    return { ...this.stats };
  }

  /**
   * Get current configuration
   */
  getConfig(): AnalysisConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AnalysisConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.enabled !== undefined) {
      if (config.enabled && !this.intervalId) {
        this.start();
      } else if (!config.enabled && this.intervalId) {
        this.stop();
      }
    }

    logger.info('Background analyzer config updated', this.config);
  }
}
