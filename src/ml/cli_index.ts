import { buildIndex } from './api';

const jsonPath = process.argv[2]; // optional fallback JSON
buildIndex(jsonPath).then(() => {
  console.log('Indexed embeddings.');
}).catch(e => {
  console.error('Indexing failed:', e?.message || e);
  process.exit(1);
});
