import { ModelSingleton } from './util/singleton.js';

// export { intentGuard, piiGuard  } from './middleware/middleware.js';
export { guard } from './middleware/middleware.js';
export * from './core/types.js';

/**
 * Pre-load the model to avoid cold-start delay on first user request.
 */
export async function initGuard(config?: any) {
  console.log('[Guard] Loading local models...');

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
  console.log('[Guard] Models loaded');
}