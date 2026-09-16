// Optional v0.1.0 configuration example using the local repository build.
// Import this config into both initGuard(config) and guard(config).
import { defineGuardConfig, createJsonlDecisionStore } from '../../dist/index.js';

export const decisionStore = createJsonlDecisionStore('./logs/guard-decisions.jsonl');
export default defineGuardConfig({
  policyVersion: 'support-v2',
  intent: { semantic: { threshold: 0.7, intents: { support: 'Technical support for Azure Blob Storage and APIs' } } },
  pii: {
    model: 'openai/privacy-filter', mode: 'classifier',
    // Evaluate detection coverage before relying on this fallback in production.
    fallback: { model: 'Xenova/bert-base-NER', mode: 'ner', labelMappings: { PER: 'NAME' } },
  },
  tools: { defaultAction: 'block', rules: { lookupTicket: 'redact' } },
  logging: { enabled: false, store: decisionStore },
});
