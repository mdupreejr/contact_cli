import * as fs from 'fs';
import { logger } from './logger';

/**
 * Parsed CSV data structure
 */
export interface CsvData {
  headers: string[];
  rows: string[][];
  rowCount: number;
}

/**
 * CSV parsing options
 */
export interface CsvParseOptions {
  delimiter?: string;
  hasHeaders?: boolean;
  skipEmptyRows?: boolean;
  encoding?: BufferEncoding;
}

/**
 * Simple CSV parser that handles quoted fields and various edge cases
 */
export class CsvParser {
  private options: Required<CsvParseOptions>;

  constructor(options?: CsvParseOptions) {
    this.options = {
      delimiter: options?.delimiter || ',',
      hasHeaders: options?.hasHeaders !== false, // Default true
      skipEmptyRows: options?.skipEmptyRows !== false, // Default true
      encoding: options?.encoding || 'utf-8',
    };
  }

  /**
   * Parse CSV file from path
   */
  async parseFile(filePath: string): Promise<CsvData> {
    try {
      logger.info(`Parsing CSV file: ${filePath}`);
      const content = fs.readFileSync(filePath, this.options.encoding);
      return this.parseString(content);
    } catch (error) {
      logger.error('Failed to parse CSV file:', error);
      throw new Error(`Failed to parse CSV file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse CSV from string content
   */
  parseString(content: string): CsvData {
    const lines = this.splitLines(content);
    const rows: string[][] = [];
    let headers: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines if configured
      if (this.options.skipEmptyRows && line.length === 0) {
        continue;
      }

      const row = this.parseLine(line);

      // First row is headers if configured
      if (i === 0 && this.options.hasHeaders) {
        headers = row;
      } else {
        rows.push(row);
      }
    }

    // If no headers configured, generate numeric headers
    if (!this.options.hasHeaders && rows.length > 0) {
      headers = rows[0].map((_, index) => `Column ${index + 1}`);
    }

    logger.info(`Parsed CSV: ${headers.length} columns, ${rows.length} rows`);

    return {
      headers,
      rows,
      rowCount: rows.length,
    };
  }

  /**
   * Parse a single CSV line, handling quoted fields
   */
  private parseLine(line: string): string[] {
    const fields: string[] = [];
    let currentField = '';
    let insideQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = i + 1 < line.length ? line[i + 1] : '';

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote mode
          insideQuotes = !insideQuotes;
        }
      } else if (char === this.options.delimiter && !insideQuotes) {
        // End of field
        fields.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }

      i++;
    }

    // Add last field
    fields.push(currentField.trim());

    return fields;
  }

  /**
   * Split content into lines, handling different line endings
   */
  private splitLines(content: string): string[] {
    // Normalize line endings to \n
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return normalized.split('\n');
  }

  /**
   * Convert parsed CSV data to objects using headers as keys
   */
  toObjects(data: CsvData): Record<string, string>[] {
    return data.rows.map(row => {
      const obj: Record<string, string> = {};
      data.headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });
  }

  /**
   * Detect delimiter by analyzing first few lines
   */
  static detectDelimiter(content: string): string {
    const lines = content.split('\n').slice(0, 5); // Check first 5 lines
    const delimiters = [',', ';', '\t', '|'];
    const counts: Record<string, number[]> = {};

    for (const delimiter of delimiters) {
      counts[delimiter] = lines.map(line => (line.match(new RegExp(`\\${delimiter}`, 'g')) || []).length);
    }

    // Find delimiter with most consistent count across lines
    let bestDelimiter = ',';
    let bestScore = 0;

    for (const delimiter of delimiters) {
      const delimiterCounts = counts[delimiter];
      if (delimiterCounts.length === 0) continue;

      // Check if count is consistent
      const firstCount = delimiterCounts[0];
      if (firstCount === 0) continue;

      const isConsistent = delimiterCounts.every(count => count === firstCount);
      if (isConsistent && firstCount > bestScore) {
        bestScore = firstCount;
        bestDelimiter = delimiter;
      }
    }

    return bestDelimiter;
  }

  /**
   * Validate CSV file format
   */
  static validate(data: CsvData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (data.headers.length === 0) {
      errors.push('No headers found in CSV file');
    }

    if (data.rowCount === 0) {
      errors.push('No data rows found in CSV file');
    }

    // Check for inconsistent column counts
    const expectedColumns = data.headers.length;
    const inconsistentRows = data.rows
      .map((row, index) => ({ index, length: row.length }))
      .filter(r => r.length !== expectedColumns);

    if (inconsistentRows.length > 0) {
      errors.push(
        `Found ${inconsistentRows.length} rows with inconsistent column count (expected ${expectedColumns})`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Helper function to parse CSV file
 */
export async function parseCSV(filePath: string, options?: CsvParseOptions): Promise<CsvData> {
  const parser = new CsvParser(options);
  return parser.parseFile(filePath);
}
