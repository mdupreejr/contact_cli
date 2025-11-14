import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { SyncQueue, SyncQueueItem, SyncStatus } from '../db/sync-queue';
import { ContactStore } from '../db/contact-store';
import { Contact } from '../types/contactsplus';
import { logger } from '../utils/logger';

/**
 * Sync Queue Viewer
 * UI for manually reviewing and approving queued sync operations
 */
export class SyncQueueViewer {
  private screen: Widgets.Screen;
  private syncQueue: SyncQueue;
  private contactStore: ContactStore;

  private container: Widgets.BoxElement | null = null;
  private headerBox: Widgets.BoxElement | null = null;
  private queueList: Widgets.ListElement | null = null;
  private detailBox: Widgets.BoxElement | null = null;
  private statusBar: Widgets.BoxElement | null = null;

  private queueItems: SyncQueueItem[] = [];
  private selectedIndex: number = 0;
  private filterStatus: SyncStatus | 'all' = 'all';
  private selectedItems: Set<number> = new Set();
  private multiSelectMode: boolean = false;

  private onComplete: (() => void) | null = null;

  constructor(screen: Widgets.Screen, syncQueue: SyncQueue, contactStore: ContactStore) {
    this.screen = screen;
    this.syncQueue = syncQueue;
    this.contactStore = contactStore;
  }

