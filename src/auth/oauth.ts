import * as http from 'http';
import { URL } from 'url';
import axios from 'axios';
import open from 'open';
import * as crypto from 'crypto';
import { getConfig, getOAuthPort } from '../utils/config';
import { TokenStorage } from './token-storage';
import { OAuthTokens } from '../types/contactsplus';
import { logger } from '../utils/logger';
import {
  DEFAULT_OAUTH_TIMEOUT,
  OAUTH_CLEANUP_DELAY,
  OAUTH_STATE_BYTES,
  OAUTH_CODE_VERIFIER_BYTES,
  HTTP_STATUS_OK,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_SERVER_ERROR,
  MILLISECONDS_PER_SECOND,
} from '../utils/constants';

export class OAuthManager {
  private config = getConfig();
  private tokenStorage = new TokenStorage();
  private server?: http.Server;
  private expectedState: string | null = null;
  private refreshPromise: Promise<OAuthTokens> | null = null;
  private codeVerifier?: string;
  private oauthTimeout?: NodeJS.Timeout;
  private serverClosing: boolean = false;

  /**
   * Generate a cryptographically random code verifier for PKCE
   * @returns Base64-URL encoded random string
   */
  private generateCodeVerifier(): string {
    const randomBytes = crypto.randomBytes(OAUTH_CODE_VERIFIER_BYTES);
    return randomBytes.toString('base64url');
  }

  /**
   * Generate code challenge from verifier using SHA-256
   * @param verifier - The code verifier string
   * @returns Base64-URL encoded SHA-256 hash
   */
  private generateCodeChallenge(verifier: string): string {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return hash.toString('base64url');
  }

  async authenticate(): Promise<OAuthTokens> {
    // Check if we have valid tokens
    if (await this.tokenStorage.isTokenValid()) {
      const tokens = await this.tokenStorage.getTokens();
      if (tokens) {
        logger.debug('Using existing valid tokens');
        return tokens;
      }
    }

    // Check if we need to refresh tokens
    if (await this.tokenStorage.needsRefresh()) {
      // If refresh already in progress, wait for it (prevents race condition)
      if (this.refreshPromise) {
        logger.debug('Token refresh already in progress, waiting');
        return this.refreshPromise;
      }

      const tokens = await this.tokenStorage.getTokens();
      if (tokens) {
        try {
          logger.info('Starting token refresh');
          // Create refresh promise to prevent concurrent refreshes
          this.refreshPromise = this.refreshToken(tokens.refresh_token)
            .then(async (refreshedTokens) => {
              await this.tokenStorage.storeTokens(refreshedTokens);
              logger.info('Token refresh completed successfully');
              return refreshedTokens;
            })
            .finally(() => {
              this.refreshPromise = null;
            });

          return await this.refreshPromise;
        } catch (error) {
          this.refreshPromise = null;
          logger.warn('Token refresh failed, starting new auth flow', { error });
        }
      }
    }

    // Start fresh OAuth flow
    logger.info('Starting fresh OAuth authentication flow');
    return this.startOAuthFlow();
  }

  private async startOAuthFlow(): Promise<OAuthTokens> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const safeResolve = (value: OAuthTokens) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      const safeReject = (error: Error) => {
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      };

      const port = getOAuthPort();

      try {
        this.cleanup();  // Clean up any existing server FIRST
      } catch (cleanupError) {
        logger.warn('Error during initial cleanup', { error: cleanupError });
        // Continue anyway - we'll create a new server
      }

      // Create authorization URL
      const authUrl = this.buildAuthUrl();

