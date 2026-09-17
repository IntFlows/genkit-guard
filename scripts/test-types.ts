import { guard, createRedisPiiVaultStorage, type RedisPiiVaultClient } from '../src/index.js';

const redis: RedisPiiVaultClient = {
  async hGet() {
    return undefined;
  },
  async hSet() {},
  async hGetAll() {
    return {};
  },
};

guard({
  pii: {
    reversible: true,
    vault: {
      storage: createRedisPiiVaultStorage(redis),
      scopeId: (req: any, ctx: any) => ctx?.auth?.sessionId ?? req?.metadata?.requestId,
    },
  },
});

import { defineGuardConfig, initGuard, type GuardConfig } from '../src/index.js';
const shared = defineGuardConfig({
  models: { extractor: 'custom/intent' },
  pii: { model: 'custom/pii', mode: 'classifier', labelMappings: { LABEL_0: null, LABEL_1: 'NAME' } },
});
guard(shared);
void initGuard(shared);
const legacy: GuardConfig = { models: { extractor: 'legacy/intent' }, pii: { model: 'legacy/pii' } };
guard(legacy);
void initGuard(legacy);

import type { GuardDecision } from '../src/index.js';
const release1 = defineGuardConfig({
  policyVersion: 'release-1',
  tools: {
    defaultAction: 'block',
    rules: { lookup: 'allow', sendEmail: 'approval-required', summarize: 'redact' },
    approve: async ({ toolName, input, context }) => {
      const call: unknown[] = [toolName, input, context];
      return call.length === 0;
    },
  },
  logging: { onDecision: async (decision: GuardDecision) => { console.log(decision.reasonCode); } },
});
guard(release1);

// Legacy direct invocation remains typed for configurations without tool policies.
void guard()({ prompt: 'test' }, async (request: unknown) => request);
void guard({ pii: { mode: 'ner' } })({ prompt: 'test' }, async (request: unknown) => request);

import { createJsonlDecisionStore, createGuardDecisionStore, GuardModelError } from '../src/index.js';
const nextVersion = defineGuardConfig({
  models: { extractorFallback: 'backup/intent' },
  pii: { mode: 'classifier', fallback: { model: 'backup/pii', mode: 'ner', labelMappings: { PER: 'NAME' } } },
  logging: { store: createJsonlDecisionStore('./logs/decisions.jsonl') },
});
guard(nextVersion);
void initGuard(nextVersion);
createGuardDecisionStore({ append: async decision => { const version: '1' = decision.schemaVersion; } });
const unavailable: string = new GuardModelError('pii').code;
