import * as blessed from 'blessed';
import { ToolSuggestion, SuggestionRationale } from '../types/tools';
import { SuggestionManager, SuggestionBatch } from '../utils/suggestion-manager';

export class SuggestionViewer {
  private screen: blessed.Widgets.Screen;
  private suggestionManager: SuggestionManager;
  private container: blessed.Widgets.BoxElement;
  private titleBox: blessed.Widgets.BoxElement;
  private progressBox: blessed.Widgets.BoxElement;
  private suggestionBox: blessed.Widgets.BoxElement;
  private rationaleBox: blessed.Widgets.BoxElement;
  private actionBox: blessed.Widgets.BoxElement;
  private isVisible = false;
  private currentBatchId?: string;
  private onComplete?: (batchId: string, summary: Record<string, unknown>) => void;

  constructor(screen: blessed.Widgets.Screen, suggestionManager: SuggestionManager) {
    this.screen = screen;
    this.suggestionManager = suggestionManager;
    this.createUI();
  }

  private createUI(): void {
    this.container = blessed.box({
      top: 'center',
      left: 'center',
      width: '95%',
      height: '90%',
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
      label: ' {bold}{cyan-fg}Suggestion Review{/cyan-fg}{/bold} ',
    });

    this.titleBox = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
      },
    });

    this.progressBox = blessed.box({
      top: 3,
      left: 0,
      width: '100%',
      height: 3,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'green',
        },
      },
      tags: true,
    });

    this.suggestionBox = blessed.box({
      top: 6,
      left: 0,
      width: '100%',
      height: '60%-6',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'yellow',
        },
      },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      label: ' Suggested Change ',
    });

    this.rationaleBox = blessed.box({
      top: '60%',
      left: 0,
      width: '100%',
      height: '35%-3',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'magenta',
        },
      },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      label: ' Reasoning & Rationale ',
    });

    this.actionBox = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 5,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'white',
        },
      },
      tags: true,
      label: ' Actions ',
      content: `{center}{bold}
[A] Accept  [R] Reject  [M] Modify  [S] Skip  [C] Cancel All  [ESC] Exit
{/bold}{/center}`,
    });

    // Add all components to container
    this.container.append(this.titleBox);
    this.container.append(this.progressBox);
    this.container.append(this.suggestionBox);
    this.container.append(this.rationaleBox);
    this.container.append(this.actionBox);

    this.screen.append(this.container);
    this.setupKeyHandling();
  }

  private setupKeyHandling(): void {
    this.container.key(['a', 'A'], () => this.handleDecision('approve'));
    this.container.key(['r', 'R'], () => this.handleDecision('reject'));
    this.container.key(['m', 'M'], () => this.handleModify());
    this.container.key(['s', 'S'], () => this.handleDecision('skip'));
    this.container.key(['c', 'C'], () => this.handleCancel());
    this.container.key(['escape', 'q'], () => this.hide());
    
    // Navigation keys
    this.container.key(['up', 'down'], () => {
      // Allow scrolling in suggestion and rationale boxes
      this.suggestionBox.focus();
    });
  }

  async show(batchId: string, onComplete?: (batchId: string, summary: Record<string, unknown>) => void): Promise<void> {
    this.currentBatchId = batchId;
    this.onComplete = onComplete;

    const progress = this.suggestionManager.getBatchProgress(batchId);
    if (!progress || progress.total === 0) {
      // No suggestions to show, complete immediately
      if (onComplete) {
        const summary = this.suggestionManager.getBatchSummary(batchId);
        onComplete(batchId, summary as Record<string, unknown>);
      }
      return;
    }

    this.isVisible = true;
    this.container.show();
    this.container.focus();

    await this.updateDisplay();
    this.screen.render();
  }

  hide(): void {
    this.isVisible = false;
    this.container.hide();
    this.screen.render();
  }

  isShowing(): boolean {
    return this.isVisible;
  }

  private async updateDisplay(): Promise<void> {
    if (!this.currentBatchId) return;

    const batch = this.suggestionManager.getBatch(this.currentBatchId);
    if (!batch) {
      this.hide();
      return;
    }

    const suggestion = this.suggestionManager.getCurrentSuggestion(this.currentBatchId);
    const progress = this.suggestionManager.getBatchProgress(this.currentBatchId);

    if (!suggestion || !progress || progress.total === 0) {
      await this.handleBatchComplete();
      return;
    }

    // Update title
    this.titleBox.setContent(`{center}{bold}${batch.toolName} - Contact ${batch.contactId}{/bold}{/center}`);

    // Update progress
    this.progressBox.setContent(
      `{center}Progress: {bold}{green-fg}${progress.current}/${progress.total}{/green-fg}{/bold} (${progress.percentage}%){/center}`
    );

    // Update suggestion display
    this.displaySuggestion(suggestion);

    // Update rationale display
    this.displayRationale(suggestion.rationale);

    this.screen.render();
  }

  /**
   * Escape blessed.js special characters to prevent rendering issues.
   * Uses blessed.js official escape() function to convert tags like {bold}
   * to {open}bold{close} so they display as literal text.
   */
  private escapeBlessedMarkup(text: string): string {
    return blessed.escape(text);
  }

  private displaySuggestion(suggestion: ToolSuggestion): void {
    // Escape blessed.js special characters in field name
    const escapedField = this.escapeBlessedMarkup(suggestion.field);

    const content = `{bold}{yellow-fg}Field:{/yellow-fg}{/bold} ${escapedField}

{bold}{red-fg}Current Value:{/red-fg}{/bold}
${this.formatValue(suggestion.originalValue)}

{bold}{green-fg}Suggested Value:{/green-fg}{/bold}
${this.formatValue(suggestion.suggestedValue)}

{bold}{cyan-fg}Confidence:{/cyan-fg}{/bold} ${Math.round(suggestion.confidence * 100)}%

{bold}{cyan-fg}Timestamp:{/cyan-fg}{/bold} ${new Date(suggestion.timestamp).toLocaleString()}`;

    this.suggestionBox.setContent(content);
  }

  private displayRationale(rationale: SuggestionRationale): void {
    const content = `{bold}{yellow-fg}Reason:{/yellow-fg}{/bold}
${rationale.reason}

{bold}{cyan-fg}Rules Applied:{/cyan-fg}{/bold}
${rationale.rulesApplied.map(rule => `• ${rule}`).join('\n')}

{bold}{green-fg}Confidence Score:{/green-fg}{/bold} ${Math.round(rationale.confidence * 100)}%

${rationale.validationResult ? `{bold}{magenta-fg}Validation Result:{/magenta-fg}{/bold}
${JSON.stringify(rationale.validationResult, null, 2)}` : ''}

${rationale.additionalInfo ? `{bold}{blue-fg}Additional Information:{/blue-fg}{/bold}
${Object.entries(rationale.additionalInfo).map(([key, value]) => `• ${key}: ${value}`).join('\n')}` : ''}`;

    this.rationaleBox.setContent(content);
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '{gray-fg}(empty){/gray-fg}';
    }

    if (typeof value === 'string') {
      return value;
    }

    return JSON.stringify(value, null, 2);
  }

  private async handleDecision(decision: 'approve' | 'reject' | 'skip'): Promise<void> {
    if (!this.currentBatchId) return;

    const result = await this.suggestionManager.processDecision(this.currentBatchId, decision);
    
    if (!result.success) {
      this.showError(`Failed to process decision: ${result.error}`);
      return;
    }

    if (result.completed) {
      await this.handleBatchComplete();
    } else {
      await this.updateDisplay();
    }
  }

  private async handleModify(): Promise<void> {
    if (!this.currentBatchId) return;

    const suggestion = this.suggestionManager.getCurrentSuggestion(this.currentBatchId);
    if (!suggestion) return;

    // Create a simple input dialog
    const modifyDialog = blessed.box({
      top: 'center',
      left: 'center',
      width: 60,
      height: 8,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'yellow',
        },
      },
      tags: true,
      label: ' Modify Value ',
    });

    const inputBox = blessed.textbox({
      top: 1,
      left: 1,
      width: '100%-2',
      height: 3,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
      },
      inputOnFocus: true,
    });

    const instructionBox = blessed.box({
      bottom: 1,
      left: 1,
      width: '100%-2',
      height: 2,
      content: '{center}Enter new value, then press Enter{/center}',
      tags: true,
      style: {
        fg: 'gray',
      },
    });

    modifyDialog.append(inputBox);
    modifyDialog.append(instructionBox);
    this.screen.append(modifyDialog);

    // Set initial value
    inputBox.setValue(this.formatValue(suggestion.suggestedValue));

    inputBox.focus();
    this.screen.render();

    inputBox.on('submit', async (value: string) => {
      this.screen.remove(modifyDialog);

      let modifiedValue: unknown = value;

      // Try to parse as JSON if it looks like JSON
      if (value.startsWith('{') || value.startsWith('[') || value === 'null' || value === 'true' || value === 'false') {
        try {
          modifiedValue = JSON.parse(value);
        } catch {
          // Keep as string if JSON parsing fails
        }
      }

      const result = await this.suggestionManager.processDecision(
        this.currentBatchId!, 
        'modify', 
        modifiedValue
      );
      
      if (!result.success) {
        this.showError(`Failed to apply modification: ${result.error}`);
        return;
      }

      if (result.completed) {
        await this.handleBatchComplete();
      } else {
        await this.updateDisplay();
      }
    });

    inputBox.key(['escape'], () => {
      this.screen.remove(modifyDialog);
      this.container.focus();
      this.screen.render();
    });
  }

  private async handleCancel(): Promise<void> {
    if (!this.currentBatchId) return;

    const confirmed = await this.showConfirmDialog(
      'Cancel All Suggestions',
      'Are you sure you want to cancel all remaining suggestions?'
    );

    if (confirmed) {
      await this.suggestionManager.cancelBatch(this.currentBatchId);
      await this.handleBatchComplete();
    }
  }

  private async handleBatchComplete(): Promise<void> {
    if (!this.currentBatchId) return;

    const summary = this.suggestionManager.getBatchSummary(this.currentBatchId);

    if (this.onComplete) {
      this.onComplete(this.currentBatchId, summary as Record<string, unknown>);
    }

    this.hide();
  }

  private showError(message: string): void {
    const errorDialog = blessed.box({
      top: 'center',
      left: 'center',
      width: 50,
      height: 6,
      content: `{center}{red-fg}Error{/red-fg}\n\n${message}\n\nPress any key to continue{/center}`,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'red',
        },
      },
      tags: true,
    });

    this.screen.append(errorDialog);
    errorDialog.focus();
    this.screen.render();

    errorDialog.once('keypress', () => {
      this.screen.remove(errorDialog);
      this.container.focus();
      this.screen.render();
    });
  }

  private showConfirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = blessed.box({
        top: 'center',
        left: 'center',
        width: 50,
        height: 8,
        border: {
          type: 'line',
        },
        style: {
          fg: 'white',
          bg: 'black',
          border: {
            fg: 'yellow',
          },
        },
        tags: true,
        label: ` ${title} `,
      });

      const messageBox = blessed.box({
        top: 1,
        left: 1,
        width: '100%-2',
        height: 3,
        content: `{center}${message}{/center}`,
        tags: true,
      });

      const buttonBox = blessed.box({
        bottom: 1,
        left: 1,
        width: '100%-2',
        height: 2,
        content: '{center}[Y] Yes  [N] No{/center}',
        tags: true,
      });

      dialog.append(messageBox);
      dialog.append(buttonBox);
      this.screen.append(dialog);
      
      dialog.focus();
      this.screen.render();

      const cleanup = (result: boolean) => {
        this.screen.remove(dialog);
        this.container.focus();
        this.screen.render();
        resolve(result);
      };

      dialog.key(['y', 'Y'], () => cleanup(true));
      dialog.key(['n', 'N', 'escape'], () => cleanup(false));
    });
  }
}