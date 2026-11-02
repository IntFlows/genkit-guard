# v1.0.0-rc.1 readiness

`1.0.0-rc.1` is prepared locally and **has not been published or tagged**.
Local validation is complete with the documented RC memory limitation accepted
by the user on 2 November 2026. Remote validation and publication still require
authenticated GitHub and npm access.

## Validated release scope

| Check | Result | Evidence |
| --- | --- | --- |
| Node 22.22.1 / minimum Genkit 1.42.0 | Full suite and packed consumer pass | [report](./validation/rc-2026-11-02/node-22-minimum/summary.json) |
| Node 22.22.1 / supported-latest Genkit 1.43.0 | Full suite and packed consumer pass | [report](./validation/rc-2026-11-02/node-22-latest/summary.json) |
| Node 24.22.2 / minimum Genkit 1.42.0 | Full suite and packed consumer pass | [report](./validation/rc-2026-11-02/node-24-minimum/summary.json) |
| Node 24.22.2 / supported-latest Genkit 1.43.0 | Full suite and packed consumer pass | [report](./validation/rc-2026-11-02/node-24-latest/summary.json) |
| Independent consumer | Seven real-model/Redis checks pass | [final report](./validation/rc-2026-11-02/independent-final.json) |
| Concurrency-10 workload | 799 conversations, zero errors; p95 7.89 seconds | [raw report](./validation/rc-2026-11-02/soak-complete.json) |
| JSON and injection workload coverage | 79 JSON restorations and 79 expected injection rejections | [raw report](./validation/rc-2026-11-02/soak-complete.json) |
| Redis expiry / clock continuity | Pass | [RC acceptance](./validation/rc-2026-11-02/rc-acceptance.json) |
| Memory | Original RSS criterion fails; accepted as this RC's known limitation | [recorded decision](./validation/rc-2026-11-02/rc-acceptance.json) |
| Dependency policy | Pass: zero library-only runtime findings; 65 Genkit-only findings tracked separately | [audit](./validation/rc-2026-11-02/audit-summary.json) |
| Packed final artifact | Public ESM imports, declarations and blocking pass | [artifact comparison](./validation/rc-2026-11-02/artifact-comparison.json) |
| Publish dry run | Pass, public access with `rc` tag | [package metadata](./validation/rc-2026-11-02/final-artifact.json) |

The matrix reports identify a base commit and dirty working-tree source manifest;
they are local evidence, not successful remote CI on an immutable release commit.
The benchmark used cached MiniLM/privacy-filter q4 inference, Redis 8.10.2 and a
controlled Genkit provider. No live Gemini or PII-recall claim is made.

## Memory decision and stable-v1 gate

The sustained run's baseline/final five-minute median RSS was **2,249 / 3,107 MiB**.
It failed the proposed baseline-plus-max(50 MiB, 10%) rule. The raw report remains
`passed: false`; the separate RC decision is
`accepted-with-documented-memory-limitation`. That decision applies only to the
reviewed run `9f14c07d-ee75-4aec-ac6a-96f6da002037`, not future memory regressions.
It does not establish long-term memory stability or identify a memory-leak cause.

Stable v1 still requires the representative 24-hour production soak and memory
stability review. Concurrency 50 is outside this RC's performance target; its
historical vault errors and failed latency measurements remain documented in
[benchmarks](./benchmarks.md). The user-selected RC target is concurrency 10 and
successful-generation p95 <=9 seconds, not a universal hardware-independent SLA.

## Frozen candidate contract and migration

The [API inventory](./api.md) records root exports, defaults, decision string
version `"1"`, and existing infrastructure codes. Runtime exports and factory
aliases have a regression check. Internal dist paths are unsupported imports.

- Remove `intent.allowedIntent`; list only allowed descriptions in `intent.semantic.intents`.
- Omit deprecated `intent.mode` (only `"semantic"`) and `pii.reversible` (only `true`). Restoration is always enabled; tool `redact` is the separate irreversible tool-input policy.
- Streaming is rejected with TypeError before provider execution. Use non-streaming generation.
- Intent scoring retains negative similarities; empty intent sets block. Non-finite similarity fails as sanitized `MODEL_UNAVAILABLE`.
- Active configuration is application-owned; do not mutate it concurrently with requests.

Redis disconnect/recovery, strict/fallback behavior, audit/model/vault failures,
and restoration failures after execution have focused coverage. Guard never
retries side-effecting tools automatically and cannot roll back a completed tool.
Provider/tool errors preserve identity; guard-owned infrastructure errors remain
sanitized. Applications need idempotency before retrying ambiguous operations.

## Dependency decision

The locked Genkit baseline is 1.43.0 and direct Zod is 4.6.7. The complete audit
contains **59 moderate and 6 high findings**, classified as Genkit-only inherited
paths. Under the user's 2 November decision, those findings remain visible without
alone blocking this release. Direct/shared library paths, unclassified findings
and audit execution errors still fail CI. The complete consumer graph is not
called clean. No forced Genkit downgrade or cross-major override was applied.

## Remaining remote/publication steps

1. Authenticate GitHub in WSL and configure Git credentials. Git push currently cannot obtain a username; the configured `gh` account returns HTTP 401. Anonymous public CI metadata is readable, but it cannot validate unpushed candidate changes.
2. Commit/review the final changes, push the candidate, and require passing `RC required checks` for that exact commit, including Redis 7. Configure branch protection separately if needed.
3. Authenticate npm: `npm whoami` currently returns HTTP 401. Publish the reviewed archive with `--tag rc --access public`, keeping `latest` on the stable release.
4. Record the published integrity/tag and final CI links. Neither remote publication nor a release tag has been created by this work.

The measured archive and final archive differ only in README documentation; the
[per-file comparison](./validation/rc-2026-11-02/artifact-comparison.json) verifies
that runtime code, declarations, package metadata and downloader are identical.
