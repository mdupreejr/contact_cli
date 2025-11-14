import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * Database connection singleton
 */
export class ContactDatabase {
  private static instance: ContactDatabase;
  private db: Database.Database;
  private dbPath: string;

  private constructor(dbPath?: string) {
    // Default to data/contacts.db if not specified
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'contacts.db');

    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      logger.info(`Created data directory: ${dataDir}`);
    }

    // Open database connection
    this.db = new Database(this.dbPath);

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');

    logger.info(`Database initialized: ${this.dbPath}`);

    // Initialize schema
    this.initializeSchema();
  }

  /**
   * Get database instance (singleton)
   */
  static getInstance(dbPath?: string): ContactDatabase {
    if (!ContactDatabase.instance) {
      ContactDatabase.instance = new ContactDatabase(dbPath);
    }
    return ContactDatabase.instance;
  }

  /**
   * Get raw database connection
   */
  getConnection(): Database.Database {
    return this.db;
  }

  /**
   * Initialize database schema from schema.sql
   */
  private initializeSchema(): void {
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');

      // Execute schema in a transaction
      this.db.exec(schema);

      const version = this.getSchemaVersion();
      logger.info(`Database schema initialized (version: ${version})`);
    } catch (error) {
      logger.error('Failed to initialize database schema:', error);
      throw new Error('Database initialization failed');
    }
  }

  /**
   * Get current schema version
   */
  getSchemaVersion(): string {
    try {
      const stmt = this.db.prepare('SELECT value FROM metadata WHERE key = ?');
      const result = stmt.get('schema_version') as { value: string } | undefined;
      return result?.value || '0';
    } catch (error) {
      logger.warn('Could not read schema version:', error);
      return '0';
    }
  }

  /**
   * Run a database migration
   */
  runMigration(version: string, migrationSql: string): void {
    const currentVersion = this.getSchemaVersion();

    if (currentVersion >= version) {
      logger.info(`Migration ${version} already applied (current: ${currentVersion})`);
      return;
    }

    logger.info(`Running migration to version ${version}`);

    try {
      this.db.exec(migrationSql);

      // Update schema version
      const stmt = this.db.prepare('UPDATE metadata SET value = ?, updated_at = datetime(\'now\') WHERE key = ?');
      stmt.run(version, 'schema_version');

      logger.info(`Migration to version ${version} completed`);
    } catch (error) {
      logger.error(`Migration to version ${version} failed:`, error);
      throw error;
    }
  }

  /**
   * Execute a query with parameters (returns rows)
   */
  query<T = any>(sql: string, params?: any[]): T[] {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...(params || [])) as T[];
    } catch (error) {
      logger.error('Query failed:', { sql, params, error });
      throw error;
    }
  }

  /**
   * Execute a query and return first row
   */
  queryOne<T = any>(sql: string, params?: any[]): T | undefined {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.get(...(params || [])) as T | undefined;
    } catch (error) {
      logger.error('QueryOne failed:', { sql, params, error });
      throw error;
    }
  }

  /**
   * Execute a statement (insert, update, delete)
   */
  execute(sql: string, params?: any[]): Database.RunResult {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.run(...(params || []));
    } catch (error) {
      logger.error('Execute failed:', { sql, params, error });
      throw error;
    }
  }

  /**
   * Execute multiple statements in a transaction
   */
  transaction<T>(callback: () => T): T {
    const txn = this.db.transaction(callback);
    return txn();
  }

  /**
   * Get database statistics
   */
  getStats(): {
    totalContacts: number;
    unsyncedContacts: number;
    pendingQueueItems: number;
    totalImports: number;
    dbSize: string;
  } {
    const totalContacts = this.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM contacts')?.count || 0;
    const unsyncedContacts = this.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM contacts WHERE synced_to_api = 0'
    )?.count || 0;
    const pendingQueueItems = this.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM sync_queue WHERE sync_status = \'pending\' OR sync_status = \'approved\''
    )?.count || 0;
    const totalImports = this.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM import_history'
    )?.count || 0;

    // Get database file size
    let dbSize = '0 KB';
    try {
      const stats = fs.statSync(this.dbPath);
      const sizeKB = stats.size / 1024;
      dbSize = sizeKB < 1024 ? `${sizeKB.toFixed(2)} KB` : `${(sizeKB / 1024).toFixed(2)} MB`;
    } catch (error) {
      logger.warn('Could not get database size:', error);
    }

    return {
      totalContacts,
      unsyncedContacts,
      pendingQueueItems,
      totalImports,
      dbSize,
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      logger.info('Database connection closed');
    }
  }

  /**
   * Backup database to specified path
   */
  backup(backupPath: string): void {
    try {
      this.db.backup(backupPath);
      logger.info(`Database backed up to: ${backupPath}`);
    } catch (error) {
      logger.error('Database backup failed:', error);
      throw error;
    }
  }

  /**
   * Optimize database (vacuum + analyze)
   */
  optimize(): void {
    try {
      logger.info('Optimizing database...');
      this.db.exec('VACUUM');
      this.db.exec('ANALYZE');
      logger.info('Database optimization completed');
    } catch (error) {
      logger.error('Database optimization failed:', error);
      throw error;
    }
  }
}

/**
 * Get database instance
 */
export function getDatabase(dbPath?: string): ContactDatabase {
  return ContactDatabase.getInstance(dbPath);
}
