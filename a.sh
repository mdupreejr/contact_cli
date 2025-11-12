# from your repo root
git switch -c feat/local-ml

mkdir -p src/ml

# ---------- src/ml/types.ts ----------
cat > src/ml/types.ts <<'TS'
export type ContactLite = {
  id: string;
  name: string;
  title?: string;
  company?: string;
  emails?: string[];
  phones?: string[];
  city?: string;
  tags?: string[];
  notes?: string;
};
TS

# ---------- src/ml/embeddings.ts ----------
cat > src/ml/embeddings.ts <<'TS'
import { pipeline } from '@huggingface/transformers';

let extractor: any;
export async function embed(text: string): Promise<Float32Array> {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return out.data as Float32Array; // 384-dim
}
export function joinContactText(c: {
  name: string; title?: string; company?: string; emails?: string[]; phones?: string[];
  city?: string; tags?: string[]; notes?: string;
}) {
  return [
    c.name, c.title, c.company,
    (c.emails || []).join(' '),
    (c.phones || []).join(' '),
    c.city, (c.tags || []).join(' '),
    c.notes
  ].filter(Boolean).join('\n');
}
TS

# ---------- src/ml/vector-store.ts ----------
cat > src/ml/vector-store.ts <<'TS'
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const DB_PATH = process.env.CONTACTS_AI_DB || path.join(process.cwd(), 'data', 'ai.sqlite');

let db: Database.Database | null = null;
function ensureDir(p: string) { fs.mkdirSync(path.dirname(p), { recursive: true }); }

export function openDB(): Database.Database {
  if (db) return db;
  ensureDir(DB_PATH);
  db = new Database(DB_PATH);
  sqliteVec.load(db); // registers vec0, distance, etc.
  db.exec(`
    pragma journal_mode = wal;
    create table if not exists contact_meta (
      id text primary key,
      text text not null
    );
    create virtual table if not exists contact_vec using vec0(emb float[384]);
  `);
  return db!;
}

export function upsertEmbedding(id: string, text: string, emb: Float32Array) {
  const d = openDB();
  const tx = d.transaction(() => {
    d.prepare('insert or replace into contact_meta(id,text) values (?,?)').run(id, text);
    d.prepare(`
      insert or replace into contact_vec(rowid, emb)
      values ((select rowid from contact_meta where id = ?), ?)
    `).run(id, emb);
  });
  tx();
}

export function searchByEmbedding(emb: Float32Array, k = 20) {
  const d = openDB();
  return d.prepare(`
    select contact_meta.id as id, contact_meta.text as text, distance
    from contact_vec join contact_meta on contact_vec.rowid = contact_meta.rowid
    where emb match ? order by distance asc limit ?
  `).all(emb, k) as { id: string; text: string; distance: number }[];
}
TS

# ---------- src/ml/dedupe.ts ----------
cat > src/ml/dedupe.ts <<'TS'
import jaroW from 'jaro-winkler';
import type { ContactLite } from './types';

export type PairScore = { a: ContactLite; b: ContactLite; p: number; features: number[] };

const W = Float32Array.from([
  -4.0,  // bias
   3.0,  // nameSim
   2.5,  // emailEq
   2.0,  // phoneEq
   1.2,  // companySim
   0.8,  // cityEq
   0.6,  // emailDomainEq
]);

export function scorePair(a: ContactLite, b: ContactLite): PairScore {
  const nameSim = jaroW(a.name || '', b.name || '');
  const emailEq = intersects(a.emails, b.emails) ? 1 : 0;
  const phoneEq = intersects(a.phones, b.phones) ? 1 : 0;
  const companySim = jaroW(a.company || '', b.company || '');
  const cityEq = (a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase()) ? 1 : 0;
  const emailDomainEq = sameDomain(a.emails, b.emails) ? 1 : 0;

  const x = [1, nameSim, emailEq, phoneEq, companySim, cityEq, emailDomainEq];
  const z = x.reduce((s, v, i) => s + v * W[i], 0);
  const p = 1 / (1 + Math.exp(-z));
  return { a, b, p, features: x };
}

export function blockCandidates(all: ContactLite[]): Array<[ContactLite, ContactLite]> {
  const byDom = new Map<string, ContactLite[]>(), byP7 = new Map<string, ContactLite[]>(), byKey = new Map<string, ContactLite[]>();
  for (const c of all) {
    for (const e of (c.emails || [])) { const d = e.split('@')[1]?.toLowerCase(); if (d) push(byDom, d, c); }
    for (const p of (c.phones || [])) { const d = p.replace(/\D+/g, ''); if (d.length >= 7) push(byP7, d.slice(-7), c); }
    const n = (c.name || '').trim().split(/\s+/); const ln = (n[n.length-1]||'').toLowerCase(); const fi = (n[0]||'')[0]?.toLowerCase() || '';
    if (ln) push(byKey, fi + ln.slice(0,3), c);
  }
  return [...pairs(byDom), ...pairs(byP7), ...pairs(byKey)];
}

