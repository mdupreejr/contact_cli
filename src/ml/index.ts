/**
 * ML Module Exports
 * Central export point for machine learning functionality
 */

// Core API
export {
  buildIndex,
  dedupeSuggestions,
  semanticSearch,
} from './api';

// Deduplication (no exports from dedupe.ts)

// Training
export { trainModel } from './train';

// Embeddings (no public exports)

// Vector Store
export { closeDB } from './vector-store';

// Feedback Store
export { openFeedbackDB, closeFeedbackDB, saveFeedback, getAllFeedback } from './feedback-store';

// Types (no public type exports)

// Source (Contact transformation - no public exports)
