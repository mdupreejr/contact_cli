# ContactsPlus CLI - Bug Fix Task Plan

## Overview
This document outlines the tasks needed to fix critical bugs and improve UX consistency in the ContactsPlus CLI application. Tasks are organized by priority and include specific file locations, acceptance criteria, and implementation approaches.

---

## Priority 1: Critical Bugs (Blocking Functionality)

### Task 1.1: Fix Sync Queue Freeze with 100 Failed Items
**Priority:** Critical
**Estimated Time:** 2-3 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/sync-queue-viewer.ts`, `/Users/spike/projects/contactsplus/src/db/sync-engine.ts`

**Problem:**
When pressing 's' to sync with 100 failed items in the queue, the application freezes completely.

**Root Cause Analysis:**
- Line 757-825 in `sync-queue-viewer.ts`: `syncApprovedItems()` method processes sync synchronously in the UI thread
- No timeout handling for stuck sync operations
- Progress callback may be creating render loop that blocks the UI
- Failed items may be retrying indefinitely without backoff

**Implementation Approach:**
1. Add timeout mechanism for individual sync operations (max 30 seconds per item)
2. Implement batch processing with pauses between batches to prevent UI blocking
3. Add error boundary to catch and recover from sync failures
4. Filter out failed items with excessive retry counts before syncing
5. Add "Cancel" button visible during sync operation

**Acceptance Criteria:**
- [ ] Sync operation completes or fails gracefully within reasonable time (< 5 minutes for 100 items)
- [ ] UI remains responsive during sync (can cancel operation)
- [ ] Failed items don't retry more than 3 times without user approval
- [ ] Progress indicator updates smoothly without blocking
- [ ] Error message displayed if sync times out or fails

**Code Changes:**
```typescript
// sync-queue-viewer.ts line 757
private async syncApprovedItems(): Promise<void> {
  // Add filtering of failed items with high retry counts
  const approvedItems = this.syncQueue.getApprovedItems()
    .filter(item => item.retryCount < 3);

  // Add batch processing with UI refresh intervals
  const BATCH_SIZE = 10;
  const BATCH_DELAY = 100; // ms between batches

  // Add cancellation flag
  this.syncCancelled = false;

  // Process in batches to allow UI updates
  // Add timeout per item (30 seconds)
}
```

---

### Task 1.2: Fix Phone Number Analyzer Queue Population
**Priority:** Critical
**Estimated Time:** 1-2 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/tools-menu.ts`, `/Users/spike/projects/contactsplus/src/tools/phone-normalization-tool.ts`

**Problem:**
Phone analyzer says "1880 phone numbers found to normalize" but doesn't put them in the queue, then freezes.

**Root Cause Analysis:**
- Line 856-935 in `tools-menu.ts`: `runPhoneNormalizationTool()` uses old suggestion viewer pattern
- Company cleaning tool (line 937-1036) shows correct pattern: queues to sync queue directly
- Phone tool should queue suggestions instead of using interactive viewer for batch operations

**Implementation Approach:**
1. Refactor `runPhoneNormalizationTool()` to match `runCompanyNameCleaningTool()` pattern
2. Queue all suggestions to sync queue with session ID
3. Remove suggestion viewer loop that causes freezing
4. Add batch progress logging to detail box

**Acceptance Criteria:**
- [ ] All detected phone number suggestions added to sync queue
- [ ] Tool completes without freezing
- [ ] User sees progress of analysis in real-time
- [ ] Final message shows "Go to Sync Queue Manager to review"
- [ ] No interactive one-by-one approval during analysis

**Code Changes:**
```typescript
// tools-menu.ts line 856
private async runPhoneNormalizationTool(): Promise<void> {
  // Remove suggestion viewer loop (lines 896-918)
  // Add sync queue batch queuing pattern like company tool (lines 975-1027)

  const syncQueue = getSyncQueue();
  const importSessionId = `phone_normalization_${Date.now()}`;

  // Queue all suggestions directly
  for (const contactResult of result.results) {
    // Apply suggestions and queue to sync queue
  }
}
```

---

### Task 1.3: Fix Phone Tool Field Display Issue
**Priority:** Critical
**Estimated Time:** 1 hour
**Files:** `/Users/spike/projects/contactsplus/src/ui/suggestion-viewer.ts`

**Problem:**
Field shows "Q ??│Field: phoneNumbers[0].value" with corrupted display.

**Root Cause Analysis:**
- Line 217-221 in `suggestion-viewer.ts`: `escapeBlessedMarkup()` function exists but array bracket syntax `[0]` may still cause issues
- Blessed.js tags use `{}` syntax; brackets `[]` might also need escaping

**Implementation Approach:**
1. Enhance `escapeBlessedMarkup()` to handle square brackets
2. Test with array field names like `phoneNumbers[0].value`
3. Add unit tests for field name escaping

**Acceptance Criteria:**
- [ ] Field names with array indices display correctly
- [ ] No garbled characters (Q, ??, │) in field display
- [ ] All blessed.js special characters properly escaped

**Code Changes:**
```typescript
// suggestion-viewer.ts line 217
private escapeBlessedMarkup(text: string): string {
  return text
    .replace(/\{/g, '{open}')
    .replace(/\}/g, '{close}')
    .replace(/\[/g, '\\[')      // Add bracket escaping
    .replace(/\]/g, '\\]');     // Add bracket escaping
}
```

---

