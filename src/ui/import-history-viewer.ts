import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { ImportHistory, ImportSession } from '../db/import-history';
import { logger } from '../utils/logger';

/**
 * Import History Viewer
 * Visual browser for past CSV imports with detailed statistics
 */
export class ImportHistoryViewer {
  private screen: Widgets.Screen;
  private importHistory: ImportHistory;

  private container: Widgets.BoxElement | null = null;
  private headerBox: Widgets.BoxElement | null = null;
  private sessionList: Widgets.ListElement | null = null;
  private detailBox: Widgets.BoxElement | null = null;
  private statusBar: Widgets.BoxElement | null = null;

  private sessions: ImportSession[] = [];
  private selectedIndex: number = 0;
  private onComplete: (() => void) | null = null;

  constructor(screen: Widgets.Screen, importHistory: ImportHistory) {
    this.screen = screen;
    this.importHistory = importHistory;
  }

  /**
   * Show import history viewer
   */
  show(onComplete: () => void): void {
    this.onComplete = onComplete;
    this.loadSessions();
    this.createUI();
    this.updateDisplay();
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
   * Load import sessions
   */
  private loadSessions(): void {
    this.sessions = this.importHistory.getAllImportSessions();
    logger.debug(`Loaded ${this.sessions.length} import sessions`);
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

    // Session list (left side)
    this.sessionList = blessed.list({
      parent: this.container,
      top: 3,
      left: 0,
      width: '40%',
      height: '90%-3',
      label: ' Import Sessions ',
      border: { type: 'line' },
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      scrollbar: {
        ch: ' ',
        style: {
          bg: 'blue',
        },
      },
      style: {
        fg: 'white',
        border: { fg: 'cyan' },
        selected: {
          bg: 'blue',
          fg: 'white',
          bold: true,
        },
      },
    });

    // Detail view (right side)
    this.detailBox = blessed.box({
      parent: this.container,
      top: 3,
      left: '40%',
      width: '60%',
      height: '90%-3',
      label: ' Session Details ',
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
      keys: true,
      vi: true,
    });

    // Status bar
    this.statusBar = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '',
      tags: true,
      style: {
        fg: 'white',
        bg: 'black',
      },
      padding: { left: 1, right: 1 },
    });

    // Key bindings
    this.container.key(['escape', 'q'], () => {
      this.close();
    });

    this.container.key(['r'], () => {
      this.refresh();
    });

    this.container.key(['d'], () => {
      this.deleteSelected();
    });

    // List navigation
    if (this.sessionList) {
      this.sessionList.on('select', (item, index) => {
        this.selectedIndex = index;
        this.updateDetailView();
        this.screen.render();
      });

      this.sessionList.focus();
    }

