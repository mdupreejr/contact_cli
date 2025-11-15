import * as blessed from 'blessed';
import { Contact, AccountInfo } from '../types/contactsplus';
import { ToolsMenu } from './tools-menu';
import { ContactsApi } from '../api/contacts';
import { LoggingScreen } from './logging-screen';
import { StatsScreen } from './stats-screen';
import { SettingsScreen } from './settings-screen';
import { StatsManager } from '../utils/stats-manager';
import { ListNavigator } from '../utils/list-navigator';

export class Screen {
  private screen: blessed.Widgets.Screen;
  private header!: blessed.Widgets.BoxElement;
  private contactList!: blessed.Widgets.ListElement;
  private contactDetail!: blessed.Widgets.BoxElement;
  private footer!: blessed.Widgets.BoxElement;
  private searchBox!: blessed.Widgets.TextboxElement;
  private isSearchMode = false;
  private contacts: Contact[] = [];
  private filteredContacts: Contact[] = [];
  private selectedContactIndex = 0;
  private toolsMenu: ToolsMenu;
  private loggingScreen: LoggingScreen;
  private statsScreen: StatsScreen;
  private settingsScreen: SettingsScreen;
  private statsManager: StatsManager;
  private contactListNavigator?: ListNavigator;

  constructor(contactsApi: ContactsApi) {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'ContactsPlus CLI',
    });

    // Initialize stats manager
    this.statsManager = new StatsManager();

    this.createHeader();
    this.createContactList();
    this.createContactDetail();
    this.createFooter();
    this.createSearchBox();
    
    // Initialize tools menu
    this.toolsMenu = new ToolsMenu(this.screen, contactsApi, (updatedContacts) => {
      this.handleContactsUpdated(updatedContacts);
    });
    
    // Initialize logging, stats, and settings screens
    this.loggingScreen = new LoggingScreen(this.screen);
    this.statsScreen = new StatsScreen(this.screen, this.statsManager);
    this.settingsScreen = new SettingsScreen(this.screen, () => {
      // Callback when settings are saved - could refresh data if needed
      this.emit('settingsSaved');
    });

    this.setupKeyHandling();
  }

  private createHeader(): void {
    this.header = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' ContactsPlus CLI - Loading...',
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'blue',
        border: {
          fg: 'blue',
        },
      },
    });

    this.screen.append(this.header);
  }

  private createContactList(): void {
    this.contactList = blessed.list({
      top: 3,
      left: 0,
      width: '40%',
      height: '80%',
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
          fg: 'cyan',
        },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
    });

    this.screen.append(this.contactList);

    // Set up standardized list navigation with automatic detail loading
    this.contactListNavigator = new ListNavigator({
      element: this.contactList,
      onSelectionChange: (index) => {
        this.selectedContactIndex = index;
        this.showContactDetail();
      },
      enableVimKeys: true,
      pageSize: 10,
    });
  }

  private createContactDetail(): void {
    this.contactDetail = blessed.box({
      top: 3,
      left: '40%',
      width: '60%',
      height: '80%',
      content: 'Select a contact to view details',
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'cyan',
        },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: true, // Enable blessed tags for formatting
    });

    this.screen.append(this.contactDetail);
  }

  private createFooter(): void {
    this.footer = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' {cyan-fg}↑↓/j/k{/cyan-fg}: Navigate | {cyan-fg}PgUp/PgDn{/cyan-fg}: Page | {cyan-fg}/{/cyan-fg}: Search | {cyan-fg}t{/cyan-fg}: Tools | {cyan-fg}s{/cyan-fg}: Stats | {cyan-fg}l{/cyan-fg}: Logs | {cyan-fg}p{/cyan-fg}: Settings | {cyan-fg}r{/cyan-fg}: Refresh | {cyan-fg}q{/cyan-fg}: Quit',
      style: {
        fg: 'white',
        bg: 'black',
      },
      tags: true,
    });

    this.screen.append(this.footer);
  }

  private createSearchBox(): void {
    this.searchBox = blessed.textbox({
      top: 'center',
      left: 'center',
      width: 50,
      height: 3,
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
      hidden: true,
      tags: true,
      label: ' Search Contacts ',
      inputOnFocus: true,
      keys: true,
      mouse: true,
    });

    this.screen.append(this.searchBox);

    this.searchBox.key(['escape'], () => {
      this.exitSearchMode();
    });
  }

  private setupKeyHandling(): void {
    // Update contact detail when selection changes
    this.contactList.on('select', (item, index) => {
      this.selectedContactIndex = index;  // Track selected index
      this.showContactDetail();
      this.screen.render();
    });

    // Add explicit arrow key handlers as backup
    this.contactList.key(['up', 'down'], () => {
      this.showContactDetail();
      this.screen.render();
    });

    // Escape key - go back one level
    this.screen.key(['escape'], () => {
      if (this.toolsMenu.isShowing()) {
        this.toolsMenu.hide();
      } else if (this.loggingScreen.isShowing()) {
        this.loggingScreen.hide();
      } else if (this.statsScreen.isShowing()) {
        this.statsScreen.hide();
      } else if (this.isSearchMode) {
        this.exitSearchMode();
      }
      // If on main screen, escape does nothing (use 'q' to quit)
    });

    // Q key and Ctrl-C - quit the app
    this.screen.key(['q', 'C-c'], () => {
      process.exit(0);
    });

    this.screen.key(['/'], () => {
      if (!this.toolsMenu.isShowing() && !this.loggingScreen.isShowing() && !this.statsScreen.isShowing()) {
        this.enterSearchMode();
      }
    });

    this.screen.key(['t'], () => {
      if (!this.isSearchMode && !this.loggingScreen.isShowing() && !this.statsScreen.isShowing()) {
        this.showTools();
      }
    });

    this.screen.key(['s'], () => {
      if (!this.isSearchMode && !this.toolsMenu.isShowing() && !this.loggingScreen.isShowing() && !this.syncQueueViewer?.isShowing()) {
        this.showStats();
      }
    });

    this.screen.key(['l'], () => {
      if (!this.isSearchMode && !this.toolsMenu.isShowing() && !this.statsScreen.isShowing()) {
        this.showLogs();
      }
    });

    this.screen.key(['p'], () => {
      if (!this.isSearchMode && !this.toolsMenu.isShowing() && !this.loggingScreen.isShowing() && !this.statsScreen.isShowing()) {
        this.showSettings();
      }
    });

    this.screen.key(['r'], () => {
      if (!this.toolsMenu.isShowing() && !this.isSearchMode && !this.loggingScreen.isShowing() && !this.statsScreen.isShowing()) {
        this.statsManager.recordRefresh();
        this.emit('refresh');
      }
    });

    this.screen.key(['enter'], () => {
      if (!this.isSearchMode && !this.toolsMenu.isShowing() && !this.loggingScreen.isShowing() && !this.statsScreen.isShowing()) {
        this.showContactDetail();
      }
    });

    this.searchBox.on('submit', (value: string) => {
      this.performSearch(value);
      this.exitSearchMode();
    });

    this.searchBox.on('cancel', () => {
      this.exitSearchMode();
    });
  }

  private enterSearchMode(): void {
    this.isSearchMode = true;
    this.searchBox.show();
    this.searchBox.focus();
    this.searchBox.setValue('');
    this.searchBox.readInput();
    this.screen.render();
  }

  private exitSearchMode(): void {
    this.isSearchMode = false;
    this.searchBox.hide();
    this.contactList.focus();
    this.screen.render();
  }

  private performSearch(query: string): void {
    this.statsManager.recordSearch();
    
    if (!query.trim()) {
      this.filteredContacts = [...this.contacts];
    } else {
      const startTime = Date.now();
      const lowerQuery = query.toLowerCase();
      this.filteredContacts = this.contacts.filter(contact => {
        const name = this.getContactDisplayName(contact).toLowerCase();
        const email = contact.contactData.emails?.[0]?.value?.toLowerCase() || '';
        const company = contact.contactData.organizations?.[0]?.name?.toLowerCase() || '';
        
        return name.includes(lowerQuery) || 
               email.includes(lowerQuery) || 
               company.includes(lowerQuery);
      });
      
      const searchTime = Date.now() - startTime;
      this.statsManager.recordSearchTime(searchTime);
    }
    this.updateContactList();
  }

  private showContactDetail(): void {
    const selectedIndex = (this.contactList as any).selected || 0;
    const contact = this.filteredContacts[selectedIndex];

    if (!contact || this.filteredContacts.length === 0) {
      this.contactDetail.setContent('Select a contact to view details');
      this.screen.render();
      return;
    }

    // Record contact view for statistics
    this.statsManager.recordContactView(contact.contactId);

    const details = this.formatContactDetails(contact);
    this.contactDetail.setContent(details);
    this.screen.render();
  }

  private formatContactDetails(contact: Contact): string {
    const name = this.getContactDisplayName(contact);
    const data = contact.contactData || {};

    let details = `{bold}{cyan-fg}${name}{/cyan-fg}{/bold}\n\n`;

    // Emails
    if (data.emails && data.emails.length > 0) {
      details += '{bold}{yellow-fg}📧 Emails{/yellow-fg}{/bold}\n';
      data.emails.forEach(email => {
        details += `  {green-fg}${blessed.escape(email.type || 'Email')}:{/green-fg} ${blessed.escape(email.value)}\n`;
      });
      details += '\n';
    }

    // Phone numbers
    if (data.phoneNumbers && data.phoneNumbers.length > 0) {
      details += '{bold}{yellow-fg}📞 Phone Numbers{/yellow-fg}{/bold}\n';
      data.phoneNumbers.forEach(phone => {
        details += `  {green-fg}${blessed.escape(phone.type || 'Phone')}:{/green-fg} ${blessed.escape(phone.value)}\n`;
      });
      details += '\n';
    }

    // Organizations
    if (data.organizations && data.organizations.length > 0) {
      details += '{bold}{yellow-fg}🏢 Organizations{/yellow-fg}{/bold}\n';
      data.organizations.forEach(org => {
        if (org.name) details += `  {green-fg}Company:{/green-fg} ${blessed.escape(org.name)}\n`;
        if (org.title) details += `  {green-fg}Title:{/green-fg} ${blessed.escape(org.title)}\n`;
        if (org.department) details += `  {green-fg}Department:{/green-fg} ${blessed.escape(org.department)}\n`;
        details += '\n';
      });
    }

    // Addresses
    if (data.addresses && data.addresses.length > 0) {
      details += '{bold}{yellow-fg}🏠 Addresses{/yellow-fg}{/bold}\n';
      data.addresses.forEach(addr => {
        details += `  {green-fg}${blessed.escape(addr.type || 'Address')}:{/green-fg}\n`;
        if (addr.street) details += `    ${blessed.escape(addr.street)}\n`;
        const cityLine = [addr.city, addr.region, addr.postalCode].filter((s): s is string => Boolean(s)).map(s => blessed.escape(s)).join(' ');
        if (cityLine) details += `    ${cityLine}\n`;
        if (addr.country) details += `    ${blessed.escape(addr.country)}\n`;
        details += '\n';
      });
    }

    // URLs/Social Media
    if (data.urls && data.urls.length > 0) {
      details += '{bold}{yellow-fg}🌐 URLs & Social Media{/yellow-fg}{/bold}\n';
      data.urls.forEach(url => {
        details += `  {green-fg}${blessed.escape(url.type || 'URL')}:{/green-fg} ${blessed.escape(url.value)}\n`;
        if (url.username) details += `    {gray-fg}Username: ${blessed.escape(url.username)}{/gray-fg}\n`;
        if (url.userId) details += `    {gray-fg}User ID: ${blessed.escape(url.userId)}{/gray-fg}\n`;
      });
      details += '\n';
    }

    // Instant Messages
    if (data.ims && data.ims.length > 0) {
      details += '{bold}{yellow-fg}💬 Instant Messages{/yellow-fg}{/bold}\n';
      data.ims.forEach(im => {
        details += `  {green-fg}${blessed.escape(im.type || 'IM')}:{/green-fg} ${blessed.escape(im.value)}\n`;
      });
      details += '\n';
    }

    // Related People
    if (data.relatedPeople && data.relatedPeople.length > 0) {
      details += '{bold}{yellow-fg}👥 Related People{/yellow-fg}{/bold}\n';
      data.relatedPeople.forEach(person => {
        details += `  {green-fg}${blessed.escape(person.type || 'Relation')}:{/green-fg} ${blessed.escape(person.value)}\n`;
      });
      details += '\n';
    }

    // Important Dates
    if (data.dates && data.dates.length > 0) {
      details += '{bold}{yellow-fg}📅 Important Dates{/yellow-fg}{/bold}\n';
      data.dates.forEach(date => {
        let dateStr = '';
        if (date.month && date.day && date.year) {
          dateStr = `${blessed.escape(String(date.month))}/${blessed.escape(String(date.day))}/${blessed.escape(String(date.year))}`;
        } else if (date.month && date.day) {
          dateStr = `${blessed.escape(String(date.month))}/${blessed.escape(String(date.day))}`;
        }
        details += `  {green-fg}${blessed.escape(date.type || 'Date')}:{/green-fg} ${dateStr}\n`;
      });
      details += '\n';
    }

    // Birthday
    if (data.birthday) {
      details += '{bold}{yellow-fg}🎂 Birthday{/yellow-fg}{/bold}\n';
      let birthdayStr = '';
      if (data.birthday.month && data.birthday.day && data.birthday.year) {
        birthdayStr = `${blessed.escape(String(data.birthday.month))}/${blessed.escape(String(data.birthday.day))}/${blessed.escape(String(data.birthday.year))}`;
      } else if (data.birthday.month && data.birthday.day) {
        birthdayStr = `${blessed.escape(String(data.birthday.month))}/${blessed.escape(String(data.birthday.day))}`;
      }
      details += `  ${birthdayStr}\n\n`;
    }

    // Custom Items
    if (data.items && data.items.length > 0) {
      details += '{bold}{yellow-fg}📋 Additional Information{/yellow-fg}{/bold}\n';
      data.items.forEach(item => {
        details += `  {green-fg}${blessed.escape(item.type || 'Info')}:{/green-fg} ${blessed.escape(item.value)}\n`;
      });
      details += '\n';
    }

    // Notes
    if (data.notes) {
      details += `{bold}{yellow-fg}📝 Notes{/yellow-fg}{/bold}\n${blessed.escape(data.notes)}\n\n`;
    }

    // Tags (from metadata)
    if (contact.contactMetadata.tagIds && contact.contactMetadata.tagIds.length > 0) {
      details += `{bold}{yellow-fg}🏷️  Tags{/yellow-fg}{/bold}\n`;
      details += `  {green-fg}Tag IDs:{/green-fg} ${contact.contactMetadata.tagIds.map(id => blessed.escape(id)).join(', ')}\n\n`;
    }

    // Business Card Status
    if (contact.contactMetadata.businessCardTranscriptionStatus) {
      details += `{bold}{yellow-fg}💳 Business Card{/yellow-fg}{/bold}\n`;
      details += `  {green-fg}Status:{/green-fg} ${blessed.escape(contact.contactMetadata.businessCardTranscriptionStatus)}\n\n`;
    }

    // Team Information
    if (contact.teamId) {
      details += `{bold}{yellow-fg}👔 Team Information{/yellow-fg}{/bold}\n`;
      details += `  {green-fg}Team ID:{/green-fg} ${blessed.escape(contact.teamId)}\n`;
      if (contact.contactMetadata.ownedBy) {
        details += `  {green-fg}Owned by:{/green-fg} ${blessed.escape(contact.contactMetadata.ownedBy)}\n`;
      }
      if (contact.contactMetadata.sharedBy && contact.contactMetadata.sharedBy.length > 0) {
        details += `  {green-fg}Shared by:{/green-fg} ${contact.contactMetadata.sharedBy.map(id => blessed.escape(id)).join(', ')}\n`;
      }
      details += '\n';
    }

    // Metadata
    details += `{bold}{yellow-fg}ℹ️  Contact Info{/yellow-fg}{/bold}\n`;
    details += `  {green-fg}Contact ID:{/green-fg} ${blessed.escape(contact.contactId)}\n`;
    details += `  {green-fg}ETag:{/green-fg} ${blessed.escape(contact.etag)}\n`;
    details += `  {green-fg}Created:{/green-fg} ${new Date(contact.created).toLocaleDateString()}\n`;
    details += `  {green-fg}Updated:{/green-fg} ${new Date(contact.updated).toLocaleDateString()}\n`;
    if (contact.contactMetadata.companyContact) {
      details += `  {green-fg}Company Contact:{/green-fg} Yes\n`;
    }

    return details;
  }

  private getContactDisplayName(contact: Contact): string {
    const name = contact.contactData?.name;
    if (name && (name.givenName || name.familyName)) {
      const parts = [name.prefix, name.givenName, name.middleName, name.familyName, name.suffix]
        .filter(Boolean);
      if (parts.length > 0) {
        return blessed.escape(parts.join(' '));
      }
    }

    // Fallback to email or organization
    if (contact.contactData?.emails?.[0]?.value) {
      return blessed.escape(contact.contactData.emails[0].value);
    }

    if (contact.contactData?.organizations?.[0]?.name) {
      return blessed.escape(contact.contactData.organizations[0].name);
    }

    // Fallback to phone number
    if (contact.contactData?.phoneNumbers?.[0]?.value) {
      return blessed.escape(contact.contactData.phoneNumbers[0].value);
    }

    return 'Unnamed Contact';
  }

  updateHeader(accountInfo?: AccountInfo, contactCount?: number): void {
    let headerText = ' ContactsPlus CLI';
    
    if (accountInfo) {
      const accountName = this.getContactDisplayName({ contactData: accountInfo.profileData } as Contact);
      headerText += ` - ${accountName}`;
    }
    
    if (contactCount !== undefined) {
      headerText += ` (${contactCount} contacts)`;
    }
    
    this.header.setContent(headerText);
    this.screen.render();
  }

  setContacts(contacts: Contact[]): void {
    this.contacts = contacts;
    this.filteredContacts = [...contacts];
    this.statsManager.setContacts(contacts);
    this.updateContactList();
  }

  private updateContactList(): void {
    if (this.filteredContacts.length === 0) {
      this.contactList.setItems(['No contacts found']);
      this.contactDetail.setContent('No contacts to display.\n\nTry refreshing with {cyan-fg}r{/cyan-fg} or check your search query.');
      if (this.contactListNavigator) {
        this.contactListNavigator.setItemCount(0);
      }
    } else {
      const items = this.filteredContacts.map(contact => this.getContactDisplayName(contact));
      this.contactList.setItems(items);
      this.contactList.select(0);

      // Update the navigator with the new item count
      if (this.contactListNavigator) {
        this.contactListNavigator.setItemCount(this.filteredContacts.length);
        this.contactListNavigator.setIndex(0);
      }

      this.showContactDetail(); // Show details of first contact
    }
    this.screen.render();
  }

  showLoading(message: string = 'Loading...'): void {
    this.header.setContent(` ContactsPlus CLI - ${message}`);
    this.screen.render();
  }

  showError(error: string): void {
    const errorBox = blessed.box({
      top: 'center',
      left: 'center',
      width: 60,
      height: 8,
      content: `Error: ${error}\n\nPress any key to continue...`,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        bg: 'red',
        border: {
          fg: 'red',
        },
      },
    });

    this.screen.append(errorBox);
    errorBox.focus();
    
    errorBox.key(['escape', 'enter', 'space'], () => {
      this.screen.remove(errorBox);
      this.contactList.focus();
      this.screen.render();
    });
    
    this.screen.render();
  }

  render(): void {
    this.screen.render();
  }

  emit(event: string, data?: unknown): void {
    this.screen.emit(event, data);
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    this.screen.on(event, callback);
  }

  focus(): void {
    this.contactList.focus();
  }

  get syncQueueViewer() {
    return this.toolsMenu.getSyncQueueViewer();
  }

  private showTools(): void {
    this.statsManager.recordToolRun();
    this.toolsMenu.show(this.contacts);
  }

  private showStats(): void {
    this.statsScreen.show();
  }

  private showLogs(): void {
    this.loggingScreen.show();
  }

  private showSettings(): void {
    this.settingsScreen.show();
  }

  private handleContactsUpdated(updatedContacts: Contact[]): void {
    this.contacts = updatedContacts;
    this.filteredContacts = [...updatedContacts];
    this.updateContactList();
    this.emit('contactsUpdated', updatedContacts);
  }

  // Methods for stats tracking
  recordApiCall(success: boolean): void {
    this.statsManager.recordApiCall(success);
  }

  recordLoadTime(timeMs: number): void {
    this.statsManager.recordLoadTime(timeMs);
  }

  destroy(): void {
    this.screen.destroy();
  }
}