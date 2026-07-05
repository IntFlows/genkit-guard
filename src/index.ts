import { ModelSingleton } from './util/singleton.js';

// export { intentGuard, piiGuard  } from './middleware/middleware.js';
export { guard, guardAction, guardMiddleware, guardPlugin } from './middleware/middleware.js';
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
export async function initGuard(config?: any) {
  logGuardEvent('guard.models.loading', 'Loading local guard models');

  const extractorModel = config?.models?.extractor ?? 'Xenova/all-MiniLM-L6-v2';
  const piiModel = config?.pii?.model;
  const piiMode = config?.pii?.mode ?? 'ner';

  const tasks: Promise<any>[] = [ModelSingleton.getExtractor(extractorModel)];

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
