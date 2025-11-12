# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ContactsPlus CLI is an ncurses-based terminal application for managing ContactsPlus.com contacts. It uses OAuth 2.0 authentication, the ContactsPlus API, and provides contact browsing, editing, data cleaning tools, statistics, and logging capabilities.

## Common Commands

### Development
```bash
npm run dev          # Run in development mode with ts-node
npm run build        # Build TypeScript to JavaScript
npm run type-check   # Check TypeScript types without emitting
npm run lint         # Run ESLint on source files
```

### Running the Application
```bash
npm start            # Run the built application
contactsplus         # If installed globally
contactsplus --debug # Enable debug logging
contactsplus --logout # Clear stored authentication tokens
```

### Testing Individual Functionality
Since this is a full-screen terminal UI application:
- Test authentication: Run `npm start` and verify OAuth flow
- Test with debug logging: Use `contactsplus --debug` to see detailed logs
- Test specific features: Use keyboard shortcuts (t=tools, s=stats, l=logging)

## Architecture

### Core Application Flow
1. **Entry Point** (`src/index.ts`): ContactsPlusApp class orchestrates initialization
2. **Authentication** (`src/auth/oauth.ts`): OAuth 2.0 flow with local server on port 3000
3. **Token Storage** (`src/auth/token-storage.ts`): Secure storage using system keychain via keytar
4. **API Client** (`src/api/client.ts`): HTTP client with automatic token refresh
5. **Contacts API** (`src/api/contacts.ts`): Wrapper for ContactsPlus API endpoints
6. **UI Layer** (`src/ui/screen.ts`): Main blessed-based UI with keyboard navigation

### Tools System Architecture
The codebase implements a sophisticated, extensible tools framework:

**BaseTool Abstract Class** (`src/types/tools.ts`):
- All tools extend BaseTool with consistent interface
- Tools analyze contacts and generate suggestions without making direct changes
- Supports batch processing via `batchAnalyze()` method
- Suggestions include confidence scores, rationale, and validation metadata

**Tool Registry** (`src/utils/tool-registry.ts`):
- Centralized registry managing tool lifecycle
- Handles tool dependencies and optimal execution order
- Supports priority-based execution and dependency resolution
- Implements topological sort for dependency chains

**Key Components**:
- **SuggestionManager** (`src/utils/suggestion-manager.ts`): Manages suggestion lifecycle
- **ChangeLogger** (`src/utils/change-logger.ts`): Tracks all changes with rollback capability
- **ToolsMenu** (`src/ui/tools-menu.ts`): UI for tool selection and execution

### Existing Tools
1. **DuplicateNameFixer** (`src/tools/duplicate-name-fixer.ts`):
   - Detects duplicate words in contact names (e.g., "Ben Ben Ullright")
   - Suggests cleaned versions for user approval
   - Works directly with ContactsApi for updates

2. **PhoneNormalizationTool** (`src/tools/phone-normalization-tool.ts`):
   - Uses libphonenumber-js for international phone number normalization
   - Adds country codes (+1 for US, others for international)
   - Smart detection of existing country codes

### Statistics and Logging
- **StatsManager** (`src/utils/stats-manager.ts`): Collects comprehensive application metrics
  - Contact statistics (total, company vs personal, field coverage)
  - Field details (email analytics, phone normalization status, organization data)
  - Data quality metrics (completeness scores, duplicate detection)
  - Application performance (API call statistics, memory usage)
- **StatsScreen** (`src/ui/stats-screen.ts`): Multi-section dashboard with 4 main views
- **LoggingScreen** (`src/ui/logging-screen.ts`): Real-time log viewer with filtering and export

### UI Structure
The UI uses blessed widgets with a clean separation:
- **Header**: Account info and contact count
- **Contact List** (left 40%): Scrollable list of contacts
- **Contact Detail** (right 60%): Detailed view with all contact fields
- **Footer**: Keyboard shortcut hints
- **Modal Screens**: Tools menu, statistics, logging (overlay main UI)

### Type System
All ContactsPlus API types are defined in `src/types/contactsplus.ts`:
- Contact: Complete contact data structure with all possible fields
- ContactData: Name, emails, phones, addresses, organizations, URLs, IMs, dates, etc.
- ContactMetadata: Team info, sharing, business card transcription status
- AccountInfo: User account details

Tool-specific types in `src/types/tools.ts`:
- ToolSuggestion: Structured suggestion with confidence and rationale
- ToolResult: Per-contact analysis results
- BatchToolResult: Aggregated batch processing results
- ChangeLogEntry: Change tracking with rollback data

