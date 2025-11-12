import * as blessed from 'blessed';
import { StatsManager, ContactStats, FieldStats, QualityMetrics, AppMetrics } from '../utils/stats-manager';

export class StatsScreen {
  private screen: blessed.Widgets.Screen;
  private statsBox: blessed.Widgets.BoxElement;
  private tabBar: blessed.Widgets.BoxElement;
  private contentBox: blessed.Widgets.BoxElement;
  private footerBox: blessed.Widgets.BoxElement;
  private isVisible = false;
  private currentTab = 0;
  private statsManager: StatsManager;
  private refreshInterval?: NodeJS.Timeout;

  private readonly tabs = [
    { name: 'Contacts', key: '1' },
    { name: 'Fields', key: '2' },
    { name: 'Quality', key: '3' },
    { name: 'App', key: '4' },
  ];

  constructor(screen: blessed.Widgets.Screen, statsManager: StatsManager) {
    this.screen = screen;
    this.statsManager = statsManager;
    this.createStatsUI();
    this.setupEventHandlers();
  }

  private createStatsUI(): void {
    // Main stats container
    this.statsBox = blessed.box({
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
      label: ' {bold}{cyan-fg}ContactsPlus Statistics{/cyan-fg}{/bold} ',
    });

    // Tab bar at the top
    this.tabBar = blessed.box({
      top: 1,
      left: 1,
      width: '100%-2',
      height: 3,
      content: this.getTabBarContent(),
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
      label: ' Navigation ',
    });

    // Content area in the middle
    this.contentBox = blessed.box({
      top: 4,
      left: 1,
      width: '100%-2',
      height: '100%-8',
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
      label: ' Statistics ',
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

    this.statsBox.append(this.tabBar);
    this.statsBox.append(this.contentBox);
    this.statsBox.append(this.footerBox);
    this.screen.append(this.statsBox);
  }

  private getTabBarContent(): string {
    return this.tabs.map((tab, index) => {
      const isActive = index === this.currentTab;
      const color = isActive ? 'blue' : 'white';
      const highlight = isActive ? '{bold}' : '';
      return `${highlight}{${color}-fg}${tab.key}.${tab.name}{/${color}-fg}{/bold}`;
    }).join(' | ');
  }

  private getFooterContent(): string {
    return ' {cyan-fg}1-4{/cyan-fg}: Switch tabs | {cyan-fg}r{/cyan-fg}: Refresh | {cyan-fg}e{/cyan-fg}: Export | {cyan-fg}↑↓{/cyan-fg}: Scroll | {cyan-fg}q{/cyan-fg}: Back';
  }

  private setupEventHandlers(): void {
    // Tab switching
    this.statsBox.key(['1'], () => this.switchTab(0));
    this.statsBox.key(['2'], () => this.switchTab(1));
    this.statsBox.key(['3'], () => this.switchTab(2));
    this.statsBox.key(['4'], () => this.switchTab(3));

    // Refresh stats
    this.statsBox.key(['r'], () => {
      this.refreshStats();
    });

    // Export stats
    this.statsBox.key(['e'], () => {
      this.exportStats();
    });

    // Close stats screen
    this.statsBox.key(['escape', 'q'], () => {
      this.hide();
    });

    // Scroll handling
    this.statsBox.key(['up', 'k'], () => {
      this.contentBox.scroll(-1);
      this.screen.render();
    });

    this.statsBox.key(['down', 'j'], () => {
      this.contentBox.scroll(1);
      this.screen.render();
    });

    this.statsBox.key(['pageup'], () => {
      this.contentBox.scroll(-10);
      this.screen.render();
    });

    this.statsBox.key(['pagedown'], () => {
      this.contentBox.scroll(10);
      this.screen.render();
    });
  }

  private switchTab(tabIndex: number): void {
    if (tabIndex >= 0 && tabIndex < this.tabs.length) {
      this.currentTab = tabIndex;
      this.updateDisplay();
    }
  }

  private refreshStats(): void {
    this.showMessage('Refreshing statistics...', 'info');
    this.updateDisplay();
  }

  private updateDisplay(): void {
    // Update tab bar
    this.tabBar.setContent(this.getTabBarContent());

    // Update content based on current tab
    let content = '';
    switch (this.currentTab) {
      case 0:
        content = this.getContactStatsContent();
        break;
      case 1:
        content = this.getFieldStatsContent();
        break;
      case 2:
        content = this.getQualityMetricsContent();
        break;
      case 3:
        content = this.getAppMetricsContent();
        break;
    }

    this.contentBox.setContent(content);
    this.contentBox.setLabel(` ${this.tabs[this.currentTab].name} Statistics `);
    this.screen.render();
  }

  private getContactStatsContent(): string {
    const stats = this.statsManager.getContactStats();
    
    let content = `{bold}{yellow-fg}Contact Overview{/yellow-fg}{/bold}\n\n`;
    
    content += `{bold}Total Contacts:{/bold} {cyan-fg}${stats.total.toLocaleString()}{/cyan-fg}\n`;
    content += `{bold}Company Contacts:{/bold} {green-fg}${stats.companyContacts.toLocaleString()}{/green-fg} (${this.getPercentage(stats.companyContacts, stats.total)}%)\n`;
    content += `{bold}Personal Contacts:{/bold} {blue-fg}${stats.personalContacts.toLocaleString()}{/blue-fg} (${this.getPercentage(stats.personalContacts, stats.total)}%)\n\n`;

    content += `{bold}{yellow-fg}Field Coverage{/yellow-fg}{/bold}\n\n`;
    
    const fields = [
      { label: 'Email Addresses', count: stats.withEmails },
      { label: 'Phone Numbers', count: stats.withPhones },
      { label: 'Physical Addresses', count: stats.withAddresses },
      { label: 'Organizations', count: stats.withOrganizations },
      { label: 'URLs/Social Media', count: stats.withUrls },
      { label: 'Notes', count: stats.withNotes },
      { label: 'Birthdays', count: stats.withBirthdays },
      { label: 'Photos', count: stats.withPhotos },
    ];

    fields.forEach(field => {
      const percentage = this.getPercentage(field.count, stats.total);
      const bar = this.createProgressBar(percentage, 20);
      content += `{bold}${field.label}:{/bold}\n`;
      content += `  ${field.count.toLocaleString()} contacts (${percentage}%) ${bar}\n\n`;
    });

    if (stats.total === 0) {
      content += `{red-fg}No contacts loaded. Please refresh the application to load contacts.{/red-fg}`;
    }

    return content;
  }

  private getFieldStatsContent(): string {
    const stats = this.statsManager.getFieldStats();
    
    let content = `{bold}{yellow-fg}Field Details{/yellow-fg}{/bold}\n\n`;

    // Email statistics
    content += `{bold}{cyan-fg}📧 Email Statistics{/cyan-fg}{/bold}\n`;
    content += `{bold}Total Emails:{/bold} ${stats.emails.total.toLocaleString()}\n`;
    content += `{bold}Unique Emails:{/bold} ${stats.emails.unique.toLocaleString()}\n`;
    content += `{bold}Top Domains:{/bold}\n`;
    
    const topDomains = Object.entries(stats.emails.domains)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    
    topDomains.forEach(([domain, count]) => {
      content += `  • ${domain}: ${count}\n`;
    });
    
    content += `{bold}Email Types:{/bold}\n`;
    Object.entries(stats.emails.types).forEach(([type, count]) => {
      content += `  • ${type || 'Unknown'}: ${count}\n`;
    });
    content += '\n';

    // Phone statistics
    content += `{bold}{green-fg}📞 Phone Statistics{/green-fg}{/bold}\n`;
    content += `{bold}Total Phones:{/bold} ${stats.phones.total.toLocaleString()}\n`;
    content += `{bold}Unique Phones:{/bold} ${stats.phones.unique.toLocaleString()}\n`;
    content += `{bold}Normalized:{/bold} {green-fg}${stats.phones.normalized}{/green-fg} (${this.getPercentage(stats.phones.normalized, stats.phones.total)}%)\n`;
    content += `{bold}Needs Normalization:{/bold} {red-fg}${stats.phones.needsNormalization}{/red-fg} (${this.getPercentage(stats.phones.needsNormalization, stats.phones.total)}%)\n`;
    
    content += `{bold}Countries:{/bold}\n`;
    const topCountries = Object.entries(stats.phones.countries)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    
    topCountries.forEach(([country, count]) => {
      content += `  • ${country}: ${count}\n`;
    });
    content += '\n';

    // Organization statistics
    content += `{bold}{blue-fg}🏢 Organization Statistics{/blue-fg}{/bold}\n`;
    content += `{bold}Total Organizations:{/bold} ${stats.organizations.total.toLocaleString()}\n`;
    content += `{bold}Unique Organizations:{/bold} ${stats.organizations.unique.toLocaleString()}\n`;
    content += `{bold}With Job Titles:{/bold} ${stats.organizations.withTitles.toLocaleString()}\n`;
    
    if (stats.organizations.topCompanies.length > 0) {
      content += `{bold}Top Companies:{/bold}\n`;
      stats.organizations.topCompanies.slice(0, 5).forEach(company => {
        content += `  • ${company.name}: ${company.count} contacts\n`;
      });
    }
    content += '\n';

    // Address statistics
    content += `{bold}{magenta-fg}🏠 Address Statistics{/magenta-fg}{/bold}\n`;
    content += `{bold}Total Addresses:{/bold} ${stats.addresses.total.toLocaleString()}\n`;
    
    if (Object.keys(stats.addresses.countries).length > 0) {
      content += `{bold}Countries:{/bold}\n`;
      const topAddressCountries = Object.entries(stats.addresses.countries)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5);
      
      topAddressCountries.forEach(([country, count]) => {
        content += `  • ${country}: ${count}\n`;
      });
    }

    return content;
  }

  private getQualityMetricsContent(): string {
    const quality = this.statsManager.getQualityMetrics();
    
    let content = `{bold}{yellow-fg}Data Quality Assessment{/yellow-fg}{/bold}\n\n`;

    // Quality scores
    content += `{bold}{cyan-fg}Quality Scores{/cyan-fg}{/bold}\n`;
    content += `{bold}Completeness Score:{/bold} ${this.getScoreColor(quality.completenessScore)}${quality.completenessScore}/100{/} ${this.createProgressBar(quality.completenessScore, 20)}\n`;
    content += `{bold}Duplicate Score:{/bold} ${this.getInverseScoreColor(quality.duplicateScore)}${quality.duplicateScore}/100{/} ${this.createProgressBar(100 - quality.duplicateScore, 20)} (lower is better)\n`;
    content += `{bold}Standardization Score:{/bold} ${this.getScoreColor(quality.standardizationScore)}${quality.standardizationScore}/100{/} ${this.createProgressBar(quality.standardizationScore, 20)}\n\n`;

    // Missing fields
    content += `{bold}{red-fg}Missing Fields{/red-fg}{/bold}\n`;
    content += `{bold}No Email:{/bold} ${quality.missingFields.noEmail.toLocaleString()} contacts\n`;
    content += `{bold}No Phone:{/bold} ${quality.missingFields.noPhone.toLocaleString()} contacts\n`;
    content += `{bold}No Address:{/bold} ${quality.missingFields.noAddress.toLocaleString()} contacts\n`;
    content += `{bold}No Organization:{/bold} ${quality.missingFields.noOrganization.toLocaleString()} contacts\n`;
    content += `{bold}Incomplete Names:{/bold} ${quality.missingFields.incompleteNames.toLocaleString()} contacts\n\n`;

    // Data issues
    content += `{bold}{yellow-fg}Data Issues{/yellow-fg}{/bold}\n`;
    content += `{bold}Duplicate Names:{/bold} ${quality.dataIssues.duplicateNames.toLocaleString()}\n`;
    content += `{bold}Invalid Emails:{/bold} ${quality.dataIssues.invalidEmails.toLocaleString()}\n`;
    content += `{bold}Invalid Phones:{/bold} ${quality.dataIssues.invalidPhones.toLocaleString()}\n`;
    content += `{bold}Empty Fields:{/bold} ${quality.dataIssues.emptyFields.toLocaleString()}\n\n`;

    // Recommendations
    content += `{bold}{green-fg}Recommendations{/green-fg}{/bold}\n`;
    
    if (quality.dataIssues.duplicateNames > 0) {
      content += `• Run the {cyan-fg}Duplicate Name Fixer{/cyan-fg} tool to clean up ${quality.dataIssues.duplicateNames} duplicate names\n`;
    }
    
    const phoneStats = this.statsManager.getFieldStats().phones;
    if (phoneStats.needsNormalization > 0) {
      content += `• Run the {cyan-fg}Phone Normalization{/cyan-fg} tool to standardize ${phoneStats.needsNormalization} phone numbers\n`;
    }
    
    if (quality.missingFields.noEmail > 10) {
      content += `• Consider collecting email addresses for ${quality.missingFields.noEmail} contacts without emails\n`;
    }
    
    if (quality.completenessScore < 70) {
      content += `• Focus on improving data completeness - current score is ${quality.completenessScore}%\n`;
    }

    return content;
  }

  private getAppMetricsContent(): string {
    const app = this.statsManager.getAppMetrics();
    
    let content = `{bold}{yellow-fg}Application Metrics{/yellow-fg}{/bold}\n\n`;

    // System information
    content += `{bold}{cyan-fg}System Information{/cyan-fg}{/bold}\n`;
    content += `{bold}App Version:{/bold} 1.8.0\n`;
    content += `{bold}Start Time:{/bold} ${app.startTime.toLocaleString()}\n`;
    content += `{bold}Uptime:{/bold} ${app.uptime}\n`;
    content += `{bold}Memory Usage:{/bold}\n`;
    content += `  • RSS: ${this.formatBytes(app.memoryUsage.rss)}\n`;
    content += `  • Heap Used: ${this.formatBytes(app.memoryUsage.heapUsed)}\n`;
    content += `  • Heap Total: ${this.formatBytes(app.memoryUsage.heapTotal)}\n`;
    content += `  • External: ${this.formatBytes(app.memoryUsage.external)}\n\n`;

    // API statistics
    content += `{bold}{green-fg}API Statistics{/green-fg}{/bold}\n`;
    content += `{bold}Total API Calls:{/bold} ${app.apiCalls.total.toLocaleString()}\n`;
    content += `{bold}Successful Calls:{/bold} {green-fg}${app.apiCalls.successful.toLocaleString()}{/green-fg}\n`;
    content += `{bold}Failed Calls:{/bold} {red-fg}${app.apiCalls.failed.toLocaleString()}{/red-fg}\n`;
    
    if (app.apiCalls.total > 0) {
      const successRate = Math.round((app.apiCalls.successful / app.apiCalls.total) * 100);
      content += `{bold}Success Rate:{/bold} ${this.getScoreColor(successRate)}${successRate}%{/} ${this.createProgressBar(successRate, 15)}\n`;
    }
    
    if (app.apiCalls.lastCall) {
      content += `{bold}Last API Call:{/bold} ${app.apiCalls.lastCall.toLocaleString()}\n`;
    }
    content += '\n';

    // User activity
    content += `{bold}{blue-fg}User Activity{/blue-fg}{/bold}\n`;
    content += `{bold}Contacts Viewed:{/bold} ${app.userActions.contactsViewed.toLocaleString()}\n`;
    content += `{bold}Searches Performed:{/bold} ${app.userActions.searchesPerformed.toLocaleString()}\n`;
    content += `{bold}Tools Run:{/bold} ${app.userActions.toolsRun.toLocaleString()}\n`;
    content += `{bold}Data Refreshes:{/bold} ${app.userActions.refreshes.toLocaleString()}\n\n`;

    // Performance metrics
    content += `{bold}{magenta-fg}Performance Metrics{/magenta-fg}{/bold}\n`;
    content += `{bold}Average Load Time:{/bold} ${app.performance.avgLoadTime}ms\n`;
    content += `{bold}Average Search Time:{/bold} ${app.performance.avgSearchTime}ms\n\n`;

    // Runtime information
    content += `{bold}{yellow-fg}Runtime Environment{/yellow-fg}{/bold}\n`;
    content += `{bold}Node.js Version:{/bold} ${process.version}\n`;
    content += `{bold}Platform:{/bold} ${process.platform}\n`;
    content += `{bold}Architecture:{/bold} ${process.arch}\n`;
    content += `{bold}Current Working Directory:{/bold} ${process.cwd()}\n`;

    return content;
  }

  // Utility methods
  private getPercentage(value: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  }

  private createProgressBar(percentage: number, width: number = 20): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '{cyan-fg}█{/cyan-fg}'.repeat(filled) + '{gray-fg}░{/gray-fg}'.repeat(empty);
  }