    this.container.focus();
  }

  /**
   * Update display with current data
   */
  private updateDisplay(): void {
    this.updateHeader();
    this.updateSessionList();
    this.updateDetailView();
    this.updateStatusBar();
  }

  /**
   * Update header
   */
  private updateHeader(): void {
    if (!this.headerBox) return;

    const stats = this.importHistory.getImportStats();
    const header = `Import History | Total: ${stats.totalImports} | Completed: ${stats.completedImports} | Failed: ${stats.failedImports}`;

    this.headerBox.setContent(header);
  }

  /**
   * Update session list
   */
  private updateSessionList(): void {
    if (!this.sessionList) return;

    const items = this.sessions.map((session) => {
      const statusIcon = this.getStatusIcon(session.status);
      const statusColor = this.getStatusColor(session.status);
      const date = new Date(session.startedAt).toLocaleDateString();
      const time = new Date(session.startedAt).toLocaleTimeString();

      return `${statusIcon} {${statusColor}}${session.csvFilename}{/${statusColor}} | ${date} ${time}`;
    });

    this.sessionList.setItems(items);

    if (this.sessions.length > 0 && this.selectedIndex < this.sessions.length) {
      this.sessionList.select(this.selectedIndex);
    }
  }

  /**
   * Update detail view for selected session
   */
  private updateDetailView(): void {
    if (!this.detailBox || this.sessions.length === 0) {
      this.detailBox?.setContent('No import sessions found');
      return;
    }

    const session = this.sessions[this.selectedIndex];
    if (!session) return;

    const lines: string[] = [];

    lines.push('{bold}Import Session Details{/bold}');
    lines.push('');
    lines.push(`{cyan-fg}Session ID:{/cyan-fg} ${session.sessionId}`);
    lines.push(`{cyan-fg}CSV File:{/cyan-fg} ${session.csvFilename}`);
    lines.push(`{cyan-fg}File Hash:{/cyan-fg} ${session.csvHash.substring(0, 16)}...`);
    lines.push('');

    // Status
    const statusColor = this.getStatusColor(session.status);
    lines.push(`{cyan-fg}Status:{/cyan-fg} {${statusColor}}${session.status.toUpperCase()}{/${statusColor}}`);

    // Timestamps
    const startDate = new Date(session.startedAt);
    lines.push(`{cyan-fg}Started:{/cyan-fg} ${startDate.toLocaleString()}`);

    if (session.completedAt) {
      const endDate = new Date(session.completedAt);
      const duration = endDate.getTime() - startDate.getTime();
      const durationSec = (duration / 1000).toFixed(2);
      lines.push(`{cyan-fg}Completed:{/cyan-fg} ${endDate.toLocaleString()}`);
      lines.push(`{cyan-fg}Duration:{/cyan-fg} ${durationSec}s`);
    }

    lines.push('');
    lines.push('{bold}Statistics:{/bold}');
    lines.push(`  Total Rows: ${session.totalRows}`);
    lines.push(`  Parsed Contacts: ${session.parsedContacts}`);
    lines.push(`  Matched Contacts: ${session.matchedContacts}`);
    lines.push(`  New Contacts: ${session.newContacts}`);
    lines.push('');
    lines.push(`  Queued Operations: ${session.queuedOperations}`);
    lines.push(`  Synced Operations: ${session.syncedOperations}`);
    lines.push(`  Failed Operations: ${session.failedOperations}`);

    // Success rate
    if (session.queuedOperations > 0) {
      const successRate = ((session.syncedOperations / session.queuedOperations) * 100).toFixed(1);
      lines.push(`  Success Rate: ${successRate}%`);
    }

    if (session.errorMessage) {
      lines.push('');
      lines.push(`{red-fg}Error:{/red-fg}`);
      lines.push(`  ${session.errorMessage}`);
    }

    // Performance metrics
    if (session.completedAt && session.status === 'completed') {
      lines.push('');
      lines.push('{bold}Performance:{/bold}');
      const duration = new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime();
      const rowsPerSecond = session.totalRows / (duration / 1000);
      lines.push(`  Processing Speed: ${rowsPerSecond.toFixed(2)} rows/sec`);
    }

    this.detailBox.setContent(lines.join('\n'));
  }

  /**
   * Get status icon
   */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'in_progress':
        return '⟳';
      case 'completed':
        return '✓';
      case 'failed':
        return '✗';
      case 'cancelled':
        return '⊗';
      default:
        return '?';
    }
  }

  /**
   * Get status color
   */
  private getStatusColor(status: string): string {
    switch (status) {
      case 'in_progress':
        return 'cyan-fg';
      case 'completed':
        return 'green-fg';
      case 'failed':
        return 'red-fg';
      case 'cancelled':
        return 'yellow-fg';
      default:
        return 'white-fg';
    }
  }

  /**
   * Update status bar
   */
  private updateStatusBar(): void {
    if (!this.statusBar) return;

    const controls = [
      '{cyan-fg}[R]{/cyan-fg} Refresh',
      '{red-fg}[D]{/red-fg} Delete',
      '{cyan-fg}[ESC]{/cyan-fg} Back',
    ];

    const info = this.sessions.length > 0
      ? `Session ${this.selectedIndex + 1}/${this.sessions.length}`
      : 'No sessions';

    this.statusBar.setContent(`${info}\n${controls.join(' | ')}`);
  }

  /**
   * Refresh display
   */
  private refresh(): void {
    this.loadSessions();
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.sessions.length - 1));
    this.updateDisplay();
    this.screen.render();
    logger.info('Import history refreshed');
  }

  /**
   * Delete selected session
   */
  private deleteSelected(): void {
    if (this.sessions.length === 0) return;

    const session = this.sessions[this.selectedIndex];

    // Confirmation dialog
    const confirmBox = blessed.question({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 9,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'red' },
      },
      tags: true,
    });

    confirmBox.ask(
      `{bold}{red-fg}Delete Import Session?{/red-fg}{/bold}\n\n` +
      `File: ${session.csvFilename}\n` +
      `Date: ${new Date(session.startedAt).toLocaleString()}\n\n` +
      `{yellow-fg}This will delete the session record and CSV row hashes.{/yellow-fg}`,
      (err, value) => {
        if (value) {
          try {
            this.importHistory.deleteImportSession(session.sessionId);
            logger.info(`Deleted import session: ${session.sessionId}`);
            this.refresh();
          } catch (error) {
            logger.error('Failed to delete session:', error);
          }
        }
        confirmBox.destroy();
        this.screen.render();
      }
    );

    this.screen.render();
  }

  /**
   * Close viewer
   */
  private close(): void {
    logger.info('Closing import history viewer');
    this.hide();

    if (this.onComplete) {
      this.onComplete();
    }
  }
}
