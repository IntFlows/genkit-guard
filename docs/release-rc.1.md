# v1.0.0-rc.1 release candidate

Prepared locally on 2 November 2026; not yet published or tagged.

The candidate freezes root runtime exports, configuration defaults, decision schema
string version `"1"` and existing infrastructure error codes. The root export
inventory and factory aliases have a regression check. Internal dist paths remain
unsupported imports. API changes after this candidate need explicit review.

Migration: remove `intent.allowedIntent`; list allowed descriptions in
`intent.semantic.intents`. Omit deprecated `intent.mode` (only `"semantic"`) and
`pii.reversible` (only `true`). Restoration is always enabled. Streaming is
rejected before provider execution; use non-streaming generation. Negative intent
scores retain their actual value, empty intent sets block, and non-finite model
similarities fail with sanitized `MODEL_UNAVAILABLE`.

Redis/audit/model failures stop at their documented boundary. Errors after tool
execution do not roll back effects, and tools are never automatically retried by
guard. Use application idempotency for retries. Redis TTL expires whole hashes
after inactivity, not individual entries; continuous writes can retain the token
index indefinitely. The default memory vault has no retention bound.

The user-selected local acceptance target is concurrency 10 and generation p95
<=9 seconds. Historical concurrency-50 failures are retained as stress evidence.
The 30-minute target phase completed 799 conversations without errors, with p95 7.89 seconds. Median RSS increased from 2,249 to 3,107 MiB, failing the proposed relative-growth criterion. The user accepted this measured footprint as an RC limitation on 2 November 2026; long-term memory stability is still required before stable v1. Raw failed memory results remain intact. No universal latency or live-Gemini claim is made. See [benchmarks](./benchmarks.md)
for artifact identities, hardware, method and raw results.

Direct/shared library and unclassified audit findings block release. Genkit-only
inherited findings are recorded separately under the user's release-policy
decision; their presence alone is not a guard-owned release blocker. A clean
library-only graph does not clear an application's complete dependency graph.

See [readiness](./rc.1-readiness.md) for exact validation status. Publication uses
`npm publish --tag rc --access public` only after required validation completes.
Stable v1 follows the accepted 24-hour production soak without release blockers.
