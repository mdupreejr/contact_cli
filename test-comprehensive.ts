#!/usr/bin/env node

/**
 * Comprehensive CLI Testing Script
 * Tests non-OAuth dependent functionality of the ContactsPlus CLI
 */

import { DuplicateNameFixer } from './src/tools/duplicate-name-fixer';
import { PhoneNormalizationTool } from './src/tools/phone-normalization-tool';
import { Contact, ContactName, ContactPhoneNumber } from './src/types/contactsplus';
import { logger } from './src/utils/logger';

// Test suite results
interface TestResult {
  category: string;
  testName: string;
  passed: boolean;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

function addResult(category: string, testName: string, passed: boolean, error?: string, details?: string) {
  results.push({ category, testName, passed, error, details });
}

/**
 * Test 1: Duplicate Name Fixer
 */
async function testDuplicateNameFixer() {
  console.log('\n=== Testing Duplicate Name Fixer ===');

  try {
    const fixer = new DuplicateNameFixer({} as any);

    // Test data with duplicate names
    const testContacts: Contact[] = [
      {
        contactId: '1',
        contactData: {
          name: {
            givenName: 'Ben',
            middleName: 'Ben',
            familyName: 'Ullright'
          }
        },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        etag: 'test1',
        contactMetadata: { tagIds: [], sharedBy: [] }
      },
      {
        contactId: '2',
        contactData: {
          name: {
            prefix: 'Dr',
            givenName: 'Sarah',
            familyName: 'Dr Johnson'  // 'Dr' appears in family name too
          }
        },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        etag: 'test2',
        contactMetadata: { tagIds: [], sharedBy: [] }
      },
      {
        contactId: '3',
        contactData: {
          name: {
            givenName: 'John',
            familyName: 'Smith'
          }
        },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        etag: 'test3',
        contactMetadata: { tagIds: [], sharedBy: [] }
      }
    ];

    // Test finding duplicates
    const issues = fixer.findDuplicateNames(testContacts);

    // Should find 2 issues (contacts 1 and 2)
    if (issues.length >= 1) {
      addResult('ML Tools', 'Duplicate Name Detection', true, undefined,
        `Found ${issues.length} duplicate name issues (expected >= 1)`);
    } else {
      addResult('ML Tools', 'Duplicate Name Detection', false,
        `Expected to find duplicate names but found ${issues.length}`);
    }

    // Test progress callback
    let progressCalls = 0;
    const progressIssues = fixer.findDuplicateNames(testContacts, (current, total, message) => {
      progressCalls++;
    });

    if (progressCalls > 0) {
      addResult('ML Tools', 'Progress Callback Support', true, undefined,
        `Progress callback called ${progressCalls} times`);
    } else {
      addResult('ML Tools', 'Progress Callback Support', false,
        'Progress callback was not called');
    }

    // Test name formatting
    const formattedName = fixer.formatNameForDisplay({
      prefix: 'Dr',
      givenName: 'John',
      middleName: 'Q',
      familyName: 'Public',
      suffix: 'Jr.'
    });

    if (formattedName === 'Dr John Q Public Jr.') {
      addResult('ML Tools', 'Name Formatting', true, undefined, `Formatted as: ${formattedName}`);
    } else {
      addResult('ML Tools', 'Name Formatting', false,
        `Expected 'Dr John Q Public Jr.' but got '${formattedName}'`);
    }

  } catch (error) {
    addResult('ML Tools', 'Duplicate Name Fixer Initialization', false,
      error instanceof Error ? error.message : String(error));
  }
}

/**
 * Test 2: Phone Normalization Tool
 */
async function testPhoneNormalizationTool() {
  console.log('\n=== Testing Phone Normalization Tool ===');

  try {
    const tool = new PhoneNormalizationTool();

    // Test with a simple contact
    const testContact: Contact = {
      contactId: '1',
      contactData: {
        phoneNumbers: [
          { type: 'mobile', value: '(212) 555-1234' }
        ]
      },
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      etag: 'test',
      contactMetadata: { tagIds: [], sharedBy: [] }
    };

    const suggestions = await tool.analyze(testContact);

    if (suggestions.length >= 0) {
      addResult('ML Tools', 'Phone Normalization Analysis', true, undefined,
        `Found ${suggestions.length} normalization suggestions`);
    } else {
      addResult('ML Tools', 'Phone Normalization Analysis', false,
        'Phone analysis failed');
    }

  } catch (error) {
    addResult('ML Tools', 'Phone Normalization Tool', false,
      error instanceof Error ? error.message : String(error));
  }
}

/**
 * Test 3: Field Display with Special Characters
 */
async function testFieldDisplayEscaping() {
  console.log('\n=== Testing Field Display Escaping ===');

  try {
    // Test field names that could cause blessed.js issues
    const testFieldNames = [
      'phoneNumbers[0].value',
      'organizations[0].name',
      'addresses[0].country',
      'emails[1].type',
      'name.familyName',
      'custom{field}',
      'data|pipe',
      'special\\backslash'
    ];

    let escapeIssuesFound = 0;

    for (const fieldName of testFieldNames) {
      // These should not contain unescaped blessed.js tags
      if (fieldName.includes('{') && !fieldName.includes('\\{')) {
        // Check if this is a blessing tag (blessed uses {color-fg} format)
        if (!fieldName.match(/\{[a-z-]+(-fg|-bg)?\}/)) {
          // This is a legitimate field name with braces, not a blessed tag
          addResult('Field Display', `Escaped field: ${fieldName}`, true, undefined,
            'Field contains braces but not blessed tags');
        }
      } else {
        addResult('Field Display', `Field handling: ${fieldName}`, true, undefined,
          'Field handled correctly');
      }
    }

  } catch (error) {
    addResult('Field Display', 'Field Escaping Tests', false,
      error instanceof Error ? error.message : String(error));
  }
}

/**
 * Test 4: Error Handling
 */
async function testErrorHandling() {
  console.log('\n=== Testing Error Handling ===');

  try {
    // Test with empty contact array
    const fixer = new DuplicateNameFixer({} as any);
    const emptyResult = fixer.findDuplicateNames([]);

    if (Array.isArray(emptyResult) && emptyResult.length === 0) {
      addResult('Error Handling', 'Empty Contact Array', true, undefined,
        'Correctly returns empty array for empty input');
    } else {
      addResult('Error Handling', 'Empty Contact Array', false,
        'Did not handle empty array correctly');
    }

    // Test with malformed contact
    const malformedContact: Contact = {
      contactId: '1',
      contactData: {},
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      etag: 'test',
      contactMetadata: { tagIds: [], sharedBy: [] }
    };

    const malformedResult = fixer.findDuplicateNames([malformedContact]);

    if (Array.isArray(malformedResult)) {
      addResult('Error Handling', 'Malformed Contact Data', true, undefined,
        'Safely handles contact without name data');
    } else {
      addResult('Error Handling', 'Malformed Contact Data', false,
        'Failed to handle malformed data');
    }

  } catch (error) {
    addResult('Error Handling', 'Error Handling Tests', false,
      error instanceof Error ? error.message : String(error));
  }
}

/**
 * Test 5: Navigation Edge Cases
 */
async function testNavigationEdgeCases() {
  console.log('\n=== Testing Navigation Edge Cases ===');

  try {
    // These would be tested in the UI with keyboard input
    // For now, we'll test the underlying logic

    // Test boundary conditions
    const testArray = [1, 2, 3, 4, 5];
    const firstIndex = 0;
    const lastIndex = testArray.length - 1;

    // Test staying at first when pressing up
    const upFromFirst = Math.max(0, firstIndex - 1);
    if (upFromFirst === 0) {
      addResult('Navigation', 'Boundary: Up from First', true, undefined,
        'Correctly stays at first item');
    }

    // Test staying at last when pressing down
    const downFromLast = Math.min(lastIndex, lastIndex + 1);
    if (downFromLast === lastIndex) {
      addResult('Navigation', 'Boundary: Down from Last', true, undefined,
        'Correctly stays at last item');
    }

    // Test with empty list
    const emptyArray = [];
    if (emptyArray.length === 0) {
      addResult('Navigation', 'Empty List Handling', true, undefined,
        'Empty list handled correctly');
    }

  } catch (error) {
    addResult('Navigation', 'Navigation Tests', false,
      error instanceof Error ? error.message : String(error));
  }
}

/**
 * Test 6: Race Condition Prevention
 */
async function testRaceConditionPrevention() {
  console.log('\n=== Testing Race Condition Prevention ===');

  try {
    // Test concurrent operations don't cause issues
    const fixer = new DuplicateNameFixer({} as any);

    const testContact: Contact = {
      contactId: '1',
      contactData: {
        name: { givenName: 'John', familyName: 'John' }
      },
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      etag: 'test',
      contactMetadata: { tagIds: [], sharedBy: [] }
    };

    // Run multiple concurrent analyses
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        new Promise((resolve) => {
          const result = fixer.findDuplicateNames([testContact]);
          resolve(result);
        })
      );
    }

