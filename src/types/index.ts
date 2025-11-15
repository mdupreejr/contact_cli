/**
 * Types Module Exports
 * Central export point for all type definitions
 */

// Core contact types
export type {
  Contact,
  ContactData,
  ContactName,
  ContactEmail,
  ContactPhoneNumber,
  ContactAddress,
  ContactOrganization,
  ContactMetadata,
  AccountInfo,
  OAuthTokens,
  ContactsPlusConfig,
} from './contactsplus';

// Settings types
export type {
  AppSettings,
  DataSourceSettings,
  ApiSettings,
  UiSettings,
  CacheSettings,
  DebugSettings,
  SettingsValidationError,
  SettingsValidationResult,
} from './settings';

// Tool types
export type {
  IProgressTracker,
  ToolSuggestion,
  SuggestionRationale,
  ToolResult,
  BatchToolResult,
  ChangeLogEntry,
  ToolMetrics,
  ToolConfig,
} from './tools';

export { BaseTool } from './tools';