function pairs(m: Map<string, ContactLite[]>) {
  const out: Array<[ContactLite, ContactLite]> = [];
  for (const [, arr] of m) for (let i=0;i<arr.length;i++) for (let j=i+1;j<arr.length;j++) out.push([arr[i], arr[j]]);
  return out;
}
const intersects = (a?: string[], b?: string[]) => !!a?.length && !!b?.length && a.some(x => b?.includes(x));
const sameDomain = (a?: string[], b?: string[]) => {
  const A = new Set((a||[]).map(e => e.split('@')[1]?.toLowerCase()).filter(Boolean) as string[]);
  const B = new Set((b||[]).map(e => e.split('@')[1]?.toLowerCase()).filter(Boolean) as string[]);
  for (const d of A) if (B.has(d)) return true;
  return false;
};
const push = <T,>(m: Map<string, T[]>, k: string, v: T) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };
TS

# ---------- src/ml/source.ts ----------
cat > src/ml/source.ts <<'TS'
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
TS

# ---------- src/ml/api.ts ----------
cat > src/ml/api.ts <<'TS'
import type { ContactLite } from './types';
import { embed, joinContactText } from './embeddings';
import { upsertEmbedding, searchByEmbedding } from './vector-store';
import { blockCandidates, scorePair } from './dedupe';
import { listAllContacts } from './source';

export async function buildIndex(jsonPath?: string) {
  const contacts: ContactLite[] = await listAllContacts(jsonPath);
  for (const c of contacts) {
    const text = joinContactText(c);
    const emb = await embed(text);
    upsertEmbedding(c.id, text, emb);
  }
}

export async function semanticSearch(q: string, k = 20) {
  const qEmb = await embed(q);
  return searchByEmbedding(qEmb, k);
}

export async function dedupeSuggestions(top = 50, jsonPath?: string) {
  const all = await listAllContacts(jsonPath);
  const pairs = blockCandidates(all).map(([a,b]) => scorePair(a,b)).sort((x,y) => y.p - x.p);
  return pairs.slice(0, top);
}
TS

# ---------- src/ml/cli_index.ts ----------
cat > src/ml/cli_index.ts <<'TS'
import { buildIndex } from './api';

const jsonPath = process.argv[2]; // optional fallback JSON
buildIndex(jsonPath).then(() => {
  console.log('Indexed embeddings.');
}).catch(e => {
  console.error('Indexing failed:', e?.message || e);
  process.exit(1);
});
TS

# ---------- src/ml/cli_search.ts ----------
cat > src/ml/cli_search.ts <<'TS'
import { semanticSearch } from './api';

const q = process.argv.slice(2).join(' ');
if (!q) { console.error('usage: npm run ai:search -- "query"'); process.exit(1); }

semanticSearch(q, 20).then(rows => {
  for (const r of rows) {
    const firstLine = r.text.split('\n')[0];
    console.log(`${r.id}\t${r.distance.toFixed(4)}\t${firstLine}`);
  }
}).catch(e => {
  console.error('search failed:', e?.message || e);
  process.exit(1);
});
TS

# ---------- src/ml/cli_dedupe.ts ----------
cat > src/ml/cli_dedupe.ts <<'TS'
import { dedupeSuggestions } from './api';

const jsonPath = process.argv[2]; // optional fallback JSON
dedupeSuggestions(25, jsonPath).then(list => {
  for (const s of list) {
    console.log(`${s.p.toFixed(3)}\t${s.a.id} <> ${s.b.id}\t${s.a.name} <> ${s.b.name}`);
  }
}).catch(e => {
  console.error('dedupe failed:', e?.message || e);
  process.exit(1);
});
TS

# ---------- install deps and wire scripts ----------
npm i -S @huggingface/transformers better-sqlite3 sqlite-vec jaro-winkler
npm pkg set scripts.ai:index="ts-node src/ml/cli_index.ts"
npm pkg set scripts.ai:search="ts-node src/ml/cli_search.ts"
npm pkg set scripts.ai:dedupe="ts-node src/ml/cli_dedupe.ts"

git add -A
git commit -m "feat(ai): local embeddings + semantic search + dedupe CLI (sqlite-vec + Transformers.js)"
git push -u origin HEAD

# optional: open PR (requires GitHub CLI)
if command -v gh >/dev/null 2>&1; then
  gh pr create --fill --title "AI: local semantic search + dedupe" --body "Adds local embeddings (Transformers.js) + sqlite-vec. Commands: ai:index, ai:search, ai:dedupe."
fi
