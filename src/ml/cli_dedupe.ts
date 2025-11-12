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
