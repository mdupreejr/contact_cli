import { BaseTool, ToolSuggestion } from '../types/tools';
import { Contact } from '../types/contactsplus';
import { logger } from '../utils/logger';
import { semanticSearch } from '../ml/api';

export class SemanticSearchTool extends BaseTool {
  readonly name = 'Semantic Search';
  readonly description = 'AI-powered semantic search using machine learning embeddings to find contacts by meaning, not just keywords';
  readonly category = 'enhancement';
  readonly version = '1.0.0';

  private searchQuery: string = '';

  setSearchQuery(query: string): void {
    this.searchQuery = query;
  }

  async analyze(): Promise<ToolSuggestion[]> {
    if (!this.searchQuery) {
      return [];
    }

    try {
      await semanticSearch(this.searchQuery, 20);
      return [];
    } catch (error) {
      logger.error('Semantic search failed:', error);
      return [];
    }
  }

  async performSearch(query: string): Promise<Array<{id: string; text: string; distance: number}>> {
    try {
      this.searchQuery = query;
      const results = await semanticSearch(query, 20);
      return results;
    } catch (error) {
      logger.error('Semantic search failed:', error);
      return [];
    }
  }
}
