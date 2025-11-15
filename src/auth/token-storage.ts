import * as keytar from 'keytar';
import { OAuthTokens } from '../types/contactsplus';
import { logger } from '../utils/logger';

const SERVICE_NAME = 'contactsplus-cli';
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const TOKEN_EXPIRY_KEY = 'token_expiry';
const ACCOUNT_NAME = 'default';

export class TokenStorage {
  async storeTokens(tokens: OAuthTokens): Promise<void> {
    try {
      await keytar.setPassword(SERVICE_NAME, ACCESS_TOKEN_KEY, tokens.access_token);
      await keytar.setPassword(SERVICE_NAME, REFRESH_TOKEN_KEY, tokens.refresh_token);
      await keytar.setPassword(SERVICE_NAME, TOKEN_EXPIRY_KEY, JSON.stringify({
        access_token_expiration: tokens.access_token_expiration,
        refresh_token_expiration: tokens.refresh_token_expiration,
        scope: tokens.scope,
      }));
      logger.info('Tokens stored successfully');
    } catch (error) {
      logger.error('Failed to store tokens:', error);
      throw error;
    }
  }

  async getTokens(): Promise<OAuthTokens | null> {
    try {
      const accessToken = await keytar.getPassword(SERVICE_NAME, ACCESS_TOKEN_KEY);
      const refreshToken = await keytar.getPassword(SERVICE_NAME, REFRESH_TOKEN_KEY);
      const expiryData = await keytar.getPassword(SERVICE_NAME, TOKEN_EXPIRY_KEY);

      if (!accessToken || !refreshToken || !expiryData) {
        return null;
      }

      // Parse and validate expiry data
      let expiry: unknown;
      try {
        expiry = JSON.parse(expiryData);
      } catch (parseError) {
        logger.error('Failed to parse token expiry data:', parseError);
        // Clear corrupted data
        await this.clearTokens();
        return null;
      }

      // Validate expiry data structure
      const expiryObj = expiry as Record<string, unknown>;
      if (!expiry ||
          typeof expiryObj.access_token_expiration !== 'number' ||
          typeof expiryObj.refresh_token_expiration !== 'number' ||
          typeof expiryObj.scope !== 'string') {
        logger.error('Invalid token expiry data structure');
        await this.clearTokens();
        return null;
      }

      // Validate expiration values are reasonable
      const now = Date.now();
      if (expiryObj.access_token_expiration < now - (365 * 24 * 60 * 60 * 1000) || // Not more than 1 year in the past
          expiryObj.access_token_expiration > now + (365 * 24 * 60 * 60 * 1000)) {  // Not more than 1 year in the future
        logger.error('Invalid token expiration timestamp');
        await this.clearTokens();
        return null;
      }

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        access_token_expiration: expiryObj.access_token_expiration,
        access_token_expiration_date: new Date(expiryObj.access_token_expiration).toISOString(),
        refresh_token_expiration: expiryObj.refresh_token_expiration as number,
        refresh_token_expiration_date: new Date(expiryObj.refresh_token_expiration as number).toISOString(),
        scope: expiryObj.scope,
      };
    } catch (error) {
      logger.error('Failed to retrieve tokens:', error);
      return null;
    }
  }

  async clearTokens(): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, ACCESS_TOKEN_KEY);
      await keytar.deletePassword(SERVICE_NAME, REFRESH_TOKEN_KEY);
      await keytar.deletePassword(SERVICE_NAME, TOKEN_EXPIRY_KEY);
      logger.info('Tokens cleared successfully');
    } catch (error) {
      logger.error('Failed to clear tokens:', error);
      throw error;
    }
  }

  /**
   * Check if access token is still valid
   * Uses a safety buffer to prevent TOCTOU race condition where token
   * expires between check and use
   */
  async isTokenValid(): Promise<boolean> {
    const tokens = await this.getTokens();
    if (!tokens) return false;

    const now = Date.now();
    const SAFETY_BUFFER = 60 * 1000; // 60 seconds buffer
    return now < (tokens.access_token_expiration - SAFETY_BUFFER);
  }

  /**
   * Check if token needs refresh
   * Uses larger window (10 min) to ensure refresh happens well before expiration
   * and account for network latency and clock skew
   */
  async needsRefresh(): Promise<boolean> {
    const tokens = await this.getTokens();
    if (!tokens) return false;

    const now = Date.now();
    const TEN_MINUTES = 10 * 60 * 1000;  // Increase from 5 to 10 minutes
    return (now + TEN_MINUTES) >= tokens.access_token_expiration;
  }
}