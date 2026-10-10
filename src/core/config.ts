import type { PiiVaultStorage } from '../pii/storage.js';
import type { GuardDecisionStore } from './decision-storage.js';
import { z } from 'genkit';
import type { GuardConfig } from '../middleware/middleware.js';

const callbackSchema = z.custom<(...args: any[]) => any>(value => typeof value === 'function');
const storageSchema = z.custom<PiiVaultStorage>((value: any) => value !== null &&
  ['get', 'set', 'entries'].every(method => typeof value?.[method] === 'function') &&
  (value?.getByToken === undefined || typeof value.getByToken === 'function'));
const toolActionSchema = z.enum(['allow', 'block', 'redact', 'approval-required']);
export const guardConfigSchema: z.ZodType<GuardConfig> = z.object({
  policyVersion: z.string().optional(),
  tools: z.object({
    defaultAction: toolActionSchema.optional(),
    rules: z.record(z.string(), toolActionSchema).optional(),
    approve: callbackSchema.optional(),
  }).optional(),
  intent: z.object({
    mode: z.string().optional(),
    allowedIntent: z.string().optional(),
    semantic: z.object({
      threshold: z.number().finite().min(-1).max(1).optional(),
      intents: z.record(z.string(), z.string()),
    }).optional(),
  }).optional(),
  pii: z.object({
    reversible: z.boolean().optional(),
    model: z.string().min(1).optional(),
    mode: z.enum(['ner', 'classifier']).optional(),
    fallback: z.object({
      model: z.string().min(1), mode: z.enum(['ner', 'classifier']).optional(),
      labelMappings: z.record(z.string(), z.string().regex(/^[A-Z_]+$/).nullable()).optional(),
    }).optional(),
    labelMappings: z.record(z.string(), z.string().regex(/^[A-Z_]+$/).nullable()).optional(),
    vault: z.object({
      storage: storageSchema.optional(),
      scopeId: z.union([z.string(), callbackSchema]).optional(),
    }).optional(),
  }).optional(),
  logging: z.object({
    enabled: z.boolean().optional(),
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    serviceName: z.string().optional(),
    onDecision: callbackSchema.optional(),
    store: z.custom<GuardDecisionStore>((value: any) => value !== null && typeof value?.append === 'function').optional(),
  }).optional(),
  models: z.object({
    extractor: z.string().min(1).optional(),
    extractorFallback: z.string().min(1).optional(),
  }).optional(),
}).passthrough();

/** Check known options without cloning or wrapping application-owned adapters. */
export function validateGuardConfig(config?: GuardConfig): void {
  const result = guardConfigSchema.safeParse(config === undefined ? {} : config);
  if (!result.success) {
    const paths = [...new Set(result.error.issues.map(issue => issue.path.join('.') || 'config'))];
    throw new TypeError(`Invalid guard configuration: ${paths.join(', ')}`);
  }
}
