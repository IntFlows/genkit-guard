export type GuardAction = 'allow' | 'block' | 'redact' | 'approval-required';
export type GuardReasonCode =
  | 'INJECTION_PATTERN' | 'INJECTION_CLEAR' | 'INTENT_ALLOWED' | 'INTENT_REJECTED'
  | 'PII_DETECTED' | 'PII_CLEAR' | 'TOOL_ALLOWED' | 'TOOL_BLOCKED'
  | 'TOOL_REDACTED' | 'TOOL_APPROVAL_REQUIRED' | 'TOOL_APPROVED'
  | 'TOOL_APPROVAL_DENIED' | 'TOOL_POLICY_ERROR'
  | 'MODEL_FALLBACK_USED' | 'MODEL_UNAVAILABLE';

/** Content-free audit contract. Version independently of the npm package. */
export interface GuardDecision {
  schemaVersion: '1';
  decisionId: string;
  timestamp: string;
  guard: 'injection' | 'intent' | 'pii' | 'tool';
  policyVersion: string;
  action: GuardAction;
  reasonCode: GuardReasonCode;
  latencyMs: number;
  confidence?: number;
}

export interface ToolPolicyContext {
  toolName: string;
  /** A copy of the restored arguments. Never included in GuardDecision events. */
  input: unknown;
  /** Trusted application context supplied by Genkit, not model arguments. */
  context: unknown;
}
export interface ToolGuardConfig {
  /** Default allow preserves existing behavior. Use block for an allowlist. */
  defaultAction?: GuardAction;
  rules?: Record<string, GuardAction>;
  /** Called only for approval-required rules; only literal true authorizes execution. */
  approve?: (call: ToolPolicyContext) => boolean | Promise<boolean>;
}

/** Thrown before tool execution for blocked, pending, denied or failed policies. */
export class GuardToolError extends Error {
  constructor(public readonly decision: GuardDecision) {
    super(`Tool execution stopped: ${decision.reasonCode}`);
    this.name = 'GuardToolError';
  }
}
