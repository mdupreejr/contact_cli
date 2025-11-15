/**
 * Validators - Reusable validation helper utilities
 *
 * Provides standardized validation functions to reduce code duplication
 * and ensure consistent validation logic across the codebase.
 */

/**
 * Validators class containing static validation methods
 */
export class Validators {
  /**
   * String validators
   */

  /**
   * Check if value is a non-empty string
   */
  static isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  /**
   * Check if email is valid using basic RFC 5322 pattern
   */
  static isEmail(email: string): boolean {
    if (!email || typeof email !== 'string') {
      return false;
    }
    // Basic email pattern - not comprehensive but catches common cases
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email);
  }

  /**
   * Check if URL is valid
   */
  static isUrl(url: string): boolean {
    if (!url || typeof url !== 'string') {
      return false;
    }
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if string length is within range (inclusive)
   */
  static isWithinLength(str: string, min: number, max: number): boolean {
    if (typeof str !== 'string') {
      return false;
    }
    const len = str.length;
    return len >= min && len <= max;
  }

  /**
   * Check if string has file extension
   */
  static hasExtension(filepath: string, extension: string): boolean {
    if (!filepath || typeof filepath !== 'string') {
      return false;
    }
    return filepath.toLowerCase().endsWith(extension.toLowerCase());
  }

  /**
   * Number validators
   */

  /**
   * Check if value is an integer
   */
  static isInteger(value: unknown): value is number {
    return Number.isInteger(value);
  }

  /**
   * Check if value is a positive integer (> 0)
   */
  static isPositiveInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) > 0;
  }

  /**
   * Check if value is a non-negative integer (>= 0)
   */
  static isNonNegativeInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 0;
  }

  /**
   * Check if number is within range (inclusive)
   */
  static isInRange(num: number, min: number, max: number): boolean {
    if (typeof num !== 'number' || isNaN(num)) {
      return false;
    }
    return num >= min && num <= max;
  }

  /**
   * Phone validators
   */

  /**
   * Check if phone format is valid (basic check - digits only after normalization)
   */
  static isValidPhoneFormat(phone: string): boolean {
    if (!phone || typeof phone !== 'string') {
      return false;
    }
    const normalized = phone.replace(/\D/g, '');
    return normalized.length >= 10 && normalized.length <= 15;
  }

  /**
   * Array validators
   */

  /**
   * Check if value is a non-empty array
   */
  static isNonEmptyArray(value: unknown): value is unknown[] {
    return Array.isArray(value) && value.length > 0;
  }

  /**
   * Enum/choice validators
   */

  /**
   * Check if value is one of the allowed values
   */
  static isOneOf<T>(value: T, allowed: T[]): boolean {
    return allowed.includes(value);
  }

  /**
   * Validation with error messages (throws on invalid)
   */

  /**
   * Validate that a required field is present and non-empty
   * @throws Error if validation fails
   */
  static validateRequired(value: unknown, fieldName: string): void {
    if (value === null || value === undefined) {
      throw new Error(`${fieldName} is required`);
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      throw new Error(`${fieldName} cannot be empty`);
    }
  }

  /**
   * Validate string length
   * @throws Error if validation fails
   */
  static validateStringLength(str: string, min: number, max: number, fieldName: string): void {
    if (typeof str !== 'string') {
      throw new Error(`${fieldName} must be a string`);
    }
    if (!this.isWithinLength(str, min, max)) {
      throw new Error(`${fieldName} must be between ${min} and ${max} characters`);
    }
  }

  /**
   * Validate number range
   * @throws Error if validation fails
   */
  static validateRange(num: number, min: number, max: number, fieldName: string): void {
    if (typeof num !== 'number' || isNaN(num)) {
      throw new Error(`${fieldName} must be a number`);
    }
    if (!this.isInRange(num, min, max)) {
      throw new Error(`${fieldName} must be between ${min} and ${max}`);
    }
  }

  /**
   * Validate email format
   * @throws Error if validation fails
   */
  static validateEmail(email: string, fieldName: string): void {
    if (!this.isEmail(email)) {
      throw new Error(`${fieldName} must be a valid email address`);
    }
  }

  /**
   * Validate URL format
   * @throws Error if validation fails
   */
  static validateUrl(url: string, fieldName: string): void {
    if (!this.isUrl(url)) {
      throw new Error(`${fieldName} must be a valid URL`);
    }
  }

  /**
   * Validate value is one of allowed options
   * @throws Error if validation fails
   */
  static validateOneOf<T>(value: T, allowed: T[], fieldName: string): void {
    if (!this.isOneOf(value, allowed)) {
      throw new Error(`${fieldName} must be one of: ${allowed.join(', ')}`);
    }
  }

  /**
   * Validate integer
   * @throws Error if validation fails
   */
  static validateInteger(value: unknown, fieldName: string): void {
    if (!this.isInteger(value)) {
      throw new Error(`${fieldName} must be an integer`);
    }
  }

  /**
   * Validate positive integer
   * @throws Error if validation fails
   */
  static validatePositiveInteger(value: unknown, fieldName: string): void {
    if (!this.isPositiveInteger(value)) {
      throw new Error(`${fieldName} must be a positive integer`);
    }
  }

  /**
   * Validate non-negative integer
   * @throws Error if validation fails
   */
  static validateNonNegativeInteger(value: unknown, fieldName: string): void {
    if (!this.isNonNegativeInteger(value)) {
      throw new Error(`${fieldName} must be a non-negative integer`);
    }
  }

  /**
   * Validate file exists and has correct extension
   * @throws Error if validation fails
   */
  static validateFileExtension(filepath: string, extension: string, fieldName: string): void {
    if (!this.hasExtension(filepath, extension)) {
      throw new Error(`${fieldName} must have ${extension} extension`);
    }
  }
}
