import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { SyncQueue, SyncQueueItem, SyncStatus } from '../db/sync-queue';
import { ContactStore } from '../db/contact-store';
import { Contact } from '../types/contactsplus';
import { logger } from '../utils/logger';
import { SyncEngine } from '../db/sync-engine';
import { ContactsApi } from '../api/contacts';
import { BaseListViewer } from './base-list-viewer';
import { CircularBuffer } from '../utils/circular-buffer';

/**
 * Sync Queue Viewer
 * UI for manually reviewing and approving queued sync operations
 * Extends BaseListViewer for consistent navigation behavior
 */
export class SyncQueueViewer extends BaseListViewer<SyncQueueItem> {
  private syncQueue: SyncQueue;
  private contactStore: ContactStore;
  private api: ContactsApi;
  private syncEngine: SyncEngine;
  private syncCancelled: boolean = false;
  private syncInProgress: boolean = false;

  private headerBox: Widgets.BoxElement | null = null;
  private statusBar: Widgets.BoxElement | null = null;

  private filterStatus: SyncStatus | 'all' = 'all';
  private filterSource: string | 'all' = 'all';
  private selectedItems: Set<number> = new Set();

  private onComplete: (() => void) | null = null;
  private syncLogBuffer = new CircularBuffer<string>(1000);

  constructor(screen: Widgets.Screen, syncQueue: SyncQueue, contactStore: ContactStore, api: ContactsApi) {
    super(screen);
    this.syncQueue = syncQueue;
    this.contactStore = contactStore;
    this.api = api;
    this.syncEngine = new SyncEngine(api);
  }

  /**
   * Show sync queue viewer with completion callback
   */
  showWithCallback(onComplete: () => void): void {
    this.onComplete = onComplete;
    this.createCustomUI();
    this.setupCustomKeyBindings();
    super.show();
  }

  /**
   * Hide the viewer
   */
  hide(): void {
    if (this.headerBox) {
      this.headerBox.destroy();
      this.headerBox = null;
    }
    if (this.statusBar) {
      this.statusBar.destroy();
      this.statusBar = null;
    }
    super.hide();
  }

  /**
   * Create custom UI elements (header and status bar)
   */
  private createCustomUI(): void {
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

    this.updateHeader();
    this.updateStatusBar();
  }

