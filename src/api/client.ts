import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { OAuthManager } from '../auth/oauth';
import { getConfig } from '../utils/config';
import { logger } from '../utils/logger';

export class ApiClient {
  private client: AxiosInstance;
  private oauthManager: OAuthManager;
  private config = getConfig();

  constructor() {
    this.oauthManager = new OAuthManager();
    this.client = axios.create({
      baseURL: this.config.apiBase,
      timeout: 30000,
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
          logger.error('Failed to authenticate request:', error);
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
        if (error.response?.status === 401) {
          logger.warn('Received 401, attempting to refresh tokens');
          try {
            // Try to refresh tokens and retry the request
            const tokens = await this.oauthManager.authenticate();
            error.config.headers.Authorization = `Bearer ${tokens.access_token}`;
            return this.client.request(error.config);
          } catch (refreshError) {
            logger.error('Failed to refresh tokens:', refreshError);
            throw refreshError;
          }
        }
        return Promise.reject(error);
      }
    );
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get(url, config);
    return response.data;
  }

  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post(url, data, config);
    return response.data;
  }

  async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete(url, config);
    return response.data;
  }

  async logout(): Promise<void> {
    await this.oauthManager.logout();
  }
}