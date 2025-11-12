import { BaseTool, ToolSuggestion } from '../types/tools';
import { Contact } from '../types/contactsplus';
import { logger } from '../utils/logger';
import { dedupeSuggestions } from '../ml/api';

export class SmartDedupeTool extends BaseTool {
  readonly name = 'Smart Deduplication';
  readonly description = 'ML-powered duplicate detection using feature scoring and logistic regression to find potential duplicates';
  readonly category = 'deduplication';
  readonly version = '1.0.0';

  async analyze(contact: Contact): Promise<ToolSuggestion[]> {
    try {
      return [];
    } catch (error) {
      logger.error('Smart deduplication analyze failed:', error);
      return [];
    }
  }

  async batchAnalyze(contacts: Contact[]): Promise<any> {
    const startTime = Date.now();
    const results: any[] = [];
    const errors: string[] = [];

    try {
      logger.info('Running ML-powered duplicate detection...');

      // Call the ML deduplication
      const duplicatePairs = await dedupeSuggestions(50);

      logger.info(`Found ${duplicatePairs.length} potential duplicate pairs`);

      // Convert ML results to tool results format
      for (const pair of duplicatePairs) {
        const suggestion = this.createSuggestion(
          pair.a.id,
          'potential_duplicate',
          pair.a,
          pair.b,
          {
            reason: `Potential duplicate detected with similarity score: ${(pair.p * 100).toFixed(1)}%`,
            confidence: pair.p,
            rulesApplied: ['ml-similarity-scoring', 'feature-matching'],
            additionalInfo: {
              matchedContact: pair.b,
              similarityScore: pair.p,
              features: pair.features || {}
            }
          }
        );

        results.push({
          contactId: pair.a.id,
          suggestions: [suggestion],
          errors: [],
          processed: true
        });
      }

      const executionTime = Date.now() - startTime;

      return {
        toolName: this.name,
        totalContacts: contacts.length,
        processedContacts: results.length,
        totalSuggestions: results.length,
        results,
        errors,
        executionTime
      };

    } catch (error) {
      logger.error('Smart deduplication failed:', error);
      errors.push(error instanceof Error ? error.message : 'Unknown error');

      return {
        toolName: this.name,
        totalContacts: contacts.length,
        processedContacts: 0,
        totalSuggestions: 0,
        results: [],
        errors,
        executionTime: Date.now() - startTime
      };
    }
  }
}
