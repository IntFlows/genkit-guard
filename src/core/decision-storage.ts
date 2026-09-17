import { open, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { GuardDecision } from './decision.js';

export interface GuardDecisionStore {
  append(decision: GuardDecision): void | Promise<void>;
}

/** Validates the v1 contract and strips unknown fields before persistence. */
export const guardDecisionSchema = z.object({
  schemaVersion: z.literal('1'),
  decisionId: z.string().min(1), timestamp: z.string().datetime(),
  guard: z.enum(['injection', 'intent', 'pii', 'tool']),
  policyVersion: z.string(),
  action: z.enum(['allow', 'block', 'redact', 'approval-required']),
  reasonCode: z.enum([
    'INJECTION_PATTERN', 'INJECTION_CLEAR', 'INTENT_ALLOWED', 'INTENT_REJECTED',
    'PII_DETECTED', 'PII_CLEAR', 'TOOL_ALLOWED', 'TOOL_BLOCKED', 'TOOL_REDACTED',
    'TOOL_APPROVAL_REQUIRED', 'TOOL_APPROVED', 'TOOL_APPROVAL_DENIED', 'TOOL_POLICY_ERROR',
    'MODEL_FALLBACK_USED', 'MODEL_UNAVAILABLE',
  ]),
  latencyMs: z.number().finite().nonnegative(), confidence: z.number().finite().optional(),
});

export function createGuardDecisionStore(adapter: GuardDecisionStore): GuardDecisionStore {
  return { append: decision => adapter.append(guardDecisionSchema.parse(decision)) };
}

// Serialize instances targeting the same resolved path within this process.
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(path: string, task: () => Promise<T>): Promise<T> {
  const result = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(task);
  queues.set(path, result);
  void result.then(() => { if (queues.get(path) === result) queues.delete(path); },
    () => { if (queues.get(path) === result) queues.delete(path); });
  return result;
}

export interface JsonlDecisionStore extends GuardDecisionStore {
  /** Read the complete file. Missing files return []; malformed records reject. */
  read(): Promise<GuardDecision[]>;
}

/** Single-process JSONL writer. Each append is flushed before it resolves. */
export function createJsonlDecisionStore(filePath: string): JsonlDecisionStore {
  const path = resolve(filePath);
  return {
    append(decision) {
      // Serialize immediately so callers cannot change a queued record.
      const line = JSON.stringify(guardDecisionSchema.parse(decision)) + '\n';
      return enqueue(path, async () => {
        await mkdir(dirname(path), { recursive: true });
        const file = await open(path, 'a+', 0o600);
        try {
          const { size } = await file.stat();
          if (size > 0) {
            const tail = Buffer.alloc(1);
            await file.read(tail, 0, 1, size - 1);
            if (tail[0] !== 10) throw new Error('Incomplete decision log record');
          }
          await file.writeFile(line, 'utf8');
          await file.sync();
        }
        finally { await file.close(); }
      });
    },
    read() {
      return enqueue(path, async () => {
        let contents: string;
        try { contents = await readFile(path, 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
        if (!contents) return [];
        if (!contents.endsWith('\n')) throw new Error('Incomplete decision log record');
        return contents.slice(0, -1).split('\n').map((line, index) => {
          try { return guardDecisionSchema.parse(JSON.parse(line)); }
          catch { throw new Error(`Invalid decision log record at line ${index + 1}`); }
        });
      });
    },
  };
}