## Creating New Tools

To add a new contact cleaning tool:

1. **Create tool class** extending BaseTool in `src/tools/`:
```typescript
import { BaseTool, ToolSuggestion, SuggestionRationale } from '../types/tools';
import { Contact } from '../types/contactsplus';

export class MyNewTool extends BaseTool {
  readonly name = 'My New Tool';
  readonly description = 'Description of what this tool does';
  readonly category = 'normalization'; // or 'validation', 'deduplication', 'enhancement'
  readonly version = '1.0.0';

  async analyze(contact: Contact): Promise<ToolSuggestion[]> {
    const suggestions: ToolSuggestion[] = [];

    // Analyze contact and create suggestions
    // Use this.createSuggestion() helper method

    return suggestions;
  }
}
```

2. **Register the tool** in `src/ui/tools-menu.ts`:
```typescript
import { MyNewTool } from '../tools/my-new-tool';

// In constructor:
const myNewTool = new MyNewTool();
toolRegistry.registerTool(myNewTool, true, [], 10);
```

3. **Add menu option to the UI**:  
   The `ToolsMenu` class does not have a `createToolsMenu()` method.  
   To add your tool to the menu, update the hardcoded tools list in the `createToolsUI()` method of the ToolsMenu class (see line 43 of `tools-menu.ts`).

## Configuration

Environment variables are loaded from `.env` (copy from `.env.example`):
- **CONTACTSPLUS_CLIENT_ID**: OAuth client ID from ContactsPlus developer portal
- **CONTACTSPLUS_CLIENT_SECRET**: OAuth client secret
- **OAUTH_REDIRECT_URI**: Callback URL (default: http://localhost:3000/callback)
- **OAUTH_PORT**: Local server port for OAuth callback (default: 3000)
- **OAUTH_SCOPES**: API scopes (default: contacts.read,account.read,contacts.write)
- **CONTACTSPLUS_API_BASE**: API base URL (default: https://api.contactsplus.com)
- **CONTACTSPLUS_AUTH_BASE**: Auth base URL (default: https://app.contactsplus.com)

Configuration is managed by `src/utils/config.ts` which validates required variables.

## Logging

The logger (`src/utils/logger.ts`) supports two modes:
- **Console Mode**: Normal console output for CLI messages
- **UI Mode**: Routes logs to in-memory buffer for LoggingScreen display

Log levels: DEBUG, INFO, WARN, ERROR

When UI is active, all logs are captured and viewable via the logging screen (press 'l').

## Authentication Flow

1. Application checks for stored tokens in system keychain
2. If not found, starts local server on OAUTH_PORT
3. Opens browser to ContactsPlus authorization page
4. User grants permission, browser redirects to localhost callback
5. Application exchanges authorization code for access/refresh tokens
6. Tokens stored securely in system keychain via keytar
7. Subsequent runs reuse stored tokens with automatic refresh

Token management is in `src/auth/token-storage.ts` and OAuth flow in `src/auth/oauth.ts`.

## API Integration

All API calls go through ApiClient (`src/api/client.ts`):
- Automatically includes access token in Authorization header
- Handles token refresh when access token expires
- Implements retry logic for failed requests
- All endpoints use POST requests to ContactsPlus API

ContactsApi wrapper (`src/api/contacts.ts`) provides high-level methods:
- `getAccount()`: Fetch user account info
- `getAllContacts()`: Fetch all contacts with pagination (cursor-based scrolling)
- `scrollContacts()`: Paginated contact fetching
- `searchContacts()`: Search with query string
- `updateContact()`: Update contact data

## TypeScript Configuration

- Target: ES2020
- Module: CommonJS
- Strict mode enabled (with some checks disabled for flexibility)
- Path alias: `@/*` maps to `src/*`
- Output: `dist/` directory
- Source maps enabled for debugging

## Dependencies of Note

- **blessed**: Terminal UI framework (ncurses-like)
- **axios**: HTTP client for API calls
- **keytar**: Secure credential storage in system keychain
- **libphonenumber-js**: International phone number parsing and validation
- **dotenv**: Environment variable management
- **open**: Opens URLs in default browser for OAuth flow

## Code Style Notes

- Use async/await for asynchronous operations
- Logger is available globally via import from `src/utils/logger.ts`
- Contact data can be deeply nested; always check for undefined values
- UI operations should be non-blocking; show loading states for long operations
- Tools should never modify contacts directly; only generate suggestions
- All changes should go through the suggestion approval workflow
