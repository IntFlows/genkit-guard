# v0.2.0

Scope: framework compatibility matrix, security hardening and operational error handling. This prepares the release; it does not publish it.

- Remove duplicated README sections and repair code examples. Setup guides use unpinned Genkit install commands.
- Replace the exact Genkit peer pin with a bounded compatible range and test minimum/latest targets across Node.js 22 and 24 in CI.
- Check injection patterns across all message parts, history and documents; semantic intent uses all content in the final message. Pattern detection still has false positives and false negatives, including possible matches in trusted history.
- Remove prompt copies and classifier output from guard-generated model metadata. Use cryptographic token namespaces and keep tokenizer state outside user-provided context fields.
- Mask longer PII values first, ignore empty matches, and cache tokens only after vault writes succeed.
- Sanitize guard model, audit delivery and tokenizer vault failures. Stop execution before downstream work when a required check fails; do not retry audit delivery or tools automatically.
- Update Transformers.js and compatible transitive dependencies, and track the root lockfile for reproducible CI installs.

## Dependency audit

After compatible updates, `npm audit --omit=dev` reports zero findings in this repository's production-only graph. The full audit still reports 49 moderate and 7 high findings in the Genkit dependency graph, including OpenTelemetry and UUID dependencies. Because Genkit is a development dependency here and a required peer in consuming applications, the production-only result does not clear consumers of those findings. Audit the application's complete installed graph. The suggested forced remediation would downgrade Genkit incompatibly; no forced downgrade or unverified override is applied.

## Validation

On Windows with Node.js 26, the full deterministic suite passes against the latest stable Genkit resolved from npm. Type checking, build and all 26 release regression tests also pass against the minimum peer target. The example type-check and all six README TypeScript examples pass syntax/type checks as applicable. The Node.js 22/24 CI matrix is configured but has not been run remotely as part of this local preparation. Live inference, provider calls and a real Redis server were not exercised.

## Error contract and migration

| Failure | Public result |
| --- | --- |
| Model policy rejection | Hook returns `finishReason: "blocked"`; Genkit generation raises `FAILED_PRECONDITION` with that response in its details |
| Tool policy rejection | `GuardToolError` with its decision |
| Local guard model loading/inference | `GuardModelError`, `MODEL_UNAVAILABLE`, with or without a fallback |
| Audit store/callback delivery | `GuardOperationalError`, `AUDIT_UNAVAILABLE` |
| Vault access through tokenizer/middleware | `GuardOperationalError`, `VAULT_UNAVAILABLE` |
| Provider/tool implementation | Original downstream error |

Applications should branch on class/code instead of underlying infrastructure messages. Guard-owned errors omit original messages and causes because they can contain PII. Direct calls to storage adapters retain their own errors. Configuration validation errors remain configuration errors.

Fallback runs once only when explicitly configured. Audit failure never triggers inference fallback. A persisted decision is not rolled back if its callback fails. Restoration and response checks may fail after downstream work has executed; automatic retries can duplicate side effects.

Vault scopes and tokens are not tenant authorization. Use isolated adapters/prefixes per trust boundary. Retention, encryption, request deadlines and durable approval remain application responsibilities.

## Next release

**v1.0.0-rc.1** is the next planned release candidate and the public API freeze. Freeze exports, configuration, decision schema and error codes at that candidate. Subsequent candidates focus on fixes and compatibility validation; API changes require explicit review before stable v1. SQLite vault and memory compaction are deferred.
