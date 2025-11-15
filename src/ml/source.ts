// Tries to pull contacts from your existing API wrapper.
// Falls back to reading JSON if you pass a file on the CLI.
import type { ContactLite } from './types';
import * as fs from 'node:fs';

export async function listAllContacts(fallbackJsonPath?: string): Promise<ContactLite[]> {
  if (fallbackJsonPath && fs.existsSync(fallbackJsonPath)) {
    const raw = JSON.parse(fs.readFileSync(fallbackJsonPath, 'utf8'));
    return raw.map(normalizeAny);
  }

  // Use the contact store to get all contacts from the database
  try {
    const { getContactStore, getDatabase } = require('../db');
    const db = getDatabase();
    const contactStore = getContactStore(db);
    const items = contactStore.getAllContacts();
    return items.map(normalizeAny);
  } catch (error) {
    throw new Error('Could not load contacts from database. Error: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
}

// Best-effort normalizer across shapes
function normalizeAny(x: Record<string, unknown> & { contactData?: Record<string, unknown> }): ContactLite {
  const id = String((x as Record<string, unknown>).id ?? (x as Record<string, unknown>).contactId ?? (x as Record<string, unknown>).uuid ?? (x as Record<string, unknown>)._id ?? cryptoRandom());

  // Handle ContactsPlus Contact structure
  const contactData = (x.contactData || x) as Record<string, unknown>;
  const nameObj = contactData.name as { givenName?: string; middleName?: string; familyName?: string } | undefined;
  const name = nameObj?.givenName && nameObj?.familyName
    ? [nameObj.givenName, nameObj.middleName, nameObj.familyName].filter(Boolean).join(' ')
    : (nameObj?.givenName || nameObj?.familyName || (x as Record<string, unknown>).displayName || 'Unknown') as string;

  const orgs = contactData.organizations as { title?: string; name?: string }[] | undefined;
  const title = orgs?.[0]?.title || (x as Record<string, unknown>).title as string | undefined;
  const company = orgs?.[0]?.name || (x as Record<string, unknown>).company as string | undefined;
  const emails = arr(contactData.emails || contactData.emailAddresses || (x as Record<string, unknown>).emails || (x as Record<string, unknown>).email).map((e) => typeof e === 'string' ? e : ((e as Record<string, unknown>).value || (e as Record<string, unknown>).address || (e as Record<string, unknown>).email) as string).filter(Boolean);
  const phones = arr(contactData.phoneNumbers || contactData.phones || (x as Record<string, unknown>).phones || (x as Record<string, unknown>).phone).map((p) => typeof p === 'string' ? p : ((p as Record<string, unknown>).value || (p as Record<string, unknown>).number || (p as Record<string, unknown>).phone) as string).filter(Boolean);
  const addresses = contactData.addresses as { city?: string }[] | undefined;
  const city = addresses?.[0]?.city || (x as Record<string, unknown>).city as string | undefined;
  const metadata = (x as Record<string, unknown>).contactMetadata as { tagIds?: unknown } | undefined;
  const tags = arr(metadata?.tagIds || (x as Record<string, unknown>).tags || (x as Record<string, unknown>).labels).map(String);
  const notes = (contactData.notes || (x as Record<string, unknown>).notes || (x as Record<string, unknown>).note || '') as string;
  return { id, name, title, company, emails, phones, city, tags, notes };
}
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : (v ? [v] : []); }
function cryptoRandom() { return 'tmp_' + Math.random().toString(36).slice(2); }
