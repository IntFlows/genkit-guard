# Public API review for v0.3.0

This inventory is a review baseline, not the v1 API freeze. Only the package root is exported; internal dist paths are not supported public imports.

| Exports | Contract |
| --- | --- |
| `guard`, `guardAction` | Same factory; callable legacy middleware without tool settings, native middleware with tool settings |
| `guardMiddleware`, `guardPlugin` | Native Genkit middleware and its plugin |
| `defineGuardConfig`, `initGuard` | Validate shared settings; initGuard then preloads local models |
| `createPiiVaultStorage`, `InMemoryPiiVaultStorage`, `defaultPiiVaultStorage` | Custom adapters and process-local vaults |
| `createRedisPiiVaultStorage` | Redis adapter, with opt-in TTL and memory fallback |
| `createGuardDecisionStore`, `createJsonlDecisionStore`, `guardDecisionSchema` | Validated decision delivery; JSONL persistence supports one process |
| `GuardToolError` | Policy stop with a decision; no stable `code` property |
| `GuardModelError` | Sanitized `MODEL_UNAVAILABLE` |
| `GuardOperationalError` | Sanitized `AUDIT_UNAVAILABLE` or `VAULT_UNAVAILABLE` |

Exported types: GuardConfig, PiiLabelMappings, PiiVaultEntry, PiiVaultStorage, PiiVaultStorageAdapter, RedisPiiVaultClient, RedisPiiVaultStorageOptions, GuardDecisionStore, JsonlDecisionStore, GuardAction, GuardReasonCode, GuardDecision, ToolPolicyContext, ToolGuardConfig, IntentGuardConfig, IntentResult, PiiRule and PiiConfig. The standalone IntentGuardConfig/PiiConfig types describe legacy concepts and do not add runtime behavior to GuardConfig.

## Defaults and compatibility

Intent uses Xenova/all-MiniLM-L6-v2 and threshold 0.7. PII defaults to classifier mode with openai/privacy-filter; explicit NER defaults to Xenova/bert-base-NER. Memory storage has no automatic retention limit. Redis TTL and fallback are off unless configured. Tools default to allow unless a policy changes it. Only literal true from approval callbacks authorizes a call.

`intent.mode`, `intent.allowedIntent` and `pii.reversible` remain accepted legacy fields; current hooks use semantic intents and restore tokens regardless of reversible. Do not remove or reinterpret those fields without an explicit migration decision before the RC. GuardConfig also permits application-specific top-level fields. Validation checks known fields but does not freeze or wrap application objects; applications must not mutate active configuration concurrently.

## Decision schema v1

Required fields: schemaVersion (literal 1), decisionId, timestamp, guard, policyVersion, action, reasonCode and latencyMs. Confidence is optional. Guards are injection, intent, pii and tool; actions are allow, block, redact and approval-required. Unknown fields are stripped before persistence. Prompt and PII payloads are excluded.

Reason codes: INJECTION_PATTERN, INJECTION_CLEAR, INTENT_ALLOWED, INTENT_REJECTED, PII_DETECTED, PII_CLEAR, TOOL_ALLOWED, TOOL_BLOCKED, TOOL_REDACTED, TOOL_APPROVAL_REQUIRED, TOOL_APPROVED, TOOL_APPROVAL_DENIED, TOOL_POLICY_ERROR, MODEL_FALLBACK_USED and MODEL_UNAVAILABLE.

## Changes to review before freezing

- TTL-enabled Redis adapters need Redis 7+ and the documented EVAL signature. TTL writes are scripted per hash, not a two-hash transaction.
- Invalid known settings now fail before model loading/provider execution. defineGuardConfig and guard throw TypeError with invalid field paths; initGuard rejects. Native middleware validates through Genkit and when hooks are built. Invalid configuration is not an infrastructure failure and is not converted into GuardOperationalError.
- Semantic thresholds must be finite and in [-1, 1], matching cosine similarity. Model IDs must be nonempty. Callback and adapter methods must be callable; return values and downstream availability remain runtime checks.
- No runtime exports, decision reason codes or infrastructure error codes are added. Configuration schema declarations are shared and typed with public Genkit/Zod types to remain portable to installed consumers.

See [release notes](./release-4.md) and [compatibility](./compatibility.md) for limits, including streaming and deployment-specific inference.
