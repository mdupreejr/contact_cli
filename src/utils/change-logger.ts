import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto-js';
import { ChangeLogEntry, ToolSuggestion, ToolMetrics } from '../types/tools';
import { Contact } from '../types/contactsplus';
import { logger } from './logger';

export class ChangeLogger {
  private logFilePath: string;
  private metricsFilePath: string;
  private logBuffer: ChangeLogEntry[] = [];
  private metricsCache: Map<string, ToolMetrics> = new Map();

  constructor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
    const logDir = path.join(homeDir, '.contactsplus', 'logs');
    this.logFilePath = path.join(logDir, 'changes.jsonl');
    this.metricsFilePath = path.join(logDir, 'metrics.json');
    this.ensureLogDirectoryExists();
    this.loadMetrics();
  }

  private async ensureLogDirectoryExists(): Promise<void> {
    try {
      const logDir = path.dirname(this.logFilePath);
      await fs.mkdir(logDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create log directory:', error);
    }
  }

  /**
   * Log a suggestion being presented to the user
   */
  async logSuggestion(
    suggestion: ToolSuggestion, 
    originalContact: Contact
  ): Promise<string> {
    const logEntry: ChangeLogEntry = {
      id: this.generateLogId(),
      timestamp: suggestion.timestamp,
      contactId: suggestion.contactId,
      toolName: suggestion.toolName,
      field: suggestion.field,
      originalValue: suggestion.originalValue,
      suggestedValue: suggestion.suggestedValue,
      userDecision: 'pending',
      rationale: suggestion.rationale,
      rollbackData: {
        canRollback: true,
        originalContact: this.cloneContact(originalContact),
      },
    };

    this.logBuffer.push(logEntry);
    await this.persistLog(logEntry);
    
    logger.debug(`Logged suggestion ${logEntry.id} for ${suggestion.toolName}`);
    return logEntry.id;
  }

  /**
   * Log user decision on a suggestion
   */
  async logDecision(
    logEntryId: string,
    decision: 'approved' | 'rejected' | 'modified',
    appliedValue?: any
  ): Promise<void> {
    const logEntry = this.logBuffer.find(entry => entry.id === logEntryId);
    if (logEntry) {
      logEntry.userDecision = decision;
      logEntry.decisionTimestamp = new Date().toISOString();
      if (appliedValue !== undefined) {
        logEntry.appliedValue = appliedValue;
      }
      
      await this.persistLog(logEntry);
      this.updateMetrics(logEntry);
      
      logger.info(`User ${decision} suggestion ${logEntryId} for ${logEntry.toolName}`);
    }
  }

  /**
   * Get change history for a specific contact
   */
  async getContactHistory(contactId: string): Promise<ChangeLogEntry[]> {
    const allLogs = await this.loadAllLogs();
    return allLogs.filter(entry => entry.contactId === contactId);
  }

  /**
   * Get change history for a specific tool
   */
  async getToolHistory(toolName: string): Promise<ChangeLogEntry[]> {
    const allLogs = await this.loadAllLogs();
    return allLogs.filter(entry => entry.toolName === toolName);
  }

  /**
   * Search logs by various criteria
   */
  async searchLogs(criteria: {
    contactId?: string;
    toolName?: string;
    field?: string;
    userDecision?: string;
    dateRange?: { start: string; end: string };
  }): Promise<ChangeLogEntry[]> {
    const allLogs = await this.loadAllLogs();
    
    return allLogs.filter(entry => {
      if (criteria.contactId && entry.contactId !== criteria.contactId) return false;
      if (criteria.toolName && entry.toolName !== criteria.toolName) return false;
      if (criteria.field && entry.field !== criteria.field) return false;
      if (criteria.userDecision && entry.userDecision !== criteria.userDecision) return false;
      if (criteria.dateRange) {
        const entryDate = new Date(entry.timestamp);
        const startDate = new Date(criteria.dateRange.start);
        const endDate = new Date(criteria.dateRange.end);
        if (entryDate < startDate || entryDate > endDate) return false;
      }
      return true;
    });
  }

  /**
   * Get metrics for a specific tool
   */
  getToolMetrics(toolName: string): ToolMetrics | null {
    return this.metricsCache.get(toolName) || null;
  }

  /**
   * Get metrics for all tools
   */
  getAllMetrics(): ToolMetrics[] {
    return Array.from(this.metricsCache.values());
  }

  /**
   * Export logs to various formats
   */
  async exportLogs(
    format: 'json' | 'csv',
    criteria?: Parameters<typeof ChangeLogger.prototype.searchLogs>[0]
  ): Promise<string> {
    const logs = criteria ? await this.searchLogs(criteria) : await this.loadAllLogs();
    
    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    } else if (format === 'csv') {
      return this.convertToCSV(logs);
    }
    
    throw new Error(`Unsupported export format: ${format}`);
  }

  /**
   * Clear old logs (older than specified days)
   */
  async clearOldLogs(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    const allLogs = await this.loadAllLogs();
    const logsToKeep = allLogs.filter(entry => 
      new Date(entry.timestamp) >= cutoffDate
    );
    
    const removedCount = allLogs.length - logsToKeep.length;
    
    // Rewrite the log file with only recent logs
    await this.rewriteLogFile(logsToKeep);
    
    logger.info(`Cleared ${removedCount} old log entries`);
    return removedCount;
  }

  private generateLogId(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substr(2, 9);
    return crypto.SHA256(timestamp + random).toString().substr(0, 12);
  }

  private cloneContact(contact: Contact): Contact {
    return JSON.parse(JSON.stringify(contact));
  }

  private async persistLog(logEntry: ChangeLogEntry): Promise<void> {
    try {
      const logLine = JSON.stringify(logEntry) + '\n';
      await fs.appendFile(this.logFilePath, logLine, 'utf8');
    } catch (error) {
      logger.error('Failed to persist log entry:', error);
    }
  }

  private async loadAllLogs(): Promise<ChangeLogEntry[]> {
    try {
      const content = await fs.readFile(this.logFilePath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      return lines.map(line => JSON.parse(line));
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return []; // File doesn't exist yet
      }
      logger.error('Failed to load logs:', error);
      return [];
    }
  }

  private async rewriteLogFile(logs: ChangeLogEntry[]): Promise<void> {
    try {
      const content = logs.map(log => JSON.stringify(log)).join('\n') + '\n';
      await fs.writeFile(this.logFilePath, content, 'utf8');
    } catch (error) {
      logger.error('Failed to rewrite log file:', error);
    }
  }

  private updateMetrics(logEntry: ChangeLogEntry): void {
    const toolName = logEntry.toolName;
    const existing = this.metricsCache.get(toolName) || {
      toolName,
      totalRuns: 0,
      totalSuggestions: 0,
      acceptedSuggestions: 0,
      rejectedSuggestions: 0,
      averageConfidence: 0,
      averageExecutionTime: 0,
      lastRun: logEntry.timestamp,
      errorCount: 0,
    };

    existing.totalSuggestions++;
    if (logEntry.userDecision === 'approved' || logEntry.userDecision === 'modified') {
      existing.acceptedSuggestions++;
    } else if (logEntry.userDecision === 'rejected') {
      existing.rejectedSuggestions++;
    }

    // Update average confidence
    const totalProcessed = existing.acceptedSuggestions + existing.rejectedSuggestions;
    if (totalProcessed > 0) {
      existing.averageConfidence = 
        (existing.averageConfidence * (totalProcessed - 1) + logEntry.rationale.confidence) / totalProcessed;
    }

    existing.lastRun = logEntry.decisionTimestamp || logEntry.timestamp;

    this.metricsCache.set(toolName, existing);
    this.saveMetrics();
  }

  private async loadMetrics(): Promise<void> {
    try {
      const content = await fs.readFile(this.metricsFilePath, 'utf8');
      const metrics: ToolMetrics[] = JSON.parse(content);
      this.metricsCache.clear();
      metrics.forEach(metric => this.metricsCache.set(metric.toolName, metric));
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        logger.error('Failed to load metrics:', error);
      }
    }
  }

  private async saveMetrics(): Promise<void> {
    try {
      const metrics = Array.from(this.metricsCache.values());
      const content = JSON.stringify(metrics, null, 2);
      await fs.writeFile(this.metricsFilePath, content, 'utf8');
    } catch (error) {
      logger.error('Failed to save metrics:', error);
    }
  }

  private convertToCSV(logs: ChangeLogEntry[]): string {
    const headers = [
      'ID', 'Timestamp', 'Contact ID', 'Tool Name', 'Field',
      'Original Value', 'Suggested Value', 'Applied Value',
      'User Decision', 'Decision Timestamp', 'Confidence',
      'Reason', 'Rules Applied'
    ];

    const rows = logs.map(log => [
      log.id,
      log.timestamp,
      log.contactId,
      log.toolName,
      log.field,
      JSON.stringify(log.originalValue),
      JSON.stringify(log.suggestedValue),
      log.appliedValue ? JSON.stringify(log.appliedValue) : '',
      log.userDecision,
      log.decisionTimestamp || '',
      log.rationale.confidence,
      log.rationale.reason,
      log.rationale.rulesApplied.join(';')
    ]);

    return [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }
}