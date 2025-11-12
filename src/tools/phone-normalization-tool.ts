import { parsePhoneNumber, isValidPhoneNumber, CountryCode } from 'libphonenumber-js';
import { BaseTool, ToolSuggestion, SuggestionRationale } from '../types/tools';
import { Contact, ContactPhoneNumber } from '../types/contactsplus';
import { logger } from '../utils/logger';

interface PhoneNormalizationResult {
  isValid: boolean;
  normalizedNumber?: string;
  detectedCountry?: CountryCode;
  format: 'international' | 'national' | 'e164';
  confidence: number;
  issues: string[];
  originalFormat?: string;
}

export class PhoneNormalizationTool extends BaseTool {
  readonly name = 'Phone Number Normalization';
  readonly description = 'Normalizes phone numbers to international format with intelligent country detection';
  readonly category = 'normalization' as const;
  readonly version = '1.0.0';

  private readonly US_PREFIXES = ['001', '01', '1', '+1'];
  private readonly DEFAULT_COUNTRY: CountryCode = 'US';

  async analyze(contact: Contact): Promise<ToolSuggestion[]> {
    const suggestions: ToolSuggestion[] = [];

    if (!contact.contactData?.phoneNumbers) {
      return suggestions;
    }

    for (let i = 0; i < contact.contactData.phoneNumbers.length; i++) {
      const phoneNumber = contact.contactData.phoneNumbers[i];
      if (!phoneNumber.value) continue;

      try {
        const result = await this.analyzePhoneNumber(phoneNumber.value);
        
        if (result.normalizedNumber && result.normalizedNumber !== phoneNumber.value) {
          const suggestion = this.createSuggestion(
            contact.contactId,
            `phoneNumbers[${i}].value`,
            phoneNumber.value,
            result.normalizedNumber,
            this.createRationale(result, phoneNumber.value)
          );
          
          suggestions.push(suggestion);
        }
      } catch (error) {
        logger.error(`Failed to analyze phone number ${phoneNumber.value}:`, error);
      }
    }

    return suggestions;
  }

  private async analyzePhoneNumber(phoneNumber: string): Promise<PhoneNormalizationResult> {
    const cleanNumber = this.cleanPhoneNumber(phoneNumber);
    const issues: string[] = [];

    // Try to parse as-is first
    let bestResult = this.tryParsePhoneNumber(cleanNumber);
    
    // If parsing failed or we got low confidence, try different strategies
    if (!bestResult.isValid || bestResult.confidence < 0.8) {
      const strategies = [
        () => this.tryAs10DigitUS(cleanNumber),      // Try US first for 10-digit numbers
        () => this.tryWithUSPrefix(cleanNumber),     // Then US with prefix
        () => this.tryWithInternationalPrefix(cleanNumber), // International +
        () => this.tryWithCountryDetection(cleanNumber),    // Country detection last
      ];

      for (const strategy of strategies) {
        const result = strategy();
        if (result.isValid && result.confidence > bestResult.confidence) {
          bestResult = result;
        }
      }
    }

    // Final validation and formatting
    if (bestResult.isValid && bestResult.normalizedNumber) {
      bestResult = this.finalizeNormalization(bestResult);
    }

    return bestResult;
  }

  private cleanPhoneNumber(phoneNumber: string): string {
    // Remove common formatting characters but preserve + at the beginning
    return phoneNumber
      .replace(/[\s\-\(\)\[\]\.]/g, '')  // Remove spaces, dashes, parentheses, brackets, dots
      .replace(/^(\+)(.*)/, '$1$2')      // Preserve + prefix
      .trim();
  }

