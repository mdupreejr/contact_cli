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
        '🔧 Fix Duplicate Names',
        '📞 Normalize Phone Numbers',
        '📧 Fix Email Formats',
        '🏢 Clean Company Names',
        '🔍 Find Missing Info',
        '🤖 AI: Semantic Search',
        '🧠 AI: Smart Deduplication',
        '📋 View All Available Tools',
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
      this.runTool(selectedIndex);
    });

    this.toolsBox.key(['escape', 'q'], () => {
      this.hide();
    });

    this.toolsList.key(['1'], () => this.runTool(0));
    this.toolsList.key(['2'], () => this.runTool(1));
    this.toolsList.key(['3'], () => this.runTool(2));
    this.toolsList.key(['4'], () => this.runTool(3));
    this.toolsList.key(['5'], () => this.runTool(4));
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

      `{bold}{yellow-fg}Find Missing Info{/yellow-fg}{/bold}

{red-fg}Coming Soon{/red-fg}

This tool will identify contacts missing essential information.`,

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
      case 6:
        this.showMessage('Semantic search feature coming soon to UI!', 'info');
        break;
      case 7:
        await this.runSmartDedupeTool();
        break;
      case 5:
        await this.showToolRegistry();
        break;
      default:
        this.showMessage('This tool is not yet implemented. Coming soon!', 'info');
        break;
    }
  }

  private async runDuplicateNameFixer(): Promise<void> {
    try {
      this.showMessage('Analyzing contacts for duplicate names...', 'info');

      const fixer = new DuplicateNameFixer(this.contactsApi);
      const issues = fixer.findDuplicateNames(this.contacts);

      if (issues.length === 0) {
        this.showMessage('Great! No duplicate names found in your contacts.', 'success');
        return;
      }

      // Show issues and let user fix them one by one
      await this.processDuplicateNameIssues(fixer, issues);

    } catch (error) {
      logger.error('Error running duplicate name fixer:', error);
      this.showMessage('Error running duplicate name fixer. Check logs for details.', 'error');
    }
  }

  private async processDuplicateNameIssues(fixer: DuplicateNameFixer, issues: DuplicateNameIssue[]): Promise<void> {
    let fixedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      const summary = fixer.getIssueSummary(issue);
      
      const choice = await this.showConfirmDialog(
        `Fix Duplicate Name (${i + 1}/${issues.length})`,
        `Contact: ${fixer.formatNameForDisplay(issue.contact.contactData.name || {})}\n\n${summary}\n\nApply this fix?`,
        ['Yes, fix it', 'Skip this one', 'Cancel tool']
      );

      if (choice === 0) { // Yes, fix it
        try {
          this.showMessage(`Fixing contact ${i + 1}/${issues.length}...`, 'info');
          const updatedContact = await fixer.applyFix(issue.contact, issue.suggestedFix);
          
          // Update the contact in our local array
          const contactIndex = this.contacts.findIndex(c => c.contactId === issue.contact.contactId);
          if (contactIndex !== -1) {
            this.contacts[contactIndex] = updatedContact;
          }
          
          fixedCount++;
        } catch (error) {
          this.showMessage(`Failed to fix contact ${i + 1}. Continuing with next...`, 'error');
          skippedCount++;
        }
      } else if (choice === 1) { // Skip this one
        skippedCount++;
      } else { // Cancel tool
        break;
      }
    }

    // Show final summary
    const message = `Duplicate Name Fixer Complete!\n\nFixed: ${fixedCount} contacts\nSkipped: ${skippedCount} contacts`;
    this.showMessage(message, 'success');

    // Notify parent component about updated contacts
    if (fixedCount > 0) {
      this.onContactsUpdated(this.contacts);
    }
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

      // Create progress tracker and show indicator
      const tracker = new ProgressTracker(this.contacts.length, 'Analyzing contacts...');
      this.progressIndicator.show(tracker, 'Phone Number Normalization');

      // Analyze all contacts with progress tracking
      const result = await phoneNormalizationTool.batchAnalyze(this.contacts, tracker);
      
      if (result.totalSuggestions === 0) {
        this.showMessage('Great! All phone numbers are already properly formatted.', 'success');
        return;
      }

      // Process suggestions for each contact
      let totalFixed = 0;
      for (const contactResult of result.results) {
        if (contactResult.suggestions.length === 0) continue;

        const contact = this.contacts.find(c => c.contactId === contactResult.contactId);
        if (!contact) continue;

        // Create suggestion batch
        const batchId = await this.suggestionManager.createBatch(
          'Phone Number Normalization',
          contact.contactId,
          contactResult.suggestions,
          contact
        );

        // Show suggestion viewer
        await new Promise<void>((resolve) => {
          this.suggestionViewer.show(batchId, (completedBatchId, summary) => {
            logger.info(`Completed batch ${completedBatchId}: ${summary?.successRate}% success rate`);
            totalFixed += summary?.approved || 0;
            resolve();
          });
        });
      }

      // Show final summary
      const message = `Phone Number Normalization Complete!\n\nProcessed: ${result.processedContacts} contacts\nSuggestions: ${result.totalSuggestions}\nApplied: ${totalFixed} changes`;
      this.showMessage(message, 'success');

      // Refresh contacts if changes were made
      if (totalFixed > 0) {
        this.showMessage('Refreshing contact list...', 'info');
        // Note: Would need to reload contacts from API
        this.onContactsUpdated(this.contacts);
      }

    } catch (error) {
      logger.error('Error running phone normalization tool:', error);
      this.showMessage('Error running phone normalization tool. Check logs for details.', 'error');
    }
  }

  private async runCompanyNameCleaningTool(): Promise<void> {
    try {
      const companyNameCleaningTool = toolRegistry.getTool('Company Name Cleaning');
      if (!companyNameCleaningTool) {
        this.showMessage('Company name cleaning tool not found in registry', 'error');
        return;
      }

      // Create progress tracker and show indicator
      const tracker = new ProgressTracker(this.contacts.length, 'Analyzing contacts...');
      this.progressIndicator.show(tracker, 'Company Name Cleaning');

      // Analyze all contacts with progress tracking
      const result = await companyNameCleaningTool.batchAnalyze(this.contacts, tracker);

      if (result.totalSuggestions === 0) {
        this.showMessage('Great! All company names are already properly formatted.', 'success');
        return;
      }

      // Process suggestions for each contact
      let totalFixed = 0;
      for (const contactResult of result.results) {
        if (contactResult.suggestions.length === 0) continue;

        const contact = this.contacts.find(c => c.contactId === contactResult.contactId);
        if (!contact) continue;

        // Create suggestion batch
        const batchId = await this.suggestionManager.createBatch(
          'Company Name Cleaning',
          contact.contactId,
          contactResult.suggestions,
          contact
        );

        // Show suggestion viewer
        await new Promise<void>((resolve) => {
          this.suggestionViewer.show(batchId, (completedBatchId, summary) => {
            logger.info(`Completed batch ${completedBatchId}: ${summary?.successRate}% success rate`);
            totalFixed += summary?.approved || 0;
            resolve();
          });
        });
      }

      // Show final summary
      const message = `Company Name Cleaning Complete!\n\nProcessed: ${result.processedContacts} contacts\nSuggestions: ${result.totalSuggestions}\nApplied: ${totalFixed} changes`;
      this.showMessage(message, 'success');

      // Refresh contacts if changes were made
      if (totalFixed > 0) {
        this.showMessage('Refreshing contact list...', 'info');
        this.onContactsUpdated(this.contacts);
      }
    } catch (error) {
      logger.error('Error running company name cleaning tool:', error);
      this.showMessage(
        error instanceof Error ? error.message : 'An error occurred while running the tool',
        'error'
      );
    }
  }

  private async runEmailValidationTool(): Promise<void> {
    try {

      const emailValidationTool = toolRegistry.getTool('Email Validation');
      if (!emailValidationTool) {
        this.showMessage('Email validation tool not found in registry', 'error');
        return;
      }

      // Create progress tracker and show indicator
      const tracker = new ProgressTracker(this.contacts.length, 'Analyzing contacts...');
      this.progressIndicator.show(tracker, 'Email Validation');

      // Analyze all contacts with progress tracking
      const result = await emailValidationTool.batchAnalyze(this.contacts, tracker);

      if (result.totalSuggestions === 0) {
        this.showMessage('Great! All email addresses are valid.', 'success');
        return;
      }

      // Process suggestions for each contact
      let totalFixed = 0;
      for (const contactResult of result.results) {
        if (contactResult.suggestions.length === 0) continue;

        const contact = this.contacts.find(c => c.contactId === contactResult.contactId);
        if (!contact) continue;

        // Create suggestion batch
        const batchId = await this.suggestionManager.createBatch(
          'Email Validation',
          contact.contactId,
          contactResult.suggestions,
          contact
        );

        // Show suggestion viewer
        await new Promise<void>((resolve) => {
          this.suggestionViewer.show(batchId, (completedBatchId, summary) => {
            logger.info(`Completed batch ${completedBatchId}: ${summary?.successRate}% success rate`);
            totalFixed += summary?.approved || 0;
            resolve();
          });
        });
      }

      // Show final summary
      const message = `Email Validation Complete!\n\nProcessed: ${result.processedContacts} contacts\nSuggestions: ${result.totalSuggestions}\nApplied: ${totalFixed} changes`;
      this.showMessage(message, 'success');

      // Refresh contacts if changes were made
      if (totalFixed > 0) {
        this.showMessage('Refreshing contact list...', 'info');
        this.onContactsUpdated(this.contacts);
      }
    } catch (error) {
      logger.error('Error running email validation tool:', error);
      this.showMessage(
        error instanceof Error ? error.message : 'An error occurred while running the tool',
        'error'
      );
    }
  }

  private async runSmartDedupeTool(): Promise<void> {
    try {
      this.showMessage('Running ML-powered duplicate detection...', 'info');

      const smartDedupeTool = toolRegistry.getTool('Smart Deduplication');
      if (!smartDedupeTool) {
        this.showMessage('Smart deduplication tool not found in registry', 'error');
        return;
      }

      // Run batch analysis
      const result = await smartDedupeTool.batchAnalyze(this.contacts);

      if (result.totalSuggestions === 0) {
        this.showMessage('Great! No duplicate contacts detected.', 'success');
        return;
      }

      // Process suggestions for each contact pair
      let totalFixed = 0;
      for (const contactResult of result.results) {
        if (contactResult.suggestions.length === 0) continue;

        const contact = this.contacts.find(c => c.contactId === contactResult.contactId);
        if (!contact) continue;

        // Create suggestion batch
        const batchId = await this.suggestionManager.createBatch(
          'Smart Deduplication',
          contact.contactId,
          contactResult.suggestions,
          contact
        );

        // Show suggestion viewer
        await new Promise<void>((resolve) => {
          this.suggestionViewer.show(batchId, (completedBatchId, summary) => {
            logger.info(`Completed batch ${completedBatchId}: ${summary?.successRate}% success rate`);
            totalFixed += summary?.approved || 0;
            resolve();
          });
        });
      }

      // Show final summary
      const message = `Smart Deduplication Complete!\n\nPotential duplicates found: ${result.totalSuggestions}\nMerges performed: ${totalFixed}`;
      this.showMessage(message, 'success');

      // Refresh contacts if changes were made
      if (totalFixed > 0) {
        this.showMessage('Refreshing contact list...', 'info');
        this.onContactsUpdated(this.contacts);
      }
    } catch (error) {
      logger.error('Error running smart deduplication tool:', error);
      this.showMessage(
        error instanceof Error ? error.message : 'An error occurred while running the tool',
        'error'
      );
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
}