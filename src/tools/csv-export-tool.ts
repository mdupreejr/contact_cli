import * as fs from 'fs';
import * as path from 'path';
import { Contact } from '../types/contactsplus';
import { logger } from '../utils/logger';

/**
 * CSV Export Options
 */
export interface CsvExportOptions {
  includeHeaders?: boolean;
  delimiter?: string;
  encoding?: BufferEncoding;
  fields?: string[]; // Specific fields to export, or all if not specified
}

/**
 * CSV Export Result
 */
export interface CsvExportResult {
  filePath: string;
  rowCount: number;
  fieldCount: number;
  fileSize: number;
}

/**
 * CSV Export Tool
 * Exports contacts to CSV format
 */
export class CsvExportTool {
  private defaultOptions: Required<CsvExportOptions> = {
    includeHeaders: true,
    delimiter: ',',
    encoding: 'utf-8',
    fields: [],
  };

  /**
   * Export contacts to CSV file
   */
  async exportContacts(
    contacts: Contact[],
    filePath: string,
    options?: CsvExportOptions
  ): Promise<CsvExportResult> {
    const opts = { ...this.defaultOptions, ...options };

    try {
      // Validate file path
      const absolutePath = path.resolve(filePath);

      // Security: Validate against allowed directories (user's home, current working directory)
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      const cwd = process.cwd();

      // Check for path traversal BEFORE normalization
      if (filePath.includes('..') || absolutePath.includes('..')) {
        throw new Error('Access denied: Path traversal detected');
      }

      // Then normalize
      const normalizedPath = path.normalize(absolutePath);

      // Resolve symlinks to prevent TOCTOU attacks
      let realPath: string;
      try {
        realPath = fs.realpathSync(normalizedPath);
      } catch (error) {
        // Path doesn't exist yet - validate parent directory
        const dir = path.dirname(normalizedPath);
        try {
          const dirReal = fs.realpathSync(dir);
          realPath = path.join(dirReal, path.basename(normalizedPath));
        } catch {
          // Parent directory doesn't exist - fail securely
          throw new Error('Access denied: Parent directory does not exist or is not accessible');
        }
      }

      // Ensure paths end with separator for exact directory matching
      const homeDirNormalized = homeDir ? path.join(homeDir, path.sep) : '';
      const cwdNormalized = path.join(cwd, path.sep);

      const isAllowedPath = (homeDirNormalized && realPath.startsWith(homeDirNormalized)) ||
                           realPath.startsWith(cwdNormalized);

      if (!isAllowedPath) {
        throw new Error('Access denied: File path is outside allowed directories');
      }

      // Prevent writing to system directories (platform-specific)
      const systemDirs = process.platform === 'win32'
        ? [
            'C:\\Windows',
            'C:\\Program Files',
            'C:\\Program Files (x86)',
            'C:\\ProgramData',
            'C:\\System32',
            'C:\\Users\\All Users',
            'C:\\Users\\Default',
            'C:\\$Recycle.Bin',
            'C:\\Boot',
            'C:\\Recovery'
          ]
        : ['/etc', '/System', '/bin', '/sbin', '/usr', '/boot', '/var', '/lib',
           '/lib64', '/opt', '/root', '/proc', '/sys', '/dev', '/run',
           '/Library', '/Applications', '/Volumes'];

      const isSystemDir = systemDirs.some(dir =>
        process.platform === 'win32'
          ? realPath.toUpperCase().startsWith(dir.toUpperCase())
          : realPath.startsWith(dir)
      );
      if (isSystemDir) {
        throw new Error('Access denied: Cannot write to system directories');
      }

      // Check file extension
      if (!realPath.toLowerCase().endsWith('.csv')) {
        throw new Error('Invalid file type: Only .csv files are allowed');
      }

      const dir = path.dirname(realPath);

      // Ensure directory exists (only if within allowed paths)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      logger.info('Starting CSV export', { contactCount: contacts.length, filePath: realPath });

      // Determine fields to export
      const fields = opts.fields.length > 0
        ? opts.fields
        : this.getAllFields(contacts);

      // Build CSV content
      const csvLines: string[] = [];

      // Add headers
      if (opts.includeHeaders) {
        csvLines.push(this.escapeRow(fields, opts.delimiter));
      }

      // Add data rows
      for (const contact of contacts) {
        const row = this.contactToRow(contact, fields);
        csvLines.push(this.escapeRow(row, opts.delimiter));
      }

      const csvContent = csvLines.join('\n');

      // Final security check - atomic write prevents TOCTOU
      try {
        // Try atomic create first (wx = write + exclusive, won't follow symlinks)
        await fs.promises.writeFile(realPath, csvContent, {
          encoding: opts.encoding,
          flag: 'wx'
        });
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST') {
          // File exists - verify not a symlink, then overwrite
          const stats = fs.lstatSync(realPath);
          if (stats.isSymbolicLink()) {
            throw new Error('Access denied: Target is a symbolic link');
          }
          // Safe to overwrite existing file
          await fs.promises.writeFile(realPath, csvContent, {
            encoding: opts.encoding,
            flag: 'w'
          });
        } else {
          throw error;
        }
      }

      // Get file stats
      const stats = fs.statSync(realPath);

      logger.info('CSV export completed successfully', {
        filePath: realPath,
        rowCount: contacts.length,
        fieldCount: fields.length,
        fileSizeKB: (stats.size / 1024).toFixed(2)
      });

      return {
        filePath: realPath,
        rowCount: contacts.length,
        fieldCount: fields.length,
        fileSize: stats.size,
      };
    } catch (error) {
      logger.error('CSV export failed', { filePath, contactCount: contacts.length, error });
      throw new Error(`Failed to export CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all unique fields from contacts
   */
  private getAllFields(contacts: Contact[]): string[] {
    const fields = new Set<string>();

    // Standard fields
    fields.add('contactId');
    fields.add('givenName');
    fields.add('middleName');
    fields.add('familyName');
    fields.add('prefix');
    fields.add('suffix');

    // Dynamic fields based on actual data
    for (const contact of contacts) {
      const data = contact.contactData;

      // Emails
      if (data.emails) {
        for (let i = 0; i < data.emails.length; i++) {
          fields.add(`email${i + 1}`);
          fields.add(`email${i + 1}Type`);
        }
      }

      // Phones
      if (data.phoneNumbers) {
        for (let i = 0; i < data.phoneNumbers.length; i++) {
          fields.add(`phone${i + 1}`);
          fields.add(`phone${i + 1}Type`);
        }
      }

      // Organizations
      if (data.organizations && data.organizations.length > 0) {
        fields.add('company');
        fields.add('title');
        fields.add('department');
      }

      // Addresses
      if (data.addresses) {
        for (let i = 0; i < data.addresses.length; i++) {
          fields.add(`address${i + 1}Street`);
          fields.add(`address${i + 1}City`);
          fields.add(`address${i + 1}Region`);
          fields.add(`address${i + 1}PostalCode`);
          fields.add(`address${i + 1}Country`);
          fields.add(`address${i + 1}Type`);
        }
      }

      // URLs
      if (data.urls) {
        for (let i = 0; i < data.urls.length; i++) {
          fields.add(`url${i + 1}`);
        }
      }

      // Birthday
      if (data.birthday) {
        fields.add('birthday');
      }

      // Notes
      if (data.notes) {
        fields.add('notes');
      }
    }

    return Array.from(fields);
  }

  /**
   * Convert contact to row data
   */
  private contactToRow(contact: Contact, fields: string[]): string[] {
    const row: string[] = [];
    const data = contact.contactData;

    for (const field of fields) {
      let value = '';

      // Contact ID
      if (field === 'contactId') {
        value = contact.contactId;
      }
      // Name fields
      else if (field === 'givenName') {
        value = data.name?.givenName || '';
      } else if (field === 'middleName') {
        value = data.name?.middleName || '';
      } else if (field === 'familyName') {
        value = data.name?.familyName || '';
      } else if (field === 'prefix') {
        value = data.name?.prefix || '';
      } else if (field === 'suffix') {
        value = data.name?.suffix || '';
      }
      // Email fields
      else if (field.startsWith('email')) {
        const index = parseInt(field.replace(/\D/g, ''), 10) - 1;
        if (field.includes('Type')) {
          value = data.emails?.[index]?.type || '';
        } else {
          value = data.emails?.[index]?.value || '';
        }
      }
      // Phone fields
      else if (field.startsWith('phone')) {
        const index = parseInt(field.replace(/\D/g, ''), 10) - 1;
        if (field.includes('Type')) {
          value = data.phoneNumbers?.[index]?.type || '';
        } else {
          value = data.phoneNumbers?.[index]?.value || '';
        }
      }
      // Organization fields
      else if (field === 'company') {
        value = data.organizations?.[0]?.name || '';
      } else if (field === 'title') {
        value = data.organizations?.[0]?.title || '';
      } else if (field === 'department') {
        value = data.organizations?.[0]?.department || '';
      }
      // Address fields
      else if (field.startsWith('address')) {
        const index = parseInt(field.replace(/\D/g, ''), 10) - 1;
        const address = data.addresses?.[index];
        if (field.includes('Street')) {
          value = address?.street || '';
        } else if (field.includes('City')) {
          value = address?.city || '';
        } else if (field.includes('Region')) {
          value = address?.region || '';
        } else if (field.includes('PostalCode')) {
          value = address?.postalCode || '';
        } else if (field.includes('Country')) {
          value = address?.country || '';
        } else if (field.includes('Type')) {
          value = address?.type || '';
        }
      }
      // URL fields
      else if (field.startsWith('url')) {
        const index = parseInt(field.replace(/\D/g, ''), 10) - 1;
        value = data.urls?.[index]?.value || '';
      }
      // Birthday
      else if (field === 'birthday' && data.birthday) {
        const parts: string[] = [];
        if (data.birthday.year) parts.push(data.birthday.year.toString());
        if (data.birthday.month) parts.push(data.birthday.month.toString().padStart(2, '0'));
        if (data.birthday.day) parts.push(data.birthday.day.toString().padStart(2, '0'));
        value = parts.join('-');
      }
      // Notes
      else if (field === 'notes') {
        value = data.notes || '';
      }

      row.push(value);
    }

    return row;
  }

  /**
   * Escape and format row for CSV
   */
  private escapeRow(values: string[], delimiter: string): string {
    return values.map(value => this.escapeValue(value, delimiter)).join(delimiter);
  }

  /**
   * Escape individual value for CSV
   * Prevents CSV injection by sanitizing formula prefixes
   */
  private escapeValue(value: string, delimiter: string): string {
    // Sanitize CSV injection: prefix dangerous characters with single quote
    // This forces Excel/Sheets to treat the cell as text, not a formula
    if (value.length > 0) {
      const firstChar = value.charAt(0);
      if (firstChar === '=' || firstChar === '+' || firstChar === '-' ||
          firstChar === '@' || firstChar === '\t' || firstChar === '\r' ||
          firstChar === '|' || firstChar === '\n') {
        value = "'" + value;  // Prefix with single quote to force text interpretation
      }
    }

    // If value contains delimiter, newline, or quote, wrap in quotes
    if (value.includes(delimiter) || value.includes('\n') || value.includes('"')) {
      // Escape quotes by doubling them
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * Get recommended filename
   */
  getRecommendedFilename(): string {
    const date = new Date().toISOString().split('T')[0];
    return `contacts-export-${date}.csv`;
  }
}

/**
 * Helper function to export contacts
 */
export async function exportContactsToCsv(
  contacts: Contact[],
  filePath: string,
  options?: CsvExportOptions
): Promise<CsvExportResult> {
  const tool = new CsvExportTool();
  return tool.exportContacts(contacts, filePath, options);
}
