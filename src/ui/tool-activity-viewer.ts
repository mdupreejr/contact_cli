import * as blessed from 'blessed';
import { getToolActivityTracker, ToolActivityStats } from '../db/tool-activity-tracker';
import { logger } from '../utils/logger';

export class ToolActivityViewer {
  private screen: blessed.Widgets.Screen;
  private container: blessed.Widgets.BoxElement;
  private contentBox: blessed.Widgets.BoxElement;
  private footerBox: blessed.Widgets.BoxElement;
  private isVisible = false;
  private onClose?: () => void;

  constructor(screen: blessed.Widgets.Screen, onClose?: () => void) {
    this.screen = screen;
    this.onClose = onClose;
    this.createUI();
    this.setupEventHandlers();
  }

  private createUI(): void {
    // Main container
    this.container = blessed.box({
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
      label: ' {bold}{cyan-fg}Tool Activity Statistics{/cyan-fg}{/bold} ',
    });

    // Content area
    this.contentBox = blessed.box({
      top: 1,
      left: 1,
      width: '100%-2',
      height: '100%-5',
      content: '',
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
      label: ' Tool Activity ',
    });

    // Footer with controls
    this.footerBox = blessed.box({
      bottom: 1,
      left: 1,
      width: '100%-2',
      height: 3,
      content: ' {cyan-fg}r{/cyan-fg}: Refresh | {cyan-fg}↑↓{/cyan-fg}: Scroll | {cyan-fg}ESC/q{/cyan-fg}: Back',
      style: {
        fg: 'white',
        bg: 'black',
      },
      tags: true,
    });

    this.container.append(this.contentBox);
    this.container.append(this.footerBox);
    this.screen.append(this.container);
  }

  private setupEventHandlers(): void {
    // Refresh stats
    this.container.key(['r'], () => {
      this.updateDisplay();
    });

    // Close viewer
    this.container.key(['escape', 'q'], () => {
      this.hide();
    });

    // Scroll handling
    this.container.key(['up', 'k'], () => {
      this.contentBox.scroll(-1);
      this.screen.render();
    });

    this.container.key(['down', 'j'], () => {
      this.contentBox.scroll(1);
      this.screen.render();
    });

    this.container.key(['pageup'], () => {
      this.contentBox.scroll(-10);
      this.screen.render();
    });

    this.container.key(['pagedown'], () => {
      this.contentBox.scroll(10);
      this.screen.render();
    });
  }

  private async updateDisplay(): Promise<void> {
    try {
      const tracker = getToolActivityTracker();
      const stats = await tracker.getCombinedStats();

      let content = '';

      content += `{bold}{yellow-fg}Tool Activity Overview{/yellow-fg}{/bold}\n\n`;

      if (stats.length === 0) {
        content += `{gray-fg}No tool activity recorded yet.{/gray-fg}\n`;
        content += `{gray-fg}Tool activity will appear here after you run tools from the Tools menu.{/gray-fg}\n`;
      } else {
        // Create table header
        content += `{bold}Tool Name{/bold}                          {bold}This Session{/bold}  {bold}Lifetime{/bold}  {bold}Last Run{/bold}\n`;
        content += `{gray-fg}${'-'.repeat(80)}{/gray-fg}\n`;

        // Add each tool's stats
        for (const stat of stats) {
          const toolName = this.truncate(stat.toolName, 30);
          const sessionRuns = this.formatNumber(stat.timesRunThisSession, 5);
          const lifetimeRuns = this.formatNumber(stat.timesRunTotal, 5);
          const lastRun = stat.lastRunTimestamp ? this.formatTimestamp(stat.lastRunTimestamp) : 'Never';

          content += `{cyan-fg}${toolName}{/cyan-fg} ${sessionRuns}x      ${lifetimeRuns}x      ${lastRun}\n`;

          // Show contacts modified if any
          if (stat.contactsModifiedThisSession > 0 || stat.contactsModifiedTotal > 0) {
            const sessionMods = this.formatNumber(stat.contactsModifiedThisSession, 5);
            const lifetimeMods = this.formatNumber(stat.contactsModifiedTotal, 5);
            content += `  {gray-fg}Contacts modified:{/gray-fg}         ${sessionMods}       ${lifetimeMods}\n`;
          }

          content += '\n';
        }

        content += `{gray-fg}${'-'.repeat(80)}{/gray-fg}\n\n`;

        // Summary statistics
        const totalSessionRuns = stats.reduce((sum, s) => sum + s.timesRunThisSession, 0);
        const totalLifetimeRuns = stats.reduce((sum, s) => sum + s.timesRunTotal, 0);
        const totalSessionMods = stats.reduce((sum, s) => sum + s.contactsModifiedThisSession, 0);
        const totalLifetimeMods = stats.reduce((sum, s) => sum + s.contactsModifiedTotal, 0);

        content += `{bold}{yellow-fg}Summary{/yellow-fg}{/bold}\n\n`;
        content += `{bold}Total Tools Run (This Session):{/bold} {cyan-fg}${totalSessionRuns.toLocaleString()}{/cyan-fg}\n`;
        content += `{bold}Total Tools Run (Lifetime):{/bold} {green-fg}${totalLifetimeRuns.toLocaleString()}{/green-fg}\n`;
        content += `{bold}Contacts Modified (This Session):{/bold} {cyan-fg}${totalSessionMods.toLocaleString()}{/cyan-fg}\n`;
        content += `{bold}Contacts Modified (Lifetime):{/bold} {green-fg}${totalLifetimeMods.toLocaleString()}{/green-fg}\n`;
      }

      this.contentBox.setContent(content);
      this.screen.render();
    } catch (error) {
      logger.error('Failed to update tool activity display:', error);
      this.contentBox.setContent(`{red-fg}Error loading tool activity statistics{/red-fg}`);
      this.screen.render();
    }
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text.padEnd(maxLength, ' ');
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  private formatNumber(num: number, width: number): string {
    return num.toString().padStart(width, ' ');
  }

  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  async show(): Promise<void> {
    this.isVisible = true;
    this.container.show();
    this.container.focus();
    await this.updateDisplay();
  }

  hide(): void {
    this.isVisible = false;
    this.container.hide();
    this.screen.render();

    if (this.onClose) {
      this.onClose();
    }
  }

  isShowing(): boolean {
    return this.isVisible;
  }
}
