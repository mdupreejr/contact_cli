import * as http from 'http';
import { URL } from 'url';
import axios from 'axios';
import open from 'open';
import * as crypto from 'crypto';
import { getConfig, getOAuthPort } from '../utils/config';
import { TokenStorage } from './token-storage';
import { OAuthTokens } from '../types/contactsplus';
import { logger } from '../utils/logger';

export class OAuthManager {
  private config = getConfig();
  private tokenStorage = new TokenStorage();
  private server?: http.Server;
  private expectedState: string | null = null;
  private refreshPromise: Promise<OAuthTokens> | null = null;

  async authenticate(): Promise<OAuthTokens> {
    // Check if we have valid tokens
    if (await this.tokenStorage.isTokenValid()) {
      const tokens = await this.tokenStorage.getTokens();
      if (tokens) {
        logger.info('Using existing valid tokens');
        return tokens;
      }
    }

    // Check if we need to refresh tokens
    if (await this.tokenStorage.needsRefresh()) {
      // If refresh already in progress, wait for it (prevents race condition)
      if (this.refreshPromise) {
        logger.debug('Token refresh already in progress, waiting...');
        return this.refreshPromise;
      }

      const tokens = await this.tokenStorage.getTokens();
      if (tokens) {
        try {
          // Create refresh promise to prevent concurrent refreshes
          this.refreshPromise = this.refreshToken(tokens.refresh_token)
            .then(async (refreshedTokens) => {
              await this.tokenStorage.storeTokens(refreshedTokens);
              logger.info('Tokens refreshed successfully');
              return refreshedTokens;
            })
            .finally(() => {
              this.refreshPromise = null;
            });

          return await this.refreshPromise;
        } catch (error) {
          this.refreshPromise = null;
          logger.warn('Failed to refresh tokens, starting new auth flow');
        }
      }
    }

    // Start fresh OAuth flow
    return this.startOAuthFlow();
  }

  private async startOAuthFlow(): Promise<OAuthTokens> {
    return new Promise((resolve, reject) => {
      const port = getOAuthPort();

      // Clean up any existing server first
      this.cleanup();

      // Create authorization URL
      const authUrl = this.buildAuthUrl();

      // Add timeout to prevent hanging forever
      const timeout = setTimeout(() => {
        logger.error('OAuth flow timed out after 5 minutes');
        this.cleanup();
        reject(new Error('OAuth flow timed out'));
      }, 5 * 60 * 1000);

      // Start local server to receive callback
      this.server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url!, `http://localhost:${port}`);

          if (url.pathname === '/callback') {
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            const returnedState = url.searchParams.get('state');

            // Validate state parameter (CSRF protection)
            if (!returnedState || returnedState !== this.expectedState) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<h1>Invalid state parameter - possible CSRF attack</h1>');
              clearTimeout(timeout);
              this.cleanup();
              this.expectedState = null;
              reject(new Error('State validation failed'));
              return;
            }
            this.expectedState = null; // Clear after use

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<h1>Authorization Error</h1><p>${error}</p>`);
              clearTimeout(timeout);
              this.cleanup();
              reject(new Error(`OAuth error: ${error}`));
              return;
            }

            if (!code) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<h1>Missing Authorization Code</h1>');
              clearTimeout(timeout);
              this.cleanup();
              reject(new Error('Missing authorization code'));
              return;
            }

            try {
              // Exchange code for tokens
              const tokens = await this.exchangeCodeForTokens(code);

              // Store tokens
              await this.tokenStorage.storeTokens(tokens);

              // Send success response
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <h1>Authentication Successful!</h1>
                <p>You can now close this window and return to the CLI.</p>
                <script>window.close();</script>
              `);

              clearTimeout(timeout);
              // Give response time to be sent before closing
              setTimeout(() => this.cleanup(), 500);
              resolve(tokens);
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(`<h1>Authentication Error</h1><p>${error}</p>`);
              clearTimeout(timeout);
              this.cleanup();
              reject(error);
            }
          } else {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>Not Found</h1>');
          }
        } catch (error) {
          logger.error('Server error:', error);
          clearTimeout(timeout);
          this.cleanup();
          reject(error);
        }
      });

      this.server.on('error', (error) => {
        logger.error('Server error:', error);
        clearTimeout(timeout);
        this.cleanup();
        reject(error);
      });

      this.server.listen(port, () => {
        logger.info(`OAuth server started on http://localhost:${port}`);
        logger.info('Opening browser for authentication...');
        open(authUrl);
      });
    });
  }

  private buildAuthUrl(): string {
    // Generate cryptographically secure random state
    const state = crypto.randomBytes(32).toString('hex');
    this.expectedState = state;

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes,
      response_type: 'code',
      state: state,
    });

    return `${this.config.authBase}/oauth/authorize?${params.toString()}`;
  }

  private async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    try {
      const response = await axios.post(
        `${this.config.apiBase}/v3/oauth.exchangeAuthCode`,
        new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: this.config.redirectUri,
          code: code,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data as OAuthTokens;
    } catch (error) {
      logger.error('Failed to exchange code for tokens:', error);
      throw new Error('Failed to exchange authorization code for tokens');
    }
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    try {
      const response = await axios.post(
        `${this.config.apiBase}/v3/oauth.refreshToken`,
        new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: refreshToken,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      // The refresh endpoint only returns access_token and expiration
      const data = response.data;
      const existingTokens = await this.tokenStorage.getTokens();
      
      return {
        access_token: data.access_token,
        refresh_token: refreshToken, // Keep the same refresh token
        access_token_expiration: data.access_token_expiration,
        access_token_expiration_date: data.access_token_expiration_date,
        refresh_token_expiration: existingTokens?.refresh_token_expiration || 0,
        refresh_token_expiration_date: existingTokens?.refresh_token_expiration_date || '',
        scope: existingTokens?.scope || this.config.scopes,
      };
    } catch (error) {
      logger.error('Failed to refresh token:', error);
      throw new Error('Failed to refresh access token');
    }
  }

  private cleanup(): void {
    if (this.server) {
      this.server.removeAllListeners(); // Prevent memory leaks
      this.server.close((err) => {
        if (err) {
          logger.error('Error closing OAuth server:', err);
        } else {
          logger.debug('OAuth server closed');
        }
      });
      this.server = undefined;
    }
  }

  async logout(): Promise<void> {
    await this.tokenStorage.clearTokens();
    logger.info('Logged out successfully');
  }
}