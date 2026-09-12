import type { GuardConfig } from './middleware/middleware.js';

/** Model labels (case insensitive, optional BIOES prefix) to masking token types. */
export type PiiLabelMappings = Record<string, string | null>;

/** Define an application-owned guard.config.ts and pass it to both public APIs. */
export function defineGuardConfig(config: GuardConfig): GuardConfig {
  return config;
}

export function resolveGuardModels(config?: GuardConfig) {
  const mode = config?.pii?.mode ?? 'ner';
  return {
    extractor: config?.models?.extractor ?? 'Xenova/all-MiniLM-L6-v2',
    mode,
    pii: config?.pii?.model ?? (mode === 'ner' ? 'Xenova/bert-base-NER' : 'openai/privacy-filter'),
  };
}
