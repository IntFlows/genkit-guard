# v0.3.0 stability plan

v0.3.0 closes reliability and release-validation gaps before the v1.0.0-rc.1 public API freeze. Keep the package at v0.2.0 while these changes are developed. Each change should address one confirmed gap, include focused verification, and update this checklist.

## 1. Storage correctness and failure behavior

- [x] Prevent expired Redis fallback values from reappearing after a later write; cover exact expiry boundaries, live TTL refresh and independent scope/index expiry.
- [x] Test partial Redis writes and expiry failures, strict versus fallback behavior, and recovery after an outage. Document what happens to values written only to memory.
- [x] Extend real Redis integration coverage to expiry and concurrent writes; add a CI job with a Redis service.
- [ ] Confirm the Redis CI job passes remotely for the release commit.
- [x] Review mitigation for partial writes and failed TTL updates before claiming reliable retention deadlines.
- [x] Review process-local vault retention and cleanup. Record remaining limitations explicitly; any new lifecycle API needs review before the API freeze.

## 2. Public API and configuration contracts

- [x] Inventory exports, defaults, decision schema and error codes; identify intentional changes before freezing them.
- [x] Verify invalid configuration fails predictably before downstream execution, including storage options and middleware variants.
- [x] Preserve sanitized guard errors and unchanged downstream errors with regression coverage.

## 3. Package and compatibility validation

- [x] Install an actual npm tarball into a clean consumer project; verify public ESM imports, declarations and a mocked Genkit generation without source-tree dependencies.
- [x] Add the tarball smoke test to CI and review the shipped file list.
- [ ] Confirm passing minimum/latest Genkit runs on Node.js 22 and 24 for the release commit. Review newer supported runtimes before expanding claims.
- [x] Review the complete consumer dependency audit; record unresolved findings and remediation decisions.
- [ ] Resolve or explicitly accept the outstanding dependency findings before release.

## 4. Operational validation and documentation

- [x] Exercise real local inference and Redis in a separate consumer app on local WSL; record versions, resource usage and outcomes. Deployment-specific validation and the RC soak remain separate.
- [ ] Verify documentation and examples against the package, including storage outage/recovery, audit failures and post-execution restoration failures.
- [x] Define a reproducible soak workload and acceptance thresholds for the RC: concurrency, latency, memory, errors and restoration correctness using synthetic PII.
- [ ] Resolve release blockers and record remaining limitations in v0.3.0 release notes.

## Release gates

Ship v0.3.0 only after the checklist is complete, required checks pass on the release commit, and there are no unresolved correctness or guard-owned data-exposure blockers. Record evidence and scope rather than treating configured CI as a passed run.

At v1.0.0-rc.1, freeze exports, configuration, decision schema and error codes, publish migration guidance, and run the agreed production soak. Release v1.0.0 after the soak meets its thresholds and no release blockers remain. SQLite vault and memory compaction stay outside this milestone.

## Evidence

On 2026-10-04, the new storage regression failed against the previous implementation because an expired value reappeared after a write. After the fix, the full `npm test` suite passed on WSL Node.js 22.22.1 with locked dependencies, including type checking, storage expiry tests and the 100-scope concurrency simulation. Remote CI and real inference remain unverified. Expired fallback hashes are removed when accessed or rewritten; this change does not add background memory cleanup.

On 2026-10-04, expanded `test:storage` and `test:redis` passed on WSL Node.js 22.22.1 with Redis 8.10.2 at localhost:6379. Deterministic tests cover failure at each of the four write/expiry commands, strict and fallback modes, retries of storage writes, and recovery without replay. Live tests cover scoped isolation, cross-turn restoration, 20 concurrent writes (including a shared scope), expiry of both hashes and writes after expiry. Tests create unique prefixes and remove only their own keys. The Redis 7 CI job is configured but has not been run remotely; its version differs from the local server.
On 2026-10-04, the scripted TTL path, live Redis TTL/partial-index checks and clean tarball consumer passed. The complete deterministic suite passed after shared configuration validation, including early rejection without local-model loading or provider execution and unchanged sanitized infrastructure errors. Package validation is now included in the compatibility CI matrix. See [API inventory](./api-v0.3.0.md), [unreleased notes](./release-4.md) and [soak protocol](./soak-validation.md). The dependency audit remains at 49 moderate and 7 high findings; review is complete, remediation/acceptance is not. Remote CI inspection failed with HTTP 401 from the configured GitHub credentials. Real inference/soak results remain pending.
Final local validation on 2026-10-04: npm test, test:config, test:redis and test:package pass on Node.js 22.22.1 with Genkit 1.42.0; Redis is 8.10.2. Genkit was already the latest stable version, so the attempted compatible update did not change dependency versions. The final audit still reports 49 moderate and 7 high findings. No claim is made for minimum-peer or Node.js 24 results on these changes.

On 2026-10-10, the separate genkit-guard-test-app installed the actual npm tarball and passed five integration checks using real MiniLM, privacy-filter q4 and Redis. Each of legacy guard, native guard with policies and native guardMiddleware made three controlled provider-boundary requests with no original synthetic PII, restored tool inputs exactly once, restored final outputs and remasked reused history. Injection and real intent rejection stopped the provider. Node.js 22.22.1, Genkit 1.42.0 and Redis 8.10.2 were used. The recorded run took 7701 ms including model loading and peaked at 2068 MiB RSS. These are smoke-test measurements, not a performance budget or soak result. See [independent workflow](./independent-testing.md) and [recorded artifact evidence](./validation/independent-2026-10-10.json).

This independent test exposed placeholder corruption when the real PII classifier labeled placeholder fragments as PII. Protecting opaque placeholders during masking fixed reused-history restoration. A focused regression and the complete deterministic suite pass after the fix. No live Gemini call was made by this automated suite; remote CI and dependency findings remain unresolved.