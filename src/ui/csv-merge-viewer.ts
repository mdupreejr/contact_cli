import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { ContactMatch } from '../tools/csv-import-tool';
import { Contact } from '../types/contactsplus';
import { logger } from '../utils/logger';

/**
 * User decision for a contact match
 */
export interface MergeDecision {
  match: ContactMatch;
  action: 'merge' | 'skip' | 'new';
}

/**
 * CSV Merge Viewer
 * Shows merge suggestions from CSV import and allows user to approve/reject each one
 */
export class CsvMergeViewer {
  private screen: Widgets.Screen;
  private container: Widgets.BoxElement | null = null;
  private headerBox: Widgets.BoxElement | null = null;
  private csvBox: Widgets.BoxElement | null = null;
  private existingBox: Widgets.BoxElement | null = null;
  private mergedBox: Widgets.BoxElement | null = null;
  private matchDetailsBox: Widgets.BoxElement | null = null;
  private buttonBox: Widgets.BoxElement | null = null;
  private statusBar: Widgets.BoxElement | null = null;

  private matches: ContactMatch[] = [];
  private currentIndex: number = 0;
  private decisions: MergeDecision[] = [];
  private onComplete: ((decisions: MergeDecision[]) => void) | null = null;

  constructor(screen: Widgets.Screen) {
    this.screen = screen;
  }

  /**
   * Show merge viewer with list of matches to review
   */
  show(matches: ContactMatch[], onComplete: (decisions: MergeDecision[]) => void): void {
    this.matches = matches;
    this.currentIndex = 0;
    this.decisions = [];
    this.onComplete = onComplete;

    if (this.matches.length === 0) {
      // No matches to review
      this.showNoMatchesMessage();
      return;
    }

    this.createUI();
    this.displayCurrentMatch();
    this.screen.render();
  }

  /**
   * Hide the viewer
   */
  hide(): void {
    if (this.container) {
      this.container.destroy();
      this.container = null;
    }
    this.screen.render();
  }

