const cleanco = require('cleanco');
import { BaseTool, ToolSuggestion, SuggestionRationale } from '../types/tools';
import { Contact, ContactOrganization } from '../types/contactsplus';
import { logger } from '../utils/logger';

export class CompanyNameCleaningTool extends BaseTool {
  readonly name = 'Company Name Cleaning';
  readonly description = 'Standardizes company names by removing common suffixes (Inc, Ltd, GmbH, Corporation, etc.)';
  readonly category = 'normalization' as const;
  readonly version = '1.0.0';

  async analyze(contact: Contact): Promise<ToolSuggestion[]> {
    const suggestions: ToolSuggestion[] = [];

    if (!contact.contactData?.organizations) {
      return suggestions;
    }

    for (let i = 0; i < contact.contactData.organizations.length; i++) {
      const organization = contact.contactData.organizations[i];
      if (!organization.name) continue;

      try {
        const originalName = organization.name;
        const cleanedName = cleanco.clean(originalName);

        // Only suggest if the cleaned name is actually different (ignoring case)
        // This means a suffix was removed, not just case changed
        if (cleanedName.toLowerCase() !== originalName.toLowerCase()) {
          // Preserve original capitalization by applying it to the cleaned name
          const capitalizedClean = this.preserveCapitalization(originalName, cleanedName);

          const suggestion = this.createSuggestion(
            contact.contactId,
            `organizations[${i}].name`,
            originalName,
            capitalizedClean,
            this.createRationale(originalName, capitalizedClean)
          );

          suggestions.push(suggestion);
        }
      } catch (error) {
        logger.error(`Failed to clean company name ${organization.name}:`, error);
      }
    }

    return suggestions;
  }

  private createRationale(
    originalName: string,
    cleanedName: string
  ): SuggestionRationale {
    const rulesApplied: string[] = ['suffix-removal'];

    const removedPart = originalName.replace(cleanedName, '').trim();
    const reason = `Removed suffix "${removedPart}" from company name`;

    return {
      reason,
      confidence: 1.0,
      rulesApplied,
    };
  }

  private preserveCapitalization(original: string, cleaned: string): string {
    // If original is all uppercase, return cleaned in uppercase
    if (original === original.toUpperCase()) {
      return cleaned.toUpperCase();
    }

    // If original is title case, return cleaned in title case
    if (this.isTitleCase(original)) {
      return this.toTitleCase(cleaned);
    }

    // Otherwise, just capitalize first letter
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  private isTitleCase(str: string): boolean {
    const words = str.split(' ');
    return words.every(word => {
      if (word.length === 0) return true;
      return word.charAt(0) === word.charAt(0).toUpperCase();
    });
  }

  private toTitleCase(str: string): string {
    return str.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
}