### Task 1.4: Fix Suggestion Viewer Navigation Stuck
**Priority:** Critical
**Estimated Time:** 1-2 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/suggestion-viewer.ts`

**Problem:**
Gets stuck on suggestion page, can't escape or navigate. Shows incorrect count "1/1 suggested change".

**Root Cause Analysis:**
- Line 158-194 in `suggestion-viewer.ts`: `show()` and `updateDisplay()` methods
- Progress calculation may be wrong when batch is empty
- Escape key (line 149) calls `hide()` but may not properly clean up state
- Batch may be marked complete but viewer doesn't exit

**Implementation Approach:**
1. Add safety check in `updateDisplay()` for empty/completed batches
2. Ensure `hide()` method calls `onComplete` callback
3. Add force-exit escape hatch (double-press ESC)
4. Fix progress calculation to show 0/0 instead of 1/1 for empty batches

**Acceptance Criteria:**
- [ ] ESC key always exits suggestion viewer
- [ ] Correct count displayed (0/0 for empty, N/M for valid batches)
- [ ] Double-ESC exits even if state is corrupted
- [ ] Callback always invoked when closing viewer

**Code Changes:**
```typescript
// suggestion-viewer.ts line 169
hide(): void {
  this.isVisible = false;
  this.container.hide();

  // Always call completion callback on hide
  if (this.onComplete && this.currentBatchId) {
    const summary = this.suggestionManager.getBatchSummary(this.currentBatchId);
    this.onComplete(this.currentBatchId, summary);
  }

  this.screen.render();
}

// suggestion-viewer.ts line 179
private async updateDisplay(): Promise<void> {
  // Add safety checks
  if (!this.currentBatchId || !batch || !batch.suggestions.length) {
    await this.handleBatchComplete();
    return;
  }
}
```

---

### Task 1.5: Fix Contact List Display Corruption
**Priority:** Critical
**Estimated Time:** 2 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/screen.ts`, `/Users/spike/projects/contactsplus/src/ui/contact-formatter.ts`

**Problem:**
First contact in the list shows "Q ?♂ ?♂ --" instead of proper name/info, indicating severe display corruption.

**Root Cause Analysis:**
- Contact formatting may not be handling special characters, emojis, or missing data properly
- Blessed.js markup escaping issue similar to Task 1.3 but in contact list rendering
- Possible null/undefined values being displayed as special characters
- Contact formatter may not have fallback for missing name fields

**Implementation Approach:**
1. Audit contact list item rendering in `screen.ts`
2. Ensure all contact data is validated before display
3. Add proper escaping for blessed.js markup in contact names
4. Implement fallback display for contacts with missing name data
5. Add unit tests for edge cases (no name, special characters, emojis)

**Acceptance Criteria:**
- [ ] All contacts display with readable text
- [ ] No garbled characters (Q, ?♂, ??) in contact list
- [ ] Contacts without names show fallback (e.g., phone number or email)
- [ ] Special characters and emojis properly escaped
- [ ] All blessed.js special characters handled correctly

**Code Changes:**
```typescript
// screen.ts - contact list rendering
private formatContactForList(contact: Contact): string {
  // Escape blessed.js special characters
  const escapedName = this.escapeBlessedMarkup(contact.displayName || 'No Name');

  // Provide fallback if name is empty
  if (!contact.displayName || contact.displayName.trim() === '') {
    return this.getContactFallbackDisplay(contact);
  }

  return escapedName;
}

private escapeBlessedMarkup(text: string): string {
  return text
    .replace(/\{/g, '{open}')
    .replace(/\}/g, '{close}')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

private getContactFallbackDisplay(contact: Contact): string {
  // Use phone number or email if name missing
  const phone = contact.contactData?.phoneNumbers?.[0]?.value;
  const email = contact.contactData?.emailAddresses?.[0]?.value;
  return this.escapeBlessedMarkup(phone || email || '(No Display Name)');
}
```

---

### Task 1.6: Fix Search Box Input Issue
**Priority:** Critical
**Estimated Time:** 2-3 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/screen.ts`

**Problem:**
When pressing '/' key, search box appears but cannot enter text into it. Complete input failure.

**Root Cause Analysis:**
- Search box may not be receiving focus when shown
- Key event handlers may be conflicting (screen vs. search box)
- Blessed.js textbox may not be properly configured for input
- Event handlers may not be transferred to search box

**Implementation Approach:**
1. Ensure search box receives focus when activated
2. Temporarily disable other key handlers when search is active
3. Verify textbox element is properly configured (input: true, keys: true)
4. Add explicit focus management when toggling search visibility
5. Test with various input scenarios

**Acceptance Criteria:**
- [ ] Search box accepts text input immediately after '/' pressed
- [ ] All keyboard input goes to search box when active
- [ ] ESC key exits search and returns focus to main list
- [ ] Enter key executes search
- [ ] No key conflicts between search box and main screen

**Code Changes:**
```typescript
// screen.ts - search box activation
private showSearchBox(): void {
  this.searchBox.show();
  this.searchBox.focus();  // Ensure focus

  // Temporarily remove main screen key handlers
  this.screen.unkey(['up', 'down', 'pageup', 'pagedown']);

  this.screen.render();
}

