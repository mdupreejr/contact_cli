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
- 📊 **Comprehensive statistics and analytics dashboard**
- 📝 **Real-time logging with filtering and export capabilities**
- 📈 **Data quality metrics and recommendations**
- 🛠️ **Advanced phone number normalization with libphonenumber**

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

The application uses environment variables for configuration. Follow these steps:

1. **Copy the example environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Get your ContactsPlus API credentials:**
   - Visit [ContactsPlus Developer Portal](https://developers.contactsplus.com)
   - Create a new application or use existing credentials
   - Copy your Client ID and Client Secret

3. **Update `.env` with your credentials:**
   ```env
   CONTACTSPLUS_CLIENT_ID=your_actual_client_id
   CONTACTSPLUS_CLIENT_SECRET=your_actual_client_secret
   ```

4. **Review other settings in `.env`** (defaults should work for most users)

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
- `s` - Open statistics screen
- `l` - Open logging screen
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

#### 📞 Normalize Phone Numbers
Intelligently normalizes phone numbers to international format using libphonenumber:
- **US Numbers**: Adds +1 prefix for 10-digit numbers with valid area codes
- **International**: Supports 200+ countries with automatic country detection
- **Smart Detection**: Recognizes existing country codes and formats appropriately
- **Examples**: `(212) 555-1234` → `+1 212 555 1234`, `44 20 7946 0958` → `+44 20 7946 0958`

#### 📧 Additional Tools (Coming Soon)
- Fix Email Formats  
- Clean Company Names
- Find Missing Information

### 📊 Statistics Dashboard

Press `s` to access the comprehensive statistics dashboard with four main sections:

#### 1. Contact Statistics
- Total contacts overview (company vs personal)
- Field coverage analysis with visual progress bars
- Breakdown of contacts with emails, phones, addresses, etc.

#### 2. Field Details
- **Email Analytics**: Total, unique counts, domain distribution, type breakdown
- **Phone Analytics**: Normalization status, country distribution, type analysis
- **Organization Data**: Top companies, title distribution, unique counts
- **Address Statistics**: Country and city distribution

#### 3. Data Quality Metrics
- **Quality Scores**: Completeness, duplicate detection, standardization scores
- **Missing Fields Analysis**: Identification of contacts lacking essential information
- **Data Issues Detection**: Duplicate names, invalid emails/phones, empty fields
- **Actionable Recommendations**: Specific suggestions for data cleanup

#### 4. Application Metrics
- System information and performance data
- API call statistics with success rates
- User activity tracking
- Memory usage and runtime metrics

### 📝 Logging Screen

Press `l` to access the real-time logging system:

#### Features:
- **Real-time Log Collection**: Captures all application logs as they happen
- **Log Level Filtering**: Filter by ERROR, WARN, INFO, or DEBUG levels
- **Search and Navigation**: Scroll through logs with keyboard controls
- **Auto-scroll Toggle**: Enable/disable automatic scrolling for new entries
- **Export Functionality**: Save logs to timestamped files for analysis
- **Color-coded Entries**: Visual distinction between log levels

#### Controls:
- `1-4`: Filter by log level (ERROR, WARN, INFO, DEBUG)
- `0`: Show all logs
- `a`: Toggle auto-scroll
- `c`: Clear current logs
- `e`: Export logs to file

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