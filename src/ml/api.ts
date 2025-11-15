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
  const { logger } = require('../utils/logger');
  const all = await listAllContacts(jsonPath);
  logger.info(`AI Deduplication analyzing ${all.length} contacts`);

  const candidatePairs = blockCandidates(all);
  logger.info(`Generated ${candidatePairs.length} candidate pairs from blocking`);

  const scoredPairs = candidatePairs.map(([a,b]) => scorePair(a,b));
  const sortedPairs = scoredPairs.sort((x,y) => y.p - x.p);

  logger.info(`Found ${sortedPairs.length} total scored pairs`);
  if (sortedPairs.length > 0) {
    logger.info(`Top similarity score: ${(sortedPairs[0].p * 100).toFixed(1)}%`);
    logger.debug(`Comparing contact "${sortedPairs[0].a.name}" with "${sortedPairs[0].b.name}": similarity = ${sortedPairs[0].p}`);
  }

  const topPairs = sortedPairs.slice(0, top);
  logger.info(`Returning top ${topPairs.length} duplicate pairs`);

  return topPairs;
}
