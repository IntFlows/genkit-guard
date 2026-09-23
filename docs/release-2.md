# v0.1.0 - Release 2

Historical scope: persistent decision logging and opt-in guard-model fallback. Current wiki documentation is maintained in `docs/wiki`; see `docs/release-3.md` for subsequent behavior changes.

Acceptance criteria:

- Persist GuardDecision v1 records through a custom append adapter or the built-in JSONL store.
- Await store delivery before callback/downstream execution and propagate delivery failures.
- Read records after reopening, serialize concurrent in-process appends, validate input and reject incomplete tails.
- Try one explicitly configured fallback after an intent/PII model loading or inference error.
- Use fallback-specific PII mode and labels; retain regex detection.
- Never use fallback to override policy rejection, audit failure or downstream failure.
- Stop when both models fail; no regex-only bypass.
- Keep no-fallback defaults and error behavior, existing tool policies and vault APIs.
- Cover native Genkit execution, persistence, concurrency, startup and runtime in tests.

Out of scope: generative-model fallback, replacing privacy-filter, AU fine-tuning, SQLite PII vault (Release 3), compaction, audit retention/rotation/encryption, timeout/circuit-breaker policies and durable multi-worker file coordination.

The package version is prepared as 0.1.0. Nothing is published by this implementation. Wiki preview: npm run wiki:publish. Publish only when ready: npm run wiki:publish -- --publish.
