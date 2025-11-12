# ContactsPlus CLI

A command-line interface for managing your ContactsPlus.com contacts with an intuitive ncurses-based interface.

## Features

- 🔐 Secure OAuth 2.0 authentication with ContactsPlus
- 📱 Browse all your contacts in a terminal-based interface
- 🔍 Fast search functionality
- 📋 Detailed contact view with complete information from all available fields
- 🔄 Full ContactsPlus API integration with comprehensive data loading
- 🔄 Real-time data refresh
- 💾 Secure credential storage using keytar
- 🔧 Built-in contact cleaning tools
- ✏️ Contact editing and data fixing capabilities

## Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd contactsplus
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Install globally (optional):
```bash
npm install -g .
```

## Configuration

The application uses environment variables stored in `.env` file. The required API credentials are already configured.

## Usage

### Start the application:
```bash
npm start
# or if installed globally:
contactsplus
```

### First-time setup:
1. Run the application
2. Your browser will open for authentication
3. Log in to your ContactsPlus account
4. Grant permission to the CLI application
5. Return to the terminal to use the interface

### Keyboard shortcuts:
- `↑` / `↓` - Navigate through contacts
- `Enter` - View contact details
- `/` - Search contacts
- `t` - Open tools menu
- `r` - Refresh data
- `q` / `Esc` - Quit application

### Command-line options:
```bash
contactsplus --help          # Show help
contactsplus --logout        # Clear stored tokens
contactsplus --debug         # Enable debug logging
```

### Tools Menu

Press `t` to access the tools menu, which includes:

#### 🔧 Fix Duplicate Names
Automatically detects and fixes duplicate words in contact names:
- Finds contacts like "Ben Ben Ullright" → suggests "Ben Ullright" 
- "John John Smith" → "John Smith"
- "Dr Sarah Dr Johnson" → "Dr Sarah Johnson"

The tool will:
1. Scan all contacts for duplicate words in names
2. Show you each issue found with suggested fixes
3. Let you choose whether to apply each fix
4. Update contacts directly in ContactsPlus

#### 📞 Additional Tools (Coming Soon)
- Normalize Phone Numbers
- Fix Email Formats  
- Clean Company Names
- Find Missing Information

## Development

### Available scripts:
```bash
npm run dev          # Run in development mode with ts-node
npm run build        # Build TypeScript to JavaScript
npm run type-check   # Check TypeScript types
npm run lint         # Run ESLint
```

### Project structure:
```
src/
├── index.ts              # Main application entry point
├── auth/
│   ├── oauth.ts          # OAuth 2.0 authentication flow
│   └── token-storage.ts  # Secure token storage
├── api/
│   ├── client.ts         # HTTP client with authentication
│   └── contacts.ts       # ContactsPlus API wrapper
├── ui/
│   └── screen.ts         # ncurses interface
├── types/
│   └── contactsplus.ts   # TypeScript type definitions
└── utils/
    ├── config.ts         # Configuration management
    └── logger.ts         # Logging utilities
```

## Authentication

This application uses OAuth 2.0 to authenticate with ContactsPlus. On first run:

1. A local server starts on port 3000 to receive the OAuth callback
2. Your browser opens the ContactsPlus authorization page
3. After granting permission, tokens are securely stored using keytar
4. Subsequent runs will reuse the stored tokens automatically

## API Integration

The CLI integrates with the ContactsPlus API to:
- Authenticate users via OAuth 2.0
- Fetch user account information
- Retrieve and search contacts with **all available fields**:
  - Complete contact names (prefix, given, middle, family, suffix)
  - All email addresses and phone numbers
  - Physical addresses with full details
  - Organization/company information
  - URLs and social media profiles
  - Instant messaging handles
  - Related people and relationships
  - Important dates and birthdays
  - Custom fields and additional items
  - Notes and tags
  - Business card transcription status
  - Team and sharing information
- Update and modify contact information
- Handle token refresh automatically

## Troubleshooting

### Authentication issues:
```bash
contactsplus --logout  # Clear stored tokens and re-authenticate
```

### Port conflicts:
If port 3000 is in use, set a different port in `.env`:
```env
OAUTH_PORT=3001
```

### Debug mode:
```bash
contactsplus --debug  # Enable verbose logging
```

## Security

- Credentials are stored securely using the system keychain (keytar)
- OAuth tokens are automatically refreshed when needed
- No sensitive information is stored in plain text

## License

MIT License - see LICENSE file for details