private hideSearchBox(): void {
  this.searchBox.hide();
  this.contactList.focus();  // Return focus to contact list

  // Re-enable main screen key handlers
  this.setupKeyHandlers();

  this.screen.render();
}
```

---

### Task 1.7: Fix AI Smart Deduplication Tool
**Priority:** Critical
**Estimated Time:** 3-4 hours
**Files:** `/Users/spike/projects/contactsplus/src/tools/ai-deduplication-tool.ts`, `/Users/spike/projects/contactsplus/src/ui/tools-menu.ts`

**Problem:**
AI Smart Deduplication reports "no duplicates" when duplicates obviously exist. Tool is completely non-functional.

**Root Cause Analysis:**
- Duplicate detection algorithm may have logic error
- Threshold for matching may be set too high (too strict)
- Query to database may not be returning all contacts
- Comparison function may be broken or returning false negatives
- Tool may be comparing wrong fields or using incorrect similarity metric

**Implementation Approach:**
1. Add comprehensive logging to duplicate detection process
2. Review similarity threshold configuration (lower if too strict)
3. Verify contact query returns all contacts, not filtered subset
4. Test comparison algorithm with known duplicate pairs
5. Add debug mode to show similarity scores for all contact pairs
6. Validate fuzzy matching and name normalization logic

**Acceptance Criteria:**
- [ ] Tool detects known duplicate contacts
- [ ] Similarity threshold is configurable and documented
- [ ] Tool logs how many contacts were compared
- [ ] Tool shows similarity scores in debug mode
- [ ] Detected duplicates are queued for review
- [ ] Tool completes without errors or freezing

**Code Changes:**
```typescript
// ai-deduplication-tool.ts
async analyze(): Promise<ToolResult> {
  const allContacts = await this.contactRepository.getAllContacts();

  logger.info(`AI Deduplication analyzing ${allContacts.length} contacts`);

  const duplicatePairs: DuplicatePair[] = [];

  // Compare all pairs
  for (let i = 0; i < allContacts.length; i++) {
    for (let j = i + 1; j < allContacts.length; j++) {
      const similarity = this.calculateSimilarity(allContacts[i], allContacts[j]);

      logger.debug(`Comparing contact ${i} with ${j}: similarity = ${similarity}`);

      if (similarity > this.SIMILARITY_THRESHOLD) {
        duplicatePairs.push({ contact1: allContacts[i], contact2: allContacts[j], score: similarity });
      }
    }
  }

  logger.info(`Found ${duplicatePairs.length} duplicate pairs`);

  return { duplicates: duplicatePairs };
}
```

---

## Priority 2: Navigation Consistency Issues

### Task 2.1: Create Base List Navigation Component Template
**Priority:** High
**Estimated Time:** 3-4 hours
**Files:** Create `/Users/spike/projects/contactsplus/src/ui/base-list-viewer.ts`

**Problem:**
Page up/down and arrow keys don't work consistently across all lists. Need a reusable template.

**Root Cause Analysis:**
- Each list implements navigation independently
- `sync-queue-viewer.ts` (line 186-242): Has arrow key support via blessed.js select event
- `screen.ts` (line 178-183): Contact list uses blessed.js select event
- Inconsistent key binding and focus management

**Implementation Approach:**
1. Create abstract `BaseListViewer` class with standardized navigation
2. Implement consistent key bindings: arrows, page up/down, home/end
3. Provide template methods for subclasses to override (render item, render details)
4. Handle focus management and screen rendering consistently

**Acceptance Criteria:**
- [ ] Single source of truth for list navigation behavior
- [ ] Arrow keys work in all lists
- [ ] Page Up/Down work in all lists
- [ ] Home/End keys work in all lists
- [ ] Details update automatically when navigating
- [ ] Scrollbar position updates correctly

**Implementation Pattern:**
```typescript
// base-list-viewer.ts
export abstract class BaseListViewer<T> {
  protected screen: blessed.Widgets.Screen;
  protected container: blessed.Widgets.BoxElement;
  protected list: blessed.Widgets.ListElement;
  protected detailBox: blessed.Widgets.BoxElement;

  protected items: T[] = [];
  protected selectedIndex: number = 0;

  constructor(screen: blessed.Widgets.Screen) {
    this.createUI();
    this.setupNavigation();
  }

  private setupNavigation(): void {
    // Standard navigation for all lists
    this.list.on('select', (item, index) => {
      this.selectedIndex = index;
      this.updateDetailView();
      this.screen.render();
    });

    // Page up/down
    this.list.key(['pageup'], () => this.pageUp());
    this.list.key(['pagedown'], () => this.pageDown());
    this.list.key(['home'], () => this.selectFirst());
    this.list.key(['end'], () => this.selectLast());
  }

  protected abstract renderItem(item: T, index: number): string;
  protected abstract renderDetail(item: T): string;
  protected abstract getItems(): T[];
}
```

---

### Task 2.2: Refactor Sync Queue Viewer to Use Base Template
**Priority:** High
**Estimated Time:** 2 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/sync-queue-viewer.ts`

**Problem:**
Sync queue doesn't update details when navigating to next item with arrow keys.

**Root Cause Analysis:**
- Line 189-193 in `sync-queue-viewer.ts`: Has select event but may not fire consistently
- Arrow key navigation might bypass select event
- Detail view only updates on manual selection, not on arrow navigation

**Implementation Approach:**
1. Extend `BaseListViewer` class
2. Override `renderItem()` to format queue items
3. Override `renderDetail()` to show before/after comparison
4. Remove duplicate navigation code

**Acceptance Criteria:**
- [ ] Details update automatically on arrow up/down
- [ ] Page up/down work correctly
- [ ] Scrolling updates detail pane in real-time
- [ ] Selected item always highlighted
- [ ] Detail box shows current item, not stale data

---

### Task 2.3: Restore Contact List Auto-Load Details
**Priority:** High
**Estimated Time:** 1 hour
**Files:** `/Users/spike/projects/contactsplus/src/ui/screen.ts`

**Problem:**
Main contact list no longer loads details automatically when scrolling up/down with arrows.

**Root Cause Analysis:**
- Line 180-183 in `screen.ts`: Has select event listener
- Line 526 in `updateContactList()`: Calls `showContactDetail()` only when setting items
- Recent changes may have broken auto-update on scroll

**Implementation Approach:**
1. Verify select event is properly attached to contactList
2. Ensure `showContactDetail()` is called on every selection change
3. Add explicit arrow key handlers if blessed.js select isn't firing
4. Test with keyboard and mouse navigation

**Acceptance Criteria:**
- [ ] Details auto-load when pressing up/down arrows
- [ ] Details auto-load when clicking on contact
- [ ] Details auto-load when using page up/down
- [ ] No lag or freeze during navigation
- [ ] Contact detail box shows current selection at all times

