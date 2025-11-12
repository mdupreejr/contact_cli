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
