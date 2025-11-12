import * as blessed from 'blessed';
import { logger, LogLevel } from '../utils/logger';

export class LoggingScreen {
  private screen: blessed.Widgets.Screen;
  private logBox: blessed.Widgets.BoxElement;
  private logList: blessed.Widgets.ListElement;
  private filterBox: blessed.Widgets.BoxElement;
  private footerBox: blessed.Widgets.BoxElement;
  private isVisible = false;
  private logEntries: Array<{ timestamp: Date; level: string; message: string }> = [];
  private filteredEntries: Array<{ timestamp: Date; level: string; message: string }> = [];
  private currentFilter: LogLevel | null = null;
  private autoScroll = true;

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
    this.createLoggingUI();
    this.setupEventHandlers();
    
    // Start collecting logs
    this.startLogCollection();
  }

  private createLoggingUI(): void {
    // Main logging container
    this.logBox = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
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
      label: ' {bold}{cyan-fg}ContactsPlus Logs{/cyan-fg}{/bold} ',
    });

    // Filter controls at the top
    this.filterBox = blessed.box({
      top: 1,
      left: 1,
      width: '100%-2',
      height: 3,
      content: this.getFilterContent(),
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'green',
        },
      },
      tags: true,
      label: ' Filter Controls ',
    });

    // Log list in the middle
    this.logList = blessed.list({
      top: 4,
      left: 1,
      width: '100%-2',
      height: '100%-8',
      items: [],
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
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      label: ' Log Entries ',
    });

    // Footer with controls
    this.footerBox = blessed.box({
      bottom: 1,
      left: 1,
      width: '100%-2',
      height: 3,
      content: this.getFooterContent(),
      style: {
        fg: 'white',
        bg: 'black',
      },
      tags: true,
    });

    this.logBox.append(this.filterBox);
    this.logBox.append(this.logList);
    this.logBox.append(this.footerBox);
    this.screen.append(this.logBox);
  }

  private getFilterContent(): string {
    const filterText = this.currentFilter !== null ? LogLevel[this.currentFilter] : 'ALL';
    const autoScrollText = this.autoScroll ? 'ON' : 'OFF';
    
    return `Filter: {bold}{yellow-fg}${filterText}{/yellow-fg}{/bold} | Auto-scroll: {bold}{green-fg}${autoScrollText}{/green-fg}{/bold} | Logs: {bold}{cyan-fg}${this.filteredEntries.length}{/cyan-fg}{/bold}`;
  }

  private getFooterContent(): string {
    return ' {cyan-fg}↑↓{/cyan-fg}: Navigate | {cyan-fg}1-4{/cyan-fg}: Filter levels | {cyan-fg}a{/cyan-fg}: Auto-scroll | {cyan-fg}c{/cyan-fg}: Clear | {cyan-fg}e{/cyan-fg}: Export | {cyan-fg}q{/cyan-fg}: Back';
  }

  private setupEventHandlers(): void {
    // Filter by log level
    this.logBox.key(['1'], () => this.setFilter(LogLevel.ERROR));
    this.logBox.key(['2'], () => this.setFilter(LogLevel.WARN));
    this.logBox.key(['3'], () => this.setFilter(LogLevel.INFO));
    this.logBox.key(['4'], () => this.setFilter(LogLevel.DEBUG));
    this.logBox.key(['0'], () => this.setFilter(null)); // Show all

    // Toggle auto-scroll
    this.logBox.key(['a'], () => {
      this.autoScroll = !this.autoScroll;
      this.updateFilterDisplay();
    });

    // Clear logs
    this.logBox.key(['c'], () => {
      this.clearLogs();
    });

    // Export logs
    this.logBox.key(['e'], () => {
      this.exportLogs();
    });

    // Close logging screen
    this.logBox.key(['escape', 'q'], () => {
      this.hide();
    });

    // Scroll to bottom when new logs arrive (if auto-scroll enabled)
    this.logList.on('add item', () => {
      if (this.autoScroll) {
        this.logList.scrollTo((this.logList as any).items.length - 1);
      }
    });
  }

  private startLogCollection(): void {
    // Override the logger's log method to capture logs for the UI
    const originalSetUIMode = logger.setUIMode.bind(logger);
    
    // Enhance logger to capture logs for our display
    (logger as any).originalLog = (logger as any).log || function() {};
    
    // Intercept log calls
    const self = this;
    const originalMethods = {
      error: logger.error.bind(logger),
      warn: logger.warn.bind(logger),
      info: logger.info.bind(logger),
      debug: logger.debug.bind(logger),
    };

    logger.error = function(message: string, ...args: any[]) {
      self.addLogEntry(LogLevel.ERROR, 'ERROR', message, args);
      return originalMethods.error(message, ...args);
    };

    logger.warn = function(message: string, ...args: any[]) {
      self.addLogEntry(LogLevel.WARN, 'WARN', message, args);
      return originalMethods.warn(message, ...args);
    };

    logger.info = function(message: string, ...args: any[]) {
      self.addLogEntry(LogLevel.INFO, 'INFO', message, args);
      return originalMethods.info(message, ...args);
    };

    logger.debug = function(message: string, ...args: any[]) {
      self.addLogEntry(LogLevel.DEBUG, 'DEBUG', message, args);
      return originalMethods.debug(message, ...args);
    };
  }

  private addLogEntry(level: LogLevel, levelText: string, message: string, args: any[]): void {
    const entry = {
      timestamp: new Date(),
      level: levelText,
      message: message + (args.length ? ' ' + args.join(' ') : ''),
    };

    this.logEntries.push(entry);
    
    // Keep only last 1000 entries to prevent memory issues
    if (this.logEntries.length > 1000) {
      this.logEntries.shift();
    }

    // Update filtered view if this entry should be shown
    if (this.shouldShowEntry(level)) {
      this.filteredEntries.push(entry);
      if (this.filteredEntries.length > 1000) {
        this.filteredEntries.shift();
      }
      
      if (this.isVisible) {
        this.updateLogDisplay();
      }
    }
  }

  private shouldShowEntry(level: LogLevel): boolean {
    return this.currentFilter === null || level <= (this.currentFilter || LogLevel.DEBUG);
  }

  private setFilter(filter: LogLevel | null): void {
    this.currentFilter = filter;
    this.applyFilter();
    this.updateFilterDisplay();
  }

  private applyFilter(): void {
    this.filteredEntries = this.logEntries.filter(entry => {
      if (this.currentFilter === null) return true;
      
      const entryLevel = this.getLevelFromText(entry.level);
      return entryLevel <= this.currentFilter;
    });
    
    if (this.isVisible) {
      this.updateLogDisplay();
    }
  }

  private getLevelFromText(levelText: string): LogLevel {
    switch (levelText) {
      case 'ERROR': return LogLevel.ERROR;
      case 'WARN': return LogLevel.WARN;
      case 'INFO': return LogLevel.INFO;
      case 'DEBUG': return LogLevel.DEBUG;
      default: return LogLevel.INFO;
    }
  }

  private updateLogDisplay(): void {
    const items = this.filteredEntries.map(entry => {
      const timestamp = entry.timestamp.toLocaleTimeString();
      const levelColor = this.getLevelColor(entry.level);
      return `{gray-fg}${timestamp}{/gray-fg} {bold}{${levelColor}-fg}[${entry.level}]{/${levelColor}-fg}{/bold} ${entry.message}`;
    });

    this.logList.setItems(items);
    
    if (this.autoScroll && items.length > 0) {
      this.logList.select(items.length - 1);
    }
    
    this.screen.render();
  }

  private getLevelColor(level: string): string {
    switch (level) {
      case 'ERROR': return 'red';
      case 'WARN': return 'yellow';
      case 'INFO': return 'cyan';
      case 'DEBUG': return 'green';
      default: return 'white';
    }
  }

  private updateFilterDisplay(): void {
    this.filterBox.setContent(this.getFilterContent());
    this.screen.render();
  }

  private clearLogs(): void {
    this.logEntries = [];
    this.filteredEntries = [];
    this.updateLogDisplay();
    this.updateFilterDisplay();
  }

  private exportLogs(): void {
    const fs = require('fs');
    const path = require('path');
    
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `contactsplus-logs-${timestamp}.txt`;
      const filepath = path.join(process.cwd(), filename);
      
      const logContent = this.filteredEntries.map(entry => {
        return `${entry.timestamp.toISOString()} [${entry.level}] ${entry.message}`;
      }).join('\n');
      
      fs.writeFileSync(filepath, logContent, 'utf8');
      
      // Show success message
      this.showMessage(`Logs exported to: ${filename}`, 'success');
    } catch (error) {
      this.showMessage('Failed to export logs: ' + error, 'error');
    }
  }

  private showMessage(message: string, type: 'success' | 'error'): void {
    const color = type === 'success' ? 'green' : 'red';
    
    const messageBox = blessed.box({
      top: 'center',
      left: 'center',
      width: 50,
      height: 5,
      content: `{center}{bold}{${color}-fg}${message}{/${color}-fg}{/bold}{/center}`,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: color,
        },
      },
      tags: true,
    });

    this.screen.append(messageBox);
    messageBox.focus();
    
    messageBox.key(['escape', 'enter', 'space'], () => {
      this.screen.remove(messageBox);
      this.logList.focus();
      this.screen.render();
    });
    
    this.screen.render();

    // Auto-close after 3 seconds
    setTimeout(() => {
      if (messageBox.parent) {
        this.screen.remove(messageBox);
        this.logList.focus();
        this.screen.render();
      }
    }, 3000);
  }

  show(): void {
    this.isVisible = true;
    this.logBox.show();
    this.logList.focus();
    
    // Refresh the display
    this.applyFilter();
    this.updateFilterDisplay();
    
    this.screen.render();
  }

  hide(): void {
    this.isVisible = false;
    this.logBox.hide();
    this.screen.render();
  }

  isShowing(): boolean {
    return this.isVisible;
  }

  // Get log statistics for the stats screen
  getLogStats(): any {
    const stats = {
      total: this.logEntries.length,
      errors: 0,
      warnings: 0,
      info: 0,
      debug: 0,
    };

    this.logEntries.forEach(entry => {
      switch (entry.level) {
        case 'ERROR': stats.errors++; break;
        case 'WARN': stats.warnings++; break;
        case 'INFO': stats.info++; break;
        case 'DEBUG': stats.debug++; break;
      }
    });

    return stats;
  }
}