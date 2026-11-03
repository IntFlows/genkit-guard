# Benchmarks and deployment sizing

The `1.0.0-rc.1` workload is **accepted for RC with a documented memory
limitation**, following the user's 2 November 2026 decision. The raw memory check
remains failed. These are local measurements with real local classifiers, Redis
and a controlled Genkit provider; they are not a production SLA, live-Gemini test
or PII-recall benchmark.

## RC workload and results

[Raw report](./validation/rc-2026-11-02/soak-complete.json) ·
[Samples](./validation/rc-2026-11-02/soak-samples.jsonl) ·
[RC acceptance decision](./validation/rc-2026-11-02/rc-acceptance.json)

| Measure | Recorded value |
| --- | ---: |
| Concurrent conversations | 10 |
| Reported target-phase duration, including drain/sampling | 1,809.4 seconds |
| Completed conversations | 799 |
| Unique-scope / reused-scope conversations | 403 / 396 |
| Unexpected errors | 0 |
| Successful-generation p50 | 5,358 ms |
| Successful-generation p95 | **7,889 ms** |
| Successful-generation p99 | 12,837 ms |
| Agreed p95 budget | **9,000 ms** |
| Completed conversations/s | 0.442 |
| Additional structured JSON restorations | 79 |
| Expected injection rejections before provider execution | 79 |
| Redis keys expired after inactivity | Yes |
| Maximum recorded wall/monotonic clock skew | Less than 1 ms |
| Baseline / final median process RSS | **2,249 / 3,107 MiB** |
| Original relative-memory check | **Fail; accepted RC limitation** |

Every conversation calls one synthetic metadata tool exactly once, then reuses
returned history for three follow-up generations. Workers alternate unique
scopes and reused worker scopes. Every tenth conversation adds nested JSON
restoration and a blocked injection check. Provider-boundary assertions reject
original tested synthetic emails; tool input and final output must restore the
expected values, while opaque signatures remain unchanged.

Percentiles cover successful `ai.generate` calls, including the initial tool
loop and JSON calls. Expected injection rejections are counted separately.
Throughput counts completed conversations, not generations or model tokens.
The workload is closed-loop and histories are bounded to four ordinary
generations plus the periodic JSON case; it does not model an external arrival
queue or an indefinitely growing conversation.

## Environment and artifact identity

The measured run used Node.js 22.22.1, Genkit 1.42.0, Redis 8.10.2, WSL2 Linux
6.18.33.2, an Intel Core 7 240H with 16 logical CPUs, and 15.4 GiB system memory.
Models were `Xenova/all-MiniLM-L6-v2` and `openai/privacy-filter` q4. Redis AOF was
disabled, vault TTL was 120 seconds, and memory fallback was disabled. Model
identifiers were recorded, but immutable upstream model revisions were not;
future model downloads cannot be assumed to reproduce these measurements.

Run ID: `9f14c07d-ee75-4aec-ac6a-96f6da002037`. The benchmarked archive has SHA-1
`062e6171862908bb5dcb35f26a856afbe4415d5f` and its full integrity is in the raw
report. The final archive adds README disclosure only: the [artifact
comparison](./validation/rc-2026-11-02/artifact-comparison.json) checks all other
packaged files byte-for-byte. [Final package metadata](./validation/rc-2026-11-02/final-artifact.json)
identifies the archive prepared for publication.

The measured harness created a Genkit application and registered actions per
conversation. Subsequent harness revisions use a reusable application and fixed
workers, and record allocator settings. Their short diagnostic runs are not the
799-conversation result. Re-running the current harness creates a new experiment;
do not silently substitute its lifecycle or results for this archived run.

## Memory limitation and release decision

The original criterion was final five-minute median RSS no greater than baseline
plus the larger of 50 MiB or 10%. This run failed that criterion. The user accepted
the measured footprint as a known RC limitation, not as evidence of long-term
stability. The raw report retains `passed: false` and `memoryGate: false`; the
separate release decision records `accepted-with-documented-memory-limitation`.
The exception applies only to this reviewed run and does not waive future
regressions, latency failures, incorrect restoration or unexpected errors.

The report alone does not establish the cause of the RSS increase or a hard
maximum memory requirement. Size the deployment from representative measurements.
Stable v1 still requires the accepted 24-hour production workload and long-term
memory review. No allocator option or tensor-lifetime change was added to the
library based on the exploratory component profiles.

## Stress-test scope

A prior [stress reference](./validation/rc-2026-11-02/stress-reference.json), on the
older v0.3.0 artifact, recorded concurrency-50 p95 of 28,279 ms and 50 vault errors.
It also contains a recording gap and a failed memory check. These failures are
retained to explain the concurrency-10 RC target; they are not measurements of
the current candidate and are not relabeled as passing results.
## Reproduce a new experiment

In the sibling independent app, run `npm run refresh:guard` and `npm test`, then:

```bash
SOAK_P95_MS=9000 node scripts/soak-release.mjs --smoke
SOAK_P95_MS=9000 node scripts/soak-release.mjs
```

Require cached models, Redis 7+, and the intended deployment's hardware/settings.
Use `REDIS_URL` for a dedicated test instance. Refresh installs a checksum-named
archive and checks lockfile integrity; never refresh an active soak installation.
The current runner warms target concurrency, takes a loaded baseline, runs a
30-minute phase, and checks expiry. It still reports the original numeric memory
criterion; the archived RC exception does not automatically accept another run.
See [independent testing](./independent-testing.md) for artifact and provider-boundary
checks. Live-provider latency and quality need separate validation.

## Retention constraints

The default memory vault has no TTL, capacity bound or cleanup API. Redis TTL
applies to whole hashes, not individual entries. Every write refreshes the scope
hash and shared token index. Continuous traffic can keep the token index alive
indefinitely even while inactive scope hashes expire. TTL is an inactivity
deadline, not a maximum age or storage-size bound. Monitor hash cardinality and
memory independently of key count.

Use a custom adapter with per-entry expiry/capacity controls for hard retention
bounds, or isolate and retire prefixes under application lifecycle control. The
opt-in Redis memory fallback mirrors writes, uses lazy expiry, and has no bounded
capacity or background cleanup. Recovery trusts Redis, including misses;
memory-only writes are not replayed. Scopes/tokens do not provide tenant
authorization. Applications own isolation, encryption, deadlines and idempotency.
Do not retry a completed tool merely because response restoration later fails.