  private tryParsePhoneNumber(
    phoneNumber: string, 
    defaultCountry?: CountryCode
  ): PhoneNormalizationResult {
    try {
      const parsed = parsePhoneNumber(phoneNumber, defaultCountry);
      
      if (parsed && parsed.isValid()) {
        return {
          isValid: true,
          normalizedNumber: parsed.formatInternational(),
          detectedCountry: parsed.country,
          format: 'international',
          confidence: this.calculateConfidence(phoneNumber, parsed),
          issues: [],
          originalFormat: phoneNumber,
        };
      }
    } catch (error) {
      // Parsing failed
    }

    return {
      isValid: false,
      confidence: 0,
      issues: ['Could not parse as valid phone number'],
      format: 'international',
      originalFormat: phoneNumber,
    };
  }

  private tryWithUSPrefix(phoneNumber: string): PhoneNormalizationResult {
    // Check if this looks like a US number that should get +1
    const hasUSPrefix = this.US_PREFIXES.some(prefix => 
      phoneNumber.startsWith(prefix)
    );

    if (hasUSPrefix) {
      // Already has US prefix, try parsing with US default
      return this.tryParsePhoneNumber(phoneNumber, 'US');
    }

    // Check if it's a 10-digit number that could be US
    if (this.isLikely10DigitUS(phoneNumber)) {
      const withUS = '+1' + phoneNumber;
      const result = this.tryParsePhoneNumber(withUS, 'US');
      if (result.isValid) {
        result.issues = [`Added +1 prefix for 10-digit US number`];
        result.confidence = Math.min(result.confidence, 0.9); // Slight confidence reduction for assumption
      }
      return result;
    }

    return {
      isValid: false,
      confidence: 0,
      issues: ['Not a US number pattern'],
      format: 'international',
      originalFormat: phoneNumber,
    };
  }

  private tryWithInternationalPrefix(phoneNumber: string): PhoneNormalizationResult {
    // If it doesn't start with +, try adding it
    if (!phoneNumber.startsWith('+')) {
      const withPlus = '+' + phoneNumber;
      const result = this.tryParsePhoneNumber(withPlus);
      if (result.isValid) {
        result.issues = [`Added + prefix for international number`];
        result.confidence = Math.min(result.confidence, 0.85); // Slight confidence reduction
      }
      return result;
    }

    return {
      isValid: false,
      confidence: 0,
      issues: ['Already has + prefix'],
      format: 'international',
      originalFormat: phoneNumber,
    };
  }

  private tryWithCountryDetection(phoneNumber: string): PhoneNormalizationResult {
    // Try common country codes if the number looks international
    // Order matters - try US first for ambiguous cases
    const commonCountries: CountryCode[] = ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'MX', 'BR', 'IN', 'CN'];
    
    let bestResult: PhoneNormalizationResult = {
      isValid: false,
      confidence: 0,
      issues: ['No valid country detected'],
      format: 'international',
      originalFormat: phoneNumber,
    };

    for (const country of commonCountries) {
      const result = this.tryParsePhoneNumber(phoneNumber, country);
      if (result.isValid) {
        // Boost confidence for US if it looks like a US number
        let adjustedConfidence = result.confidence;
        if (country === 'US' && this.isLikely10DigitUS(phoneNumber.replace(/\D/g, ''))) {
          adjustedConfidence += 0.2;
        }
        
        if (adjustedConfidence > bestResult.confidence) {
          result.issues = [`Detected as ${country} number`];
          result.confidence = Math.min(adjustedConfidence, 0.9); // Cap at 90% for detection
          bestResult = result;
        }
      }
    }

