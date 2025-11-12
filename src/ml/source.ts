// Tries to pull contacts from your existing API wrapper.
// Falls back to reading JSON if you pass a file on the CLI.
import type { ContactLite } from './types';
import * as fs from 'node:fs';

export async function listAllContacts(fallbackJsonPath?: string): Promise<ContactLite[]> {
  if (fallbackJsonPath && fs.existsSync(fallbackJsonPath)) {
    const raw = JSON.parse(fs.readFileSync(fallbackJsonPath, 'utf8'));
    return raw.map(normalizeAny);
  }
  let api: any = null;
  try { api = require('../api/contacts'); } catch {}
  // Try common function names
  const fn = api?.listAllContacts || api?.getAllContacts || api?.fetchAllContacts || api?.listContacts || null;
  if (!fn) throw new Error('Could not locate contacts API. Pass a JSON export path to the CLI.');
  const items = await fn.call(api);
  return items.map(normalizeAny);
}

// Best-effort normalizer across shapes
function normalizeAny(x: any): ContactLite {
  const id = String(x.id ?? x.contactId ?? x.uuid ?? x._id ?? cryptoRandom());
  const name = x.name?.full || x.displayName || [x.name?.given, x.name?.family].filter(Boolean).join(' ') || x.name || 'Unknown';
  const title = x.organization?.title || x.title || undefined;
  const company = x.organization?.name || x.company || x.org || undefined;
  const emails = arr(x.emails || x.email).map((e: any) => typeof e === 'string' ? e : (e.value || e.address || e.email)).filter(Boolean);
  const phones = arr(x.phones || x.phone).map((p: any) => typeof p === 'string' ? p : (p.value || p.number || p.phone)).filter(Boolean);
  const city = x.address?.city || x.addresses?.[0]?.city || undefined;
  const tags = arr(x.tags || x.labels).map(String);
  const notes = x.notes || x.note || '';
  return { id, name, title, company, emails, phones, city, tags, notes };
}
function arr(v: any) { return Array.isArray(v) ? v : (v ? [v] : []); }
function cryptoRandom() { return 'tmp_' + Math.random().toString(36).slice(2); }