**Code Changes:**
```typescript
// screen.ts line 180
this.contactList.on('select', (item, index) => {
  this.selectedIndex = index;  // Track selected index
  this.showContactDetail();
  this.screen.render();
});

// Add explicit arrow key handlers as backup
this.contactList.key(['up', 'down'], () => {
  this.showContactDetail();
  this.screen.render();
});
```

---

### Task 2.4: Fix Keyboard Shortcut Inconsistency Across App
**Priority:** High
**Estimated Time:** 2-3 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/screen.ts`, `/Users/spike/projects/contactsplus/src/ui/stats-viewer.ts`, `/Users/spike/projects/contactsplus/src/ui/settings-page.ts`, all page components

**Problem:**
Keyboard shortcuts are inconsistent across the app. Stats page says 'q' to go back, but 'q' is for quit. Escape should be for going back, not 'q'.

**Root Cause Analysis:**
- Different pages implement different key bindings
- 'q' is overloaded (quit vs. go back depending on context)
- No standard pattern for navigation between pages
- User confusion about which key does what on each page

**Implementation Approach:**
1. Establish consistent keyboard shortcut standard:
   - `ESC` = Go back/up one level (never quit)
   - `q` = Quit application (only from main screen)
   - `q` = Go back (only on sub-pages, never quits app)
2. Audit all page components for key bindings
3. Update all pages to follow standard
4. Update all help text to reflect correct shortcuts
5. Add comments documenting the standard

**Acceptance Criteria:**
- [ ] ESC always goes back/up one level on all pages
- [ ] ESC never quits the application
- [ ] 'q' quits only from main contact list screen
- [ ] 'q' goes back on all sub-pages (consistent with ESC)
- [ ] All help text shows correct key bindings
- [ ] Keyboard shortcuts work identically across all pages

**Code Changes:**
```typescript
// Define standard in constants file
export const KEY_BINDINGS = {
  QUIT: 'q',           // Only on main screen
  GO_BACK: 'escape',   // All sub-pages
  GO_BACK_ALT: 'q',    // Alternative on sub-pages only
  SEARCH: '/',
  HELP: '?',
};

// stats-viewer.ts
private setupKeyHandlers(): void {
  // Remove 'q' for quit, use for go back
  this.screen.key(['escape', 'q'], () => {
    this.hide();
    this.onClose();
  });
}

// screen.ts - main screen
private setupKeyHandlers(): void {
  // 'q' quits only from main screen
  this.screen.key(['q'], () => {
    this.confirmQuit();
  });

  // ESC does NOT quit from main screen
  this.screen.key(['escape'], () => {
    // Close any open panels, return to main view
    this.closeAllPanels();
  });
}
```

---

### Task 2.5: Fix Settings Page Scroll and Navigation Issues
**Priority:** High
**Estimated Time:** 2 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/settings-page.ts`

**Problem:**
Settings page cannot scroll down to see bottom of page, and Escape key doesn't go back up a level.

**Root Cause Analysis:**
- Settings page content exceeds visible area but scrolling is not enabled
- Blessed.js scrollable property may not be set
- Key handler for ESC may not be registered
- Content box may not have proper height configuration

**Implementation Approach:**
1. Enable scrollable property on settings content box
2. Add scroll key handlers (up/down arrows, page up/down)
3. Register ESC key to return to previous screen
4. Ensure content box uses proper height (100%-1 for border)
5. Add scrollbar indicator

**Acceptance Criteria:**
- [ ] Can scroll to bottom of settings page using arrow keys
- [ ] Page up/down work for faster scrolling
- [ ] Scrollbar indicator shows current position
- [ ] ESC key returns to main menu/previous screen
- [ ] All settings options are visible and accessible
- [ ] Content does not get cut off

**Code Changes:**
```typescript
// settings-page.ts
private createUI(): void {
  this.container = blessed.box({
    parent: this.screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    scrollable: true,          // Enable scrolling
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: { fg: 'blue' }
    },
    keys: true,                // Enable key handling
    vi: true,                  // Enable vi-style navigation
  });

  // Register ESC to go back
  this.container.key(['escape', 'q'], () => {
    this.hide();
    this.onClose?.();
  });

  // Ensure focus for scrolling to work
  this.container.focus();
}
```

---

## Priority 3: Tool Data Quality Issues

### Task 3.1: Fix Company Clean Tool Field Display
**Priority:** Medium
**Estimated Time:** 2 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/sync-queue-viewer.ts`, `/Users/spike/projects/contactsplus/src/ui/tools-menu.ts`

**Problem:**
Company clean tool details only show "before → after" but don't show what actually changed. All items show names instead of companies.

**Root Cause Analysis:**
- Line 399-454 in `sync-queue-viewer.ts`: `formatContactComparison()` method
- Line 437-443: Company comparison only shows if name changed, not if field exists
- Tool may be analyzing name field instead of organizations field

**Implementation Approach:**
1. Enhance `formatContactComparison()` to highlight field-level changes
2. Show field name before each change (e.g., "Company Name:", "Job Title:")
3. Add visual indicators for which fields changed
4. Verify company tool is analyzing `organizations[0].name` not `name.givenName`

**Acceptance Criteria:**
- [ ] Detail view shows exact field that changed (e.g., "Company Name:")
- [ ] Before/after values clearly labeled
- [ ] Company changes show organization field, not person name
- [ ] Multiple field changes in one contact all visible
- [ ] Color coding: red for removed, green for added, yellow for modified

**Code Changes:**
```typescript
// sync-queue-viewer.ts line 399
private formatContactComparison(before: Contact['contactData'], after: Contact['contactData']): string[] {
  const lines: string[] = [];

  // Show which specific fields changed
  const changes = this.detectChanges(before, after);

  for (const change of changes) {
    lines.push(`{yellow-fg}${change.fieldLabel}:{/yellow-fg}`);
    lines.push(`  {red-fg}Before: ${change.oldValue}{/red-fg}`);
    lines.push(`  {green-fg}After:  ${change.newValue}{/green-fg}`);
    lines.push('');
  }

  return lines;
}

