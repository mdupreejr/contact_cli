import { Contact } from './contactsplus';

export interface ToolSuggestion {
  id: string;
  contactId: string;
  toolName: string;
  field: string;
  originalValue: any;
  suggestedValue: any;
  confidence: number;
  rationale: SuggestionRationale;
  timestamp: string;
}

export interface SuggestionRationale {
  reason: string;
  confidence: number;
  rulesApplied: string[];
  validationResult?: any;
  additionalInfo?: Record<string, any>;
}

export interface ToolResult {
  contactId: string;
  suggestions: ToolSuggestion[];
  errors: string[];
  processed: boolean;
}

export interface BatchToolResult {
  toolName: string;
  totalContacts: number;
  processedContacts: number;
  totalSuggestions: number;
  results: ToolResult[];
  errors: string[];
  executionTime: number;
}

export interface ChangeLogEntry {
  id: string;
  timestamp: string;
  contactId: string;
  toolName: string;
  field: string;
  originalValue: any;
  suggestedValue: any;
  appliedValue?: any;
  userDecision: 'approved' | 'rejected' | 'modified' | 'pending';
  decisionTimestamp?: string;
  rationale: SuggestionRationale;
  rollbackData?: {
    canRollback: boolean;
    originalContact: Contact;
  };
}

export interface ToolMetrics {
  toolName: string;
  totalRuns: number;
  totalSuggestions: number;
  acceptedSuggestions: number;
  rejectedSuggestions: number;
  averageConfidence: number;
  averageExecutionTime: number;
  lastRun: string;
  errorCount: number;
}

export interface ToolConfig {
  enabled: boolean;
  priority: number;
  options: Record<string, any>;
}

export abstract class BaseTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly category: 'normalization' | 'validation' | 'deduplication' | 'enhancement';
  abstract readonly version: string;

  protected config: ToolConfig;

  constructor(config?: Partial<ToolConfig>) {
    this.config = {
      enabled: true,
      priority: 0,
      options: {},
      ...config,
    };
  }

  /**
   * Analyze a contact and generate suggestions without making changes
   */
  abstract analyze(contact: Contact): Promise<ToolSuggestion[]>;

  /**
   * Process multiple contacts and return suggestions for all
   */
  async batchAnalyze(contacts: Contact[]): Promise<BatchToolResult> {
    const startTime = Date.now();
    const results: ToolResult[] = [];
    const errors: string[] = [];
    let totalSuggestions = 0;
    let processedContacts = 0;

    for (const contact of contacts) {
      try {
        const suggestions = await this.analyze(contact);
        results.push({
          contactId: contact.contactId,
          suggestions,
          errors: [],
          processed: true,
        });
        totalSuggestions += suggestions.length;
        processedContacts++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Contact ${contact.contactId}: ${errorMessage}`);
        results.push({
          contactId: contact.contactId,
          suggestions: [],
          errors: [errorMessage],
          processed: false,
        });
      }
    }

    const executionTime = Date.now() - startTime;

    return {
      toolName: this.name,
      totalContacts: contacts.length,
      processedContacts,
      totalSuggestions,
      results,
      errors,
      executionTime,
    };
  }

  /**
   * Validate that a suggestion can be applied to a contact
   */
  validateSuggestion(suggestion: ToolSuggestion, contact: Contact): boolean {
    // Base validation - tools can override for specific validation
    return suggestion.contactId === contact.contactId && suggestion.confidence > 0;
  }

  /**
   * Get configuration for this tool
   */
  getConfig(): ToolConfig {
    return { ...this.config };
  }

  /**
   * Update configuration for this tool
   */
  updateConfig(updates: Partial<ToolConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Generate a unique suggestion ID
   */
  protected generateSuggestionId(): string {
    return `${this.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a suggestion object with consistent structure
   */
  protected createSuggestion(
    contactId: string,
    field: string,
    originalValue: any,
    suggestedValue: any,
    rationale: SuggestionRationale
  ): ToolSuggestion {
    return {
      id: this.generateSuggestionId(),
      contactId,
      toolName: this.name,
      field,
      originalValue,
      suggestedValue,
      confidence: rationale.confidence,
      rationale,
      timestamp: new Date().toISOString(),
    };
  }
}