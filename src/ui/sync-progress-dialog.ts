import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { SyncItemResult } from '../db/sync-engine';
import { logger } from '../utils/logger';

/**
 * Sync Progress Dialog
 * Shows real-time progress during sync operations
 */
export class SyncProgressDialog {
  private screen: Widgets.Screen;
  private container: Widgets.BoxElement | null = null;
  private progressBar: Widgets.ProgressBarElement | null = null;
  private statusText: Widgets.BoxElement | null = null;
  private resultsBox: Widgets.BoxElement | null = null;

  private totalItems: number = 0;
  private currentItem: number = 0;
  private successCount: number = 0;
  private failureCount: number = 0;
  private results: SyncItemResult[] = [];

  constructor(screen: Widgets.Screen) {
    this.screen = screen;
  }

  /**
   * Show progress dialog
   */
  show(totalItems: number): void {
    this.totalItems = totalItems;
    this.currentItem = 0;
    this.successCount = 0;
    this.failureCount = 0;
    this.results = [];

    this.createUI();
    this.screen.render();
  }

  /**
   * Hide the dialog
   */
  hide(): void {
    if (this.container) {
      this.container.destroy();
      this.container = null;
    }
    this.screen.render();
  }

  /**
   * Create the UI
   */
  private createUI(): void {
    // Main container
    this.container = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 80,
      height: 20,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' },
      },
      tags: true,
      label: ' {bold}{cyan-fg}Syncing to API{/cyan-fg}{/bold} ',
    });

    // Status text
    this.statusText = blessed.box({
      parent: this.container,
      top: 1,
      left: 2,
      width: '100%-4',
      height: 3,
      tags: true,
      content: this.getStatusText(),
    });

    // Progress bar
    this.progressBar = blessed.progressbar({
      parent: this.container,
      top: 4,
      left: 2,
      width: '100%-4',
      height: 3,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'green' },
        bar: {
          bg: 'green',
          fg: 'black',
        },
      },
      filled: 0,
    });

    // Results box (scrollable)
    this.resultsBox = blessed.box({
      parent: this.container,
      top: 7,
      left: 2,
      width: '100%-4',
      height: '100%-9',
      border: { type: 'line' },
      label: ' Recent Results ',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        style: { bg: 'blue' },
      },
      style: {
        fg: 'white',
        border: { fg: 'white' },
      },
    });
  }

  /**
   * Update progress
   */
  updateProgress(current: number, result?: SyncItemResult): void {
    this.currentItem = current;

    if (result) {
      this.results.push(result);
      if (result.success) {
        this.successCount++;
      } else {
        this.failureCount++;
      }
    }

    // Update progress bar
    if (this.progressBar && this.totalItems > 0) {
      const percent = (this.currentItem / this.totalItems) * 100;
      this.progressBar.setProgress(percent);
    }

    // Update status text
    if (this.statusText) {
      this.statusText.setContent(this.getStatusText());
    }

    // Update results display
    this.updateResultsDisplay();

    this.screen.render();
  }

  /**
   * Get status text
   */
  private getStatusText(): string {
    const lines: string[] = [];

    lines.push(`Progress: {cyan-fg}${this.currentItem}/${this.totalItems}{/cyan-fg}`);
    lines.push(`Success: {green-fg}${this.successCount}{/green-fg} | Failed: {red-fg}${this.failureCount}{/red-fg}`);

    if (this.currentItem > 0 && this.totalItems > 0) {
      const percent = ((this.currentItem / this.totalItems) * 100).toFixed(1);
      lines.push(`Completion: {cyan-fg}${percent}%{/cyan-fg}`);
    }

    return lines.join('\n');
  }

  /**
   * Update results display (last 5 results)
   */
  private updateResultsDisplay(): void {
    if (!this.resultsBox) return;

    const recentResults = this.results.slice(-5).reverse();
    const lines: string[] = [];

    for (const result of recentResults) {
      const statusIcon = result.success ? '{green-fg}✓{/green-fg}' : '{red-fg}✗{/red-fg}';
      const operation = result.operation.toUpperCase();
      const contactId = result.contactId.substring(0, 8);

      let line = `${statusIcon} ${operation} ${contactId}`;

      if (!result.success && result.error) {
        line += ` - {red-fg}${result.error.substring(0, 40)}${result.error.length > 40 ? '...' : ''}{/red-fg}`;
      }

      lines.push(line);
    }

    this.resultsBox.setContent(lines.join('\n'));
  }

  /**
   * Show completion summary
   */
  showCompletionSummary(
    durationMs: number,
    onClose: () => void
  ): void {
    // Clear existing content
    if (this.container) {
      this.container.destroy();
    }

    // Create summary dialog
    const summaryBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 70,
      height: 18,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: this.failureCount > 0 ? 'yellow' : 'green' },
      },
      tags: true,
      label: ' {bold}Sync Complete{/bold} ',
      padding: { left: 2, right: 2, top: 1, bottom: 1 },
    });

    const lines: string[] = [];

    lines.push('{bold}{cyan-fg}Sync Summary{/cyan-fg}{/bold}');
    lines.push('');
    lines.push(`Total Items: {cyan-fg}${this.totalItems}{/cyan-fg}`);
    lines.push(`Successful: {green-fg}${this.successCount}{/green-fg}`);
    lines.push(`Failed: {red-fg}${this.failureCount}{/red-fg}`);
    lines.push('');

    const successRate = this.totalItems > 0
      ? ((this.successCount / this.totalItems) * 100).toFixed(1)
      : '0';
    lines.push(`Success Rate: {cyan-fg}${successRate}%{/cyan-fg}`);

    const durationSec = (durationMs / 1000).toFixed(2);
    lines.push(`Duration: {cyan-fg}${durationSec}s{/cyan-fg}`);

    if (this.totalItems > 0) {
      const itemsPerSec = (this.totalItems / (durationMs / 1000)).toFixed(2);
      lines.push(`Speed: {cyan-fg}${itemsPerSec} items/sec{/cyan-fg}`);
    }

    lines.push('');

    if (this.failureCount > 0) {
      lines.push('{yellow-fg}Some items failed to sync.{/yellow-fg}');
      lines.push('{yellow-fg}Check the sync queue for details and retry.{/yellow-fg}');
      lines.push('');
    } else {
      lines.push('{green-fg}All items synced successfully!{/green-fg}');
      lines.push('');
    }

    lines.push('{cyan-fg}Press any key to close{/cyan-fg}');

    summaryBox.setContent(lines.join('\n'));

    summaryBox.key(['escape', 'enter', 'space', 'q'], () => {
      summaryBox.destroy();
      this.screen.render();
      onClose();
    });

    summaryBox.focus();
    this.screen.render();

    logger.info(`Sync completed: ${this.successCount} succeeded, ${this.failureCount} failed`);
  }
}
