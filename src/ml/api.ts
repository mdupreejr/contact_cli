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
