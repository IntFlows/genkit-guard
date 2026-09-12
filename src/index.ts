export * from './core/decision.js';
import { resolveGuardModels } from './guard.config.js';
import type { GuardConfig } from './middleware/middleware.js';
export { defineGuardConfig } from './guard.config.js';
export type { PiiLabelMappings } from './guard.config.js';
import { ModelSingleton } from './util/singleton.js';

// export { intentGuard, piiGuard  } from './middleware/middleware.js';
export { guard, guardAction, guardMiddleware, guardPlugin } from './middleware/middleware.js';
export type { GuardConfig } from './middleware/middleware.js';
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

function logGuardEvent(eventName: string, body: string, attributes: Record<string, any> = {}) {
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
export async function initGuard(config?: GuardConfig) {
  logGuardEvent('guard.models.loading', 'Loading local guard models');

  const { extractor, pii, mode: piiMode } = resolveGuardModels(config);
  const tasks = [ModelSingleton.getExtractor(extractor)];
  tasks.push(piiMode === 'ner'
    ? ModelSingleton.getNER(pii)
    : ModelSingleton.getPIIClassifier(pii));

  await Promise.all(tasks);
  logGuardEvent('guard.models.loaded', 'Local guard models loaded', {
    piiMode,
  });
}
