#!/usr/bin/env node

const fs = require('fs');

const testContacts = [
  {
    contactId: 'test-001',
    contactData: {
      name: { givenName: 'Alice', familyName: 'Johnson' },
      emails: [{ type: 'work', value: 'alice.johnson@techcorp.com' }],
      phoneNumbers: [{ type: 'mobile', value: '+1-555-0101' }],
      organizations: [{ name: 'Tech Corp Inc.', title: 'Senior Engineer' }]
    },
    contactMetadata: {}
  },
  {
    contactId: 'test-002',
    contactData: {
      name: { givenName: 'Bob', familyName: 'Smith' },
      emails: [{ type: 'personal', value: 'bob.smith@gmial.com' }], // Typo for testing
      phoneNumbers: [{ type: 'work', value: '5550102' }], // Missing prefix
      organizations: [{ name: 'Startup LLC', title: 'Product Manager' }]
    },
    contactMetadata: {}
  },
  {
    contactId: 'test-003',
    contactData: {
      name: { givenName: 'Alice', familyName: 'Johnson' }, // Duplicate
      emails: [{ type: 'work', value: 'a.johnson@techcorp.com' }],
      phoneNumbers: [{ type: 'mobile', value: '+1-555-0101' }],
      organizations: [{ name: 'Tech Corp', title: 'Senior Software Engineer' }]
    },
    contactMetadata: {}
  }
];

const filename = process.argv[2] || 'test-data.json';
fs.writeFileSync(filename, JSON.stringify(testContacts, null, 2));
console.log(`✅ Generated ${testContacts.length} test contacts in ${filename}`);
console.log(`\nTo use:`);
console.log(`  1. Add to .env: CONTACTS_JSON_FILE=${filename}`);
console.log(`  2. Add to .env: READONLY_MODE=true`);
console.log(`  3. Run: npm start`);
