import { logger } from './logger';
import { MAX_PHONE_LENGTH } from './constants';
import { Validators } from './validators';

/**
 * Parsed array field information
 */
export interface ParsedArrayField {
  arrayName: string;
  index: number;
  propName: string;
}

/**
 * Parsed nested field information
 */
export interface ParsedNestedField {
  objectName: string;
  propName: string;
}

/**
 * FieldParser - Shared utilities for parsing and applying field values
 *
 * Eliminates duplication of field parsing logic across the codebase.
 * Handles array fields (e.g., "phoneNumbers[0].value"), nested fields
 * (e.g., "name.givenName"), and simple fields.
 *
 * Field name constraints:
 * - Simple fields: Must match \w+ pattern (alphanumeric and underscore)
 * - Array fields: Must be in format arrayName[index].propertyName
 * - Nested fields: Must be in format objectName.propertyName
 * - Complex paths: Can combine multiple levels (e.g., "addresses[0].street")
 */
export class FieldParser {
  /**
   * Parse array field notation like "phoneNumbers[0].value"
   *
   * @param field - Field string to parse
   * @returns Parsed field info or null if not an array field
   */
  static parseArrayField(field: string): ParsedArrayField | null {
    const arrayMatch = field.match(/^(\w+)\[(\d+)\]\.(\w+)$/);
    if (!arrayMatch) return null;

    const [, arrayName, indexStr, propName] = arrayMatch;
    const index = parseInt(indexStr, 10);

    if (!Validators.isNonNegativeInteger(index)) {
      logger.warn(`Invalid array index in field: ${field}`);
      return null;
    }

    return { arrayName, index, propName };
  }

  /**
   * Parse nested field notation like "name.givenName"
   *
   * @param field - Field string to parse
   * @returns Parsed field info or null if not a nested field
   */
  static parseNestedField(field: string): ParsedNestedField | null {
    const nestedMatch = field.match(/^(\w+)\.(\w+)$/);
    if (!nestedMatch) return null;

    const [, objectName, propName] = nestedMatch;
    return { objectName, propName };
  }

  /**
   * Apply a value to a field in a data object
   *
   * Handles array fields, nested fields, and simple fields.
   *
   * @param data - Object to modify
   * @param field - Field path (e.g., "phoneNumbers[0].value", "name.givenName")
   * @param value - Value to set
   */
  static applyFieldValue(data: Record<string, unknown>, field: string, value: unknown): void {
    try {
      const arrayField = this.parseArrayField(field);
      if (arrayField) {
        if (!data[arrayField.arrayName]) {
          data[arrayField.arrayName] = [];
        }
        const arr = data[arrayField.arrayName] as Record<string, unknown>[];
        if (!arr[arrayField.index]) {
          arr[arrayField.index] = {};
        }
        arr[arrayField.index][arrayField.propName] = value;
        return;
      }

      const nestedField = this.parseNestedField(field);
      if (nestedField) {
        if (!data[nestedField.objectName]) {
          data[nestedField.objectName] = {};
        }
        const obj = data[nestedField.objectName] as Record<string, unknown>;
        obj[nestedField.propName] = value;
        return;
      }

      data[field] = value;
    } catch (error) {
      logger.warn(`Failed to apply value for field ${field}:`, error);
    }
  }

  /**
   * Navigate through a field path and apply a value
   *
   * Handles complex paths with multiple levels of nesting and arrays.
   * Example: "addresses[0].street" or "name.givenName"
   *
   * @param data - Root object to modify
   * @param fieldPath - Dot-separated field path
   * @param value - Value to set
   */
  static applyFieldPath(data: Record<string, unknown>, fieldPath: string, value: unknown): void {
    try {
      const pathParts = fieldPath.split('.');
      let current: Record<string, unknown> = data;

      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];

        if (part.includes('[') && part.includes(']')) {
          const [arrayName, indexStr] = part.split('[');
          const index = parseInt(indexStr.replace(']', ''), 10);

          if (!Validators.isNonNegativeInteger(index)) {
            logger.warn(`Invalid array index in field path: ${fieldPath}`);
            return;
          }

          if (!current[arrayName]) {
            current[arrayName] = [];
          }

          const arr = current[arrayName] as Record<string, unknown>[];
          if (!arr[index]) {
            arr[index] = {};
          }

          current = arr[index];
        } else {
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part] as Record<string, unknown>;
        }
      }

      const lastPart = pathParts[pathParts.length - 1];
      current[lastPart] = value;
    } catch (error) {
      logger.warn(`Failed to apply value for field path ${fieldPath}:`, error);
    }
  }

  /**
   * Normalize a phone number by removing all non-digit characters
   *
   * @param phone - Phone number to normalize
   * @returns Normalized phone number (digits only)
   */
  static normalizePhone(phone: string): string {
    if (!Validators.isNonEmptyString(phone)) {
      logger.warn('Invalid phone number provided to normalizePhone');
      return '';
    }
    if (!Validators.isWithinLength(phone, 0, MAX_PHONE_LENGTH)) {
      logger.warn(`Phone number truncated from ${phone.length} to ${MAX_PHONE_LENGTH} characters`);
      phone = phone.substring(0, MAX_PHONE_LENGTH);
    }
    return phone.replace(/\D/g, '');
  }
}
