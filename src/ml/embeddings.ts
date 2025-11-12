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
