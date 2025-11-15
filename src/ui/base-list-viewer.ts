import blessed from 'blessed';

/**
 * Base class for all list-based viewers in the application.
 * Provides standardized navigation behavior (arrow keys, page up/down, home/end)
 * and automatic detail loading when navigating.
 *
 * Subclasses must implement:
 * - renderItem(item, index): Format item for list display
 * - renderDetail(item): Format item for detail view
 * - getItems(): Return array of items to display
 */
export abstract class BaseListViewer<T> {
  protected screen: blessed.Widgets.Screen;
  protected container: blessed.Widgets.BoxElement;
  protected list: blessed.Widgets.ListElement;
  protected detailBox: blessed.Widgets.BoxElement;

  protected items: T[] = [];
  protected selectedIndex: number = 0;

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
    this.container = this.createContainer();
    this.list = this.createList();
    this.detailBox = this.createDetailBox();
    this.setupNavigation();
  }

  /**
   * Create the main container element.
   * Subclasses can override to customize container properties.
   */
  protected createContainer(): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      hidden: true,
    });
  }

  /**
   * Create the list element.
   * Subclasses can override to customize list properties.
   */
  protected createList(): blessed.Widgets.ListElement {
    return blessed.list({
      parent: this.container,
      top: 0,
      left: 0,
      width: '50%',
      height: '100%',
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: '│',
        style: { fg: 'blue' }
      },
      style: {
        selected: {
          bg: 'blue',
          fg: 'white'
        },
        item: {
          fg: 'white'
        }
      }
    });
  }

  /**
   * Create the detail box element.
   * Subclasses can override to customize detail box properties.
   */
  protected createDetailBox(): blessed.Widgets.BoxElement {
    return blessed.box({
      parent: this.container,
      top: 0,
      left: '50%',
      width: '50%',
      height: '100%',
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: '│',
        style: { fg: 'blue' }
      },
      keys: true,
      vi: true,
      tags: true,
      style: {
        fg: 'white'
      }
    });
  }

  /**
   * Setup standardized navigation for all lists.
   * This provides consistent behavior across all list-based viewers.
   */
  private setupNavigation(): void {
    // Handle list selection changes (arrow keys, mouse clicks)
    this.list.on('select', (item, index) => {
      this.selectedIndex = index;  // Sync from select event
      this.updateDetailView();
      this.screen.render();
    });

    // Page up: Jump up by visible page size
    this.list.key(['pageup'], () => {
      this.pageUp();
    });

    // Page down: Jump down by visible page size
    this.list.key(['pagedown'], () => {
      this.pageDown();
    });

    // Home: Jump to first item
    this.list.key(['home'], () => {
      this.selectFirst();
    });

    // End: Jump to last item
    this.list.key(['end'], () => {
      this.selectLast();
    });

    // Explicit arrow key handlers to ensure detail updates
    // These fire even if the select event doesn't
    this.list.key(['up', 'k'], () => {
      this.selectedIndex = (this.list as any).selected;  // Sync from widget
      this.updateDetailView();
      this.screen.render();
    });

    this.list.key(['down', 'j'], () => {
      this.selectedIndex = (this.list as any).selected;  // Sync from widget
      this.updateDetailView();
      this.screen.render();
    });
  }

  /**
   * Jump up by one page (height of visible list area).
   */
  protected pageUp(): void {
    // Handle empty list
    if (this.items.length === 0) {
      return;
    }

    const pageSize = this.getPageSize();
    const newIndex = Math.max(0, this.selectedIndex - pageSize);

    // Ensure newIndex is within valid range
    if (newIndex >= 0 && newIndex < this.items.length) {
      this.list.select(newIndex);
      this.selectedIndex = newIndex;
      this.updateDetailView();
      this.screen.render();
    }
  }

  /**
   * Jump down by one page (height of visible list area).
   */
  protected pageDown(): void {
    // Handle empty list
    if (this.items.length === 0) {
      return;
    }

    const pageSize = this.getPageSize();
    const newIndex = Math.min(this.items.length - 1, this.selectedIndex + pageSize);

    // Ensure newIndex is within valid range
    if (newIndex >= 0 && newIndex < this.items.length) {
      this.list.select(newIndex);
      this.selectedIndex = newIndex;
      this.updateDetailView();
      this.screen.render();
    }
  }

  /**
   * Jump to first item in list.
   */
  protected selectFirst(): void {
    // Handle empty list
    if (this.items.length === 0) {
      return;
    }

    this.list.select(0);
    this.selectedIndex = 0;
    this.updateDetailView();
    this.screen.render();
  }

  /**
   * Jump to last item in list.
   */
  protected selectLast(): void {
    // Handle empty list
    if (this.items.length === 0) {
      return;
    }

    const lastIndex = this.items.length - 1;
    this.list.select(lastIndex);
    this.selectedIndex = lastIndex;
    this.updateDetailView();
    this.screen.render();
  }

  /**
   * Calculate visible page size based on list height.
   */
  protected getPageSize(): number {
    // Get list height (accounting for borders)
    const height = this.list.height as number;
    // Subtract 2 for borders, default to 10 if height is a percentage
    return typeof height === 'number' ? Math.max(1, height - 2) : 10;
  }

  /**
   * Update the detail view with the currently selected item.
   * Called automatically whenever navigation occurs.
   */
  protected updateDetailView(): void {
    // Bounds checking - ensure selectedIndex is valid
    if (this.selectedIndex < 0 || this.selectedIndex >= this.items.length) {
      this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.items.length - 1));
    }

    // Handle empty list
    if (this.items.length === 0) {
      this.detailBox.setContent('No items to display');
      return;
    }

    const currentItem = this.items[this.selectedIndex];

    if (!currentItem) {
      this.detailBox.setContent('No item selected');
      return;
    }

    const detailContent = this.renderDetail(currentItem);
    this.detailBox.setContent(detailContent);
  }

  /**
   * Refresh the list with current items.
   * Fetches items from getItems() and renders them.
   */
  public refreshList(): void {
    this.items = this.getItems();

    const listItems = this.items.map((item, index) => this.renderItem(item, index));
    this.list.setItems(listItems);

    // Preserve selection if valid, otherwise select first item
    if (this.selectedIndex >= this.items.length) {
      this.selectedIndex = Math.max(0, this.items.length - 1);
    }

    this.list.select(this.selectedIndex);
    this.updateDetailView();
    this.screen.render();
  }

  /**
   * Show the viewer.
   */
  public show(): void {
    this.container.show();
    this.list.focus();
    this.refreshList();
    this.screen.render();
  }

  /**
   * Hide the viewer.
   */
  public hide(): void {
    this.container.hide();
    this.screen.render();
  }

  /**
   * Check if viewer is visible.
   */
  public isVisible(): boolean {
    return !this.container.hidden;
  }

  // Abstract methods that subclasses must implement

  /**
   * Render a single item for display in the list.
   * @param item - The item to render
   * @param index - The item's index in the list
   * @returns Formatted string for list display
   */
  protected abstract renderItem(item: T, index: number): string;

  /**
   * Render detailed view of an item for the detail panel.
   * @param item - The item to render
   * @returns Formatted string (may include blessed tags) for detail display
   */
  protected abstract renderDetail(item: T): string;

  /**
   * Get the array of items to display in the list.
   * Called by refreshList() to populate the list.
   * @returns Array of items
   */
  protected abstract getItems(): T[];
}
