import * as http from 'http';
import { URL } from 'url';
import axios from 'axios';
import open from 'open';
import { getConfig, getOAuthPort } from '../utils/config';
import { TokenStorage } from './token-storage';
import { OAuthTokens } from '../types/contactsplus';
import { logger } from '../utils/logger';

export class OAuthManager {
  private config = getConfig();
  private tokenStorage = new TokenStorage();
  private server?: http.Server;

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
      const tokens = await this.tokenStorage.getTokens();
      if (tokens) {
        try {
          const refreshedTokens = await this.refreshToken(tokens.refresh_token);
          await this.tokenStorage.storeTokens(refreshedTokens);
          logger.info('Tokens refreshed successfully');
          return refreshedTokens;
        } catch (error) {
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
      
      // Create authorization URL
      const authUrl = this.buildAuthUrl();
      
      // Start local server to receive callback
      this.server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url!, `http://localhost:${port}`);
          
          if (url.pathname === '/callback') {
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            
            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`<h1>Authorization Error</h1><p>${error}</p>`);
              this.cleanup();
              reject(new Error(`OAuth error: ${error}`));
              return;
            }
            
            if (!code) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<h1>Missing Authorization Code</h1>');
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
              
              this.cleanup();
              resolve(tokens);
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(`<h1>Authentication Error</h1><p>${error}</p>`);
              this.cleanup();
              reject(error);
            }
          } else {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>Not Found</h1>');
          }
        } catch (error) {
          logger.error('Server error:', error);
          reject(error);
        }
      });
      
      this.server.listen(port, () => {
        logger.info(`OAuth server started on http://localhost:${port}`);
        logger.info('Opening browser for authentication...');
        open(authUrl);
      });
      
      this.server.on('error', (error) => {
        logger.error('Server error:', error);
        this.cleanup();
        reject(error);
      });
    });
  }

  private buildAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes,
      response_type: 'code',
      state: Math.random().toString(36).substring(2, 15),
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
      this.server.close();
      this.server = undefined;
    }
  }

  async logout(): Promise<void> {
    await this.tokenStorage.clearTokens();
    logger.info('Logged out successfully');
  }
}