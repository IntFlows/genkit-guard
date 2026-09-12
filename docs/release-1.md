# Release 1 acceptance criteria

Repository reconciliation: local package version is v0.0.14, with shared model configuration work pending publication. Tool unmasking, tool PII scanning, structured console logging and Redis adapters already existed. Public npm release status was not checked for this implementation.

Delivered scope:

- Explicit exact-name tool policy with allow, block, redact and approval-required actions.
- Default allow preserves prior behavior; default block supports allowlists.
- No execution for blocked, pending, denied or failed approval decisions.
- Irreversible redaction of detected PII in nested string arguments.
- Versioned content-free GuardDecision events shared by prompt and tool checks.
- Awaited audit callback and deterministic reason codes.
- Tests for Genkit generate integration, policy behavior, logging privacy and a local-remote wiki publisher.
- Example and wiki documentation.

Deferred: persistent decision store/fallback (Release 2), SQLite vault (Release 3), compaction and stable-v1 hardening (Release 4). Approval UI, durable approval queue, transactional rollback across parallel tools, AU model evaluation and fine-tuning are not included.

Validation: run `npm test`. Real provider/model downloads remain separate from deterministic tests.
