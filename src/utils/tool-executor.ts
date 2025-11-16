import { BaseTool, ToolSuggestion, ToolResult } from '../types/tools';
import { Contact, ContactData } from '../types/contactsplus';
import { getSyncQueue, getContactStore } from '../db';
import { getToolActivityTracker } from '../db/tool-activity-tracker';
import { logger } from './logger';
import { ProgressTracker } from './progress-tracker';
import { FieldParser } from './field-parser';

/**
 * Tool execution result summary
 */
export interface ToolExecutionResult {
  /** Number of contacts analyzed */
  analyzed: number;
  /** Total number of suggestions generated */
  suggestions: number;
  /** Number of items queued for sync */
  queued: number;
  /** Session ID for grouping related changes */
  sessionId: string;
}

/**
 * Options for tool execution
 */
export interface ToolExecutionOptions {
  /** Custom prefix for session ID (default: tool name) */
  sessionIdPrefix?: string;
  /** Progress callback for UI updates */
  onProgress?: (current: number, total: number, message: string) => void;
}

/**
 * ToolExecutor - Standardizes tool execution pattern across all ML tools
 *
 * All tools follow the same pattern:
 * 1. Run analysis on contacts
 * 2. Queue all suggestions to sync queue
 * 3. Return summary for user notification
 *
 * This ensures consistent UX: Tool runs → "Go to Sync Queue to review"
 *
 * Benefits:
 * - Consistent behavior across all ML tools
 * - Automatic progress tracking
 * - Automatic tool activity logging
 * - Deduplication of suggestions before queueing
 * - Error handling and logging
 *
 * @example
 * ```typescript
 * const contacts = await contactStore.getAllContacts();
 * const result = await ToolExecutor.runTool(
 *   phoneNormalizationTool,
 *   contacts,
 *   { onProgress: (current, total, msg) => console.log(msg) }
 * );
 * console.log(`Queued ${result.queued} items for review`);
 * ```
 */