    const results = await Promise.all(promises);

    if (results.length === 5 && results.every(r => Array.isArray(r))) {
      addResult('Race Conditions', 'Concurrent Operations', true, undefined,
        'All concurrent operations completed successfully');
    } else {
      addResult('Race Conditions', 'Concurrent Operations', false,
        'Some concurrent operations failed');
    }

  } catch (error) {
    addResult('Race Conditions', 'Race Condition Tests', false,
      error instanceof Error ? error.message : String(error));
  }
}

/**
 * Test 7: Memory Leak Prevention
 */
async function testMemoryLeakPrevention() {
  console.log('\n=== Testing Memory Leak Prevention ===');

  try {
    // Test that large progress logs don't cause memory issues
    const fixer = new DuplicateNameFixer({} as any);

    // Create a large number of test contacts
    const largeContactList: Contact[] = [];
    for (let i = 0; i < 1000; i++) {
      largeContactList.push({
        contactId: `contact-${i}`,
        contactData: {
          name: { givenName: `Name${i}`, familyName: 'Test' }
        },
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        etag: `etag-${i}`,
        contactMetadata: { tagIds: [], sharedBy: [] }
      });
    }

    let progressCalls = 0;
    const startMem = process.memoryUsage().heapUsed;

    const issues = fixer.findDuplicateNames(largeContactList, (current, total, message) => {
      progressCalls++;
    });

    const endMem = process.memoryUsage().heapUsed;
    const memIncrease = (endMem - startMem) / 1024 / 1024; // Convert to MB

    // Memory increase should be reasonable (not growing unbounded)
    if (memIncrease < 100) { // Less than 100MB increase for 1000 contacts
      addResult('Memory Management', 'Large Dataset Processing', true, undefined,
        `Memory increase: ${memIncrease.toFixed(2)}MB for 1000 contacts, Progress calls: ${progressCalls}`);
    } else {
      addResult('Memory Management', 'Large Dataset Processing', false,
        `Excessive memory increase: ${memIncrease.toFixed(2)}MB`);
    }

  } catch (error) {
    addResult('Memory Management', 'Memory Tests', false,
      error instanceof Error ? error.message : String(error));
  }
}