private detectChanges(before: Contact['contactData'], after: Contact['contactData']): FieldChange[] {
  // Deep comparison to find exact fields that changed
  const changes: FieldChange[] = [];

  // Check organizations
  if (JSON.stringify(before.organizations) !== JSON.stringify(after.organizations)) {
    // Identify specific organization fields that changed
  }

  return changes;
}
```

---

### Task 3.2: Fix Company Tool Processing Wrong Data
**Priority:** Medium
**Estimated Time:** 1 hour
**Files:** `/Users/spike/projects/contactsplus/src/tools/company-name-cleaning-tool.ts`

**Problem:**
All items in company clean tool are names, not companies. Tool is processing wrong data.

**Root Cause Analysis:**
- Line 12-49 in `company-name-cleaning-tool.ts`: `analyze()` method correctly targets `organizations[i].name`
- Issue may be in tool invocation or result display
- Line 973-1027 in `tools-menu.ts`: `runCompanyNameCleaningTool()` may be applying suggestions to wrong field

**Implementation Approach:**
1. Add logging to confirm tool is analyzing organization names
2. Verify field path in suggestion: `organizations[0].name` not `name.givenName`
3. Add filter to skip contacts without organizations
4. Add validation that only processes contacts with company data

**Acceptance Criteria:**
- [ ] Tool only processes contacts with organizations array
- [ ] Suggestions target `organizations[X].name` field
- [ ] Preview shows company name, not person name
- [ ] Tool skips contacts that don't have company info
- [ ] Count in UI matches actual company name changes

**Code Changes:**
```typescript
// company-name-cleaning-tool.ts line 12
async analyze(contact: Contact): Promise<ToolSuggestion[]> {
  const suggestions: ToolSuggestion[] = [];

  // Skip if no organizations
  if (!contact.contactData?.organizations || contact.contactData.organizations.length === 0) {
    return suggestions;
  }

  // Add logging to confirm we're processing companies
  logger.debug(`Analyzing company names for contact ${contact.contactId}: ${contact.contactData.organizations.map(o => o.name).join(', ')}`);

  // ... rest of method
}
```

---

### Task 3.3: Fix Statistics Accuracy Issues
**Priority:** Medium
**Estimated Time:** 3-4 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/stats-viewer.ts`, `/Users/spike/projects/contactsplus/src/db/statistics-tracker.ts`

**Problem:**
Statistics show incorrect data:
- Stats show 0% of contacts have photos (likely incorrect)
- Total API calls shows only 2 (should be over 100)
- Contacts viewed shows 1 (incorrect)

**Root Cause Analysis:**
- Statistics may not be persisting to database correctly
- Counters may be reset between app sessions
- Photo count calculation may have logic error
- API call tracking may not be capturing all calls
- View count may only track manual views, not automatic ones

**Implementation Approach:**
1. Audit statistics calculation in `stats-viewer.ts`
2. Review photo count query - verify it checks `photos` array properly
3. Ensure API call counter increments on every Google API call
4. Review view tracking - should count any contact detail display
5. Add statistics persistence to SQLite database
6. Add statistics aggregation across sessions
7. Fix any queries that return incorrect counts

**Acceptance Criteria:**
- [ ] Photo percentage reflects actual contacts with photos
- [ ] API call count increments for every Google People API call
- [ ] Contact view count tracks all detail displays (arrows, clicks, etc.)
- [ ] Statistics persist across app restarts
- [ ] All percentages calculated correctly
- [ ] Statistics match actual data in database

**Code Changes:**
```typescript
// stats-viewer.ts
private async calculateStatistics(): Promise<Statistics> {
  const db = getDatabase();

  // Fix photo count query
  const photoCount = await db.get<number>(
    `SELECT COUNT(*) as count FROM contacts
     WHERE json_extract(contactData, '$.photos') IS NOT NULL
     AND json_array_length(json_extract(contactData, '$.photos')) > 0`
  );

  // Get API call count from persistent tracker
  const apiCalls = await this.statsTracker.getTotalApiCalls();

  // Get view count from persistent tracker
  const viewCount = await this.statsTracker.getTotalContactViews();

  return {
    totalContacts: totalCount,
    withPhotos: photoCount,
    photoPercentage: (photoCount / totalCount) * 100,
    apiCalls: apiCalls,
    contactsViewed: viewCount,
  };
}

// Track API calls properly
export async function trackApiCall(endpoint: string): Promise<void> {
  const db = getDatabase();
  await db.run(
    'INSERT INTO api_calls (endpoint, timestamp) VALUES (?, ?)',
    endpoint,
    Date.now()
  );
}

// Track contact views properly
export async function trackContactView(contactId: string): Promise<void> {
  const db = getDatabase();
  await db.run(
    'INSERT INTO contact_views (contactId, timestamp) VALUES (?, ?)',
    contactId,
    Date.now()
  );
}
```

---

### Task 3.4: Add Tool Activity Statistics Page
**Priority:** Medium
**Estimated Time:** 4-5 hours
**Files:** Create `/Users/spike/projects/contactsplus/src/ui/tool-activity-viewer.ts`, `/Users/spike/projects/contactsplus/src/db/tool-activity-tracker.ts`

**Problem:**
Need a new statistics page showing changes made by each tool (this session and total over all runs). This helps users understand tool impact and track modifications.

**Root Cause Analysis:**
- No tracking of which tool made which changes
- No historical record of tool usage and effectiveness
- Users can't see impact of tools over time
- No session-based vs. lifetime statistics

