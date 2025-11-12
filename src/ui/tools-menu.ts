import * as blessed from 'blessed';
import { Contact } from '../types/contactsplus';
import { ContactsApi } from '../api/contacts';
import { DuplicateNameFixer, DuplicateNameIssue } from '../tools/duplicate-name-fixer';
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

  constructor(
    screen: blessed.Widgets.Screen, 
    contactsApi: ContactsApi,
    onContactsUpdated: (contacts: Contact[]) => void
  ) {
    this.screen = screen;
    this.contactsApi = contactsApi;
    this.contacts = [];
    this.onContactsUpdated = onContactsUpdated;
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

{red-fg}Coming Soon{/red-fg}

This tool will standardize phone number formats across all contacts.`,

      `{bold}{yellow-fg}Fix Email Formats{/yellow-fg}{/bold}

{red-fg}Coming Soon{/red-fg}

This tool will identify and fix common email formatting issues.`,

      `{bold}{yellow-fg}Clean Company Names{/yellow-fg}{/bold}

{red-fg}Coming Soon{/red-fg}

This tool will standardize company name formats and remove duplicates.`,

      `{bold}{yellow-fg}Find Missing Info{/yellow-fg}{/bold}

{red-fg}Coming Soon{/red-fg}

This tool will identify contacts missing essential information.`,
    ];

    this.detailBox.setContent(toolDescriptions[toolIndex] || 'Tool details not available.');
    this.screen.render();
  }

  private async runTool(toolIndex: number): Promise<void> {
    switch (toolIndex) {
      case 0:
        await this.runDuplicateNameFixer();
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
}