import { ToolSuggestion, ChangeLogEntry } from '../types/tools';
import { Contact } from '../types/contactsplus';
import { ContactsApi } from '../api/contacts';
import { ChangeLogger } from './change-logger';
import { logger } from './logger';
import { saveFeedback } from '../ml/feedback-store';

export interface SuggestionBatch {
  id: string;
  toolName: string;
  contactId: string;
  suggestions: ToolSuggestion[];
  currentIndex: number;
  completed: boolean;
  startTime: string;
  results: SuggestionResult[];
}

export interface SuggestionResult {
  suggestionId: string;
  logEntryId: string;
  decision: 'approved' | 'rejected' | 'modified' | 'pending';
  appliedValue?: any;
  timestamp?: string;
}

export interface ApplyResult {
  success: boolean;
  updatedContact?: Contact;
  error?: string;
}

export class SuggestionManager {
  private contactsApi: ContactsApi;
  private changeLogger: ChangeLogger;
  private activeBatches: Map<string, SuggestionBatch> = new Map();

  constructor(contactsApi: ContactsApi) {
    this.contactsApi = contactsApi;
    this.changeLogger = new ChangeLogger();
  }

  /**
   * Create a new suggestion batch for processing
   */
  async createBatch(
    toolName: string,
    contactId: string,
    suggestions: ToolSuggestion[],
    originalContact: Contact
  ): Promise<string> {
    const batchId = this.generateBatchId();
    const results: SuggestionResult[] = [];

    // Log all suggestions first
    for (const suggestion of suggestions) {
      try {
        const logEntryId = await this.changeLogger.logSuggestion(suggestion, originalContact);
        results.push({
          suggestionId: suggestion.id,
          logEntryId,
          decision: 'pending',
        });
      } catch (error) {
        logger.error(`Failed to log suggestion ${suggestion.id}:`, error);
        results.push({
          suggestionId: suggestion.id,
          logEntryId: '',
          decision: 'rejected',
          timestamp: new Date().toISOString(),
        });
      }
    }

    const batch: SuggestionBatch = {
      id: batchId,
      toolName,
      contactId,
      suggestions,
      currentIndex: 0,
      completed: false,
      startTime: new Date().toISOString(),
      results,
    };

    this.activeBatches.set(batchId, batch);
    logger.info(`Created suggestion batch ${batchId} with ${suggestions.length} suggestions`);
    
    return batchId;
  }

  /**
   * Get a suggestion batch by ID
   */
  getBatch(batchId: string): SuggestionBatch | null {
    return this.activeBatches.get(batchId) || null;
  }

  /**
   * Get the current suggestion in a batch
   */
  getCurrentSuggestion(batchId: string): ToolSuggestion | null {
    const batch = this.getBatch(batchId);
    if (!batch || batch.completed) return null;
    
    return batch.suggestions[batch.currentIndex] || null;
  }

  /**
   * Get the progress of a batch
   */
  getBatchProgress(batchId: string): {
    current: number;
    total: number;
    percentage: number;
    completed: boolean;
  } | null {
    const batch = this.getBatch(batchId);
    if (!batch) return null;

    return {
      current: batch.currentIndex + 1,
      total: batch.suggestions.length,
      percentage: Math.round(((batch.currentIndex + 1) / batch.suggestions.length) * 100),
      completed: batch.completed,
    };
  }