**Implementation Approach:**
1. Create database schema for tool activity tracking
2. Track every change queued by each tool (tool name, timestamp, action type)
3. Create new UI page showing tool activity statistics
4. Show both current session and lifetime totals
5. Display: tool name, suggestions generated, changes applied, success rate
6. Add breakdown by tool and by session
7. Link from Stats menu

**Acceptance Criteria:**
- [ ] Database tracks every tool execution and result
- [ ] New page shows tool activity statistics
- [ ] Current session stats shown separately from lifetime stats
- [ ] Each tool shows: suggestions made, applied, rejected, success rate
- [ ] Page accessible from Stats menu
- [ ] Statistics persist across app restarts
- [ ] ESC/q returns to previous screen

**Implementation Pattern:**
```typescript
// tool-activity-tracker.ts (new file)
export interface ToolActivity {
  toolName: string;
  sessionId: string;
  timestamp: number;
  suggestionsGenerated: number;
  suggestionsApplied: number;
  suggestionsRejected: number;
}

export class ToolActivityTracker {
  async recordToolExecution(
    toolName: string,
    sessionId: string,
    suggestions: number
  ): Promise<void> {
    await db.run(
      `INSERT INTO tool_activity
       (toolName, sessionId, timestamp, suggestionsGenerated)
       VALUES (?, ?, ?, ?)`,
      toolName, sessionId, Date.now(), suggestions
    );
  }

  async getSessionStats(sessionId: string): Promise<ToolActivity[]> {
    // Get stats for current session
  }

  async getLifetimeStats(): Promise<ToolActivity[]> {
    // Get stats across all sessions
  }
}

// tool-activity-viewer.ts (new file)
export class ToolActivityViewer {
  show(): void {
    // Display tool activity statistics
    // - Current session section
    // - Lifetime totals section
    // - Per-tool breakdown
    // - Success rates
  }
}
```

---

### Task 3.5: Fix Menu Organization and Remove Broken Items
**Priority:** Medium
**Estimated Time:** 2 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/tools-menu.ts`, `/Users/spike/projects/contactsplus/src/ui/stats-viewer.ts`, `/Users/spike/projects/contactsplus/src/ui/settings-page.ts`

**Problem:**
Menu organization issues:
- Database Statistics should be under Stats page, not Tools page
- Sync Settings should be in Settings page, not Tools page
- "Find Missing Info" in tools list doesn't work - just remove it

**Root Cause Analysis:**
- Items placed in wrong menus during initial development
- "Find Missing Info" was planned but not implemented
- Need logical reorganization based on item purpose
- Tools menu should only contain active tools

**Implementation Approach:**
1. Move "Database Statistics" from Tools menu to Stats menu
2. Move "Sync Settings" from Tools menu to Settings page
3. Remove "Find Missing Info" from Tools menu entirely
4. Update menu item numbers/ordering after removals
5. Test all menu navigation after reorganization

**Acceptance Criteria:**
- [ ] Database Statistics appears in Stats menu
- [ ] Database Statistics removed from Tools menu
- [ ] Sync Settings appears in Settings page
- [ ] Sync Settings removed from Tools menu
- [ ] "Find Missing Info" completely removed
- [ ] All menu numbers updated correctly
- [ ] No broken menu items
- [ ] All working tools still accessible

**Code Changes:**
```typescript
// tools-menu.ts - remove items
private getMenuItems(): string[] {
  return [
    '1. AI Smart Deduplication',
    '2. Phone Number Normalization',
    '3. Company Name Cleaning',
    '4. Duplicate Name Fixer',
    // REMOVED: Database Statistics (moved to Stats)
    // REMOVED: Sync Settings (moved to Settings)
    // REMOVED: Find Missing Info (not implemented)
    '5. Back to Main Menu',
  ];
}

// stats-viewer.ts - add Database Statistics
private getMenuItems(): string[] {
  return [
    '1. Contact Statistics',
    '2. Tool Activity Statistics',  // New from Task 3.4
    '3. Database Statistics',       // Moved from Tools
    '4. Back to Main Menu',
  ];
}

// settings-page.ts - add Sync Settings
private getMenuItems(): string[] {
  return [
    '1. Auto-load Contact Details',
    '2. Sync Settings',             // Moved from Tools
    '3. Display Preferences',
    '4. Back to Main Menu',
  ];
}
```

---

## Priority 4: Architectural Improvements

### Task 4.1: Implement Consistent Queue-First Architecture
**Priority:** Medium
**Estimated Time:** 3-4 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/tools-menu.ts`, all tool files

**Problem:**
Not all tools queue changes for review. Some apply directly, some use suggestion viewer, inconsistent patterns.

**Root Cause Analysis:**
- `runPhoneNormalizationTool()` (line 856): Uses suggestion viewer (one-by-one approval)
- `runCompanyNameCleaningTool()` (line 937): Queues to sync queue (batch approval)
- `runDuplicateNameFixer()` (line 504): Uses confirmation dialog (one-by-one approval)
- Need single pattern: all tools → sync queue → review → approve → sync

**Implementation Approach:**
1. Create `ToolExecutor` utility class that standardizes tool execution
2. All tools run analysis → queue results → show completion message
3. Remove suggestion viewer from tool flow (only use for manual operations)
4. Update all tool methods to follow: analyze → queue → notify user

**Acceptance Criteria:**
- [ ] All ML tools queue suggestions to sync queue
- [ ] No tools apply changes directly without queue
- [ ] User reviews all changes in Sync Queue Manager
- [ ] Consistent UX: Tool runs → "Go to Sync Queue to review"
- [ ] Suggestion viewer only used for manual edits, not tool output

