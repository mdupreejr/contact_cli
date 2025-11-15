import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { OAuthManager } from '../auth/oauth';
import { getConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { DEFAULT_API_TIMEOUT, HTTP_STATUS_UNAUTHORIZED } from '../utils/constants';

/**
 * ApiClient - HTTP client for Google Contacts API
 *
 * Provides authenticated HTTP request methods with automatic token management,
 * retry logic, and error handling. Handles OAuth authentication and token
 * refresh automatically.
 *
 * Features:
 * - Automatic OAuth token injection via request interceptor
 * - Automatic token refresh on 401 responses
 * - Configurable timeout (default 30 seconds)
 * - Standard REST methods (GET, POST, PUT, DELETE)
 *
 * @example
 * ```typescript
 * const client = new ApiClient();
 * const contacts = await client.get<Contact[]>('/contacts');
 * ```
 */
export class ApiClient {
  private client: AxiosInstance;
  private oauthManager: OAuthManager;
  private config = getConfig();

  /**
   * Create a new API client with OAuth authentication
   *
   * Initializes axios instance with base URL, timeout, and interceptors
   * for automatic authentication and token refresh.
   */
  constructor() {
    this.oauthManager = new OAuthManager();
    // API timeout configurable via API_TIMEOUT env var (default: 30 seconds)
    this.client = axios.create({
      baseURL: this.config.apiBase,
      timeout: parseInt(process.env.API_TIMEOUT || String(DEFAULT_API_TIMEOUT), 10),  // Default 30s, configurable
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'contactsplus-cli/1.0.0',
      },
    });

    // Add request interceptor to include auth token
    this.client.interceptors.request.use(
      async (config) => {
        try {
          const tokens = await this.oauthManager.authenticate();
          config.headers.Authorization = `Bearer ${tokens.access_token}`;
          return config;
        } catch (error) {
          logger.error('Failed to authenticate request', { url: config.url, error });
          throw error;
        }
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Add response interceptor to handle errors
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;

        // Check if this request has already been retried (prevent infinite loop)
        if (config._retry) {
          logger.error('Token refresh already attempted, failing request', { url: config.url });
          return Promise.reject(error);
        }

        if (error.response?.status === HTTP_STATUS_UNAUTHORIZED && !config._retry) {
          config._retry = true; // Mark as retried

          logger.warn('Received 401 Unauthorized, attempting to refresh tokens', { url: config.url });
          try {
            // Try to refresh tokens and retry the request
            const tokens = await this.oauthManager.authenticate();
            config.headers.Authorization = `Bearer ${tokens.access_token}`;
            logger.info('Tokens refreshed, retrying request', { url: config.url });
            return this.client.request(config);
          } catch (refreshError) {
            logger.error('Failed to refresh tokens', { url: config.url, error: refreshError });
            // Clear stored tokens to force re-auth on next attempt
            await this.oauthManager.logout();
            throw new Error('Authentication expired. Please restart the application.');
          }
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Perform an authenticated GET request
   *
   * @template T - Expected response type
   * @param url - API endpoint path (relative to base URL)
   * @param config - Optional axios request configuration
   * @returns Response data of type T
   * @throws Error if request fails or authentication expires
   */
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.get(url, config);
      return response.data;
    } catch (error) {
      logger.error('GET request failed:', { url, error });
      throw error;
    }
  }

  /**
   * Perform an authenticated POST request
   *
   * @template T - Expected response type
   * @param url - API endpoint path (relative to base URL)
   * @param data - Request payload
   * @param config - Optional axios request configuration
   * @returns Response data of type T
   * @throws Error if request fails or authentication expires
   */
  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.post(url, data, config);
      return response.data;
    } catch (error) {
      logger.error('POST request failed:', { url, error });
      throw error;
    }
  }

  /**
   * Perform an authenticated PUT request
   *
   * @template T - Expected response type
   * @param url - API endpoint path (relative to base URL)
   * @param data - Request payload
   * @param config - Optional axios request configuration
   * @returns Response data of type T
   * @throws Error if request fails or authentication expires
   */
  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.put(url, data, config);
      return response.data;
    } catch (error) {
      logger.error('PUT request failed:', { url, error });
      throw error;
    }
  }

  /**
   * Perform an authenticated DELETE request
   *
   * @template T - Expected response type
   * @param url - API endpoint path (relative to base URL)
   * @param config - Optional axios request configuration
   * @returns Response data of type T
   * @throws Error if request fails or authentication expires
   */
  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      const response = await this.client.delete(url, config);
      return response.data;
    } catch (error) {
      logger.error('DELETE request failed:', { url, error });
      throw error;
    }
  }

  /**
   * Logout and clear stored authentication tokens
   *
   * Forces the user to re-authenticate on next API request.
   */
  async logout(): Promise<void> {
    try {
      await this.oauthManager.logout();
    } catch (error) {
      logger.error('Failed to logout:', error);
      throw error;
    }
  }

  /**
   * Clean up resources
   *
   * Cleans up OAuth server and other resources. Should be called
   * when shutting down the application.
   */
  cleanup(): void {
    try {
      this.oauthManager.cleanup();
    } catch (error) {
      logger.error('Failed to cleanup API client:', error);
    }
  }
}