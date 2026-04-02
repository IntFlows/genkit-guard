import { ModelSingleton } from './util/singleton.js';

export { intentGuard, piiGuard  } from './middleware/middleware.js';
export * from './core/types.js';

/**
 * Pre-load the model to avoid cold-start delay on first user request.
 */
export async function initGuard() {
  console.log('[Guard] Loading local models...');
  await Promise.all([
    ModelSingleton.getExtractor(),
    ModelSingleton.getNER()
  ]);
  console.log('[Guard] Models loaded');
}