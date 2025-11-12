import * as blessed from 'blessed';
import { AppSettings } from '../types/settings';
import { getSettingsManager } from '../utils/settings-manager';
import { logger } from '../utils/logger';

export class SettingsScreen {
  private screen: blessed.Widgets.Screen;
  private container?: blessed.Widgets.BoxElement;
  private form?: blessed.Widgets.FormElement<any>;
  private visible: boolean = false;
  private settingsManager = getSettingsManager();
  private onSettingsSaved?: () => void;

  // Form fields
  private fields: Map<string, blessed.Widgets.CheckboxElement | blessed.Widgets.TextboxElement> = new Map();

  constructor(screen: blessed.Widgets.Screen, onSettingsSaved?: () => void) {
    this.screen = screen;
    this.onSettingsSaved = onSettingsSaved;
  }

  async show(): Promise<void> {
    if (this.visible) return;

    const settings = this.settingsManager.getSettings();
    this.createUI(settings);
    this.visible = true;
    this.screen.render();
  }

  hide(): void {
    if (!this.visible) return;

    if (this.container) {
      this.container.destroy();
      this.container = undefined;
      this.form = undefined;
      this.fields.clear();
    }

    this.visible = false;
    this.screen.render();
  }

  private createUI(settings: AppSettings): void {
    // Main container
    this.container = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '90%',
      height: '90%',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
        bg: 'black',
      },
      label: ' {bold}{cyan-fg}Settings{/cyan-fg}{/bold} ',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
    });

    // Create form
    this.form = blessed.form({
      parent: this.container,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-3',
      keys: true,
      vi: true,
    });

    let currentTop = 1;

    // Section: Data Source
    currentTop = this.addSection('Data Source', currentTop);
    currentTop = this.addCheckbox('readonly', 'Read-Only Mode (prevent API writes)', settings.dataSource.readOnlyMode, currentTop);
    currentTop = this.addTextbox('jsonFile', 'JSON File Path', settings.dataSource.jsonFilePath || '', currentTop);
    currentTop = this.addTextbox('csvFile', 'CSV File Path', settings.dataSource.csvFilePath || '', currentTop);
    currentTop++;

    // Section: API
    currentTop = this.addSection('API Configuration', currentTop);
    currentTop = this.addTextbox('apiBase', 'API Base URL', settings.api.apiBase, currentTop);
    currentTop = this.addTextbox('authBase', 'Auth Base URL', settings.api.authBase, currentTop);
    currentTop = this.addTextbox('timeout', 'Timeout (ms)', settings.api.timeout.toString(), currentTop);
    currentTop = this.addCheckbox('retryOnFailure', 'Retry on Failure', settings.api.retryOnFailure, currentTop);
    currentTop++;

    // Section: UI
    currentTop = this.addSection('User Interface', currentTop);
    currentTop = this.addTextbox('logLevel', 'Log Level (debug/info/warn/error)', settings.ui.logLevel, currentTop);
    currentTop = this.addTextbox('autoRefresh', 'Auto Refresh (minutes, 0=off)', settings.ui.autoRefreshMinutes.toString(), currentTop);
    currentTop = this.addCheckbox('showWelcome', 'Show Welcome Message', settings.ui.showWelcome, currentTop);
    currentTop++;

    // Section: Debug
    currentTop = this.addSection('Debug', currentTop);
    currentTop = this.addCheckbox('debugEnabled', 'Enable Debug Mode', settings.debug.enabled, currentTop);
    currentTop = this.addCheckbox('logApiRequests', 'Log API Requests', settings.debug.logApiRequests, currentTop);

    // Buttons at the bottom
    this.addButtons();

    // Set up key handlers
    this.setupKeyHandlers();

    // Focus first field
    const firstField = Array.from(this.fields.values())[0];
    if (firstField) {
      firstField.focus();
    }
  }

  private addSection(title: string, top: number): number {
    blessed.text({
      parent: this.form,
      top,
      left: 2,
      content: `{bold}{yellow-fg}${title}{/yellow-fg}{/bold}`,
      tags: true,
      height: 1,
    });
    return top + 2;
  }

  private addCheckbox(key: string, label: string, checked: boolean, top: number): number {
    const checkbox = blessed.checkbox({
      parent: this.form,
      top,
      left: 4,
      height: 1,
      content: label,
      checked,
      style: {
        fg: 'white',
        focus: {
          bg: 'blue',
        },
      },
      keys: true,
      mouse: true,
    });

    this.fields.set(key, checkbox);
    return top + 1;
  }

  private addTextbox(key: string, label: string, value: string, top: number): number {
    // Label
    blessed.text({
      parent: this.form,
      top,
      left: 4,
      content: label + ':',
      height: 1,
      style: {
        fg: 'white',
      },
    });

    // Input box
    const textbox = blessed.textbox({
      parent: this.form,
      top: top + 1,
      left: 4,
      width: '80%',
      height: 3,
      value,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'gray',
        },
        focus: {
          border: {
            fg: 'cyan',
          },
        },
      },
      keys: true,
      mouse: true,
      inputOnFocus: true,
    });

    this.fields.set(key, textbox);
    return top + 4;
  }

  private addButtons(): void {
    // Save button
    const saveButton = blessed.button({
      parent: this.container,
      bottom: 1,
      left: 2,
      width: 12,
      height: 3,
      content: '{center}Save{/center}',
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'green',
        border: {
          fg: 'green',
        },
        focus: {
          bg: 'brightgreen',
          border: {
            fg: 'brightgreen',
          },
        },
      },
      tags: true,
      keys: true,
      mouse: true,
    });

    saveButton.on('press', () => this.saveSettings());

    // Cancel button
    const cancelButton = blessed.button({
      parent: this.container,
      bottom: 1,
      left: 16,
      width: 12,
      height: 3,
      content: '{center}Cancel{/center}',
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'gray',
        },
        focus: {
          bg: 'blue',
          border: {
            fg: 'blue',
          },
        },
      },
      tags: true,
      keys: true,
      mouse: true,
    });

    cancelButton.on('press', () => this.hide());

    // Reset button
    const resetButton = blessed.button({
      parent: this.container,
      bottom: 1,
      left: 30,
      width: 18,
      height: 3,
      content: '{center}Reset to Defaults{/center}',
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'gray',
        },
        focus: {
          bg: 'blue',
          border: {
            fg: 'blue',
          },
        },
      },
      tags: true,
      keys: true,
      mouse: true,
    });

    resetButton.on('press', () => this.resetSettings());
  }

  private setupKeyHandlers(): void {
    if (!this.container) return;

    this.container.key(['escape', 'q'], () => {
      this.hide();
    });

    this.container.key(['C-s'], () => {
      this.saveSettings();
    });

    this.container.key(['tab'], () => {
      this.form?.focusNext();
    });

    this.container.key(['S-tab'], () => {
      this.form?.focusPrevious();
    });
  }

  private async saveSettings(): Promise<void> {
    try {
      // Gather values from form
      const settings = this.settingsManager.getSettings();

      // Update with form values
      settings.dataSource.readOnlyMode = (this.fields.get('readonly') as blessed.Widgets.CheckboxElement)?.checked || false;
      settings.dataSource.jsonFilePath = (this.fields.get('jsonFile') as blessed.Widgets.TextboxElement)?.getValue() || undefined;
      settings.dataSource.csvFilePath = (this.fields.get('csvFile') as blessed.Widgets.TextboxElement)?.getValue() || undefined;

      settings.api.apiBase = (this.fields.get('apiBase') as blessed.Widgets.TextboxElement)?.getValue() || settings.api.apiBase;
      settings.api.authBase = (this.fields.get('authBase') as blessed.Widgets.TextboxElement)?.getValue() || settings.api.authBase;
      const timeoutStr = (this.fields.get('timeout') as blessed.Widgets.TextboxElement)?.getValue();
      if (timeoutStr) {
        settings.api.timeout = parseInt(timeoutStr, 10);
      }
      settings.api.retryOnFailure = (this.fields.get('retryOnFailure') as blessed.Widgets.CheckboxElement)?.checked || false;

      const logLevelStr = (this.fields.get('logLevel') as blessed.Widgets.TextboxElement)?.getValue();
      if (logLevelStr && ['debug', 'info', 'warn', 'error'].includes(logLevelStr)) {
        settings.ui.logLevel = logLevelStr as 'debug' | 'info' | 'warn' | 'error';
      }
      const autoRefreshStr = (this.fields.get('autoRefresh') as blessed.Widgets.TextboxElement)?.getValue();
      if (autoRefreshStr) {
        settings.ui.autoRefreshMinutes = parseInt(autoRefreshStr, 10);
      }
      settings.ui.showWelcome = (this.fields.get('showWelcome') as blessed.Widgets.CheckboxElement)?.checked || false;

      settings.debug.enabled = (this.fields.get('debugEnabled') as blessed.Widgets.CheckboxElement)?.checked || false;
      settings.debug.logApiRequests = (this.fields.get('logApiRequests') as blessed.Widgets.CheckboxElement)?.checked || false;

      // Validate and save
      await this.settingsManager.save(settings);

      this.showMessage('Settings saved successfully!', 'success');

      setTimeout(() => {
        this.hide();
        if (this.onSettingsSaved) {
          this.onSettingsSaved();
        }
      }, 1000);

    } catch (error) {
      logger.error('Failed to save settings:', error);
      this.showMessage(
        error instanceof Error ? error.message : 'Failed to save settings',
        'error'
      );
    }
  }

  private async resetSettings(): Promise<void> {
    try {
      await this.settingsManager.reset();
      this.hide();
      this.show(); // Reload with default values
      this.showMessage('Settings reset to defaults', 'success');
    } catch (error) {
      logger.error('Failed to reset settings:', error);
      this.showMessage('Failed to reset settings', 'error');
    }
  }

  private showMessage(message: string, type: 'success' | 'error'): void {
    const color = type === 'success' ? 'green' : 'red';

    const messageBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 7,
      content: `{center}{bold}{${color}-fg}${message}{/${color}-fg}{/bold}{/center}`,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: color,
        },
      },
      tags: true,
    });

    this.screen.render();

    setTimeout(() => {
      messageBox.destroy();
      this.screen.render();
    }, 2000);
  }
}