**Implementation Pattern:**
```typescript
// tool-executor.ts (new file)
export class ToolExecutor {
  static async runTool<T extends BaseTool>(
    tool: T,
    contacts: Contact[],
    sessionId: string
  ): Promise<ToolExecutionResult> {
    // 1. Run analysis
    const results = await tool.batchAnalyze(contacts);

    // 2. Queue all suggestions
    const queuedCount = await this.queueSuggestions(results, sessionId);

    // 3. Return summary
    return {
      analyzed: results.processedContacts,
      suggestions: results.totalSuggestions,
      queued: queuedCount,
    };
  }
}
```

---

### Task 4.2: Add Memory Leak Prevention
**Priority:** Medium
**Estimated Time:** 2 hours
**Files:** Multiple files with log appending

**Problem:**
Unbounded log growth can cause memory leaks (debug agent finding).

**Root Cause Analysis:**
- Line 905 in `sync-queue-viewer.ts`: `appendSyncLog()` limits to 1000 lines (good)
- Line 634 in `tools-menu.ts`: `appendToLog()` limits to 1000 lines (good)
- Need to verify all log buffers have limits

**Implementation Approach:**
1. Audit all log append functions
2. Ensure all have MAX_LOG_LINES limits
3. Add circular buffer utility for log storage
4. Implement log rotation when files get too large

**Acceptance Criteria:**
- [ ] All in-memory log buffers limited to 1000 lines
- [ ] Circular buffer used for log storage
- [ ] Old logs automatically rotated out
- [ ] Memory usage stable during long-running operations
- [ ] No unbounded array growth

---

### Task 4.3: Add Race Condition Protection
**Priority:** Medium
**Estimated Time:** 2-3 hours
**Files:** `/Users/spike/projects/contactsplus/src/ui/sync-queue-viewer.ts`, `/Users/spike/projects/contactsplus/src/db/sync-engine.ts`

**Problem:**
Potential race conditions during sync operations (debug agent finding).

**Root Cause Analysis:**
- Line 757 in `sync-queue-viewer.ts`: `syncApprovedItems()` is async but no concurrency control
- Multiple sync operations could run simultaneously
- No mutex or lock to prevent concurrent syncing

**Implementation Approach:**
1. Add `syncInProgress` flag to prevent concurrent syncs
2. Disable sync button while sync is running
3. Queue sync requests if sync already in progress
4. Add mutex lock around critical sync operations

**Acceptance Criteria:**
- [ ] Only one sync operation runs at a time
- [ ] Sync button disabled during sync
- [ ] User notified if sync already in progress
- [ ] No race conditions in queue status updates
- [ ] State remains consistent during concurrent actions

**Code Changes:**
```typescript
// sync-queue-viewer.ts
private syncInProgress: boolean = false;

private async syncApprovedItems(): Promise<void> {
  if (this.syncInProgress) {
    this.showSyncMessage('Sync already in progress', 'warning');
    return;
  }

  this.syncInProgress = true;

  try {
    // ... sync logic
  } finally {
    this.syncInProgress = false;
  }
}
```

---

## Testing Checklist

### Display and Rendering Testing
- [ ] Verify all contacts display with readable text (no garbled characters)
- [ ] Test contacts with special characters in names
- [ ] Test contacts with emojis in names
- [ ] Test contacts with missing name fields (verify fallback display)
- [ ] Verify first contact in list displays correctly
- [ ] Test field display in suggestion viewer (no corruption)

### Search Functionality Testing
- [ ] Press '/' to open search box
- [ ] Verify search box accepts text input immediately
- [ ] Type search query and press Enter
- [ ] Verify search results display correctly
- [ ] Press ESC to close search box
- [ ] Verify focus returns to main list after closing search

### Navigation Testing
- [ ] Test arrow keys in contact list
- [ ] Test arrow keys in sync queue list
- [ ] Test arrow keys in settings page
- [ ] Test page up/down in all lists
- [ ] Test home/end keys in all lists
- [ ] Verify details auto-update on navigation
- [ ] Test mouse click navigation
- [ ] Test keyboard + mouse mixed navigation
- [ ] Test scrolling in settings page (can reach bottom)

### Keyboard Shortcut Testing
- [ ] Press 'q' from main screen (should quit with confirmation)
- [ ] Press ESC from main screen (should close panels, not quit)
- [ ] Press ESC from stats page (should go back)
- [ ] Press 'q' from stats page (should go back)
- [ ] Press ESC from settings page (should go back)
- [ ] Press 'q' from settings page (should go back)
- [ ] Press ESC from sync queue (should go back)
- [ ] Verify consistent behavior across all sub-pages

### Tool Testing
- [ ] Run AI Smart Deduplication (verify it finds duplicates)
- [ ] Run phone normalization with 1000+ contacts
- [ ] Run company cleaning with 500+ contacts
- [ ] Verify all results go to sync queue
- [ ] Test sync queue with 100+ items
- [ ] Test sync with some failed items
- [ ] Verify tools don't freeze
- [ ] Verify correct field data shown (companies, not names)
- [ ] Verify tool activity is tracked in statistics

### Sync Queue Testing
- [ ] Test with 0 items
- [ ] Test with 1 item
- [ ] Test with 100 items
- [ ] Test with 100 failed items
- [ ] Test sync cancellation
- [ ] Test approve/reject operations
- [ ] Test multi-select operations
- [ ] Verify filter functionality
- [ ] Test suggestion viewer navigation (ESC to exit)
- [ ] Verify details update when navigating with arrows

### Statistics Testing
- [ ] Verify photo count shows correct percentage
- [ ] Verify API call count increments properly
- [ ] Verify contact view count tracks all views
- [ ] Check statistics persist across app restarts
- [ ] Test tool activity statistics page
- [ ] Verify session stats vs. lifetime stats
- [ ] Verify all statistics calculations are accurate