    return bestResult;
  }

  private tryAs10DigitUS(phoneNumber: string): PhoneNormalizationResult {
    const cleanedNumber = phoneNumber.replace(/\D/g, '');
    
    // Check if it's exactly 10 digits and looks like US format
    if (this.isLikely10DigitUS(cleanedNumber)) {
      const withUS = '+1' + cleanedNumber;
      const result = this.tryParsePhoneNumber(withUS, 'US');
      if (result.isValid) {
        result.issues = [`Added +1 prefix for 10-digit US number`];
        result.confidence = 0.9; // High confidence for US 10-digit
      }
      return result;
    }

    return {
      isValid: false,
      confidence: 0,
      issues: ['Not a 10-digit US number format'],
      format: 'international',
      originalFormat: phoneNumber,
    };
  }

  private isLikely10DigitUS(phoneNumber: string): boolean {
    // Check if it's exactly 10 digits and follows US pattern
    if (phoneNumber.length !== 10 || !/^\d{10}$/.test(phoneNumber)) {
      return false;
    }

    const areaCode = phoneNumber.substring(0, 3);
    const exchange = phoneNumber.substring(3, 6);

    // Basic US number validation
    // Area code can't start with 0 or 1
    // Exchange can't start with 0 or 1
    const validAreaCode = !/^[01]/.test(areaCode);
    const validExchange = !/^[01]/.test(exchange);
    
    // Known US area codes (sample of common ones)
    const commonUSAreaCodes = ['415', '212', '310', '312', '713', '214', '404', '617', '206', '602'];
    const hasKnownAreaCode = commonUSAreaCodes.includes(areaCode);
    
    // If it has a known US area code, boost confidence
    // If 555 (test number), still treat as US but lower confidence
    return validAreaCode && validExchange && (hasKnownAreaCode || areaCode === '555');
  }

  private isExactly10DigitsUSFormat(phoneNumber: string): boolean {
    return phoneNumber.length === 10 && 
           /^\d{10}$/.test(phoneNumber) &&
           this.isLikely10DigitUS(phoneNumber);
  }

  private calculateConfidence(original: string, parsed: any): number {
    let confidence = 0.8; // Base confidence

    // Higher confidence if it was already in international format
    if (original.startsWith('+')) {
      confidence += 0.1;
    }

    // Higher confidence if country was clearly indicated
    if (parsed.country) {
      confidence += 0.05;
    }

    // Lower confidence if we had to make assumptions
    if (!original.startsWith('+') && !this.US_PREFIXES.some(p => original.startsWith(p))) {
      confidence -= 0.1;
    }

    return Math.min(Math.max(confidence, 0), 1);
  }

  private finalizeNormalization(result: PhoneNormalizationResult): PhoneNormalizationResult {
    if (result.normalizedNumber) {
      // Ensure consistent international format
      try {
        const parsed = parsePhoneNumber(result.normalizedNumber);
        if (parsed && parsed.isValid()) {
          result.normalizedNumber = parsed.formatInternational();
          result.detectedCountry = parsed.country;
        }
      } catch (error) {
        // Keep original if re-parsing fails
      }
    }

    return result;
  }

  private createRationale(
    result: PhoneNormalizationResult, 
    originalNumber: string
  ): SuggestionRationale {
    const rulesApplied: string[] = [];
    
    if (result.detectedCountry) {
      rulesApplied.push(`country_detection_${result.detectedCountry}`);
    }
    
    if (originalNumber.startsWith('+')) {
      rulesApplied.push('international_format_detected');
    } else if (this.US_PREFIXES.some(p => originalNumber.startsWith(p))) {
      rulesApplied.push('us_prefix_detected');
    } else if (this.isLikely10DigitUS(originalNumber.replace(/\D/g, ''))) {
      rulesApplied.push('us_10_digit_format');
    } else {
      rulesApplied.push('international_prefix_added');
    }

    rulesApplied.push('libphonenumber_validation');

    let reason = `Normalized phone number to international format`;
    
    if (result.issues.length > 0) {
      reason += `: ${result.issues.join(', ')}`;
    }

    if (result.detectedCountry) {
      reason += ` (detected as ${result.detectedCountry})`;
    }

    return {
      reason,
      confidence: result.confidence,
      rulesApplied,
      validationResult: {
        country: result.detectedCountry,
        format: result.format,
        wasValid: result.isValid,
      },
      additionalInfo: {
        originalFormat: result.originalFormat,
        detectedCountry: result.detectedCountry,
        formatApplied: result.format,
        issuesFound: result.issues,
      },
    };
  }
}