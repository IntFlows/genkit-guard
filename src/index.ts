import { ModelSingleton } from './util/singleton.js';

// export { intentGuard, piiGuard  } from './middleware/middleware.js';
export { guard, guardAction, guardMiddleware, guardPlugin } from './middleware/middleware.js';
export { createGuardHooks } from './middleware/middleware.js';
export type {
  GuardBlockedResponse,
  GuardConfig,
  GuardContext,
  GuardHooks,
  GuardLogSeverity,
  GuardNext,
  GuardRequest,
  GuardRunner,
  GuardScopeResolver,
} from './middleware/middleware.js';
export {
  InMemoryPiiVaultStorage,
  createPiiVaultStorage,
  createRedisPiiVaultStorage,
  defaultPiiVaultStorage,
} from './pii/storage.js';
export type {
  PiiVaultEntry,
  PiiVaultStorage,
  PiiVaultStorageAdapter,
  RedisPiiVaultClient,
  RedisPiiVaultStorageOptions,
} from './pii/storage.js';
export * from './core/types.js';

function logGuardEvent(eventName: string, body: string, attributes: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    severityText: 'INFO',
    severityNumber: 9,
    body,
    resource: {
      attributes: {
        'service.name': '@intflows/genkit-guard',
      },
    },
    attributes: {
      'event.name': eventName,
      'code.namespace': 'genkit-guard',
      ...attributes,
    },
  }));
}

/**
 * Pre-load the model to avoid cold-start delay on first user request.
 */
export interface InitGuardConfig {
  models?: { extractor?: string };
  pii?: { model?: string; mode?: 'ner' | 'classifier' };
}

export async function initGuard(config?: InitGuardConfig): Promise<void> {
  logGuardEvent('guard.models.loading', 'Loading local guard models');

  const extractorModel = config?.models?.extractor ?? 'Xenova/all-MiniLM-L6-v2';
  const piiModel = config?.pii?.model;
  const piiMode = config?.pii?.mode ?? 'ner';

  const tasks: Promise<unknown>[] = [ModelSingleton.getExtractor(extractorModel)];

  if (piiMode === 'ner') {
    tasks.push(ModelSingleton.getNER(piiModel ?? 'Xenova/bert-base-NER'));
  } else {
    tasks.push(ModelSingleton.getPIIClassifier(piiModel ?? 'openai/privacy-filter'));
  }

  await Promise.all(tasks);
  logGuardEvent('guard.models.loaded', 'Local guard models loaded', {
    piiMode,
  });
}
