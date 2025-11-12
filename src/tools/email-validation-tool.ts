import * as EmailValidator from 'email-validator';
import { BaseTool, ToolSuggestion, SuggestionRationale } from '../types/tools';
import { Contact, ContactEmail } from '../types/contactsplus';
import { logger } from '../utils/logger';

export class EmailValidationTool extends BaseTool {
  readonly name = 'Email Validation';
  readonly description = 'Validates email addresses for RFC compliance and detects common typos in email domains';
  readonly category = 'validation' as const;
  readonly version = '1.0.0';

  // Common domain typos mapped to correct domains
  private readonly domainTypos: Record<string, string> = {
    'gmial.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'gmil.com': 'gmail.com',
    'gmal.com': 'gmail.com',
    'yahooo.com': 'yahoo.com',
    'yaho.com': 'yahoo.com',
    'yhoo.com': 'yahoo.com',
    'hotmial.com': 'hotmail.com',
    'hotmil.com': 'hotmail.com',
    'hotmai.com': 'hotmail.com',
    'outlok.com': 'outlook.com',
    'outloo.com': 'outlook.com',
    'iclou.com': 'icloud.com',
    'iclould.com': 'icloud.com',
    'icoud.com': 'icloud.com',
  };

  async analyze(contact: Contact): Promise<ToolSuggestion[]> {
    const suggestions: ToolSuggestion[] = [];

    if (!contact.contactData?.emails || contact.contactData.emails.length === 0) {
      return suggestions;
    }

    for (let i = 0; i < contact.contactData.emails.length; i++) {
      const email = contact.contactData.emails[i];
      if (!email.value) continue;

      try {
        const isValid = EmailValidator.validate(email.value);

        if (!isValid) {
          // Check for domain typos first
          const typoFix = this.checkDomainTypo(email.value);
          if (typoFix) {
            const suggestion = this.createSuggestion(
              contact.contactId,
              `emails[${i}].address`,
              email.value,
              typoFix,
              {
                reason: `Detected likely typo in email domain. Suggested correction based on common misspellings.`,
                confidence: 0.9,
                rulesApplied: ['domain-typo-detection'],
                additionalInfo: {
                  originalDomain: email.value.split('@')[1],
                  suggestedDomain: typoFix.split('@')[1]
                }
              }
            );
            suggestions.push(suggestion);
          } else {
            // Invalid email with no suggested fix
            const suggestion = this.createSuggestion(
              contact.contactId,
              `emails[${i}].address`,
              email.value,
              null, // No suggested fix, just flag as invalid
              {
                reason: `Email address is not RFC compliant. Please review and correct manually.`,
                confidence: 1.0,
                rulesApplied: ['rfc-5322-validation'],
                additionalInfo: {
                  validationIssue: 'Invalid email format'
                }
              }
            );
            suggestions.push(suggestion);
          }
        }
      } catch (error) {
        logger.error(`Failed to validate email ${email.value}:`, error);
      }
    }

    return suggestions;
  }

  /**
   * Check if the email domain is a common typo and return corrected email
   */
  private checkDomainTypo(email: string): string | null {
    const parts = email.split('@');
    if (parts.length !== 2) return null;

    const [localPart, domain] = parts;
    const lowerDomain = domain.toLowerCase();

    if (this.domainTypos[lowerDomain]) {
      return `${localPart}@${this.domainTypos[lowerDomain]}`;
    }

    return null;
  }
}
