import { getDatabase } from './database';
import { logger } from '../utils/logger';

export interface ToolActivity {
  toolName: string;
  sessionId: string;
  timestamp: number;
  suggestionsGenerated: number;
  contactsModified: number;
  lastRun: number;
}

export interface ToolActivityStats {
  toolName: string;
  timesRunThisSession: number;
  timesRunTotal: number;
  contactsModifiedThisSession: number;
  contactsModifiedTotal: number;
  lastRunTimestamp: number | null;
}

export class ToolActivityTracker {
  private currentSessionId: string;

  constructor() {
    this.currentSessionId = `session_${Date.now()}`;
  }

  /**
   * Record a tool execution
   */
  async recordToolExecution(
    toolName: string,
    suggestionsGenerated: number,
    contactsModified: number = 0
  ): Promise<void> {
    try {
      const db = getDatabase();
      db.execute(
        `INSERT INTO tool_activity
         (tool_name, session_id, timestamp, suggestions_generated, contacts_modified, last_run)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [toolName, this.currentSessionId, Date.now(), suggestionsGenerated, contactsModified, Date.now()]
      );
      logger.debug(`Recorded tool activity: ${toolName} - ${suggestionsGenerated} suggestions`);
    } catch (error) {
      logger.error('Failed to record tool execution:', error);
    }
  }

  /**
   * Get statistics for current session
   */
  async getSessionStats(): Promise<ToolActivityStats[]> {
    try {
      const db = getDatabase();
      const rows = db.query<{
        tool_name: string;
        times_run: number;
        contacts_modified: number;
        last_run: number;
      }>(
        `SELECT
           tool_name,
           COUNT(*) as times_run,
           SUM(contacts_modified) as contacts_modified,
           MAX(last_run) as last_run
         FROM tool_activity
         WHERE session_id = ?
         GROUP BY tool_name
         ORDER BY last_run DESC`,
        [this.currentSessionId]
      );

      return rows.map(row => ({
        toolName: row.tool_name,
        timesRunThisSession: row.times_run,
        timesRunTotal: 0,
        contactsModifiedThisSession: row.contacts_modified || 0,
        contactsModifiedTotal: 0,
        lastRunTimestamp: row.last_run
      }));
    } catch (error) {
      logger.error('Failed to get session stats:', error);
      return [];
    }
  }

  /**
   * Get lifetime statistics for all tools
   */
  async getLifetimeStats(): Promise<ToolActivityStats[]> {
    try {
      const db = getDatabase();
      const rows = db.query<{
        tool_name: string;
        times_run: number;
        contacts_modified: number;
        last_run: number;
      }>(
        `SELECT
           tool_name,
           COUNT(*) as times_run,
           SUM(contacts_modified) as contacts_modified,
           MAX(last_run) as last_run
         FROM tool_activity
         GROUP BY tool_name
         ORDER BY last_run DESC`
      );

      return rows.map(row => ({
        toolName: row.tool_name,
        timesRunThisSession: 0,
        timesRunTotal: row.times_run,
        contactsModifiedThisSession: 0,
        contactsModifiedTotal: row.contacts_modified || 0,
        lastRunTimestamp: row.last_run
      }));
    } catch (error) {
      logger.error('Failed to get lifetime stats:', error);
      return [];
    }
  }

  /**
   * Get combined statistics (current session + lifetime)
   */
  async getCombinedStats(): Promise<ToolActivityStats[]> {
    try {
      const db = getDatabase();

      // Get all unique tool names
      const allTools = db.query<{ tool_name: string }>(
        `SELECT DISTINCT tool_name FROM tool_activity ORDER BY tool_name`
      );

      const stats: ToolActivityStats[] = [];

      for (const { tool_name } of allTools) {
        // Get session stats
        const sessionRow = db.queryOne<{
          times_run: number;
          contacts_modified: number;
          last_run: number;
        }>(
          `SELECT
             COUNT(*) as times_run,
             SUM(contacts_modified) as contacts_modified,
             MAX(last_run) as last_run
           FROM tool_activity
           WHERE tool_name = ? AND session_id = ?`,
          [tool_name, this.currentSessionId]
        );

        // Get lifetime stats
        const lifetimeRow = db.queryOne<{
          times_run: number;
          contacts_modified: number;
          last_run: number;
        }>(
          `SELECT
             COUNT(*) as times_run,
             SUM(contacts_modified) as contacts_modified,
             MAX(last_run) as last_run
           FROM tool_activity
           WHERE tool_name = ?`,
          [tool_name]
        );

        stats.push({
          toolName: tool_name,
          timesRunThisSession: sessionRow?.times_run || 0,
          timesRunTotal: lifetimeRow?.times_run || 0,
          contactsModifiedThisSession: sessionRow?.contacts_modified || 0,
          contactsModifiedTotal: lifetimeRow?.contacts_modified || 0,
          lastRunTimestamp: lifetimeRow?.last_run || null
        });
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get combined stats:', error);
      return [];
    }
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.currentSessionId;
  }
}

// Singleton instance
let trackerInstance: ToolActivityTracker | null = null;

/**
 * Get tool activity tracker instance
 */
export function getToolActivityTracker(): ToolActivityTracker {
  if (!trackerInstance) {
    trackerInstance = new ToolActivityTracker();
  }
  return trackerInstance;
}