  /**
   * Show sync queue viewer
   */
  show(onComplete: () => void): void {
    this.onComplete = onComplete;
    this.loadQueueItems();
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
   * Load queue items based on current filter
   */
  private loadQueueItems(): void {
    if (this.filterStatus === 'all') {
      this.queueItems = this.syncQueue.getQueueItems();
    } else {
      this.queueItems = this.syncQueue.getQueueItems({ syncStatus: this.filterStatus });
    }

    logger.debug(`Loaded ${this.queueItems.length} queue items (filter: ${this.filterStatus})`);
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

    // Header with stats
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

    // Queue list (left side)
    this.queueList = blessed.list({
      parent: this.container,
      top: 3,
      left: 0,
      width: '50%',
      height: '80%-3',
      label: ' Sync Queue ',
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
      left: '50%',
      width: '50%',
      height: '80%-3',
      label: ' Details ',
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

    this.container.key(['f'], () => {
      this.cycleFilter();
    });

    this.container.key(['a'], () => {
      this.approveSelected();
    });

    this.container.key(['x'], () => {
      this.rejectSelected();
    });

    this.container.key(['space'], () => {
      this.toggleSelection();
    });

    this.container.key(['m'], () => {
      this.toggleMultiSelectMode();
    });

    this.container.key(['A'], () => {
      this.approveAll();
    });

    this.container.key(['X'], () => {
      this.rejectAll();
    });

    this.container.key(['d'], () => {
      this.deleteSelected();
    });

    // List navigation
    if (this.queueList) {
      this.queueList.on('select', (item, index) => {
        this.selectedIndex = index;
        this.updateDetailView();
        this.screen.render();
      });

      this.queueList.focus();
    }

    this.container.focus();
  }

  /**
   * Update display with current data
   */
  private updateDisplay(): void {
    this.updateHeader();
    this.updateQueueList();
    this.updateDetailView();
    this.updateStatusBar();
  }

  /**
   * Update header with statistics
   */
  private updateHeader(): void {
    if (!this.headerBox) return;

    const stats = this.syncQueue.getQueueStats();
    const header = `Sync Queue Manager | Total: ${stats.total} | Pending: ${stats.pending} | Approved: ${stats.approved} | Failed: ${stats.failed} | Filter: ${this.filterStatus.toUpperCase()}`;

    this.headerBox.setContent(header);
  }

  /**
   * Update queue list
   */
  private updateQueueList(): void {
    if (!this.queueList) return;

    const items = this.queueItems.map((item, index) => {
      const checkbox = this.selectedItems.has(index) ? '☑' : '☐';
      const statusIcon = this.getStatusIcon(item.syncStatus);
      const operationIcon = this.getOperationIcon(item.operation);

      const contactName = this.getContactName(item.contactId);
      const statusColor = this.getStatusColor(item.syncStatus);

      return `${checkbox} ${statusIcon} ${operationIcon} ${contactName} {${statusColor}}[${item.syncStatus}]{/${statusColor}}`;
    });

    this.queueList.setItems(items);

    if (this.queueItems.length > 0 && this.selectedIndex < this.queueItems.length) {
      this.queueList.select(this.selectedIndex);
    }
  }

  /**
   * Update detail view for selected item
   */
  private updateDetailView(): void {
    if (!this.detailBox || this.queueItems.length === 0) {
      this.detailBox?.setContent('No items in queue');
      return;
    }

    const item = this.queueItems[this.selectedIndex];
    if (!item) return;

    const lines: string[] = [];

    lines.push('{bold}Queue Item Details{/bold}');
    lines.push('');
    lines.push(`{cyan-fg}Queue ID:{/cyan-fg} ${item.id}`);
    lines.push(`{cyan-fg}Contact ID:{/cyan-fg} ${item.contactId}`);
    lines.push(`{cyan-fg}Operation:{/cyan-fg} ${item.operation.toUpperCase()}`);
    lines.push(`{cyan-fg}Status:{/cyan-fg} ${item.syncStatus}`);
    lines.push(`{cyan-fg}Reviewed:{/cyan-fg} ${item.reviewed ? 'Yes' : 'No'}`);
    if (item.approved !== undefined) {
      lines.push(`{cyan-fg}Approved:{/cyan-fg} ${item.approved ? 'Yes' : 'No'}`);
    }
    lines.push(`{cyan-fg}Retry Count:{/cyan-fg} ${item.retryCount}`);
    lines.push(`{cyan-fg}Created:{/cyan-fg} ${item.createdAt}`);

    if (item.errorMessage) {
      lines.push('');
      lines.push(`{red-fg}Error:{/red-fg} ${item.errorMessage}`);
    }

    lines.push('');
    lines.push('{bold}Contact Data:{/bold}');
    lines.push('');

    // Show before/after comparison for updates
    if (item.operation === 'update' && item.dataBefore && item.dataAfter) {
      lines.push('{yellow-fg}BEFORE → AFTER{/yellow-fg}');
      lines.push('');
      lines.push(...this.formatContactComparison(item.dataBefore, item.dataAfter));
    } else if (item.dataAfter) {
      // Show new data for creates
      lines.push(...this.formatContactData(item.dataAfter));
    } else if (item.dataBefore) {
      // Show old data for deletes
      lines.push(...this.formatContactData(item.dataBefore));
    }

    this.detailBox.setContent(lines.join('\n'));
  }

  /**
   * Format contact data for display
   */
  private formatContactData(data: Contact['contactData']): string[] {
    const lines: string[] = [];

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
      lines.push(`{bold}${name}{/bold}`);
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

    // Phones
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

    return lines;
  }

  /**
   * Format before/after comparison
   */
  private formatContactComparison(
    before: Contact['contactData'],
    after: Contact['contactData']
  ): string[] {
    const lines: string[] = [];

    // Simple side-by-side comparison (basic version)
    lines.push('{yellow-fg}Name:{/yellow-fg}');
    const nameBefore = this.getFullNameFromData(before);
    const nameAfter = this.getFullNameFromData(after);
    if (nameBefore !== nameAfter) {
      lines.push(`  {red-fg}${nameBefore}{/red-fg} → {green-fg}${nameAfter}{/green-fg}`);
    } else {
      lines.push(`  ${nameBefore}`);
    }
    lines.push('');

    // Email comparison
    const emailsBefore = before.emails?.map(e => e.value).join(', ') || 'none';
    const emailsAfter = after.emails?.map(e => e.value).join(', ') || 'none';
    if (emailsBefore !== emailsAfter) {
      lines.push('{yellow-fg}Emails:{/yellow-fg}');
      lines.push(`  {red-fg}${emailsBefore}{/red-fg}`);
      lines.push(`  {green-fg}${emailsAfter}{/green-fg}`);
      lines.push('');
    }

    return lines;
  }

  /**
   * Get full name from contact data
   */
  private getFullNameFromData(data: Contact['contactData']): string {
    if (!data.name) return 'Unknown';
    const parts = [data.name.givenName, data.name.middleName, data.name.familyName].filter(Boolean);
    return parts.join(' ') || 'Unknown';
  }

  /**
   * Get contact name for display
   */
  private getContactName(contactId: string): string {
    const contact = this.contactStore.getContact(contactId);
    if (!contact) return contactId.substring(0, 8);

    const data = contact.contactData;
    if (data.name) {
      const parts = [data.name.givenName, data.name.familyName].filter(Boolean);
      if (parts.length > 0) return parts.join(' ');
    }

    if (data.emails && data.emails.length > 0) {
      return data.emails[0].value;
    }

    return contactId.substring(0, 8);
  }

  /**
   * Update status bar
   */
  private updateStatusBar(): void {
    if (!this.statusBar) return;

    const controls = [
      '{cyan-fg}[R]{/cyan-fg} Refresh',
      '{cyan-fg}[F]{/cyan-fg} Filter',
      '{green-fg}[A]{/green-fg} Approve',
      '{red-fg}[X]{/red-fg} Reject',
      '{cyan-fg}[Space]{/cyan-fg} Select',
      '{cyan-fg}[M]{/cyan-fg} Multi-select',
      '{red-fg}[D]{/red-fg} Delete',
      '{cyan-fg}[Q]{/cyan-fg} Quit',
    ];

    const multiSelectIndicator = this.multiSelectMode
      ? `{yellow-fg}MULTI-SELECT MODE ({${this.selectedItems.size} selected}){/yellow-fg}`
      : '';

    this.statusBar.setContent(
      `${multiSelectIndicator}\n${controls.join(' | ')}`
    );
  }

  /**
   * Get status icon
   */
  private getStatusIcon(status: SyncStatus): string {
    switch (status) {
      case 'pending':
        return '⏸';
      case 'approved':
        return '✓';
      case 'syncing':
        return '⟳';
      case 'synced':
        return '✔';
      case 'failed':
        return '✗';
      default:
        return '?';
    }
  }

  /**
   * Get operation icon
   */
  private getOperationIcon(operation: string): string {
    switch (operation) {
      case 'create':
        return '+';
      case 'update':
        return '↻';
      case 'delete':
        return '-';
      default:
        return '?';
    }
  }

  /**
   * Get status color
   */
  private getStatusColor(status: SyncStatus): string {
    switch (status) {
      case 'pending':
        return 'yellow-fg';
      case 'approved':
        return 'green-fg';
      case 'syncing':
        return 'cyan-fg';
      case 'synced':
        return 'green-fg';
      case 'failed':
        return 'red-fg';
      default:
        return 'white-fg';
    }
  }

  /**
   * Refresh display
   */
  private refresh(): void {
    this.loadQueueItems();
    this.updateDisplay();
    this.screen.render();
    logger.info('Queue refreshed');
  }

  /**
   * Cycle through filter options
   */
  private cycleFilter(): void {
    const filters: Array<SyncStatus | 'all'> = ['all', 'pending', 'approved', 'syncing', 'synced', 'failed'];
    const currentIndex = filters.indexOf(this.filterStatus);
    this.filterStatus = filters[(currentIndex + 1) % filters.length];

    this.loadQueueItems();
    this.selectedIndex = 0;
    this.selectedItems.clear();
    this.updateDisplay();
    this.screen.render();
  }

  /**
   * Toggle selection of current item
   */
  private toggleSelection(): void {
    if (!this.multiSelectMode) {
      this.multiSelectMode = true;
    }

    if (this.selectedItems.has(this.selectedIndex)) {
      this.selectedItems.delete(this.selectedIndex);
    } else {
      this.selectedItems.add(this.selectedIndex);
    }

    this.updateDisplay();
    this.screen.render();
  }

  /**
   * Toggle multi-select mode
   */
  private toggleMultiSelectMode(): void {
    this.multiSelectMode = !this.multiSelectMode;
    if (!this.multiSelectMode) {
      this.selectedItems.clear();
    }
    this.updateDisplay();
    this.screen.render();
  }

  /**
   * Approve selected items
   */
  private approveSelected(): void {
    const itemsToApprove = this.multiSelectMode && this.selectedItems.size > 0
      ? Array.from(this.selectedItems).map(i => this.queueItems[i])
      : [this.queueItems[this.selectedIndex]];

    const ids = itemsToApprove.filter(item => item).map(item => item.id);
    this.syncQueue.approveMultiple(ids);

    logger.info(`Approved ${ids.length} items`);

    this.selectedItems.clear();
    this.refresh();
  }

  /**
   * Reject selected items
   */
  private rejectSelected(): void {
    const itemsToReject = this.multiSelectMode && this.selectedItems.size > 0
      ? Array.from(this.selectedItems).map(i => this.queueItems[i])
      : [this.queueItems[this.selectedIndex]];

    const ids = itemsToReject.filter(item => item).map(item => item.id);
    this.syncQueue.rejectMultiple(ids);

    logger.info(`Rejected ${ids.length} items`);

    this.selectedItems.clear();
    this.refresh();
  }

  /**
   * Approve all filtered items
   */
  private approveAll(): void {
    const ids = this.queueItems.map(item => item.id);
    this.syncQueue.approveMultiple(ids);

    logger.info(`Approved all ${ids.length} items`);

    this.selectedItems.clear();
    this.refresh();
  }

  /**
   * Reject all filtered items
   */
  private rejectAll(): void {
    const ids = this.queueItems.map(item => item.id);
    this.syncQueue.rejectMultiple(ids);

    logger.info(`Rejected all ${ids.length} items`);

    this.selectedItems.clear();
    this.refresh();
  }

  /**
   * Delete selected items
   */
  private deleteSelected(): void {
    const itemsToDelete = this.multiSelectMode && this.selectedItems.size > 0
      ? Array.from(this.selectedItems).map(i => this.queueItems[i])
      : [this.queueItems[this.selectedIndex]];

    itemsToDelete.filter(item => item).forEach(item => {
      this.syncQueue.deleteQueueItem(item.id);
    });

    logger.info(`Deleted ${itemsToDelete.length} items`);

    this.selectedItems.clear();
    this.refresh();
  }

  /**
   * Close viewer
   */
  private close(): void {
    logger.info('Closing sync queue viewer');
    this.hide();

    if (this.onComplete) {
      this.onComplete();
    }
  }
}
