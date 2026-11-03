# Stable v1.0.0 release checklist

rc.1 is published and its registry integrity matches the validated final archive.
Publishing a candidate was consistent with the accepted RC limitation. Stable
v1.0.0 requires the additional evidence below; an npm distribution tag does not
replace these gates. This checklist makes no new memory or performance claim.

| Gate | Current evidence | Required completion |
| --- | --- | --- |
| Main integration | Main's tree equals the v0.3.0 commit already in the candidate; merge history reconciled without file changes | Push the reconciled PR and require all checks on its final commit |
| Compatibility and package | Local Node 22/24, minimum/latest supported Genkit, Redis and packed consumer checks recorded | Passing remote `RC required checks`, including Redis 7, linked to the final commit |
| Latency and correctness | 799 conversations at concurrency 10, p95 7.89 seconds, zero errors; restoration and expiry pass | Repeat the representative workload for 24 hours with the agreed 9-second p95 limit |
| Memory stability | Median RSS grew from 2,249 to 3,107 MiB; accepted for this RC only | Investigate growth, select retention/capacity mitigation and demonstrate stable memory after warm-up in the 24-hour run |
| Operational failures | Focused Redis recovery, model, audit and restoration failure checks exist | Retain passing regression coverage and verify the intended deployment's strict/fallback configuration |
| Dependency policy | Genkit-only inherited findings are disclosed and nonblocking under the recorded decision | Fresh full/runtime audits; no direct/shared/unclassified blocking findings or audit errors |
| Public contract | Root exports, defaults, decision schema and errors inventoried; streaming rejected | Review any remaining API changes before stable, then retain contract regression checks |
| Artifact provenance | Published rc.1 integrity matches the reviewed archive | Validate the actual stable archive, record integrity, CI commit, model/runtime versions and release tag |

## Deployment scope

The accepted target is concurrency 10 on the measured deployment, with generation
p95 <=9 seconds. Concurrency 50 remains outside the performance claim. A stable
version does not promise arbitrary concurrency or hardware-independent latency.
The measured provider was controlled Genkit with real local classifiers, not a
live Gemini validation or a PII recall assessment.

Use Redis with explicit retention for sustained unique scopes. Redis TTL refreshes
whole hashes on writes, so the cross-scope token index can stay live indefinitely.
The default process-local memory vault has no expiry/capacity bound. Document and
validate the deployment's cleanup/isolation policy before accepting an unbounded
workload; RC acceptance did not waive this stable-release review.

## Execution and release

Follow the [soak protocol](./soak-validation.md), preserve raw results even when
failed, and compare process RSS, heap/external memory, Redis memory, scope/token
counts, latency, errors and restoration correctness over time. The existing
independent-app release runner performs a 30-minute phase; it must be explicitly
extended and reviewed before it can supply 24-hour evidence. A local 24-hour run
alone is not representative production acceptance without a deployment decision.

Keep the published rc.1 immutable. Source fixes after publication belong in a new
candidate version if needed. Publish future candidates with `--tag rc`; publish
stable 1.0.0 only when the gates above pass. The observed `latest` tag currently
points to rc.1; changing it requires a maintainer's explicit release decision.

See [RC readiness](./rc.1-readiness.md), [benchmarks](./benchmarks.md), and the
[publication record](./validation/rc-2026-11-02/npm-publication.json).