      // OAuth flow timeout configurable via OAUTH_TIMEOUT env var (default: 5 minutes)
      // Add timeout to prevent hanging forever
      const oauthTimeout = parseInt(process.env.OAUTH_TIMEOUT || String(DEFAULT_OAUTH_TIMEOUT), 10); // Default 5 minutes
      this.oauthTimeout = setTimeout(() => {
        logger.error('OAuth flow timed out', { timeoutSeconds: oauthTimeout / MILLISECONDS_PER_SECOND });
        this.cleanup();
        safeReject(new Error('OAuth flow timed out'));
      }, oauthTimeout);

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
              logger.error('OAuth state validation failed', { hasReturnedState: !!returnedState, statesMatch: returnedState === this.expectedState });
              res.writeHead(HTTP_STATUS_BAD_REQUEST, { 'Content-Type': 'text/html' });
              res.end('<h1>Invalid state parameter - possible CSRF attack</h1>');
              if (this.oauthTimeout) clearTimeout(this.oauthTimeout);
              this.cleanup();
              this.expectedState = null;
              safeReject(new Error('State validation failed'));
              return;
            }
            this.expectedState = null; // Clear after use

            if (error) {
              logger.error('OAuth authorization error received', { error });
              res.writeHead(HTTP_STATUS_BAD_REQUEST, { 'Content-Type': 'text/html' });
              res.end(`<h1>Authorization Error</h1><p>${error}</p>`);
              if (this.oauthTimeout) clearTimeout(this.oauthTimeout);
              this.cleanup();
              safeReject(new Error(`OAuth error: ${error}`));
              return;
            }

            if (!code) {
              logger.error('OAuth callback missing authorization code');
              res.writeHead(HTTP_STATUS_BAD_REQUEST, { 'Content-Type': 'text/html' });
              res.end('<h1>Missing Authorization Code</h1>');
              if (this.oauthTimeout) clearTimeout(this.oauthTimeout);
              this.cleanup();
              safeReject(new Error('Missing authorization code'));
              return;
            }

            try {
              logger.info('Exchanging authorization code for tokens');
              // Exchange code for tokens
              const tokens = await this.exchangeCodeForTokens(code);

              // Store tokens
              await this.tokenStorage.storeTokens(tokens);
              logger.info('OAuth authentication completed successfully');

              // Send success response
              res.writeHead(HTTP_STATUS_OK, { 'Content-Type': 'text/html' });
              res.end(`
                <h1>Authentication Successful!</h1>
                <p>You can now close this window and return to the CLI.</p>
                <script>window.close();</script>
              `);

              if (this.oauthTimeout) clearTimeout(this.oauthTimeout);
              // Give response time to be sent before closing
              setTimeout(() => this.cleanup(), OAUTH_CLEANUP_DELAY);
              safeResolve(tokens);
            } catch (error) {
              logger.error('Failed to exchange authorization code', { error });
              res.writeHead(HTTP_STATUS_SERVER_ERROR, { 'Content-Type': 'text/html' });
              res.end(`<h1>Authentication Error</h1><p>${error}</p>`);
              if (this.oauthTimeout) clearTimeout(this.oauthTimeout);
              this.cleanup();
              safeReject(error as Error);
            }
          } else {
            res.writeHead(HTTP_STATUS_NOT_FOUND, { 'Content-Type': 'text/html' });
            res.end('<h1>Not Found</h1>');
          }
        } catch (error) {
          logger.error('OAuth server request handling error', { error });
          if (this.oauthTimeout) clearTimeout(this.oauthTimeout);
          this.cleanup();
          safeReject(error as Error);
        }
      });

      this.server.on('error', (error) => {
        logger.error('OAuth server error', { error, port });
        if (this.oauthTimeout) clearTimeout(this.oauthTimeout);
        this.cleanup();
        safeReject(error);
      });

      this.server.listen(port, () => {
        logger.info('OAuth server started', { port, url: `http://localhost:${port}` });
        logger.info('Opening browser for authentication');
        open(authUrl);
      });
    });
  }

  private buildAuthUrl(): string {
    // Generate cryptographically secure random state
    const state = crypto.randomBytes(OAUTH_STATE_BYTES).toString('hex');
    this.expectedState = state;

    // Generate PKCE code verifier and challenge
    this.codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(this.codeVerifier);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes,
      response_type: 'code',
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    return `${this.config.authBase}/oauth/authorize?${params.toString()}`;
  }

  private async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    // Capture and clear verifier immediately to prevent reuse
    const verifier = this.codeVerifier;
    this.codeVerifier = undefined;

    if (!verifier) {
      throw new Error('Code verifier missing - invalid OAuth state');
    }

    try {
      const response = await axios.post(
        `${this.config.apiBase}/v3/oauth.exchangeAuthCode`,
        new URLSearchParams({
          client_id: this.config.clientId,
          redirect_uri: this.config.redirectUri,
          code: code,
          code_verifier: verifier  // Use captured verifier
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      // Convert relative expiration times (seconds) to absolute timestamps (milliseconds)
      const data = response.data;
      const now = Date.now();

      const tokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        access_token_expiration: now + (data.access_token_expiration * 1000),
        access_token_expiration_date: data.access_token_expiration_date,
        refresh_token_expiration: now + (data.refresh_token_expiration * 1000),
        refresh_token_expiration_date: data.refresh_token_expiration_date,
        scope: data.scope,
      };
      logger.info('Successfully exchanged authorization code for tokens');
      return tokens;
    } catch (error) {
      logger.error('Failed to exchange code for tokens', { error });
      throw new Error('Failed to exchange authorization code for tokens');
    }
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    try {
      logger.debug('Refreshing access token');
      // Note: Most OAuth servers don't require client_secret for refresh token grants with PKCE
      const params: Record<string, string> = {
        client_id: this.config.clientId,
        refresh_token: refreshToken
      };

      // Only include client_secret if provided (for backward compatibility)
      if (this.config.clientSecret) {
        params.client_secret = this.config.clientSecret;
      }

      const response = await axios.post(
        `${this.config.apiBase}/v3/oauth.refreshToken`,
        new URLSearchParams(params),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      // The refresh endpoint only returns access_token and expiration
      // Convert relative expiration time (seconds) to absolute timestamp (milliseconds)
      const data = response.data;
      const existingTokens = await this.tokenStorage.getTokens();
      const now = Date.now();

      const tokens = {
        access_token: data.access_token,
        refresh_token: refreshToken, // Keep the same refresh token
        access_token_expiration: now + (data.access_token_expiration * 1000),
        access_token_expiration_date: data.access_token_expiration_date,
        refresh_token_expiration: existingTokens?.refresh_token_expiration || 0,
        refresh_token_expiration_date: existingTokens?.refresh_token_expiration_date || '',
        scope: existingTokens?.scope || this.config.scopes,
      };
      logger.info('Access token refreshed successfully');
      return tokens;
    } catch (error) {
      logger.error('Failed to refresh token', { error });
      throw new Error('Failed to refresh access token');
    }
  }

  cleanup(): void {
    try {
      // Clear timeout
      if (this.oauthTimeout) {
        clearTimeout(this.oauthTimeout);
        this.oauthTimeout = undefined;
      }

      // Clear sensitive OAuth state
      this.codeVerifier = undefined;
      this.expectedState = null;

      if (this.server && !this.serverClosing) {
        this.serverClosing = true;
        this.server.removeAllListeners();
        this.server.close((err) => {
          if (err) {
            logger.error('Error closing OAuth server', { error: err });
          } else {
            logger.debug('OAuth server closed successfully');
          }
          this.server = undefined;
          this.serverClosing = false;
        });
      }
    } catch (error) {
      logger.error('Exception during OAuth cleanup', { error });
      // Don't rethrow - cleanup should never fail
    }
  }

  async logout(): Promise<void> {
    try {
      logger.info('Logging out and clearing tokens');
      await this.tokenStorage.clearTokens();
      logger.info('Logout completed successfully');
    } catch (error) {
      logger.error('Failed to clear tokens during logout', { error });
      throw error;
    }
  }
}