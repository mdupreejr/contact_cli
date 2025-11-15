import * as dotenv from 'dotenv';
import { ContactsPlusConfig } from '../types/contactsplus';

dotenv.config();

export function getConfig(): ContactsPlusConfig {
  const clientId = process.env.CONTACTSPLUS_CLIENT_ID;
  const clientSecret = process.env.CONTACTSPLUS_CLIENT_SECRET;
  const redirectUri = process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/callback';
  const apiBase = process.env.CONTACTSPLUS_API_BASE || 'https://api.contactsplus.com';
  const authBase = process.env.CONTACTSPLUS_AUTH_BASE || 'https://app.contactsplus.com';
  const scopes = process.env.OAUTH_SCOPES || 'contacts.read,account.read';

  if (!clientId) {
    throw new Error('Missing required environment variable: CONTACTSPLUS_CLIENT_ID');
  }

  if (clientSecret) {
    console.warn('WARNING: CONTACTSPLUS_CLIENT_SECRET is deprecated. CLI applications should use PKCE flow instead.');
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    apiBase,
    authBase,
    scopes,
  };
}

export function getOAuthPort(): number {
  return parseInt(process.env.OAUTH_PORT || '3000', 10);
}