export class ToolExecutor {
  /**
   * Execute a tool with standardized queue-first pattern
   *
   * Runs the tool's batch analysis, queues all suggestions to the sync queue,
   * and tracks tool activity for metrics.
   *
   * @template T - Tool type (must extend BaseTool)
   * @param tool - The tool to execute
   * @param contacts - Contacts to analyze
   * @param options - Execution options (session ID prefix, progress callback)
   * @returns Execution result summary with counts and session ID
   * @throws Error if tool execution or queueing fails
   */
  static async runTool<T extends BaseTool>(
    tool: T,
    contacts: Contact[],
    options: ToolExecutionOptions = {}
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const sessionId = options.sessionIdPrefix
      ? `${options.sessionIdPrefix}_${Date.now()}`
      : `${tool.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;

    try {
      logger.info(`ToolExecutor: Starting ${tool.name} on ${contacts.length} contacts`);

      // Step 1: Run analysis
      const tracker = new ProgressTracker(contacts.length, `Analyzing with ${tool.name}...`);

      if (options.onProgress) {
        tracker.on('progress', (progress) => {
          options.onProgress!(progress.current, progress.total, progress.message);
        });
      }

      const result = await tool.batchAnalyze(contacts, tracker);

      logger.info(`ToolExecutor: ${tool.name} analysis complete - ${result.totalSuggestions} suggestions`);

      // Step 2: Queue all suggestions
      const queuedCount = await this.queueSuggestions(result, contacts, sessionId);

      // Step 3: Track tool activity
      const activityTracker = getToolActivityTracker();
      await activityTracker.recordToolExecution(tool.name, result.totalSuggestions, queuedCount);

      const executionTime = Date.now() - startTime;
      logger.info(`ToolExecutor: ${tool.name} completed in ${executionTime}ms - queued ${queuedCount} items`);

      return {
        analyzed: result.processedContacts || contacts.length,
        suggestions: result.totalSuggestions,
        queued: queuedCount,
        sessionId,
      };
    } catch (error) {
      logger.error('Tool execution failed', { toolName: tool.name, contactCount: contacts.length, error });
      if (error instanceof Error) {
        error.message = `Tool execution failed for ${tool.name}: ${error.message}`;
        throw error;
      }
      throw new Error(`Tool execution failed for ${tool.name}: Unknown error`);
    }
  }

  /**
   * Queue all suggestions to sync queue
   *
   * @param result - Tool analysis result
   * @param contacts - Original contacts list
   * @param sessionId - Session ID for grouping
   * @returns Number of items queued
   */
  private static async queueSuggestions(
    result: { results: ToolResult[] },
    contacts: Contact[],
    sessionId: string
  ): Promise<number> {
    try {
      const syncQueue = getSyncQueue();
      let queuedCount = 0;
      const missingContacts: string[] = [];

      for (const contactResult of result.results) {
        if (contactResult.suggestions.length === 0) continue;

        const contact = contacts.find(c => c.contactId === contactResult.contactId);
        if (!contact) {
          missingContacts.push(contactResult.contactId);
          continue;
        }

        // Apply all suggestions to create updated contact data
        const updatedData = this.applySuggestions(
          contact.contactData,
          contactResult.suggestions
        );

        // Only queue if data actually changed
        if (this.hasChanges(contact.contactData, updatedData)) {
          syncQueue.addToQueue(
            contact.contactId,
            'update',
            updatedData,
            contact.contactData,
            sessionId
          );
          queuedCount++;
        } else {
          logger.debug('No actual changes for contact, skipping queue', { contactId: contact.contactId });
        }
      }

      if (missingContacts.length > 0) {
        logger.warn('Contacts not found in original list, skipped queueing', { missingCount: missingContacts.length, contactIds: missingContacts });
      }

      return queuedCount;
    } catch (error) {
      logger.error('Failed to queue suggestions', { sessionId, contactCount: contacts.length, error });
      if (error instanceof Error) {
        error.message = `Failed to queue suggestions for session ${sessionId}: ${error.message}`;
        throw error;
      }
      throw new Error(`Failed to queue suggestions for session ${sessionId}: Unknown error`);
    }
  }

  /**
   * Apply suggestions to contact data
   *
   * @param contactData - Original contact data
   * @param suggestions - Suggestions to apply
   * @returns Updated contact data
   */
  private static applySuggestions(
    contactData: ContactData,
    suggestions: ToolSuggestion[]
  ): ContactData {
    // Deep clone to avoid mutating original contact data while applying suggestions.
    const updatedData = JSON.parse(JSON.stringify(contactData)) as Record<string, unknown>;

    for (const suggestion of suggestions) {
      this.applySuggestion(updatedData, suggestion);
    }

    return updatedData as ContactData;
  }

  /**
   * Apply a single suggestion to contact data
   *
   * @param data - Contact data to modify
   * @param suggestion - Suggestion to apply
   */
  private static applySuggestion(data: Record<string, unknown>, suggestion: ToolSuggestion): void {
    FieldParser.applyFieldValue(data, suggestion.field, suggestion.suggestedValue);
  }

  /**
   * Check if two objects have any differences using deep equality
   *
   * Performs recursive comparison with circular reference detection
   * and depth limiting for safety. Used to avoid queueing no-op changes.
   *
   * @param original - Original data
   * @param updated - Updated data
   * @param visited - WeakSet for circular reference detection (internal use)
   * @param depth - Current recursion depth (internal use)
   * @returns true if there are differences, false if identical
   */
  private static hasChanges(
    original: unknown,
    updated: unknown,
    visited: WeakSet<object> = new WeakSet(),
    depth: number = 0
  ): boolean {
    const MAX_DEPTH = 50;

    // Depth limit protection
    if (depth > MAX_DEPTH) {
      logger.warn('Deep equality check exceeded max depth, assuming changed', { depth, maxDepth: MAX_DEPTH });
      return true; // Assume changed if too deep
    }

    // Quick reference check
    if (original === updated) return false;

    // Null/undefined checks
    if (original == null || updated == null) return original !== updated;

    // Type check
    if (typeof original !== typeof updated) return true;

    // Primitive types
    if (typeof original !== 'object') return original !== updated;

    // Circular reference detection
    if (visited.has(original)) {
      logger.warn('Circular reference detected in hasChanges');
      return false; // Assume not changed if circular (already compared in parent)
    }
    visited.add(original);

    // Array check
    const originalIsArray = Array.isArray(original);
    const updatedIsArray = Array.isArray(updated);
    if (originalIsArray !== updatedIsArray) return true;

    if (originalIsArray && updatedIsArray) {
      const origArr = original as unknown[];
      const updArr = updated as unknown[];
      if (origArr.length !== updArr.length) return true;
      for (let i = 0; i < origArr.length; i++) {
        if (this.hasChanges(origArr[i], updArr[i], visited, depth + 1)) return true;
      }
      return false;
    }

    // Object comparison
    const origObj = original as Record<string, unknown>;
    const updObj = updated as Record<string, unknown>;
    const originalKeys = Object.keys(origObj).sort();
    const updatedKeys = Object.keys(updObj).sort();

    if (originalKeys.length !== updatedKeys.length) return true;

    for (let i = 0; i < originalKeys.length; i++) {
      if (originalKeys[i] !== updatedKeys[i]) return true;
    }

    for (const key of originalKeys) {
      if (this.hasChanges(origObj[key], updObj[key], visited, depth + 1)) return true;
    }

    return false;
  }
}
