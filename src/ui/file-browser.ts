import * as blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';

export class FileBrowser {
  private screen: blessed.Widgets.Screen;
  private container?: blessed.Widgets.BoxElement;
  private fileList?: blessed.Widgets.ListElement;
  private currentPath: string;
  private extensions: string[];
  private visible: boolean = false;

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
    this.currentPath = process.cwd();
    this.extensions = ['.json', '.csv'];
  }

  /**
   * Show file browser and return selected file path
   */
  async browse(extensions?: string[]): Promise<string | null> {
    if (this.visible) return null;

    if (extensions) {
      this.extensions = extensions;
    }

    return new Promise((resolve) => {
      this.createUI(() => resolve(null));

      this.fileList?.on('select', (item: blessed.Widgets.BlessedElement, index: number) => {
        const selectedText = item.content;
        const itemPath = path.join(this.currentPath, selectedText);

        if (selectedText === '..') {
          // Go up one directory
          this.currentPath = path.dirname(this.currentPath);
          this.refreshFileList();
        } else {
          try {
            const stats = fs.statSync(itemPath);
            if (stats.isDirectory()) {
              // Enter directory
              this.currentPath = itemPath;
              this.refreshFileList();
            } else {
              // File selected
              this.hide();
              resolve(itemPath);
            }
          } catch (error) {
            // Handle file access errors gracefully
            console.error('Error accessing path:', error);
            this.refreshFileList();
          }
        }
      });
    });
  }

  private createUI(onCancel: () => void): void {
    this.visible = true;

    this.container = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
        bg: 'black',
      },
      label: ' {bold}{cyan-fg}Select File{/cyan-fg}{/bold} ',
      tags: true,
    });

    // Current path display
    const pathDisplay = blessed.text({
      parent: this.container,
      top: 0,
      left: 1,
      right: 1,
      height: 1,
      content: `{bold}Path:{/bold} ${this.currentPath}`,
      tags: true,
      style: {
        fg: 'white',
      },
    });

    // File list
    this.fileList = blessed.list({
      parent: this.container,
      top: 2,
      left: 1,
      right: 1,
      bottom: 4,
      items: [],
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'gray',
        },
        selected: {
          bg: 'blue',
          fg: 'white',
        },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
    });

    // Help text
    blessed.text({
      parent: this.container,
      bottom: 2,
      left: 1,
      right: 1,
      height: 1,
      content: '{center}{gray-fg}↑↓: Navigate | Enter: Select | Esc: Cancel{/gray-fg}{/center}',
      tags: true,
    });

    // Load initial directory
    this.refreshFileList();

    // Key handlers
    this.container.key(['escape', 'q'], () => {
      this.hide();
      onCancel();
    });

    this.fileList.focus();
    this.screen.render();
  }

  private refreshFileList(): void {
    if (!this.fileList || !this.container) return;

    try {
      const items: string[] = [];

      // Add parent directory option
      if (this.currentPath !== '/') {
        items.push('..');
      }

      // Read directory contents
      const entries = fs.readdirSync(this.currentPath);

      // Separate directories and files
      const dirs: string[] = [];
      const files: string[] = [];

      for (const entry of entries) {
        const fullPath = path.join(this.currentPath, entry);
        try {
          const stats = fs.statSync(fullPath);

          if (stats.isDirectory()) {
            dirs.push(entry);
          } else if (this.extensions.length === 0 || this.extensions.some(ext => entry.endsWith(ext))) {
            files.push(entry);
          }
        } catch (error) {
          // Skip entries that can't be accessed
          continue;
        }
      }

      // Sort and add to items
      dirs.sort();
      files.sort();

      items.push(...dirs.map(d => `📁 ${d}`));
      items.push(...files.map(f => `📄 ${f}`));

      // Update list
      this.fileList.setItems(items);

      // Update path display
      const pathDisplay = this.container.children.find(c => c.type === 'text') as blessed.Widgets.TextElement;
      if (pathDisplay) {
        pathDisplay.setContent(`{bold}Path:{/bold} ${this.currentPath}`);
      }

      this.screen.render();
    } catch (error) {
      // If we can't read the directory, go back to parent
      if (this.currentPath !== '/') {
        this.currentPath = path.dirname(this.currentPath);
        this.refreshFileList();
      }
    }
  }

  private hide(): void {
    if (!this.visible) return;

    if (this.container) {
      this.container.destroy();
      this.container = undefined;
      this.fileList = undefined;
    }

    this.visible = false;
    this.screen.render();
  }

  /**
   * Set starting directory
   */
  setDirectory(dirPath: string): void {
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      this.currentPath = dirPath;
    }
  }

  /**
   * Set file extensions filter
   */
  setExtensions(extensions: string[]): void {
    this.extensions = extensions;
  }
}
