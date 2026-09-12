import { defineGuardConfig } from './src/index.js';

// In a consuming application, import defineGuardConfig from @intflows/genkit-guard.
// Import this object and pass it to both initGuard(config) and guard(config).
export default defineGuardConfig({
  models: { extractor: 'Xenova/all-MiniLM-L6-v2' },
  intent: {
    semantic: {
      threshold: 0.7,
      intents: { integration: 'Azure Blob Storage, APIs and integration workflows' },
    },
  },
  pii: {
    mode: 'classifier',
    model: 'openai/privacy-filter',
    reversible: true,
    // For a compatible fine-tuned model:
    // labelMappings: { LABEL_0: null, LABEL_1: 'NAME' },
  },
});
