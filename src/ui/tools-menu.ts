import * as blessed from 'blessed';
import { Contact } from '../types/contactsplus';
import { ContactsApi } from '../api/contacts';
import { DuplicateNameFixer, DuplicateNameIssue } from '../tools/duplicate-name-fixer';
import { PhoneNormalizationTool } from '../tools/phone-normalization-tool';
import { CompanyNameCleaningTool } from '../tools/company-name-cleaning-tool';
import { EmailValidationTool } from '../tools/email-validation-tool';
import { SemanticSearchTool } from '../tools/semantic-search-tool';
import { SmartDedupeTool } from '../tools/smart-dedupe-tool';
import { toolRegistry } from '../utils/tool-registry';
import { SuggestionManager } from '../utils/suggestion-manager';
import { SuggestionViewer } from './suggestion-viewer';
import { ProgressTracker } from '../utils/progress-tracker';
import { ProgressIndicator } from './progress-indicator';
import { ToolExecutor } from '../utils/tool-executor';
import { CsvImportTool } from '../tools/csv-import-tool';
import { CsvMergeViewer, MergeDecision } from './csv-merge-viewer';
import { FileBrowser } from './file-browser';
import { SyncQueueViewer } from './sync-queue-viewer';
import { ImportHistoryViewer } from './import-history-viewer';
import { SyncSettingsViewer } from './sync-settings-viewer';
import { SyncProgressDialog } from './sync-progress-dialog';
import { CsvExportTool } from '../tools/csv-export-tool';
import { getDatabase, getContactStore, getSyncQueue, getImportHistory, getSyncEngine } from '../db';
import { getSyncConfigManager } from '../db/sync-config';
import { getToolActivityTracker } from '../db/tool-activity-tracker';
import { logger } from '../utils/logger';

export class ToolsMenu {
  private screen: blessed.Widgets.Screen;
  private contactsApi: ContactsApi;
  private contacts: Contact[];
  private toolsBox: blessed.Widgets.BoxElement;
  private toolsList: blessed.Widgets.ListElement;
  private detailBox: blessed.Widgets.BoxElement;
  private isVisible = false;
  private onContactsUpdated: (contacts: Contact[]) => void;
  private suggestionManager: SuggestionManager;
  private suggestionViewer: SuggestionViewer;
  private progressIndicator: ProgressIndicator;
  private csvMergeViewer: CsvMergeViewer;
  private fileBrowser: FileBrowser;
  private syncQueueViewer: SyncQueueViewer;
  private importHistoryViewer: ImportHistoryViewer;
  private syncSettingsViewer: SyncSettingsViewer;
  private syncProgressDialog: SyncProgressDialog;
  private csvExportTool: CsvExportTool;

  constructor(
    screen: blessed.Widgets.Screen,
    contactsApi: ContactsApi,
    onContactsUpdated: (contacts: Contact[]) => void
  ) {
    this.screen = screen;
    this.contactsApi = contactsApi;
    this.contacts = [];
    this.onContactsUpdated = onContactsUpdated;

    // Initialize suggestion system
    this.suggestionManager = new SuggestionManager(contactsApi);
    this.suggestionViewer = new SuggestionViewer(screen, this.suggestionManager);

    // Initialize progress indicator
    this.progressIndicator = new ProgressIndicator(screen);

    // Initialize CSV import components
    this.csvMergeViewer = new CsvMergeViewer(screen);
    this.fileBrowser = new FileBrowser(screen);

    // Initialize database components
    const db = getDatabase();
    const syncQueue = getSyncQueue(db);
    const contactStore = getContactStore(db);
    const importHistory = getImportHistory(db);
    const syncConfigManager = getSyncConfigManager(db);

    this.syncQueueViewer = new SyncQueueViewer(screen, syncQueue, contactStore, this.contactsApi);
    this.importHistoryViewer = new ImportHistoryViewer(screen, importHistory);
    this.syncSettingsViewer = new SyncSettingsViewer(screen, syncConfigManager);
    this.syncProgressDialog = new SyncProgressDialog(screen);
    this.csvExportTool = new CsvExportTool();

    // Register tools
    this.registerTools();

    this.createToolsUI();
  }