  /**
   * Override createList to customize list position and styling
   */
  protected createList(): blessed.Widgets.ListElement {
    return blessed.list({
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
  }

  /**
   * Override createDetailBox to customize detail box position and styling
   */
  protected createDetailBox(): blessed.Widgets.BoxElement {
    return blessed.box({
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
  }

  /**
   * Setup custom key bindings for sync queue operations
   */
  private setupCustomKeyBindings(): void {
    this.list.key(['escape', 'q'], () => {
      this.close();
    });

    this.list.key(['r'], () => {
      this.refresh();
    });

    this.list.key(['f'], () => {
      this.cycleFilter();
    });

    this.list.key(['a'], () => {
      this.approveSelected();
    });

    this.list.key(['x'], () => {
      this.rejectSelected();
    });

    this.list.key(['space'], () => {
      this.toggleSelection();
    });

    this.list.key(['A'], () => {
      this.approveAll();
    });

    this.list.key(['X'], () => {
      this.rejectAll();
    });

    this.list.key(['d'], () => {
      this.deleteSelected();
    });

    this.list.key(['x'], () => {
      this.clearFailedItems();
    });

    this.list.key(['s'], () => {
      // Atomic check-and-set in synchronous context
      if (this.syncInProgress) {
        this.showSyncMessage('Sync already in progress. Please wait...', 'warning');
        return;
      }
      this.syncInProgress = true;  // SET FLAG HERE (synchronously)

      this.syncApprovedItems()
        .finally(() => {
          this.syncInProgress = false;
          this.updateStatusBar();
        });
    });

    this.list.key(['c'], () => {
      if (this.syncCancelled !== undefined) {
        this.syncCancelled = true;
        this.showSyncMessage('Cancelling sync...', 'warning');
      }
    });

    this.list.key(['up', 'down'], () => {
      this.updateDetailView();
      this.screen.render();
    });
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
   * Override updateDetailView to also update header and status bar
   */
  protected updateDetailView(): void {
    this.updateHeader();
    this.updateStatusBar();
    super.updateDetailView();
  }

  /**
   * Implement abstract method: Get items to display
   */
  protected getItems(): SyncQueueItem[] {
    if (this.filterStatus === 'all') {
      return this.syncQueue.getQueueItems();
    } else {
      return this.syncQueue.getQueueItems({ syncStatus: this.filterStatus });
    }
  }

  /**
   * Implement abstract method: Render item for list display
   */
  protected renderItem(item: SyncQueueItem, index: number): string {
    const checkbox = this.selectedItems.has(index) ? '☑' : '☐';
    const statusIcon = this.getStatusIcon(item.syncStatus);
    const operationIcon = this.getOperationIcon(item.operation);
    const toolLabel = this.getToolLabel(item.importSessionId);

    const contactName = this.getContactName(item.contactId);
    const statusColor = this.getStatusColor(item.syncStatus);

    return `${checkbox} ${statusIcon} ${operationIcon} ${contactName} {gray-fg}[${toolLabel}]{/gray-fg} {${statusColor}}[${item.syncStatus}]{/${statusColor}}`;
  }

  /**
   * Implement abstract method: Render detail view for selected item
   */
  protected renderDetail(item: SyncQueueItem): string {
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

    return lines.join('\n');
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

    // Detect all changes using deep comparison
    const changes = this.detectChanges(before, after);

    // Display all changes with clear before/after labeling
    for (const change of changes) {
      lines.push(`{yellow-fg}${change.fieldLabel}:{/yellow-fg}`);
      lines.push(`  {red-fg}Before: ${change.oldValue}{/red-fg}`);
      lines.push(`  {green-fg}After:  ${change.newValue}{/green-fg}`);
      lines.push('');
    }

    // If no changes detected, show message
    if (changes.length === 0) {
      lines.push('{gray-fg}No changes detected{/gray-fg}');
    }

    return lines;
  }

  /**
   * Detect all field changes between before and after contact data
   */
  private detectChanges(
    before: Contact['contactData'],
    after: Contact['contactData']
  ): Array<{ fieldLabel: string; oldValue: string; newValue: string }> {
    const changes: Array<{ fieldLabel: string; oldValue: string; newValue: string }> = [];

    // Name comparison
    const nameBefore = this.getFullNameFromData(before);
    const nameAfter = this.getFullNameFromData(after);
    if (nameBefore !== nameAfter) {
      changes.push({
        fieldLabel: 'Name',
        oldValue: nameBefore,
        newValue: nameAfter,
      });
    }

    // Email comparison
    const emailsBefore = before.emails?.map(e => e.value).join(', ') || 'none';
    const emailsAfter = after.emails?.map(e => e.value).join(', ') || 'none';
    if (emailsBefore !== emailsAfter) {
      changes.push({
        fieldLabel: 'Emails',
        oldValue: emailsBefore,
        newValue: emailsAfter,
      });
    }

    // Phone comparison
    const phonesBefore = before.phoneNumbers?.map(p => p.value).join(', ') || 'none';
    const phonesAfter = after.phoneNumbers?.map(p => p.value).join(', ') || 'none';
    if (phonesBefore !== phonesAfter) {
      changes.push({
        fieldLabel: 'Phone Numbers',
        oldValue: phonesBefore,
        newValue: phonesAfter,
      });
    }

    // Compare all organizations (not just first one)
    const maxOrgs = Math.max(
      before.organizations?.length || 0,
      after.organizations?.length || 0
    );

    for (let i = 0; i < maxOrgs; i++) {
      const orgBefore = before.organizations?.[i];
      const orgAfter = after.organizations?.[i];

      // Company name comparison
      const companyBefore = orgBefore?.name || 'none';
      const companyAfter = orgAfter?.name || 'none';
      if (companyBefore !== companyAfter) {
        const label = maxOrgs > 1 ? `Company Name [${i}]` : 'Company Name';
        changes.push({
          fieldLabel: label,
          oldValue: companyBefore,
          newValue: companyAfter,
        });
      }

      // Job title comparison
      const titleBefore = orgBefore?.title || 'none';
      const titleAfter = orgAfter?.title || 'none';
      if (titleBefore !== titleAfter) {
        const label = maxOrgs > 1 ? `Job Title [${i}]` : 'Job Title';
        changes.push({
          fieldLabel: label,
          oldValue: titleBefore,
          newValue: titleAfter,
        });
      }

      // Department comparison
      const deptBefore = orgBefore?.department || 'none';
      const deptAfter = orgAfter?.department || 'none';
      if (deptBefore !== deptAfter) {
        const label = maxOrgs > 1 ? `Department [${i}]` : 'Department';
        changes.push({
          fieldLabel: label,
          oldValue: deptBefore,
          newValue: deptAfter,
        });
      }
    }

    // URLs comparison
    const urlsBefore = before.urls?.map(u => u.value).join(', ') || 'none';
    const urlsAfter = after.urls?.map(u => u.value).join(', ') || 'none';
    if (urlsBefore !== urlsAfter) {
      changes.push({
        fieldLabel: 'URLs',
        oldValue: urlsBefore,
        newValue: urlsAfter,
      });
    }

    // Notes comparison
    const notesBefore = before.notes || 'none';
    const notesAfter = after.notes || 'none';
    if (notesBefore !== notesAfter) {
      changes.push({
        fieldLabel: 'Notes',
        oldValue: notesBefore,
        newValue: notesAfter,
      });
    }

    // Addresses comparison
    const addrBefore = before.addresses?.map(a =>
      [a.street, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', ')
    ).join(' | ') || 'none';
    const addrAfter = after.addresses?.map(a =>
      [a.street, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', ')
    ).join(' | ') || 'none';
    if (addrBefore !== addrAfter) {
      changes.push({
        fieldLabel: 'Addresses',
        oldValue: addrBefore,
        newValue: addrAfter,
      });
    }

    return changes;
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

    // Show sync in progress indicator or selection count
    let statusLine = '';
    if (this.syncInProgress) {
      statusLine = `{yellow-fg}SYNC IN PROGRESS - Please wait...{/yellow-fg}`;
    } else if (this.selectedItems.size > 0) {
      statusLine = `{yellow-fg}${this.selectedItems.size} item(s) selected{/yellow-fg}`;
    }

    const controls = [
      '{cyan-fg}[R]{/cyan-fg} Refresh',
      '{cyan-fg}[F]{/cyan-fg} Filter',
      '{green-fg}[A]{/green-fg} Approve',
      '{red-fg}[X]{/red-fg} Reject',
      this.syncInProgress ? '{gray-fg}[S]{/gray-fg} Sync (disabled)' : '{green-fg}[S]{/green-fg} Sync',
      '{cyan-fg}[Space]{/cyan-fg} Toggle Select',
      '{red-fg}[D]{/red-fg} Delete',
      '{cyan-fg}[x]{/cyan-fg} Clear Failed',
      '{cyan-fg}[ESC]{/cyan-fg} Back',
    ];

    this.statusBar.setContent(
      `${statusLine}\n${controls.join(' | ')}`
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
  private async refresh(): Promise<void> {
    this.refreshList();
    await new Promise(resolve => setImmediate(resolve));
    logger.info('Queue refreshed');
  }

  /**
   * Cycle through filter options
   */
  private cycleFilter(): void {
    const filters: Array<SyncStatus | 'all'> = ['all', 'pending', 'approved', 'syncing', 'synced', 'failed'];
    const currentIndex = filters.indexOf(this.filterStatus);
    this.filterStatus = filters[(currentIndex + 1) % filters.length];

    this.selectedIndex = 0;
    this.selectedItems.clear();
    this.refreshList();
  }

  /**
   * Toggle selection of current item
   */
  private toggleSelection(): void {
    if (this.selectedItems.has(this.selectedIndex)) {
      this.selectedItems.delete(this.selectedIndex);
    } else {
      this.selectedItems.add(this.selectedIndex);
    }

    this.refreshList();
  }

  /**
   * Approve selected items
   */
  private approveSelected(): void {
    const processedContexts = this.selectedItems.size > 0
      ? Array.from(this.selectedItems)
          .map(index => ({ index, item: this.items[index] }))
      : [{ index: this.selectedIndex, item: this.items[this.selectedIndex] }];

    const validContexts = processedContexts.filter(
      (context): context is { index: number; item: SyncQueueItem } =>
        context.index >= 0 &&
        context.index < this.items.length &&
        Boolean(context.item)
    );

    if (validContexts.length === 0) {
      logger.warn('No items selected to approve');
      return;
    }

    const queueItemIds = validContexts.map(context => context.item.id);
    const processedIndices = validContexts.map(context => context.index);
    const fallbackIndex = processedIndices.length > 0
      ? Math.min(...processedIndices)
      : this.selectedIndex;

    this.syncQueue.approveMultiple(queueItemIds);
    this.selectedItems.clear();

    // Refresh items from database
    this.items = this.getItems();

    const listItems = this.items.map((item, index) => this.renderItem(item, index));
    this.list.setItems(listItems);

    this.advanceSelection(queueItemIds, fallbackIndex);
    this.updateDetailView();
    this.updateHeader();
    this.updateStatusBar();
    this.screen.render();

    logger.info(`Approved ${queueItemIds.length} items, now showing index ${this.selectedIndex}/${this.items.length}`);
  }

  /**
   * Reject selected items
   */
  private rejectSelected(): void {
    const processedContexts = this.selectedItems.size > 0
      ? Array.from(this.selectedItems)
          .map(index => ({ index, item: this.items[index] }))
      : [{ index: this.selectedIndex, item: this.items[this.selectedIndex] }];

    const validContexts = processedContexts.filter(
      (context): context is { index: number; item: SyncQueueItem } =>
        context.index >= 0 &&
        context.index < this.items.length &&
        Boolean(context.item)
    );

    if (validContexts.length === 0) {
      logger.warn('No items selected to reject');
      return;
    }

    const queueItemIds = validContexts.map(context => context.item.id);
    const processedIndices = validContexts.map(context => context.index);
    const fallbackIndex = processedIndices.length > 0
      ? Math.min(...processedIndices)
      : this.selectedIndex;

    this.syncQueue.rejectMultiple(queueItemIds);
    this.selectedItems.clear();

    // Refresh items from database
    this.items = this.getItems();

    const listItems = this.items.map((item, index) => this.renderItem(item, index));
    this.list.setItems(listItems);

    this.advanceSelection(queueItemIds, fallbackIndex);
    this.updateDetailView();
    this.updateHeader();
    this.updateStatusBar();
    this.screen.render();

    logger.info(`Rejected ${queueItemIds.length} items, now showing index ${this.selectedIndex}/${this.items.length}`);
  }

  /**
   * Update list selection after an approve/reject action.
   * Moves focus to the next logical item and keeps detail view in sync.
   */
  private advanceSelection(processedIds: number[], fallbackIndex: number): void {
    if (this.items.length === 0) {
      this.selectedIndex = 0;
      if (this.detailBox) {
        this.detailBox.setContent('No items to display');
      }
      return;
    }

    const processedSet = new Set(processedIds);
    const maxIndex = this.items.length - 1;
    const normalizedFallback = Math.max(0, Math.min(fallbackIndex, maxIndex));

    let nextIndex = normalizedFallback;

    for (let i = normalizedFallback; i <= maxIndex; i++) {
      if (!processedSet.has(this.items[i].id)) {
        nextIndex = i;
        break;
      }
    }

    if (processedSet.has(this.items[nextIndex]?.id)) {
      for (let i = 0; i < normalizedFallback; i++) {
        if (!processedSet.has(this.items[i].id)) {
          nextIndex = i;
          break;
        }
      }
    }

    if (processedSet.has(this.items[nextIndex]?.id)) {
      nextIndex = normalizedFallback;
    }

    this.selectedIndex = Math.max(0, Math.min(nextIndex, maxIndex));
    (this.list as any).selected = this.selectedIndex;
    this.list.select(this.selectedIndex);
  }

  /**
   * Approve all filtered items
   */
  private approveAll(): void {
    const ids = this.items.map(item => item.id);
    this.syncQueue.approveMultiple(ids);

    logger.info(`Approved all ${ids.length} items`);

    this.selectedItems.clear();
    this.refresh();
  }

  /**
   * Reject all filtered items
   */
  private rejectAll(): void {
    const ids = this.items.map(item => item.id);
    this.syncQueue.rejectMultiple(ids);

    logger.info(`Rejected all ${ids.length} items`);

    this.selectedItems.clear();
    this.refresh();
  }

  /**
   * Delete selected items
   */
  private deleteSelected(): void {
    const itemsToDelete = this.selectedItems.size > 0
      ? Array.from(this.selectedItems).map(i => this.items[i])
      : [this.items[this.selectedIndex]];

    itemsToDelete.filter(item => item).forEach(item => {
      this.syncQueue.deleteQueueItem(item.id);
    });

    logger.info(`Deleted ${itemsToDelete.length} items`);

    this.selectedItems.clear();
    this.refreshList();
  }

  /**
   * Clear all failed items from the queue
   */
  private async clearFailedItems(): Promise<void> {
    const failedItems = this.items.filter(item => item.syncStatus === 'failed');

    if (failedItems.length === 0) {
      this.showSyncMessage('No failed items to clear', 'info');
      return;
    }

    // Ask for confirmation
    const confirmed = await this.showConfirmDialog(
      'Clear Failed Items',
      `Are you sure you want to remove all ${failedItems.length} failed items from the queue?`
    );

    if (!confirmed) {
      return;
    }

    // Delete all failed items
    let deletedCount = 0;
    for (const item of failedItems) {
      this.syncQueue.deleteQueueItem(item.id);
      deletedCount++;
    }

    logger.info(`Cleared ${deletedCount} failed items from queue`);
    this.showSyncMessage(`Cleared ${deletedCount} failed items`, 'success');

    await this.refresh();
  }

  /**
   * Show a confirmation dialog
   */
  private showConfirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: 60,
        height: 8,
        border: { type: 'line' },
        style: {
          fg: 'white',
          bg: 'black',
          border: { fg: 'yellow' },
        },
        tags: true,
        label: ` ${title} `,
      });

      const messageBox = blessed.box({
        parent: dialog,
        top: 1,
        left: 1,
        width: '100%-2',
        height: 3,
        content: `{center}${message}{/center}`,
        tags: true,
      });

      const buttonBox = blessed.box({
        parent: dialog,
        bottom: 1,
        left: 1,
        width: '100%-2',
        height: 2,
        content: '{center}[Y] Yes  [N] No{/center}',
        tags: true,
      });

      dialog.focus();
      this.screen.render();

      const cleanup = (result: boolean) => {
        this.screen.remove(dialog);
        this.list.focus();
        this.screen.render();
        resolve(result);
      };

      dialog.key(['y', 'Y'], () => cleanup(true));
      dialog.key(['n', 'N', 'escape'], () => cleanup(false));
    });
  }

  /**
   * Sync all approved items to the API
   */
  private async syncApprovedItems(): Promise<void> {
    try {
      const approvedItems = this.syncQueue.getApprovedItems()
        .filter(item => item.retryCount < 3);

      if (approvedItems.length === 0) {
        const totalApproved = this.syncQueue.getApprovedItems().length;
        if (totalApproved > 0) {
          this.showSyncMessage(
            `All ${totalApproved} approved items have exceeded maximum retry count (3).\n\nPlease review and re-approve items if needed.`,
            'warning'
          );
        } else {
          this.showSyncMessage('No approved items to sync', 'warning');
        }
        return;
      }

      // Check if readonly mode is enabled
      const readonlyMode = process.env.READONLY_MODE === 'true';
      if (readonlyMode) {
        this.showSyncMessage(
          `READONLY_MODE is enabled.\n\nFound ${approvedItems.length} approved items ready to sync.\n\nTo sync to ContactsPlus API:\n1. Set READONLY_MODE=false in .env\n2. Restart the app\n3. Come back here and press 's' to sync`,
          'warning'
        );
        return;
      }

      this.updateStatusBar(); // Update UI to show sync in progress

      // Initialize scrollable sync log
      this.initSyncLog();
      this.appendSyncLog(`Starting sync of ${approvedItems.length} approved items to ContactsPlus API...`, 'info');

      const BATCH_SIZE = 10;
      const items = approvedItems;

      this.syncCancelled = false;

      let successCount = 0;
      let consecutiveFailures = 0;
      const MAX_CONSECUTIVE_FAILURES = 5;

      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        if (this.syncCancelled) {
          this.appendSyncLog('\n' + '='.repeat(60), 'info');
          this.appendSyncLog('Sync cancelled by user', 'warning');
          this.appendSyncLog('='.repeat(60), 'info');
          break;
        }
        const batch = items.slice(i, i + BATCH_SIZE);

        for (const item of batch) {
          const itemIndex = i + batch.indexOf(item);
          this.appendSyncLog(`[${itemIndex + 1}/${items.length}] Processing item...`, 'info');

          const result = await this.syncEngine.syncItem(item.id);

          if (result.success) {
            this.appendSyncLog(`  ✓ Completed successfully`, 'success');
            successCount++;
            consecutiveFailures = 0;
          } else if (result.error === 'Item already being synced by another process') {
            this.appendSyncLog(`  ⟳ Already being synced, skipping...`, 'info');
          } else {
            this.appendSyncLog(`  ✗ Failed: ${result.error}`, 'error');
            consecutiveFailures++;

            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              this.appendSyncLog('\n' + '='.repeat(60), 'error');
              this.appendSyncLog('Too many consecutive failures - stopping sync to prevent cascade', 'error');
              this.appendSyncLog('Please check your connection and try again', 'warning');
              this.appendSyncLog('='.repeat(60), 'error');
              break;
            }
          }
        }

        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setTimeout(resolve, 100));

        await this.refresh();
      }

      const successRate = successCount / items.length;

      // Add completion summary to log
      this.appendSyncLog('\n' + '='.repeat(60), 'info');
      if (successRate === 1) {
        this.appendSyncLog(`Sync Complete! All ${items.length} items synced successfully.`, 'success');
      } else if (successRate === 0) {
        this.appendSyncLog(`Sync Failed! All ${items.length} items failed to sync.`, 'error');
      } else {
        this.appendSyncLog(`Sync Complete with errors. ${successCount}/${items.length} succeeded.`, 'warning');
      }
      this.appendSyncLog('='.repeat(60), 'info');

      // Auto-delete synced items from queue to keep it clean
      if (successCount > 0) {
        const deletedCount = this.syncQueue.clearSyncedItems();
        this.appendSyncLog(`Removed ${deletedCount} successfully synced items from queue.`, 'info');
      }

      // Refresh the queue to show updated status
      setTimeout(() => {
        this.refresh();
      }, 2000);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.appendSyncLog(`Sync failed: ${errorMessage}`, 'error');
      logger.error('Sync failed:', error);
    }
  }

  /**
   * Format sync progress with detailed changes
   */
  private formatSyncProgress(item: SyncQueueItem): string {
    const lines: string[] = [];

    // Get contact name
    const contactName = this.getContactName(item.contactId);
    lines.push(`{yellow-fg}Contact:{/yellow-fg} {bold}${contactName}{/bold}`);
    lines.push(`{yellow-fg}Operation:{/yellow-fg} ${item.operation.toUpperCase()}`);
    lines.push('');

    // Show what's changing
    if (item.operation === 'update' && item.dataBefore && item.dataAfter) {
      const before = item.dataBefore;
      const after = item.dataAfter;

      // Name changes
      const nameBefore = this.getFullNameFromData(before);
      const nameAfter = this.getFullNameFromData(after);
      if (nameBefore !== nameAfter) {
        lines.push(`{cyan-fg}Name:{/cyan-fg}`);
        lines.push(`  {red-fg}${nameBefore}{/red-fg} → {green-fg}${nameAfter}{/green-fg}`);
      }

      // Phone changes
      const phonesBefore = before.phoneNumbers?.map(p => p.value).join(', ') || '';
      const phonesAfter = after.phoneNumbers?.map(p => p.value).join(', ') || '';
      if (phonesBefore !== phonesAfter) {
        lines.push(`{cyan-fg}Phone:{/cyan-fg}`);
        if (phonesBefore) lines.push(`  {red-fg}${phonesBefore}{/red-fg}`);
        if (phonesAfter) lines.push(`  {green-fg}${phonesAfter}{/green-fg}`);
      }

      // Email changes
      const emailsBefore = before.emails?.map(e => e.value).join(', ') || '';
      const emailsAfter = after.emails?.map(e => e.value).join(', ') || '';
      if (emailsBefore !== emailsAfter) {
        lines.push(`{cyan-fg}Email:{/cyan-fg}`);
        if (emailsBefore) lines.push(`  {red-fg}${emailsBefore}{/red-fg}`);
        if (emailsAfter) lines.push(`  {green-fg}${emailsAfter}{/green-fg}`);
      }

      // Company changes
      const companyBefore = before.organizations?.[0]?.name || '';
      const companyAfter = after.organizations?.[0]?.name || '';
      if (companyBefore !== companyAfter) {
        lines.push(`{cyan-fg}Company:{/cyan-fg}`);
        lines.push(`  {red-fg}${companyBefore || 'none'}{/red-fg} → {green-fg}${companyAfter || 'none'}{/green-fg}`);
      }
    } else if (item.operation === 'create' && item.dataAfter) {
      lines.push(`{green-fg}Creating new contact{/green-fg}`);
      if (item.dataAfter.emails && item.dataAfter.emails.length > 0) {
        lines.push(`Email: ${item.dataAfter.emails[0].value}`);
      }
      if (item.dataAfter.phoneNumbers && item.dataAfter.phoneNumbers.length > 0) {
        lines.push(`Phone: ${item.dataAfter.phoneNumbers[0].value}`);
      }
    }

    lines.push('');
    lines.push(`{gray-fg}Contact ID: ${item.contactId.substring(0, 12)}...{/gray-fg}`);

    return lines.join('\n');
  }

  /**
   * Initialize sync log (clear content and prepare for scrolling)
   */
  private initSyncLog(): void {
    if (!this.detailBox) return;
    this.detailBox.setContent('');
    this.detailBox.setScrollPerc(100); // Start at bottom
  }

  /**
   * Append a line to the sync log with auto-scroll and size limits
   */
  private appendSyncLog(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
    if (!this.detailBox) return;

    const colors: Record<typeof type, string> = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
    };

    const color = colors[type];
    this.syncLogBuffer.push(`{${color}-fg}${message}{/${color}-fg}`);

    this.detailBox.setContent(this.syncLogBuffer.getAll().join('\n'));
    this.detailBox.setScrollPerc(100);
    this.screen.render();
  }

  /**
   * Show a sync progress/result message
   */
  private showSyncMessage(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
    if (!this.detailBox) return;

    const colors: Record<typeof type, string> = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
    };

    const color = colors[type];
    this.detailBox.setContent(`{${color}-fg}${message}{/${color}-fg}`);
    this.screen.render();
  }

  /**
   * Get human-readable tool label from import session ID
   */
  private getToolLabel(importSessionId?: string): string {
    if (!importSessionId) return 'manual';

    if (importSessionId === 'background_analysis') return 'ML Auto';
    if (importSessionId.includes('duplicate')) return 'DupNames';
    if (importSessionId.includes('phone')) return 'PhoneNorm';
    if (importSessionId.includes('email')) return 'EmailFix';
    if (importSessionId.includes('company')) return 'CompanyClean';
    if (importSessionId.includes('csv')) return 'CSV Import';

    return importSessionId.substring(0, 10);
  }

  /**
   * Check if viewer is showing
   */
  isShowing(): boolean {
    return this.isVisible();
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