  private getScoreColor(score: number): string {
    if (score >= 80) return '{green-fg}';
    if (score >= 60) return '{yellow-fg}';
    return '{red-fg}';
  }

  private getInverseScoreColor(score: number): string {
    if (score <= 20) return '{green-fg}';
    if (score <= 40) return '{yellow-fg}';
    return '{red-fg}';
  }

  private formatBytes(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  private exportStats(): void {
    try {
      const fs = require('fs');
      const path = require('path');
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `contactsplus-stats-${timestamp}.json`;
      const filepath = path.join(process.cwd(), filename);
      
      const statsData = {
        exportTime: new Date().toISOString(),
        contacts: this.statsManager.getContactStats(),
        fields: this.statsManager.getFieldStats(),
        quality: this.statsManager.getQualityMetrics(),
        app: this.statsManager.getAppMetrics(),
      };
      
      fs.writeFileSync(filepath, JSON.stringify(statsData, null, 2), 'utf8');
      
      this.showMessage(`Statistics exported to: ${filename}`, 'success');
    } catch (error) {
      this.showMessage('Failed to export statistics: ' + error, 'error');
    }
  }

  private showMessage(message: string, type: 'success' | 'error' | 'info'): void {
    const colors = { success: 'green', error: 'red', info: 'cyan' };
    const color = colors[type];
    
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
      this.statsBox.focus();
      this.screen.render();
    });
    
    this.screen.render();

    // Auto-close info messages after 3 seconds
    if (type === 'info') {
      setTimeout(() => {
        if (messageBox.parent) {
          this.screen.remove(messageBox);
          this.statsBox.focus();
          this.screen.render();
        }
      }, 3000);
    }
  }

  show(): void {
    this.isVisible = true;
    this.statsBox.show();
    this.statsBox.focus();
    this.updateDisplay();
    
    // Start auto-refresh every 30 seconds for app metrics
    this.refreshInterval = setInterval(() => {
      if (this.isVisible && this.currentTab === 3) {
        this.updateDisplay();
      }
    }, 30000);
  }

  hide(): void {
    this.isVisible = false;
    this.statsBox.hide();
    
    // Clear auto-refresh
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
    
    this.screen.render();
  }

  isShowing(): boolean {
    return this.isVisible;
  }
}