  /**
   * Create the UI layout
   */
  private createUI(): void {
    // Main container
    this.container = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      style: {
        bg: 'black',
      },
    });

    // Header
    this.headerBox = blessed.box({
      parent: this.container,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true,
      },
      align: 'center',
      valign: 'middle',
    });

    // Three columns for contact comparison
    const columnWidth = Math.floor(100 / 3);

    // CSV Contact (left)
    this.csvBox = blessed.box({
      parent: this.container,
      top: 3,
      left: 0,
      width: `${columnWidth}%`,
      height: '50%-3',
      label: ' CSV Contact ',
      border: { type: 'line' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        style: {
          bg: 'blue',
        },
      },
      style: {
        fg: 'white',
        border: { fg: 'cyan' },
      },
    });

    // Existing Contact (middle)
    this.existingBox = blessed.box({
      parent: this.container,
      top: 3,
      left: `${columnWidth}%`,
      width: `${columnWidth}%`,
      height: '50%-3',
      label: ' Existing Contact ',
      border: { type: 'line' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        style: {
          bg: 'blue',
        },
      },
      style: {
        fg: 'white',
        border: { fg: 'yellow' },
      },
    });

    // Merged Result (right)
    this.mergedBox = blessed.box({
      parent: this.container,
      top: 3,
      left: `${columnWidth * 2}%`,
      width: `${columnWidth}%`,
      height: '50%-3',
      label: ' Proposed Merge ',
      border: { type: 'line' },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        style: {
          bg: 'blue',
        },
      },
      style: {
        fg: 'white',
        border: { fg: 'green' },
      },
    });

    // Match details box
    this.matchDetailsBox = blessed.box({
      parent: this.container,
      top: '50%',
      left: 0,
      width: '100%',
      height: '30%',
      label: ' Match Details ',
      border: { type: 'line' },
      tags: true,
      style: {
        fg: 'white',
        border: { fg: 'white' },
      },
      padding: { left: 2, right: 2, top: 1, bottom: 1 },
    });

    // Button box
    this.buttonBox = blessed.box({
      parent: this.container,
      top: '80%',
      left: 0,
      width: '100%',
      height: '15%',
      tags: true,
      style: {
        fg: 'white',
      },
      align: 'center',
      valign: 'middle',
    });

    // Status bar
    this.statusBar = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: '',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
      },
    });

    // Key bindings
    this.container.key(['escape', 'q'], () => {
      this.cancel();
    });

    this.container.key(['m', 'enter'], () => {
      this.handleDecision('merge');
    });

    this.container.key(['s'], () => {
      this.handleDecision('skip');
    });

    this.container.key(['n'], () => {
      this.handleDecision('new');
    });

    this.container.key(['left'], () => {
      this.previousMatch();
    });

    this.container.key(['right'], () => {
      this.nextMatch();
    });

    this.container.focus();
  }

  /**
   * Display the current match
   */
  private displayCurrentMatch(): void {
    if (!this.matches[this.currentIndex]) return;

    const match = this.matches[this.currentIndex];
    const { csvContact, existingContact, mergedContact, similarityScore, matchDetails } = match;

    // Update header
    if (this.headerBox) {
      this.headerBox.setContent(
        `CSV Import - Match Review (${this.currentIndex + 1}/${this.matches.length})`
      );
    }

    // Display CSV contact
    if (this.csvBox) {
      this.csvBox.setContent(this.formatContact(csvContact));
    }

    // Display existing contact
    if (this.existingBox) {
      this.existingBox.setContent(this.formatContact(existingContact));
    }

    // Display merged contact
    if (this.mergedBox && mergedContact) {
      this.mergedBox.setContent(this.formatContact(mergedContact));
    }

    // Display match details
    if (this.matchDetailsBox) {
      const details = [
        `{bold}Similarity Score:{/bold} ${(similarityScore * 100).toFixed(1)}%`,
        '',
        `{bold}Match Analysis:{/bold}`,
        `  Name Match: ${matchDetails.nameMatch ? '{green-fg}✓ Yes{/green-fg}' : '{red-fg}✗ No{/red-fg}'}`,
        `  Email Match: ${matchDetails.emailMatch ? '{green-fg}✓ Yes{/green-fg}' : '{red-fg}✗ No{/red-fg}'}`,
        `  Phone Match: ${matchDetails.phoneMatch ? '{green-fg}✓ Yes{/green-fg}' : '{red-fg}✗ No{/red-fg}'}`,
        `  Company Match: ${matchDetails.companyMatch ? '{green-fg}✓ Yes{/green-fg}' : '{red-fg}✗ No{/red-fg}'}`,
        '',
        `{bold}Suggested Action:{/bold} ${this.formatSuggestedAction(match.suggestedAction)}`,
      ];
      this.matchDetailsBox.setContent(details.join('\n'));
    }

    // Update button box
    if (this.buttonBox) {
      const buttons = [
        '{green-bg}{white-fg} M {/white-fg}{/green-bg} Merge',
        '{yellow-bg}{black-fg} S {/black-fg}{/yellow-bg} Skip',
        '{blue-bg}{white-fg} N {/white-fg}{/blue-bg} New Contact',
        '{red-bg}{white-fg} Q {/white-fg}{/red-bg} Cancel',
      ];
      this.buttonBox.setContent(buttons.join('    '));
    }

    // Update status bar
    if (this.statusBar) {
      const progress = `Match ${this.currentIndex + 1}/${this.matches.length} | Decisions: ${this.decisions.length}`;
      const navigation = `← → Navigate | Enter/M: Merge | S: Skip | N: New | Q: Cancel`;
      this.statusBar.setContent(`${progress} | ${navigation}`);
    }

    this.screen.render();
  }

  /**
   * Format contact for display
   */
  private formatContact(contact: Contact): string {
    const lines: string[] = [];
    const data = contact.contactData;

    // Name
    if (data.name) {
      const name = [
        data.name.prefix,
        data.name.givenName,
        data.name.middleName,
        data.name.familyName,
        data.name.suffix,
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(`{bold}${name || 'Unknown'}{/bold}`);
      lines.push('');
    }

    // Emails
    if (data.emails && data.emails.length > 0) {
      lines.push('{cyan-fg}Emails:{/cyan-fg}');
      data.emails.forEach(email => {
        lines.push(`  ${email.value} (${email.type || 'other'})`);
      });
      lines.push('');
    }

    // Phone numbers
    if (data.phoneNumbers && data.phoneNumbers.length > 0) {
      lines.push('{cyan-fg}Phones:{/cyan-fg}');
      data.phoneNumbers.forEach(phone => {
        lines.push(`  ${phone.value} (${phone.type || 'other'})`);
      });
      lines.push('');
    }

    // Organizations
    if (data.organizations && data.organizations.length > 0) {
      lines.push('{cyan-fg}Organization:{/cyan-fg}');
      data.organizations.forEach(org => {
        if (org.name) lines.push(`  Company: ${org.name}`);
        if (org.title) lines.push(`  Title: ${org.title}`);
      });
      lines.push('');
    }

    // Addresses
    if (data.addresses && data.addresses.length > 0) {
      lines.push('{cyan-fg}Addresses:{/cyan-fg}');
      data.addresses.forEach(addr => {
        const parts = [addr.street, addr.city, addr.region, addr.postalCode, addr.country].filter(Boolean);
        if (parts.length > 0) {
          lines.push(`  ${parts.join(', ')} (${addr.type || 'other'})`);
        }
      });
      lines.push('');
    }

    // URLs
    if (data.urls && data.urls.length > 0) {
      lines.push('{cyan-fg}Websites:{/cyan-fg}');
      data.urls.forEach(url => {
        lines.push(`  ${url.value}`);
      });
      lines.push('');
    }

    // Notes
    if (data.notes) {
      lines.push('{cyan-fg}Notes:{/cyan-fg}');
      lines.push(`  ${data.notes.substring(0, 200)}${data.notes.length > 200 ? '...' : ''}`);
      lines.push('');
    }

    // Contact ID
    lines.push(`{gray-fg}ID: ${contact.contactId}{/gray-fg}`);

    return lines.join('\n');
  }

  /**
   * Format suggested action
   */
  private formatSuggestedAction(action: string): string {
    switch (action) {
      case 'merge':
        return '{green-fg}Merge{/green-fg} - High confidence match';
      case 'skip':
        return '{yellow-fg}Skip{/yellow-fg} - Keep existing';
      case 'new':
        return '{blue-fg}New Contact{/blue-fg} - Create separate entry';
      default:
        return action;
    }
  }

  /**
   * Handle user decision
   */
  private handleDecision(action: 'merge' | 'skip' | 'new'): void {
    const match = this.matches[this.currentIndex];

    this.decisions.push({
      match,
      action,
    });

    logger.info(`CSV merge decision: ${action} for contact ${match.csvContact.contactId}`);

    // Move to next match or complete
    if (this.currentIndex < this.matches.length - 1) {
      this.currentIndex++;
      this.displayCurrentMatch();
    } else {
      this.complete();
    }
  }

  /**
   * Navigate to previous match
   */
  private previousMatch(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.displayCurrentMatch();
    }
  }

  /**
   * Navigate to next match
   */
  private nextMatch(): void {
    if (this.currentIndex < this.matches.length - 1) {
      this.currentIndex++;
      this.displayCurrentMatch();
    }
  }

  /**
   * Complete review process
   */
  private complete(): void {
    logger.info(`CSV merge review completed: ${this.decisions.length} decisions made`);
    this.hide();

    if (this.onComplete) {
      this.onComplete(this.decisions);
    }
  }

  /**
   * Cancel review process
   */
  private cancel(): void {
    logger.info('CSV merge review cancelled');
    this.hide();

    if (this.onComplete) {
      this.onComplete([]);
    }
  }

  /**
   * Show message when no matches to review
   */
  private showNoMatchesMessage(): void {
    const messageBox = blessed.message({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: 7,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'green' },
      },
      tags: true,
    });

    messageBox.display(
      '{center}{bold}No Duplicate Matches{/bold}\n\nAll CSV contacts are new.\nThey will be imported directly.{/center}',
      0,
      () => {
        messageBox.destroy();
        this.screen.render();

        if (this.onComplete) {
          this.onComplete([]);
        }
      }
    );

    this.screen.render();
  }
}