  /**
   * Process user decision for current suggestion
   */
  async processDecision(
    batchId: string,
    decision: 'approve' | 'reject' | 'modify' | 'skip',
    modifiedValue?: any
  ): Promise<{ success: boolean; error?: string; completed: boolean }> {
    const batch = this.getBatch(batchId);
    if (!batch || batch.completed) {
      return { success: false, error: 'Invalid or completed batch', completed: true };
    }

    const suggestion = batch.suggestions[batch.currentIndex];
    const result = batch.results[batch.currentIndex];

    if (!suggestion || !result) {
      return { success: false, error: 'Invalid suggestion index', completed: batch.completed };
    }

    try {
      let finalDecision: 'approved' | 'rejected' | 'modified';
      let appliedValue = suggestion.suggestedValue;

      switch (decision) {
        case 'approve':
          finalDecision = 'approved';
          break;
        case 'reject':
        case 'skip':
          finalDecision = 'rejected';
          break;
        case 'modify':
          finalDecision = 'modified';
          appliedValue = modifiedValue !== undefined ? modifiedValue : suggestion.suggestedValue;
          break;
        default:
          return { success: false, error: 'Invalid decision', completed: batch.completed };
      }

      // Update the result
      result.decision = finalDecision;
      result.appliedValue = appliedValue;
      result.timestamp = new Date().toISOString();

      // Log the decision
      await this.changeLogger.logDecision(result.logEntryId, finalDecision, appliedValue);

      // If this is a Smart Deduplication suggestion, save ML feedback
      if (batch.toolName === 'Smart Deduplication' && suggestion.rationale?.additionalInfo) {
        try {
          const additionalInfo = suggestion.rationale.additionalInfo;
          const features = additionalInfo.features as number[] | undefined;
          const modelScore = typeof additionalInfo.similarityScore === 'number'
            ? additionalInfo.similarityScore
            : suggestion.confidence;

          if (features && Array.isArray(features) && features.length === 7) {
            saveFeedback({
              contactAId: suggestion.contactId,
              contactBId: additionalInfo.matchedContact?.id || '',
              userDecision: finalDecision === 'approved' ? 'approved' : 'rejected',
              features,
              modelScore
            });
            logger.info(`Saved ML feedback: ${finalDecision} (score: ${modelScore.toFixed(3)})`);
          }
        } catch (error) {
          logger.error('Failed to save ML feedback:', error);
          // Don't fail the whole operation if feedback saving fails
        }
      }

      // Apply the change if approved or modified
      if (finalDecision === 'approved' || finalDecision === 'modified') {
        const applyResult = await this.applySuggestion(suggestion, appliedValue);
        if (!applyResult.success) {
          logger.error(`Failed to apply suggestion: ${applyResult.error}`);
          // Still continue to next suggestion even if apply failed
        }
      }

      // Move to next suggestion
      batch.currentIndex++;
      batch.completed = batch.currentIndex >= batch.suggestions.length;

      if (batch.completed) {
        this.finalizeBatch(batchId);
      }

      return { 
        success: true, 
        completed: batch.completed 
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to process decision for batch ${batchId}:`, error);
      return { 
        success: false, 
        error: errorMessage, 
        completed: batch.completed 
      };
    }
  }

  /**
   * Skip to a specific suggestion in the batch
   */
  skipToSuggestion(batchId: string, index: number): boolean {
    const batch = this.getBatch(batchId);
    if (!batch || batch.completed || index < 0 || index >= batch.suggestions.length) {
      return false;
    }

    batch.currentIndex = index;
    return true;
  }

  /**
   * Cancel a batch and mark all remaining suggestions as rejected
   */
  async cancelBatch(batchId: string): Promise<boolean> {
    const batch = this.getBatch(batchId);
    if (!batch) return false;

    try {
      // Mark all remaining suggestions as rejected
      for (let i = batch.currentIndex; i < batch.results.length; i++) {
        const result = batch.results[i];
        if (result.decision === 'pending') {
          result.decision = 'rejected';
          result.timestamp = new Date().toISOString();
          await this.changeLogger.logDecision(result.logEntryId, 'rejected');
        }
      }

      batch.completed = true;
      this.finalizeBatch(batchId);
      
      logger.info(`Cancelled batch ${batchId}`);
      return true;

    } catch (error) {
      logger.error(`Failed to cancel batch ${batchId}:`, error);
      return false;
    }
  }

  /**
   * Get summary statistics for a completed batch
   */
  getBatchSummary(batchId: string): {
    total: number;
    approved: number;
    rejected: number;
    modified: number;
    pending: number;
    successRate: number;
  } | null {
    const batch = this.getBatch(batchId);
    if (!batch) return null;

    const counts = {
      total: batch.results.length,
      approved: 0,
      rejected: 0,
      modified: 0,
      pending: 0,
    };

    batch.results.forEach(result => {
      counts[result.decision]++;
    });

    const successRate = batch.results.length > 0 
      ? Math.round(((counts.approved + counts.modified) / counts.total) * 100)
      : 0;

    return {
      ...counts,
      successRate,
    };
  }

  /**
   * Clean up old completed batches
   */
  cleanupCompletedBatches(olderThanMinutes: number = 60): number {
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    let cleaned = 0;

    this.activeBatches.forEach((batch, batchId) => {
      if (batch.completed) {
        const batchTime = new Date(batch.startTime).getTime();
        if (batchTime < cutoffTime) {
          this.activeBatches.delete(batchId);
          cleaned++;
        }
      }
    });

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} old completed batches`);
    }

    return cleaned;
  }

  private async applySuggestion(suggestion: ToolSuggestion, value: any): Promise<ApplyResult> {
    try {
      // Get the current contact
      const contacts = await this.contactsApi.getContactsByIds([suggestion.contactId]);
      if (contacts.length === 0) {
        return { success: false, error: 'Contact not found' };
      }

      const contact = contacts[0];
      const updatedContact = this.applyValueToContact(contact, suggestion.field, value);
      
      // Update the contact via API
      const result = await this.contactsApi.updateContact(updatedContact);
      
      logger.info(`Applied suggestion ${suggestion.id} to contact ${suggestion.contactId}`);
      return { success: true, updatedContact: result };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to apply suggestion ${suggestion.id}:`, error);
      return { success: false, error: errorMessage };
    }
  }

  private applyValueToContact(contact: Contact, field: string, value: any): Contact {
    const updatedContact = JSON.parse(JSON.stringify(contact)); // Deep clone

    // Parse the field path (e.g., "phoneNumbers[0].value", "name.givenName")
    const pathParts = field.split('.');
    let current: any = updatedContact.contactData;

    // Navigate to the parent of the target field
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      
      if (part.includes('[') && part.includes(']')) {
        // Handle array access like "phoneNumbers[0]"
        const [arrayName, indexStr] = part.split('[');
        const index = parseInt(indexStr.replace(']', ''));
        
        if (!current[arrayName]) {
          current[arrayName] = [];
        }
        
        // Ensure array has enough elements
        while (current[arrayName].length <= index) {
          current[arrayName].push({});
        }
        
        current = current[arrayName][index];
      } else {
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part];
      }
    }

    // Set the final value
    const finalPart = pathParts[pathParts.length - 1];
    if (finalPart.includes('[') && finalPart.includes(']')) {
      const [arrayName, indexStr] = finalPart.split('[');
      const index = parseInt(indexStr.replace(']', ''));
      
      if (!current[arrayName]) {
        current[arrayName] = [];
      }
      
      while (current[arrayName].length <= index) {
        current[arrayName].push({});
      }
      
      current[arrayName][index] = value;
    } else {
      current[finalPart] = value;
    }

    return updatedContact;
  }

  private finalizeBatch(batchId: string): void {
    const batch = this.getBatch(batchId);
    if (batch) {
      logger.info(`Completed suggestion batch ${batchId}: ${this.getBatchSummary(batchId)?.successRate}% success rate`);
    }
  }

  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}