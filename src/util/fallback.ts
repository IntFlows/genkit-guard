import type { GuardConfig } from '../middleware/middleware.js';
import { publishDecision } from '../core/audit.js';

export class GuardModelError extends Error {
  readonly code = 'MODEL_UNAVAILABLE';
  constructor(public readonly guard: 'intent' | 'pii') {
    // Do not attach underlying errors: inference errors can contain request content.
    super(`Guard ${guard} model unavailable`);
    this.name = 'GuardModelError';
  }
}

/** One fallback attempt per operation, only after a model operation throws. */
export async function runGuardModel<T>(config: GuardConfig | undefined, guard: 'intent' | 'pii',
  primary: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await primary();
  } catch {
    if (!fallback) {
      await publishDecision(config, start, { guard, action: 'block', reasonCode: 'MODEL_UNAVAILABLE' });
      throw new GuardModelError(guard);
    }
  }
  let result: T;
  try {
    result = await fallback!();
  } catch {
    await publishDecision(config, start, { guard, action: 'block', reasonCode: 'MODEL_UNAVAILABLE' });
    throw new GuardModelError(guard);
  }
  await publishDecision(config, start, { guard, action: 'allow', reasonCode: 'MODEL_FALLBACK_USED' });
  return result;
}
