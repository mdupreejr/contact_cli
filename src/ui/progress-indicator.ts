import * as blessed from 'blessed';
import { ProgressTracker, ProgressUpdate } from '../utils/progress-tracker';

export class ProgressIndicator {
  private screen: blessed.Widgets.Screen;
  private overlay?: blessed.Widgets.BoxElement;
  private progressBar?: blessed.Widgets.ProgressBarElement;
  private statusText?: blessed.Widgets.TextElement;
  private detailsText?: blessed.Widgets.TextElement;
  private visible: boolean = false;

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
  }

  /**
   * Show progress indicator with a tracker
   */
  show(tracker: ProgressTracker, title: string = 'Processing'): void {
    if (this.visible) {
      return; // Already showing
    }

    this.createUI(title);
    this.visible = true;

    // Listen for progress updates
    tracker.on('progress', (progress: ProgressUpdate) => {
      this.update(progress);
    });

    tracker.on('complete', () => {
      setTimeout(() => this.hide(), 500); // Hide after brief delay
    });

    this.screen.render();
  }

  /**
   * Show with manual updates (no tracker)
   */
  showManual(title: string = 'Processing'): void {
    if (this.visible) {
      return;
    }

    this.createUI(title);
    this.visible = true;
    this.screen.render();
  }

  /**
   * Update progress manually
   */
  update(progress: ProgressUpdate): void {
    if (!this.visible || !this.progressBar || !this.detailsText) {
      return;
    }

    // Update progress bar
    const percentage = Math.min(100, Math.max(0, progress.percentage));
    this.progressBar.setProgress(percentage);

    // Update status text
    const progressText = ProgressTracker.formatProgress(progress);
    if (this.statusText) {
      this.statusText.setContent(progressText);
    }

    // Update details (ETA and rate)
    let details = '';
    if (progress.rate > 0) {
      details += `Rate: ${progress.rate.toFixed(1)} items/sec`;
    }
    if (progress.eta !== null) {
      if (details) details += ' | ';
      details += `ETA: ${ProgressTracker.formatDuration(progress.eta)}`;
    }
    this.detailsText.setContent(details);

    this.screen.render();
  }

  /**
   * Update progress with simple current/total
   */
  updateSimple(current: number, total: number, message?: string): void {
    const progress: ProgressUpdate = {
      current,
      total,
      percentage: total > 0 ? (current / total) * 100 : 0,
      eta: null,
      rate: 0,
      message,
    };
    this.update(progress);
  }

  /**
   * Update message only
   */
  setMessage(message: string): void {
    if (this.statusText) {
      this.statusText.setContent(message);
      this.screen.render();
    }
  }

  /**
   * Hide progress indicator
   */
  hide(): void {
    if (!this.visible) {
      return;
    }

    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = undefined;
      this.progressBar = undefined;
      this.statusText = undefined;
      this.detailsText = undefined;
    }

    this.visible = false;
    this.screen.render();
  }

  /**
   * Check if currently visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Create the UI elements
   */
  private createUI(title: string): void {
    // Create overlay box
    this.overlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 11,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
        bg: 'black',
      },
      label: ` ${title} `,
      tags: true,
    });

    // Title/status text
    this.statusText = blessed.text({
      parent: this.overlay,
      top: 1,
      left: 2,
      right: 2,
      height: 1,
      content: 'Initializing...',
      style: {
        fg: 'white',
        bold: true,
      },
    });

    // Progress bar
    this.progressBar = blessed.progressbar({
      parent: this.overlay,
      top: 3,
      left: 2,
      right: 2,
      height: 3,
      orientation: 'horizontal',
      filled: 0,
      style: {
        bar: {
          bg: 'cyan',
        },
        border: {
          fg: 'white',
        },
      },
      border: {
        type: 'line',
      },
      ch: '█',
    });

    // Details text (ETA, rate)
    this.detailsText = blessed.text({
      parent: this.overlay,
      top: 7,
      left: 2,
      right: 2,
      height: 1,
      content: '',
      style: {
        fg: 'gray',
      },
      align: 'center',
    });
  }
}
