import * as blessed from 'blessed';
import { Widgets } from 'blessed';
import { SyncConfigManager, SyncConfig } from '../db/sync-config';
import { logger } from '../utils/logger';

/**
 * Sync Settings Viewer
 * UI for configuring sync behavior
 */
export class SyncSettingsViewer {
  private screen: Widgets.Screen;
  private syncConfigManager: SyncConfigManager;

  private container: Widgets.BoxElement | null = null;
  private form: Widgets.FormElement<any> | null = null;
  private onComplete: ((saved: boolean) => void) | null = null;

  constructor(screen: Widgets.Screen, syncConfigManager: SyncConfigManager) {
    this.screen = screen;
    this.syncConfigManager = syncConfigManager;
  }

  /**
   * Show settings viewer
   */
  show(onComplete: (saved: boolean) => void): void {
    this.onComplete = onComplete;
    this.createUI();
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
   * Create the UI
   */
  private createUI(): void {
    const config = this.syncConfigManager.getConfig();

    // Main container
    this.container = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 80,
      height: 28,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' },
      },
      tags: true,
      label: ' {bold}{cyan-fg}Sync Settings{/cyan-fg}{/bold} ',
    });

    // Content box
    const contentBox = blessed.box({
      parent: this.container,
      top: 1,
      left: 2,
      width: '100%-4',
      height: '100%-2',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        style: { bg: 'blue' },
      },
      keys: true,
      vi: true,
    });

    const lines: string[] = [];

    lines.push('{bold}Automatic Sync Settings:{/bold}');
    lines.push('');
    lines.push(`1. Auto-Sync: {${config.autoSync ? 'green-fg}ENABLED{/green-fg}' : 'red-fg}DISABLED{/red-fg}'}`);
    lines.push(`   Automatically sync approved items at regular intervals`);
    lines.push('');
    lines.push(`2. Auto-Sync Interval: {cyan-fg}${config.autoSyncInterval} minutes{/cyan-fg}`);
    lines.push(`   How often to run auto-sync when enabled`);
    lines.push('');
    lines.push('');

    lines.push('{bold}Retry Settings:{/bold}');
    lines.push('');
    lines.push(`3. Max Retries: {cyan-fg}${config.maxRetries}{/cyan-fg}`);
    lines.push(`   Maximum retry attempts for failed syncs`);
    lines.push('');
    lines.push(`4. Initial Retry Delay: {cyan-fg}${config.retryDelayMs}ms{/cyan-fg}`);
    lines.push(`   Initial delay before first retry (exponential backoff)`);
    lines.push('');
    lines.push(`5. Max Retry Delay: {cyan-fg}${config.maxRetryDelayMs}ms{/cyan-fg}`);
    lines.push(`   Maximum delay cap for exponential backoff`);
    lines.push('');
    lines.push('');

    lines.push('{bold}Conflict Resolution:{/bold}');
    lines.push('');
    lines.push(`6. Strategy: {cyan-fg}${config.conflictResolution.toUpperCase()}{/cyan-fg}`);
    lines.push(`   How to handle conflicts (manual/local/remote)`);
    lines.push('');
    lines.push('');

    lines.push('{bold}Trigger Settings:{/bold}');
    lines.push('');
    lines.push(`7. Sync on Startup: {${config.syncOnStartup ? 'green-fg}ENABLED{/green-fg}' : 'red-fg}DISABLED{/red-fg}'}`);
    lines.push(`   Automatically sync when app starts`);
    lines.push('');
    lines.push(`8. Sync After Import: {${config.syncOnImport ? 'green-fg}ENABLED{/green-fg}' : 'red-fg}DISABLED{/red-fg}'}`);
    lines.push(`   Automatically sync after CSV import completes`);
    lines.push('');
    lines.push('');

    lines.push('{yellow-fg}Press number keys (1-8) to toggle settings{/yellow-fg}');
    lines.push('{green-fg}Press S to save | R to reset to defaults | ESC to cancel{/green-fg}');

    contentBox.setContent(lines.join('\n'));

    // Key bindings
    this.container.key(['1'], () => {
      this.syncConfigManager.updateConfig({ autoSync: !config.autoSync });
      this.refresh();
    });

    this.container.key(['2'], () => {
      this.promptForNumber('Auto-Sync Interval (minutes)', config.autoSyncInterval, (value) => {
        this.syncConfigManager.updateConfig({ autoSyncInterval: value });
        this.refresh();
      });
    });

    this.container.key(['3'], () => {
      this.promptForNumber('Max Retries', config.maxRetries, (value) => {
        this.syncConfigManager.updateConfig({ maxRetries: value });
        this.refresh();
      });
    });

    this.container.key(['4'], () => {
      this.promptForNumber('Initial Retry Delay (ms)', config.retryDelayMs, (value) => {
        this.syncConfigManager.updateConfig({ retryDelayMs: value });
        this.refresh();
      });
    });

    this.container.key(['5'], () => {
      this.promptForNumber('Max Retry Delay (ms)', config.maxRetryDelayMs, (value) => {
        this.syncConfigManager.updateConfig({ maxRetryDelayMs: value });
        this.refresh();
      });
    });

    this.container.key(['6'], () => {
      this.cycleConflictResolution();
    });

    this.container.key(['7'], () => {
      this.syncConfigManager.updateConfig({ syncOnStartup: !config.syncOnStartup });
      this.refresh();
    });

    this.container.key(['8'], () => {
      this.syncConfigManager.updateConfig({ syncOnImport: !config.syncOnImport });
      this.refresh();
    });

    this.container.key(['s', 'S'], () => {
      this.save();
    });

    this.container.key(['r', 'R'], () => {
      this.resetToDefaults();
    });

    this.container.key(['escape', 'q'], () => {
      this.cancel();
    });

    this.container.focus();
  }

  /**
   * Refresh display
   */
  private refresh(): void {
    this.hide();
    this.createUI();
    this.screen.render();
  }

  /**
   * Prompt for numeric input
   */
  private promptForNumber(
    label: string,
    current: number,
    onComplete: (value: number) => void
  ): void {
    const inputBox = blessed.textbox({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: 7,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' },
      },
      label: ` ${label} `,
      tags: true,
      inputOnFocus: true,
    });

    inputBox.setValue(current.toString());

    inputBox.on('submit', (value) => {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num > 0) {
        onComplete(num);
      }
      inputBox.destroy();
      this.screen.render();
    });

    inputBox.on('cancel', () => {
      inputBox.destroy();
      this.screen.render();
    });

    inputBox.focus();
    this.screen.render();
  }

  /**
   * Cycle conflict resolution strategy
   */
  private cycleConflictResolution(): void {
    const config = this.syncConfigManager.getConfig();
    const strategies: Array<'manual' | 'local' | 'remote'> = ['manual', 'local', 'remote'];
    const currentIndex = strategies.indexOf(config.conflictResolution);
    const nextIndex = (currentIndex + 1) % strategies.length;

    this.syncConfigManager.updateConfig({ conflictResolution: strategies[nextIndex] });
    this.refresh();
  }

  /**
   * Save settings
   */
  private save(): void {
    logger.info('Sync settings saved');
    this.close(true);
  }

  /**
   * Reset to defaults
   */
  private resetToDefaults(): void {
    const confirmBox = blessed.question({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 7,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'yellow' },
      },
      tags: true,
    });

    confirmBox.ask(
      '{bold}{yellow-fg}Reset to Defaults?{/yellow-fg}{/bold}\n\n' +
      'This will reset all sync settings to their default values.',
      (err, value) => {
        if (value) {
          this.syncConfigManager.resetToDefaults();
          logger.info('Sync settings reset to defaults');
          this.refresh();
        }
        confirmBox.destroy();
        this.screen.render();
      }
    );

    this.screen.render();
  }

  /**
   * Cancel without saving
   */
  private cancel(): void {
    this.close(false);
  }

  /**
   * Close viewer
   */
  private close(saved: boolean): void {
    this.hide();

    if (this.onComplete) {
      this.onComplete(saved);
    }
  }
}