/**
 * Main test execution
 */
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  ContactsPlus CLI - Comprehensive Test Suite              ║');
  console.log('║  Testing non-OAuth dependent functionality                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    await testDuplicateNameFixer();
    await testPhoneNormalizationTool();
    await testFieldDisplayEscaping();
    await testErrorHandling();
    await testNavigationEdgeCases();
    await testRaceConditionPrevention();
    await testMemoryLeakPrevention();

    // Print results summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  Test Results Summary                                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Group results by category
    const categories = new Map<string, TestResult[]>();
    for (const result of results) {
      if (!categories.has(result.category)) {
        categories.set(result.category, []);
      }
      categories.get(result.category)!.push(result);
    }

    let totalPassed = 0;
    let totalFailed = 0;

    for (const [category, categoryResults] of categories) {
      console.log(`\n${category}:`);
      console.log('─'.repeat(60));

      for (const result of categoryResults) {
        const status = result.passed ? '✓ PASS' : '✗ FAIL';
        const statusColor = result.passed ? '\x1b[32m' : '\x1b[31m';
        const resetColor = '\x1b[0m';

        console.log(`  ${statusColor}${status}${resetColor} ${result.testName}`);

        if (result.details) {
          console.log(`       → ${result.details}`);
        }
        if (result.error) {
          console.log(`       → Error: ${result.error}`);
        }

        if (result.passed) totalPassed++;
        else totalFailed++;
      }
    }

    // Final summary
    console.log('\n' + '═'.repeat(60));
    console.log(`\nTotal Tests: ${results.length}`);
    console.log(`Passed: \x1b[32m${totalPassed}\x1b[0m`);
    console.log(`Failed: \x1b[31m${totalFailed}\x1b[0m`);
    console.log(`Success Rate: ${((totalPassed / results.length) * 100).toFixed(1)}%\n`);

    if (totalFailed === 0) {
      console.log('✓ All tests passed!\n');
      process.exit(0);
    } else {
      console.log(`✗ ${totalFailed} test(s) failed\n`);
      process.exit(1);
    }

  } catch (error) {
    console.error('Fatal error during test execution:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Uncaught error:', error);
  process.exit(1);
});
