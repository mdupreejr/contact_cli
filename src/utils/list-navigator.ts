import * as blessed from 'blessed';

export interface ListNavigationOptions {
  /** The blessed list or box element to navigate */
  element: blessed.Widgets.ListElement | blessed.Widgets.BoxElement;

  /** Callback when selection changes */
  onSelectionChange?: (index: number) => void;

  /** Callback when an item is activated (Enter key) */
  onActivate?: (index: number) => void;

  /** Number of items to scroll per page up/down (default: 10) */
  pageSize?: number;

  /** Whether to wrap around at the beginning/end (default: false) */
  wrapAround?: boolean;

  /** Enable vim-style navigation keys (j/k) (default: true) */
  enableVimKeys?: boolean;
}

/**
 * Standardized list navigation utility for blessed components
 * Provides consistent keyboard navigation across all list-based UI elements
 */
export class ListNavigator {
  private element: blessed.Widgets.ListElement | blessed.Widgets.BoxElement;
  private onSelectionChange?: (index: number) => void;
  private onActivate?: (index: number) => void;
  private pageSize: number;
  private wrapAround: boolean;
  private enableVimKeys: boolean;
  private currentIndex = 0;
  private itemCount = 0;

  constructor(options: ListNavigationOptions) {
    this.element = options.element;
    this.onSelectionChange = options.onSelectionChange;
    this.onActivate = options.onActivate;
    this.pageSize = options.pageSize || 10;
    this.wrapAround = options.wrapAround !== undefined ? options.wrapAround : false;
    this.enableVimKeys = options.enableVimKeys !== undefined ? options.enableVimKeys : true;

    this.setupKeyHandlers();
  }

  /**
   * Set up standard keyboard handlers for list navigation
   */
  private setupKeyHandlers(): void {
    // Arrow keys
    this.element.key(['up'], () => this.moveUp());
    this.element.key(['down'], () => this.moveDown());

    // Vim keys (if enabled)
    if (this.enableVimKeys) {
      this.element.key(['k', 'K'], () => this.moveUp());
      this.element.key(['j', 'J'], () => this.moveDown());
    }

    // Page navigation
    this.element.key(['pageup'], () => this.pageUp());
    this.element.key(['pagedown'], () => this.pageDown());

    // Home/End
    this.element.key(['home', 'g'], () => this.moveToStart());
    this.element.key(['end', 'G'], () => this.moveToEnd());

    // Enter to activate
    if (this.onActivate) {
      this.element.key(['enter'], () => {
        if (this.onActivate) {
          this.onActivate(this.currentIndex);
        }
      });
    }

    // For blessed lists, also listen to the select event
    if (this.isList(this.element)) {
      this.element.on('select', () => {
        this.currentIndex = (this.element as any).selected || 0;
        this.notifySelectionChange();
      });
    }
  }

  /**
   * Move selection up by one item
   */
  moveUp(): void {
    if (this.itemCount === 0) return;

    if (this.currentIndex > 0) {
      this.setIndex(this.currentIndex - 1);
    } else if (this.wrapAround) {
      this.setIndex(this.itemCount - 1);
    }
  }

  /**
   * Move selection down by one item
   */
  moveDown(): void {
    if (this.itemCount === 0) return;

    if (this.currentIndex < this.itemCount - 1) {
      this.setIndex(this.currentIndex + 1);
    } else if (this.wrapAround) {
      this.setIndex(0);
    }
  }

  /**
   * Move selection up by one page
   */
  pageUp(): void {
    if (this.itemCount === 0) return;

    const newIndex = Math.max(0, this.currentIndex - this.pageSize);
    this.setIndex(newIndex);
  }

  /**
   * Move selection down by one page
   */
  pageDown(): void {
    if (this.itemCount === 0) return;

    const newIndex = Math.min(this.itemCount - 1, this.currentIndex + this.pageSize);
    this.setIndex(newIndex);
  }

  /**
   * Move to the first item
   */
  moveToStart(): void {
    if (this.itemCount > 0) {
      this.setIndex(0);
    }
  }

  /**
   * Move to the last item
   */
  moveToEnd(): void {
    if (this.itemCount > 0) {
      this.setIndex(this.itemCount - 1);
    }
  }

  /**
   * Set the current index and update the UI
   */
  setIndex(index: number): void {
    if (index < 0 || index >= this.itemCount) return;

    this.currentIndex = index;

    // Update the blessed element
    if (this.isList(this.element)) {
      (this.element as any).select(index);
    }

    this.notifySelectionChange();
  }

  /**
   * Get the current selected index
   */
  getIndex(): number {
    return this.currentIndex;
  }

  /**
   * Update the item count (call this when the list content changes)
   */
  setItemCount(count: number): void {
    this.itemCount = count;

    // Ensure current index is still valid
    if (this.currentIndex >= count) {
      this.currentIndex = Math.max(0, count - 1);
    }
  }

  /**
   * Advance to the next item (useful for workflows like suggestion approval)
   * Returns true if moved to next item, false if at the end
   */
  advanceToNext(): boolean {
    if (this.currentIndex < this.itemCount - 1) {
      this.setIndex(this.currentIndex + 1);
      return true;
    }
    return false;
  }

  /**
   * Go back to the previous item
   * Returns true if moved to previous item, false if at the beginning
   */
  goToPrevious(): boolean {
    if (this.currentIndex > 0) {
      this.setIndex(this.currentIndex - 1);
      return true;
    }
    return false;
  }

  /**
   * Notify that selection has changed
   */
  private notifySelectionChange(): void {
    if (this.onSelectionChange) {
      // Use setImmediate to ensure the UI has updated
      setImmediate(() => {
        if (this.onSelectionChange) {
          this.onSelectionChange(this.currentIndex);
        }
      });
    }
  }

  /**
   * Type guard to check if element is a blessed list
   */
  private isList(element: any): element is blessed.Widgets.ListElement {
    return typeof element.select === 'function' && typeof element.getItem === 'function';
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    // Remove all key handlers - blessed handles this automatically
    // when the element is removed from the screen
  }
}

/**
 * Helper function to quickly set up standard list navigation
 * @param element The blessed list element
 * @param onSelectionChange Callback when selection changes
 * @param options Additional options
 */
export function setupListNavigation(
  element: blessed.Widgets.ListElement | blessed.Widgets.BoxElement,
  onSelectionChange?: (index: number) => void,
  options?: Partial<ListNavigationOptions>
): ListNavigator {
  return new ListNavigator({
    element,
    onSelectionChange,
    ...options,
  });
}
