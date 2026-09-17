import { randomUUID } from 'node:crypto';
import type { GuardConfig } from '../middleware/middleware.js';
import type { GuardDecision } from './decision.js';

export async function publishDecision(config: GuardConfig | undefined, start: number,
  fields: Pick<GuardDecision, 'guard' | 'action' | 'reasonCode'> & { confidence?: number }) {
  const decision: GuardDecision = Object.freeze({
    schemaVersion: '1', decisionId: randomUUID(), timestamp: new Date().toISOString(),
    policyVersion: config?.policyVersion ?? 'unversioned',
    latencyMs: Math.max(0, performance.now() - start), ...fields,
  });
  const warning = decision.action === 'block' || decision.action === 'approval-required';
  const level = config?.logging?.level ?? 'info';
  if ((config?.logging?.enabled ?? true) && level !== 'error' && (level !== 'warn' || warning)) {
    const record = {
      timestamp: decision.timestamp, severityText: warning ? 'WARN' : 'INFO',
      severityNumber: warning ? 13 : 9, body: 'Guard policy decision',
      resource: { attributes: { 'service.name': config?.logging?.serviceName ?? '@intflows/genkit-guard' } },
      attributes: { 'event.name': 'guard.decision', 'code.namespace': 'genkit-guard', decision },
    };
    (warning ? console.warn : console.log)(JSON.stringify(record));
  }
  // Persist before invoking the callback. Neither failure may trigger a model fallback.
  await config?.logging?.store?.append(decision);
  await config?.logging?.onDecision?.(decision);
  return decision;
}