  private createToolsUI(): void {
    // Main tools container
    this.toolsBox = blessed.box({
      top: 'center',
      left: 'center',
      width: '90%',
      height: '80%',
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'cyan',
        },
      },
      hidden: true,
      tags: true,
      label: ' {bold}{cyan-fg}ContactsPlus Tools{/cyan-fg}{/bold} ',
    });

    // Tools list on the left
    this.toolsList = blessed.list({
      top: 1,
      left: 1,
      width: '40%',
      height: '100%-2',
      items: [
        '1. 🔧 Fix Duplicate Names',
        '2. 📞 Normalize Phone Numbers',
        '3. 📧 Fix Email Formats',
        '4. 🏢 Clean Company Names',
        '5. 📥 Import Contacts from CSV',
        '6. 📤 Export Contacts to CSV',
        '7. 📤 Sync Queue Manager',
        '8. 📜 Import History',
        '9. 🤖 AI: Semantic Search',
        '10. 🧠 AI: Smart Deduplication',
        '11. 📋 View All Available Tools',
      ],
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        selected: {
          bg: 'blue',
          fg: 'white',
        },
        border: {
          fg: 'green',
        },
      },
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      label: ' Available Tools ',
    });

    // Detail box on the right
    this.detailBox = blessed.box({
      top: 1,
      left: '40%+1',
      width: '60%-2',
      height: '100%-2',
      content: 'Select a tool to see details and run it.',
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'green',
        },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      label: ' Tool Details ',
    });

    this.toolsBox.append(this.toolsList);
    this.toolsBox.append(this.detailBox);
    this.screen.append(this.toolsBox);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.toolsList.on('select', (item: blessed.Widgets.BlessedElement, index: number) => {
      this.showToolDetails(index);
    });

    this.toolsList.key(['enter'], () => {
      const selectedIndex = (this.toolsList as any).selected || 0;
      this.runTool(selectedIndex).catch((error) => {
        logger.error('Failed to run tool:', error);
        this.showMessage('Failed to run tool', 'error');
      });
    });

    this.toolsBox.key(['escape', 'q'], () => {
      this.hide();
    });

    this.toolsList.key(['1'], () => {
      this.runTool(0).catch((error) => {
        logger.error('Failed to run tool:', error);
        this.showMessage('Failed to run tool', 'error');
      });
    });
    this.toolsList.key(['2'], () => {
      this.runTool(1).catch((error) => {
        logger.error('Failed to run tool:', error);
        this.showMessage('Failed to run tool', 'error');
      });
    });
    this.toolsList.key(['3'], () => {
      this.runTool(2).catch((error) => {
        logger.error('Failed to run tool:', error);
        this.showMessage('Failed to run tool', 'error');
      });
    });
    this.toolsList.key(['4'], () => {
      this.runTool(3).catch((error) => {
        logger.error('Failed to run tool:', error);
        this.showMessage('Failed to run tool', 'error');
      });
    });
    this.toolsList.key(['5'], () => {
      this.runTool(4).catch((error) => {
        logger.error('Failed to run tool:', error);
        this.showMessage('Failed to run tool', 'error');
      });
    });
    this.toolsList.key(['6'], () => {
      this.runTool(5).catch((error) => {
        logger.error('Failed to run tool:', error);
        this.showMessage('Failed to run tool', 'error');
      });
    });
    this.toolsList.key(['7'], () => {
      this.runTool(6).catch((error) => {
        logger.error('Failed to run tool:', error);
        this.showMessage('Failed to run tool', 'error');
      });
    });
    this.toolsList.key(['8'], () => {
      this.runTool(7).catch((error) => {
        logger.error('Failed to run tool:', error);
        this.showMessage('Failed to run tool', 'error');
      });
    });
    this.toolsList.key(['9'], () => {
      this.runTool(8).catch((error) => {
        logger.error('Failed to run tool:', error);
        this.showMessage('Failed to run tool', 'error');
      });
    });
  }

  private showToolDetails(toolIndex: number): void {
    const toolDescriptions = [
      `{bold}{yellow-fg}Fix Duplicate Names{/yellow-fg}{/bold}

This tool scans through all your contacts and identifies names with duplicate words, such as:
- "Ben Ben Ullright" → "Ben Ullright"
- "John John Smith" → "John Smith"
- "Mary Mary Jane Doe" → "Mary Jane Doe"

The tool will:
1. Scan all contacts for duplicate words in names
2. Show you each issue found
3. Suggest a fix by removing the duplicate
4. Let you choose whether to apply each fix

{green-fg}Press Enter to run this tool{/green-fg}`,

      `{bold}{yellow-fg}Normalize Phone Numbers{/yellow-fg}{/bold}

This tool intelligently normalizes phone numbers to international format:

{bold}US Numbers:{/bold}
- Only adds +1 if starts with 001, 01, 1, +1
- OR if exactly 10 digits and valid US format
- Recognizes common US area codes

{bold}International Numbers:{/bold}
- Adds + prefix if it creates a valid international number
- Supports 200+ countries via libphonenumber-js
- Maintains existing + prefixes

Examples:
- "(212) 555-1234" → "+1 212 555 1234"
- "44 20 7946 0958" → "+44 20 7946 0958"
- "91 98765 43210" → "+91 98765 43210"

{green-fg}Press Enter to run this tool{/green-fg}`,

      `{bold}{yellow-fg}Fix Email Formats{/yellow-fg}{/bold}

{red-fg}Coming Soon{/red-fg}

This tool will identify and fix common email formatting issues.`,

      `{bold}{yellow-fg}Clean Company Names{/yellow-fg}{/bold}

This tool standardizes company names by removing common suffixes:

{bold}Examples:{/bold}
- "Acme Inc." → "Acme"
- "Microsoft Corporation" → "Microsoft"
- "Deutsche Bank GmbH" → "Deutsche Bank"
- "Smith & Co Ltd" → "Smith"

The tool will:
1. Scan all companies in organization fields
2. Identify and remove common suffixes (Inc, Corp, Ltd, GmbH, etc.)
3. Preserve original capitalization style
4. Let you review and apply each suggestion

{green-fg}Press Enter to run this tool{/green-fg}`,

      `{bold}{yellow-fg}Import Contacts from CSV{/yellow-fg}{/bold}

Import contacts from CSV files with intelligent duplicate detection and merge suggestions.

{bold}Features:{/bold}
- Auto-detects column mapping (name, email, phone, company, etc.)
- Finds similar contacts using smart matching algorithm
- Shows side-by-side comparison before merging
- Lets you approve/reject each merge individually
- Safely adds new contacts that don't match existing ones

{bold}Similarity Scoring:{/bold}
- Name similarity: 35% (Jaro-Winkler)
- Email match: 30%
- Phone match: 20%
- Company similarity: 15%

{bold}Supported Fields:{/bold}
- Names (first, last, middle, full)
- Emails, phones (mobile, work, home)
- Company, job title
- Address (street, city, state, zip, country)
- Notes, website, birthday

{green-fg}Press Enter to select CSV file{/green-fg}`,

      `{bold}{yellow-fg}Export Contacts to CSV{/yellow-fg}{/bold}

Export your contacts to a CSV file for backup or use in other applications.

{bold}Features:{/bold}
- Exports all contact fields
- Includes names, emails, phones, companies
- Includes addresses and custom fields
- Creates timestamped export file

{bold}Export Location:{/bold}
- Saved to exports/ directory
- Filename includes timestamp for versioning
- Compatible with Excel, Google Sheets, etc.

{green-fg}Press Enter to export contacts{/green-fg}`,

      `{bold}{yellow-fg}Sync Queue Manager{/yellow-fg}{/bold}

Review and approve changes before syncing to ContactsPlus API.

{bold}Features:{/bold}
- Review all pending changes
- See before/after comparison
- Approve or reject individual changes
- Bulk operations with multi-select
- See which ML tool suggested each change

{bold}Keyboard Shortcuts:{/bold}
- a: Approve selected item
- r: Reject selected item
- Space: Toggle multi-select
- s: Sync all approved items to API
- d: Delete selected item

{bold}Status Indicators:{/bold}
- Pending: Waiting for approval
- Approved: Ready to sync
- Syncing: Currently syncing
- Synced: Successfully synced
- Failed: Sync failed (can retry)

{green-fg}Press Enter to open queue manager{/green-fg}`,

      `{bold}{yellow-fg}Import History{/yellow-fg}{/bold}

View and manage your contact import history.

{bold}Features:{/bold}
- See all import sessions
- Track ML tool analysis runs
- View item counts and success rates
- Delete old import sessions
- See timestamps and sources

{bold}Import Types:{/bold}
- CSV imports
- Manual edits
- ML tool suggestions
- Background analysis

{green-fg}Press Enter to view import history{/green-fg}`,

      `{bold}{yellow-fg}AI: Semantic Search{/yellow-fg}{/bold}

Uses machine learning embeddings to search contacts by meaning, not just keywords.

{bold}How it works:{/bold}
- Powered by Transformers.js (MiniLM-L6-v2 model)
- Generates 384-dimensional vector embeddings
- Finds contacts based on semantic similarity

{bold}Examples:{/bold}
- "software engineer in SF" finds developers in San Francisco
- "doctors" finds people with medical titles
- "worked at tech companies" finds tech employees

{green-fg}Note: Requires initial indexing of contacts{/green-fg}`,

      `{bold}{yellow-fg}AI: Smart Deduplication{/yellow-fg}{/bold}

ML-powered duplicate detection using advanced similarity scoring.

{bold}Features:{/bold}
- Jaro-Winkler string similarity
- Multi-field feature matching (name, email, phone, company, city)
- Logistic regression scoring model
- Blocking candidates to reduce comparisons

{bold}Scoring criteria:{/bold}
- Name similarity: 35%
- Email match: 30%
- Phone match: 20%
- Company/city: 15%

{green-fg}Press Enter to find potential duplicates{/green-fg}`,

      `{bold}{yellow-fg}View All Available Tools{/yellow-fg}{/bold}

Shows all registered tools in the system with their status:

{bold}Available Tools:{/bold}
${this.getRegisteredToolsList()}

{bold}Tool Selection:{/bold}
- View tool details and configurations
- Enable/disable individual tools
- Set execution order and dependencies

{green-fg}Press Enter to view tool registry{/green-fg}`,
    ];

    this.detailBox.setContent(toolDescriptions[toolIndex] || 'Tool details not available.');
    this.screen.render();
  }

  private async runTool(toolIndex: number): Promise<void> {
    switch (toolIndex) {
      case 0:
        await this.runDuplicateNameFixer();
        break;
      case 1:
        await this.runPhoneNormalizationTool();
        break;
      case 2:
        await this.runEmailValidationTool();
        break;
      case 3:
        await this.runCompanyNameCleaningTool();
        break;
      case 4:
        await this.runCsvImport();
        break;
      case 5:
        await this.runCsvExport();
        break;
      case 6:
        await this.showSyncQueue();
        break;
      case 7:
        await this.showImportHistory();
        break;
      case 8:
        this.showMessage('Semantic search feature coming soon to UI!', 'info');
        break;
      case 9:
        await this.runSmartDedupeTool();
        break;
      case 10:
        await this.showToolRegistry();
        break;
      default:
        this.showMessage('This tool is not yet implemented. Coming soon!', 'info');
        break;
    }
  }

  private async runDuplicateNameFixer(): Promise<void> {
    try {
      // Initialize scrollable log
      this.detailBox.setContent('');
      this.appendToLog('Starting Duplicate Name Analysis', 'info');
      this.appendToLog(`Analyzing ${this.contacts.length} contacts...`, 'info');
      this.appendToLog('='.repeat(60), 'info');

      const fixer = new DuplicateNameFixer(this.contactsApi);
      const issues = fixer.findDuplicateNames(this.contacts, (current, total, message) => {
        this.appendToLog(`[${current}/${total}] ${message}`, 'info');
      });

      this.appendToLog('='.repeat(60), 'info');
      this.appendToLog(`Analysis complete: Found ${issues.length} contacts with duplicate names`, 'success');

      if (issues.length === 0) {
        this.appendToLog('Great! No duplicate names found in your contacts.', 'success');
        setTimeout(() => {
          this.showMessage('Great! No duplicate names found in your contacts.', 'success');
        }, 1500);
        return;
      }

      // Show issues and let user fix them one by one
      setTimeout(() => {
        this.processDuplicateNameIssues(fixer, issues);
      }, 1500);

    } catch (error) {
      logger.error('Error running duplicate name fixer:', error);
      this.appendToLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private async processDuplicateNameIssues(fixer: DuplicateNameFixer, issues: DuplicateNameIssue[]): Promise<void> {
    let queuedCount = 0;
    let skippedCount = 0;
    const syncQueue = getSyncQueue();
    const contactStore = getContactStore();

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      const summary = fixer.getIssueSummary(issue);

      const choice = await this.showConfirmDialog(
        `Fix Duplicate Name (${i + 1}/${issues.length})`,
        `Contact: ${fixer.formatNameForDisplay(issue.contact.contactData.name || {})}\n\n${summary}\n\nQueue this fix for approval?`,
        ['Yes, queue it', 'Skip this one', 'Cancel tool']
      );

      if (choice === 0) { // Yes, queue it
        try {
          // Check if this exact change is already in the queue
          const existingQueueItems = syncQueue.getQueueItems({
            syncStatus: ['pending', 'approved'],
          });

          const alreadyQueued = existingQueueItems.some(item => {
            if (item.contactId !== issue.contact.contactId) return false;
            if (!item.dataAfter?.name) return false;

            // Check if the queued change matches the suggested fix
            const queuedName = item.dataAfter.name;
            const suggestedName = issue.suggestedFix;

            return queuedName.givenName === suggestedName.givenName &&
                   queuedName.familyName === suggestedName.familyName &&
                   queuedName.middleName === suggestedName.middleName &&
                   queuedName.prefix === suggestedName.prefix &&
                   queuedName.suffix === suggestedName.suffix;
          });

          if (alreadyQueued) {
            this.showMessage(`Contact ${i + 1}/${issues.length} already queued, skipping...`, 'info');
            skippedCount++;
            continue;
          }

          // Queue the change instead of applying directly
          const updatedContactData = {
            ...issue.contact.contactData,
            name: issue.suggestedFix,
          };

          syncQueue.addToQueue(
            issue.contact.contactId,
            'update',
            updatedContactData,
            issue.contact.contactData,
            undefined
          );

          // Update local contact store
          contactStore.saveContact(
            {
              ...issue.contact,
              contactData: updatedContactData,
            },
            'manual',
            undefined,
            false // Not synced to API yet
          );

          queuedCount++;
        } catch (error) {
          logger.error(`Failed to queue fix for contact ${i + 1}:`, error);
          this.showMessage(`Failed to queue contact ${i + 1}. Continuing with next...`, 'error');
          skippedCount++;
        }
      } else if (choice === 1) { // Skip this one
        skippedCount++;
      } else { // Cancel tool
        break;
      }
    }

    // Show final summary
    const message = `Duplicate Name Fixer Complete!\n\nQueued: ${queuedCount} contacts\nSkipped: ${skippedCount} contacts\n\nGo to Sync Queue Manager to review and sync changes.`;
    this.showMessage(message, 'success');

    // Track tool activity
    const activityTracker = getToolActivityTracker();
    await activityTracker.recordToolExecution('Duplicate Name Fixer', issues.length, queuedCount);

    // Notify parent component about updated contacts
    if (queuedCount > 0) {
      this.onContactsUpdated(this.contacts);
    }
  }

  /**
   * Append a line to the detail box log with auto-scroll and size limits
   */
  private appendToLog(message: string, type: 'info' | 'success' | 'error'): void {
    const MAX_LOG_LINES = 1000; // Prevent memory leaks from unbounded log growth

    const colors = {
      info: 'cyan',
      success: 'green',
      error: 'red',
    };

    const color = colors[type];
    const currentContent = this.detailBox.getContent();
    let lines = currentContent ? currentContent.split('\n') : [];

    lines.push(`{${color}-fg}${message}{/${color}-fg}`);

    // Keep only last MAX_LOG_LINES to prevent memory leaks
    if (lines.length > MAX_LOG_LINES) {
      lines = lines.slice(-MAX_LOG_LINES);
    }

    this.detailBox.setContent(lines.join('\n'));
    this.detailBox.setScrollPerc(100); // Auto-scroll to bottom
    this.screen.render();
  }

  private showMessage(message: string, type: 'info' | 'success' | 'error'): void {
    const colors = {
      info: 'cyan',
      success: 'green',
      error: 'red',
    };

    const messageBox = blessed.box({
      top: 'center',
      left: 'center',
      width: 60,
      height: 8,
      content: `{center}{bold}{${colors[type]}-fg}${message}{/${colors[type]}-fg}{/bold}{/center}`,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: colors[type],
        },
      },
      tags: true,
    });

    this.screen.append(messageBox);
    messageBox.focus();
    
    messageBox.key(['escape', 'enter', 'space'], () => {
      this.screen.remove(messageBox);
      this.toolsList.focus();
      this.screen.render();
    });
    
    this.screen.render();

    // Auto-close after 3 seconds for info messages
    if (type === 'info') {
      setTimeout(() => {
        if (messageBox.parent) {
          this.screen.remove(messageBox);
          this.screen.render();
        }
      }, 3000);
    }
  }

  private showConfirmDialog(title: string, message: string, options: string[]): Promise<number> {
    return new Promise((resolve) => {
      const dialog = blessed.box({
        top: 'center',
        left: 'center',
        width: 70,
        height: 15,
        border: {
          type: 'line',
        },
        style: {
          fg: 'white',
          bg: 'black',
          border: {
            fg: 'yellow',
          },
        },
        tags: true,
        label: ` ${title} `,
      });

      const messageBox = blessed.box({
        top: 1,
        left: 1,
        width: '100%-2',
        height: '100%-5',
        content: message,
        tags: true,
        scrollable: true,
      });

      const buttonList = blessed.list({
        bottom: 1,
        left: 1,
        width: '100%-2',
        height: 3,
        items: options,
        style: {
          selected: {
            bg: 'blue',
            fg: 'white',
          },
        },
        keys: true,
        vi: true,
      });

      dialog.append(messageBox);
      dialog.append(buttonList);
      this.screen.append(dialog);
      
      buttonList.focus();
      this.screen.render();

      const cleanup = (result: number) => {
        this.screen.remove(dialog);
        this.toolsList.focus();
        this.screen.render();
        resolve(result);
      };

      buttonList.on('select', (item: blessed.Widgets.BlessedElement, index: number) => {
        cleanup(index);
      });

      buttonList.key(['escape'], () => cleanup(options.length - 1));
      buttonList.key(['1'], () => cleanup(0));
      buttonList.key(['2'], () => cleanup(1));
      buttonList.key(['3'], () => cleanup(2));
    });
  }

  show(contacts: Contact[]): void {
    this.contacts = contacts;
    this.isVisible = true;
    this.toolsBox.show();
    this.toolsList.focus();
    this.toolsList.select(0);
    this.showToolDetails(0);
    this.screen.render();
  }

  hide(): void {
    this.isVisible = false;
    this.toolsBox.hide();
    this.screen.render();
  }

  isShowing(): boolean {
    return this.isVisible;
  }

  getSyncQueueViewer(): SyncQueueViewer {
    return this.syncQueueViewer;
  }

  private registerTools(): void {
    // Register duplicate name fixer (existing)
    // Note: DuplicateNameFixer would need to be converted to extend BaseTool

    // Register phone normalization tool
    const phoneNormalizationTool = new PhoneNormalizationTool();
    toolRegistry.registerTool(phoneNormalizationTool, {
      enabled: true,
      dependencies: [],
      priority: 10,
    });

    // Register company name cleaning tool
    const companyNameCleaningTool = new CompanyNameCleaningTool();
    toolRegistry.registerTool(companyNameCleaningTool, {
      enabled: true,
      dependencies: [],
      priority: 8,
    });

    const emailValidationTool = new EmailValidationTool();
    toolRegistry.registerTool(emailValidationTool, {
      enabled: true,
      dependencies: [],
      priority: 7,
    });

    const semanticSearchTool = new SemanticSearchTool();
    toolRegistry.registerTool(semanticSearchTool, {
      enabled: true,
      dependencies: [],
      priority: 10,
    });

    const smartDedupeTool = new SmartDedupeTool();
    toolRegistry.registerTool(smartDedupeTool, {
      enabled: true,
      dependencies: [],
      priority: 11,
    });

    logger.info('Registered tools with tool registry');
  }

  private getRegisteredToolsList(): string {
    const tools = toolRegistry.getAllTools();
    if (tools.length === 0) {
      return '  {gray-fg}No tools registered{/gray-fg}';
    }

    return tools.map(registration => {
      const status = registration.enabled ? '{green-fg}✓{/green-fg}' : '{red-fg}✗{/red-fg}';
      const selected = registration.selected ? '{blue-fg}[SELECTED]{/blue-fg}' : '';
      return `  ${status} ${registration.tool.name} ${selected}`;
    }).join('\n');
  }

  private async runPhoneNormalizationTool(): Promise<void> {
    try {
      const phoneNormalizationTool = toolRegistry.getTool('Phone Number Normalization');
      if (!phoneNormalizationTool) {
        this.showMessage('Phone normalization tool not found in registry', 'error');
        return;
      }

      // Initialize scrollable log
      this.detailBox.setContent('');
      this.appendToLog('Starting Phone Number Normalization', 'info');
      this.appendToLog(`Analyzing ${this.contacts.length} contacts...`, 'info');
      this.appendToLog('='.repeat(60), 'info');

      // Use ToolExecutor for standardized execution
      const result = await ToolExecutor.runTool(phoneNormalizationTool, this.contacts, {
        sessionIdPrefix: 'phone_normalization',
        onProgress: (current, total, message) => {
          if (current % 100 === 0 || current === total) {
            this.appendToLog(`[${current}/${total}] ${message} ${((current / total) * 100).toFixed(1)}%`, 'info');
          }
        },
      });

      this.appendToLog('='.repeat(60), 'info');
      this.appendToLog(`Analysis complete: Found ${result.suggestions} phone numbers to normalize`, 'success');

      if (result.suggestions === 0) {
        this.appendToLog('Great! All phone numbers are already properly formatted.', 'success');
        setTimeout(() => {
          this.showMessage('Great! All phone numbers are already properly formatted.', 'success');
        }, 1500);
        return;
      }

      this.appendToLog(`Queued ${result.queued} phone number updates to sync queue`, 'success');
      this.appendToLog('Go to Sync Queue Manager (option 7) to review and approve changes', 'info');

    } catch (error) {
      logger.error('Error running phone normalization tool:', error);
      this.appendToLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private async runCompanyNameCleaningTool(): Promise<void> {
    try {
      const companyNameCleaningTool = toolRegistry.getTool('Company Name Cleaning');
      if (!companyNameCleaningTool) {
        this.showMessage('Company name cleaning tool not found in registry', 'error');
        return;
      }

      // Initialize scrollable log
      this.detailBox.setContent('');
      this.appendToLog('Starting Company Name Cleaning', 'info');
      this.appendToLog(`Analyzing ${this.contacts.length} contacts...`, 'info');
      this.appendToLog('='.repeat(60), 'info');

      // Use ToolExecutor for standardized execution
      const result = await ToolExecutor.runTool(companyNameCleaningTool, this.contacts, {
        sessionIdPrefix: 'company_cleaning',
        onProgress: (current, total, message) => {
          if (current % 100 === 0 || current === total) {
            this.appendToLog(`[${current}/${total}] ${message} ${((current / total) * 100).toFixed(1)}%`, 'info');
          }
        },
      });

      this.appendToLog('='.repeat(60), 'info');
      this.appendToLog(`Analysis complete: Found ${result.suggestions} company names to clean`, 'success');

      if (result.suggestions === 0) {
        this.appendToLog('Great! All company names are already properly formatted.', 'success');
        setTimeout(() => {
          this.showMessage('Great! All company names are already properly formatted.', 'success');
        }, 1500);
        return;
      }

      this.appendToLog(`Queued ${result.queued} company name updates to sync queue`, 'success');
      this.appendToLog('Go to Sync Queue Manager (option 7) to review and approve changes', 'info');

      setTimeout(() => {
        this.showMessage(`Queued ${result.queued} company name updates.\n\nGo to Sync Queue Manager to review and approve.`, 'success');
      }, 1500);
    } catch (error) {
      logger.error('Error running company name cleaning tool:', error);
      this.appendToLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private async runEmailValidationTool(): Promise<void> {
    try {
      const emailValidationTool = toolRegistry.getTool('Email Validation');
      if (!emailValidationTool) {
        this.showMessage('Email validation tool not found in registry', 'error');
        return;
      }

      // Initialize scrollable log
      this.detailBox.setContent('');
      this.appendToLog('Starting Email Validation', 'info');
      this.appendToLog(`Analyzing ${this.contacts.length} contacts...`, 'info');
      this.appendToLog('='.repeat(60), 'info');

      // Use ToolExecutor for standardized execution
      const result = await ToolExecutor.runTool(emailValidationTool, this.contacts, {
        sessionIdPrefix: 'email_validation',
        onProgress: (current, total, message) => {
          if (current % 100 === 0 || current === total) {
            this.appendToLog(`[${current}/${total}] ${message} ${((current / total) * 100).toFixed(1)}%`, 'info');
          }
        },
      });

      this.appendToLog('='.repeat(60), 'info');
      this.appendToLog(`Analysis complete: Found ${result.suggestions} email issues`, 'success');

      if (result.suggestions === 0) {
        this.appendToLog('Great! All email addresses are valid.', 'success');
        setTimeout(() => {
          this.showMessage('Great! All email addresses are valid.', 'success');
        }, 1500);
        return;
      }

      this.appendToLog(`Queued ${result.queued} email updates to sync queue`, 'success');
      this.appendToLog('Go to Sync Queue Manager (option 7) to review and approve changes', 'info');

    } catch (error) {
      logger.error('Error running email validation tool:', error);
      this.appendToLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private async runSmartDedupeTool(): Promise<void> {
    try {
      const smartDedupeTool = toolRegistry.getTool('Smart Deduplication');
      if (!smartDedupeTool) {
        this.showMessage('Smart deduplication tool not found in registry', 'error');
        return;
      }

      // Initialize scrollable log
      this.detailBox.setContent('');
      this.appendToLog('Starting AI Smart Deduplication', 'info');
      this.appendToLog(`Analyzing ${this.contacts.length} contacts...`, 'info');
      this.appendToLog('='.repeat(60), 'info');

      // Run batch analysis
      const result = await smartDedupeTool.batchAnalyze(this.contacts);

      this.appendToLog('='.repeat(60), 'info');
      this.appendToLog(`Analysis complete: Found ${result.totalSuggestions} potential duplicates`, 'success');

      if (result.totalSuggestions === 0) {
        this.appendToLog('Great! No duplicate contacts detected.', 'success');
        setTimeout(() => {
          this.showMessage('Great! No duplicate contacts detected.', 'success');
        }, 1500);
        return;
      }

      // Show the duplicate pairs found
      this.appendToLog(`\nFound ${result.totalSuggestions} potential duplicate pairs:`, 'success');
      this.appendToLog('', 'info');

      // Display each duplicate pair
      if (result.results && result.results.length > 0) {
        for (let i = 0; i < result.results.length && i < 20; i++) {
          const contactResult = result.results[i];
          if (contactResult.suggestions && contactResult.suggestions.length > 0) {
            const suggestion = contactResult.suggestions[0];
            const contact1 = this.contacts.find(c => c.contactId === contactResult.contactId);
            const contact1Name = contact1?.contactData?.name
              ? [contact1.contactData.name.givenName, contact1.contactData.name.familyName].filter(Boolean).join(' ')
              : contact1?.contactData?.emails?.[0]?.value || 'Unknown';

            this.appendToLog(`${i + 1}. ${contact1Name} might be duplicate`, 'info');
          }
        }

        if (result.results.length > 20) {
          this.appendToLog(`... and ${result.results.length - 20} more`, 'info');
        }
      }

      this.appendToLog('', 'info');
      this.appendToLog('Note: Duplicate merging requires manual review.', 'info');
      this.appendToLog('This feature will be enhanced to allow selecting which contact to keep.', 'info');

      // Track tool activity
      const activityTracker = getToolActivityTracker();
      await activityTracker.recordToolExecution('AI Smart Deduplication', result.totalSuggestions, 0);

      // Keep message visible - user must press a key to continue
      this.showMessage(`Found ${result.totalSuggestions} potential duplicates.\n\nSee details in the window.\n\nDuplicate merging requires manual review (coming soon).`, 'info');
    } catch (error) {
      logger.error('Error running smart deduplication tool:', error);
      this.appendToLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }

  private async showToolRegistry(): Promise<void> {
    const tools = toolRegistry.getAllTools();
    const stats = toolRegistry.getStatistics();

    let content = `{bold}{cyan-fg}Tool Registry{/cyan-fg}{/bold}\n\n`;
    content += `{bold}Statistics:{/bold}\n`;
    content += `  Total Tools: ${stats.totalTools}\n`;
    content += `  Enabled: ${stats.enabledTools}\n`;
    content += `  Selected: ${stats.selectedTools}\n\n`;

    content += `{bold}Available Tools:{/bold}\n`;
    if (tools.length === 0) {
      content += `  {gray-fg}No tools registered{/gray-fg}\n`;
    } else {
      tools.forEach(registration => {
        const status = registration.enabled ? '{green-fg}✓{/green-fg}' : '{red-fg}✗{/red-fg}';
        const selected = registration.selected ? '{blue-fg} [SELECTED]{/blue-fg}' : '';
        content += `  ${status} {bold}${registration.tool.name}{/bold}${selected}\n`;
        content += `     Category: ${registration.tool.category}\n`;
        content += `     Version: ${registration.tool.version}\n`;
        content += `     Priority: ${registration.priority}\n`;
        if (registration.dependencies.length > 0) {
          content += `     Dependencies: ${registration.dependencies.join(', ')}\n`;
        }
        content += `     ${registration.tool.description}\n\n`;
      });
    }

    content += `\n{bold}Execution Order:{/bold}\n`;
    const executionOrder = toolRegistry.getExecutionOrder();
    if (executionOrder.length === 0) {
      content += `  {gray-fg}No tools in execution order{/gray-fg}`;
    } else {
      executionOrder.forEach((toolName, index) => {
        content += `  ${index + 1}. ${toolName}\n`;
      });
    }

    this.detailBox.setContent(content);
    this.screen.render();
  }

  private async runCsvImport(): Promise<void> {
    try {
      this.hide();

      // Browse for CSV file
      const csvFilePath = await this.fileBrowser.browse(['.csv']);

      if (!csvFilePath) {
        this.showMessage('CSV import cancelled', 'info');
        return;
      }

      this.showMessage(`Importing contacts from ${csvFilePath}...`, 'info');
      logger.info(`Starting CSV import from: ${csvFilePath}`);

      // Import CSV
      const csvImportTool = new CsvImportTool();
      const importResult = await csvImportTool.importCsv(csvFilePath, this.contacts);

      if (importResult.errors.length > 0) {
        logger.error('CSV import errors:', importResult.errors);
        this.showMessage(`CSV import had errors:\n${importResult.errors.join('\n')}`, 'error');
        return;
      }

      logger.info(
        `CSV import results: ${importResult.parsedContacts.length} parsed, ${importResult.matchedContacts.length} matches, ${importResult.newContacts.length} new`
      );

      // If there are no matches, just queue all as new contacts
      if (importResult.matchedContacts.length === 0) {
        const choice = await this.showConfirmDialog(
          'No Duplicates Found',
          `Found ${importResult.newContacts.length} new contacts with no duplicates.\n\nQueue all contacts for import?`,
          ['Yes, queue all', 'Cancel']
        );

        if (choice === 0) {
          const syncQueue = getSyncQueue();
          const contactStore = getContactStore();
          const importSession = `csv_import_${Date.now()}`;

          const queued = await this.queueNewContacts(importResult.newContacts, importSession);
          this.showMessage(
            `Queued ${queued} contacts for import!\n\nGo to Sync Queue Manager to review and sync.`,
            'success'
          );
        } else {
          this.showMessage('CSV import cancelled', 'info');
        }
        return;
      }

      // Show merge viewer for matches (Stage 1: Review)
      this.csvMergeViewer.show(importResult.matchedContacts, async (decisions: MergeDecision[]) => {
        if (decisions.length === 0) {
          this.showMessage('CSV import cancelled', 'info');
          return;
        }

        // Stage 2: Show confirmation dialog with summary before syncing
        const mergeCount = decisions.filter(d => d.action === 'merge').length;
        const newFromMatchCount = decisions.filter(d => d.action === 'new').length;
        const skipCount = decisions.filter(d => d.action === 'skip').length;
        const totalNewContacts = importResult.newContacts.length + newFromMatchCount;

        const confirmMessage = [
          'Ready to queue changes for review?',
          '',
          'Summary of changes:',
          `  • ${mergeCount} contacts will be merged (updated)`,
          `  • ${totalNewContacts} new contacts will be created`,
          `  • ${skipCount} contacts will be skipped`,
          '',
          'Changes will be added to sync queue for your review.',
          'Continue?'
        ].join('\n');

        const confirmed = await this.showConfirmDialog(
          'Confirm CSV Import',
          confirmMessage,
          ['Yes, queue changes', 'Cancel']
        );

        if (confirmed !== 0) {
          this.showMessage('CSV import cancelled - no changes made', 'info');
          return;
        }

        // User confirmed - now queue the changes
        try {
          this.showMessage('Queuing changes for review...', 'info');

          // Process decisions - queue them instead of syncing directly
          const syncQueue = getSyncQueue();
          const contactStore = getContactStore();
          const importSession = `csv_import_${Date.now()}`;

          let queuedMerges = 0;
          let queuedNewFromMatch = 0;

          for (const decision of decisions) {
            if (decision.action === 'merge' && decision.match.mergedContact) {
              try {
                // Queue the merge operation
                syncQueue.addToQueue(
                  decision.match.existingContact.contactId,
                  'update',
                  decision.match.mergedContact.contactData,
                  decision.match.existingContact.contactData,
                  importSession
                );

                // Update local contact store
                contactStore.saveContact(
                  decision.match.mergedContact,
                  'csv_import',
                  importSession,
                  false // Not synced yet
                );

                queuedMerges++;
                logger.info(`Queued merge for contact ${decision.match.existingContact.contactId}`);
              } catch (error) {
                logger.error(`Failed to queue merge for ${decision.match.existingContact.contactId}:`, error);
              }
            } else if (decision.action === 'new') {
              try {
                // Queue new contact creation
                syncQueue.addToQueue(
                  decision.match.csvContact.contactId || `temp-${Date.now()}-${queuedNewFromMatch}`,
                  'create',
                  decision.match.csvContact.contactData,
                  undefined,
                  importSession
                );

                // Save to local store
                contactStore.saveContact(
                  decision.match.csvContact,
                  'csv_import',
                  importSession,
                  false // Not synced yet
                );

                queuedNewFromMatch++;
                logger.info(`Queued new contact from CSV match`);
              } catch (error) {
                logger.error(`Failed to queue new contact:`, error);
              }
            }
            // If 'skip', just ignore this CSV contact
          }

          // Queue remaining new contacts (those that didn't match)
          const queuedRemainingNew = await this.queueNewContacts(importResult.newContacts, importSession);

          // Show summary
          const summaryLines = [
            'CSV Import Queued!',
            '',
            `Queued merges: ${queuedMerges} contacts`,
            `Queued new from matches: ${queuedNewFromMatch} contacts`,
            `Queued new contacts: ${queuedRemainingNew} contacts`,
            `Skipped: ${decisions.filter(d => d.action === 'skip').length} contacts`,
            '',
            'Go to Sync Queue Manager to review and sync changes.'
          ];

          const message = summaryLines.join('\n');

          this.showMessage(message, 'success');

          // Notify parent component
          this.onContactsUpdated(this.contacts);

        } catch (error) {
          logger.error('Error processing CSV import decisions:', error);
          this.showMessage('Error processing CSV import. Check logs for details.', 'error');
        }
      });

    } catch (error) {
      logger.error('Error running CSV import:', error);
      this.showMessage(
        error instanceof Error ? error.message : 'An error occurred during CSV import',
        'error'
      );
    }
  }

  private async queueNewContacts(newContacts: Contact[], importSession: string): Promise<number> {
    const syncQueue = getSyncQueue();
    const contactStore = getContactStore();
    let count = 0;

    for (const csvContact of newContacts) {
      try {
        // Queue new contact creation
        syncQueue.addToQueue(
          csvContact.contactId || `temp-${Date.now()}-${count}`,
          'create',
          csvContact.contactData,
          undefined,
          importSession
        );

        // Save to local store
        contactStore.saveContact(
          csvContact,
          'csv_import',
          importSession,
          false // Not synced yet
        );

        count++;
        logger.info(`Queued new contact for creation`);
      } catch (error) {
        logger.error(`Failed to queue new contact:`, error);
      }
    }
    return count;
  }

  /**
   * Run CSV Export
   */
  private async runCsvExport(): Promise<void> {
    try {
      this.hide();

      // Show file browser for destination (returns directory or file path)
      const selectedPath = await this.fileBrowser.browse([]);

      if (!selectedPath) {
        this.show(this.contacts);
        return;
      }

      // Determine if selected path is a directory or file
      const fs = require('fs');
      const path = require('path');
      let filePath: string;

      try {
        const stats = fs.statSync(selectedPath);
        if (stats.isDirectory()) {
          // If directory, append recommended filename
          const filename = this.csvExportTool.getRecommendedFilename();
          filePath = path.join(selectedPath, filename);
        } else {
          // If file, use it directly (user is overwriting or chose a specific name)
          filePath = selectedPath;
        }
      } catch (error) {
        // If path doesn't exist, treat as a file path
        filePath = selectedPath;
      }

      // Export contacts
      try {
        const result = await this.csvExportTool.exportContacts(this.contacts, filePath);
        const sizeKB = (result.fileSize / 1024).toFixed(2);
        this.showMessage(
          `Export successful!\n\nFile: ${result.filePath}\nContacts: ${result.rowCount}\nFields: ${result.fieldCount}\nSize: ${sizeKB}KB`,
          'success'
        );
      } catch (error) {
        logger.error('CSV export failed:', error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.showMessage(`Failed to export CSV:\n${errorMsg}`, 'error');
      }

      this.show(this.contacts);
    } catch (error) {
      logger.error('Failed to initiate CSV export:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.showMessage(`Failed to export contacts:\n${errorMsg}`, 'error');
      this.show(this.contacts);
    }
  }

  /**
   * Show Sync Queue Manager
   */
  private async showSyncQueue(): Promise<void> {
    try {
      logger.info('Opening Sync Queue Manager...');
      this.hide();

      this.syncQueueViewer.showWithCallback(() => {
        // Callback when sync queue viewer closes
        this.show(this.contacts);
      });
    } catch (error) {
      logger.error('Failed to open Sync Queue Manager:', error);
      this.showMessage('Failed to open Sync Queue Manager', 'error');
    }
  }

  /**
   * Show Import History
   */
  private async showImportHistory(): Promise<void> {
    try {
      logger.info('Opening Import History...');
      this.hide();

      this.importHistoryViewer.show(() => {
        // Callback when viewer closes
        this.show(this.contacts);
      });
    } catch (error) {
      logger.error('Failed to open Import History:', error);
      this.showMessage('Failed to open Import History', 'error');
    }
  }

  /**
   * Show Sync Settings
   */
  private async showSyncSettings(): Promise<void> {
    try {
      logger.info('Opening Sync Settings...');
      this.hide();

      this.syncSettingsViewer.show((saved) => {
        // Callback when viewer closes
        if (saved) {
          this.showMessage('Sync settings saved successfully', 'success');
        }
        this.show(this.contacts);
      });
    } catch (error) {
      logger.error('Failed to open Sync Settings:', error);
      this.showMessage('Failed to open Sync Settings', 'error');
    }
  }

  /**
   * Show Database Statistics
   */
  private async showDatabaseStats(): Promise<void> {
    try {
      const db = getDatabase();
      const stats = db.getStats();
      const syncQueue = getSyncQueue(db);
      const queueStats = syncQueue.getQueueStats();
      const importHistory = getImportHistory(db);
      const importStats = importHistory.getImportStats();

      const message = [
        '{bold}{cyan-fg}Database Statistics{/cyan-fg}{/bold}',
        '',
        '{bold}Local Contacts:{/bold}',
        `  Total Contacts: ${stats.totalContacts}`,
        `  Unsynced Contacts: ${stats.unsyncedContacts}`,
        `  Database Size: ${stats.dbSize}`,
        '',
        '{bold}Sync Queue:{/bold}',
        `  Pending: ${queueStats.pending}`,
        `  Approved: ${queueStats.approved}`,
        `  Syncing: ${queueStats.syncing}`,
        `  Synced: ${queueStats.synced}`,
        `  Failed: ${queueStats.failed}`,
        `  Total: ${queueStats.total}`,
        '',
        '{bold}Import History:{/bold}',
        `  Total Imports: ${importStats.totalImports}`,
        `  Completed: ${importStats.completedImports}`,
        `  Failed: ${importStats.failedImports}`,
        `  Total Rows Imported: ${importStats.totalRowsImported}`,
        `  Total Contacts Created: ${importStats.totalContactsCreated}`,
        '',
        '{green-fg}Press any key to close{/green-fg}',
      ].join('\n');

      const statsBox = blessed.message({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: 60,
        height: 'shrink',
        border: { type: 'line' },
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'cyan' },
        },
        tags: true,
        padding: { left: 2, right: 2, top: 1, bottom: 1 },
      });

      statsBox.display(message, 0, () => {
        statsBox.destroy();
        this.screen.render();
      });

      this.screen.render();
    } catch (error) {
      logger.error('Failed to show database stats:', error);
      this.showMessage('Failed to show database statistics', 'error');
    }
  }
}