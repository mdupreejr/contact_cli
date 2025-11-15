import { semanticSearch } from '../ml/api';

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