### Menu Organization Testing
- [ ] Verify Database Statistics in Stats menu (not Tools)
- [ ] Verify Sync Settings in Settings page (not Tools)
- [ ] Verify "Find Missing Info" is removed completely
- [ ] Verify all menu numbers are correct
- [ ] Verify all menu items are accessible
- [ ] Verify no broken menu items exist
- [ ] Test navigation through all menus

### Memory and Performance Testing
- [ ] Run app for 1 hour continuous use
- [ ] Monitor memory usage
- [ ] Run all tools sequentially
- [ ] Check for memory leaks
- [ ] Verify log rotation works
- [ ] Test with large datasets (10k+ contacts)
- [ ] Verify no race conditions in sync operations

---

## Implementation Order Recommendation

### Phase 1: Critical Blocking Issues (Priority 1)
Fix severe bugs that prevent core functionality. These should be addressed first.

1. **Task 1.5: Fix Contact List Display Corruption** (2 hours)
   - First contact shows garbled text - critical UX issue
   - Blocking users from seeing contact data properly

2. **Task 1.6: Fix Search Box Input Issue** (2-3 hours)
   - Search feature completely broken
   - High-impact feature that's non-functional

3. **Task 1.7: Fix AI Smart Deduplication Tool** (3-4 hours)
   - Important tool not working at all
   - Users report obvious duplicates but tool finds none

4. **Task 1.1: Fix Sync Queue Freeze** (2-3 hours)
   - Application freezes with 100 failed items
   - Blocks sync functionality

5. **Task 1.2: Fix Phone Number Analyzer Queue** (1-2 hours)
   - Tool freezes instead of queuing items
   - Prevents phone normalization workflow

6. **Task 1.3: Fix Phone Tool Field Display** (1 hour)
   - Field display corruption in suggestion viewer
   - Affects user's ability to review changes

7. **Task 1.4: Fix Suggestion Viewer Navigation** (1-2 hours)
   - Users get stuck and cannot escape
   - Blocking issue for tool workflows

### Phase 2: Navigation and UX Consistency (Priority 2)
Improve user experience and create consistent patterns across the app.

1. **Task 2.4: Fix Keyboard Shortcut Inconsistency** (2-3 hours)
   - Confusing and inconsistent shortcuts across pages
   - Do this early to establish standard for all pages

2. **Task 2.5: Fix Settings Page Scroll and Navigation** (2 hours)
   - Can't access all settings options
   - ESC key doesn't work - inconsistent with other pages

3. **Task 2.1: Create Base List Navigation Template** (3-4 hours)
   - Foundation for consistent navigation
   - Will make Tasks 2.2 and 2.3 easier

4. **Task 2.2: Refactor Sync Queue Viewer** (2 hours)
   - Apply base template to sync queue
   - Fix detail auto-update on navigation

5. **Task 2.3: Restore Contact List Auto-Load** (1 hour)
   - Details should load automatically when scrolling
   - Apply lessons from base template

### Phase 3: Data Quality and Menu Organization (Priority 3)
Fix data accuracy issues and improve menu organization.

1. **Task 3.5: Fix Menu Organization** (2 hours)
   - Quick win to improve navigation
   - Remove broken items, reorganize menus logically

2. **Task 3.1: Fix Company Tool Field Display** (2 hours)
   - Details don't show what changed
   - Affects user's ability to review changes

3. **Task 3.2: Fix Company Tool Wrong Data** (1 hour)
   - Tool processing names instead of companies
   - Data quality issue

4. **Task 3.3: Fix Statistics Accuracy** (3-4 hours)
   - Stats show incorrect data
   - Undermines user trust in the app

5. **Task 3.4: Add Tool Activity Statistics** (4-5 hours)
   - New feature to track tool impact
   - Enhancement rather than bug fix

### Phase 4: Architecture and Long-term Stability (Priority 4)
Improve code architecture and prevent future issues.

1. **Task 4.1: Implement Queue-First Architecture** (3-4 hours)
   - Standardize tool execution pattern
   - Prevents future inconsistencies

2. **Task 4.2: Add Memory Leak Prevention** (2 hours)
   - Prevent unbounded growth
   - Important for long-running sessions

3. **Task 4.3: Add Race Condition Protection** (2-3 hours)
   - Prevent concurrent sync issues
   - Improves reliability

## Estimated Total Time
- **Phase 1 (Critical)**: 13-18 hours
- **Phase 2 (Navigation/UX)**: 10-13 hours
- **Phase 3 (Data Quality)**: 12-16 hours
- **Phase 4 (Architecture)**: 7-9 hours
- **Total**: 42-56 hours (approximately 1-1.5 weeks of full-time work)

---

## Notes

### Recent Updates
This task plan was updated on 2025-11-14 to include 9 additional issues discovered during end-to-end testing:

**Critical Issues Added (Priority 1):**
- Task 1.5: Contact list display corruption (garbled text)
- Task 1.6: Search box broken (cannot enter text)
- Task 1.7: AI Smart Deduplication not working

**UX/Navigation Issues Added (Priority 2):**
- Task 2.4: Keyboard shortcut inconsistency ('q' vs ESC)
- Task 2.5: Settings page scroll and navigation issues

**Data Quality/Menu Issues Added (Priority 3):**
- Task 3.3: Statistics accuracy issues (photo %, API calls, view count)
- Task 3.4: New tool activity statistics page (enhancement)
- Task 3.5: Menu organization and broken item removal

### General Notes
- All file paths are absolute and verified in the codebase
- Each task is designed to be completed independently where possible
- Tasks include both problem diagnosis and solution implementation
- Testing checklist ensures quality before considering task complete
- Use git branches for each task to enable parallel work and easy rollback
- Priority 1 tasks should be addressed before Priority 2-4 tasks
- The estimated total time is 42-56 hours across all priorities
