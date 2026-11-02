# RC soak validation protocol

Run on the deployment hardware with the release-candidate tarball, pinned application dependencies, intended Redis deployment, default classifier (or each explicitly supported alternative), and synthetic PII only. Record OS, Node, Genkit, model IDs/weights, Redis version/persistence settings, concurrency and hardware. Never infer model quality from mocked tests.

1. Warm up local inference and connections, then record five minutes of baseline memory and latency.
2. Run 30 minutes of non-streaming generations at each of concurrency 1, 10 and 50. Include email masking/restoration, repeated sessions, unique request scopes, multi-turn tool payloads, injection rejections and structured output. Use Redis TTL and disable memory fallback for the retention baseline.
3. Repeat the deployment's chosen fallback configuration separately. Exercise Redis loss and recovery, audit-store failure and local model load/inference failure using controlled adapters. Verify that failures stop work at the documented boundary. Never retry side-effecting tools automatically.
4. Capture p50/p95/p99 latency, throughput, error counts, process memory and Redis key counts/TTL. Inspect generated model/tool inputs as synthetic test data to verify masking, and final outputs for restoration. Include TTL expiration after the workload stops.

Proposed RC acceptance gates (record approval of any deployment-specific changes before running): zero unexpected errors in healthy runs; zero cross-request token collisions or incorrect restoration; zero original tested PII reaching the mock provider before masking; all injected infrastructure failures have the documented class/code and execution boundary; all newly written TTL keys have an expiry and expire after inactivity; no steadily increasing process memory after warm-up (final five-minute median no more than baseline plus the larger of 50 MiB or 10%). Record a numerical p95 latency budget for the deployment before the run and require it to pass; no universal hardware-independent latency claim is made.

A 30-minute pass is an initial validation, not evidence for the full RC. Before stable v1, repeat the accepted representative workload for 24 hours and compare the same metrics. Decide on process-local fallback capacity/cleanup mitigation before accepting workloads with unbounded unique scopes. The default memory vault cannot pass TTL-retention criteria and must not be described as expiring.

## Recorded results

The historical v0.3.0 run completed with failed stress/memory gates. The rc.1 concurrency-10 run completed with p95 7.89 seconds, zero errors and successful expiry. Its numeric memory check failed and remains recorded; the user accepted that specific measured footprint as an RC limitation. See [benchmarks](./benchmarks.md) and [RC acceptance](./validation/rc-2026-11-02/rc-acceptance.json). No 24-hour production acceptance has been recorded.

## RC deployment acceptance revision — 2 November 2026

The user selected **concurrency 10** and a **9,000 ms generation p95** limit for
this RC deployment target. Concurrency 50 remains a failed, documented stress
experiment; it is not a release acceptance target or a supported performance
claim. This changes the latency/load target only: masking/restoration correctness,
zero unexpected healthy-run errors, expiry and the original RSS limit remain.

The fresh candidate runner is `scripts/soak-release.mjs` in the independent app:
two full warm-up rounds at target concurrency, five minutes of representative
loaded baseline, then 30 minutes at concurrency 10, followed by inactivity expiry.
It records Redis connection/operation error classes and codes without payloads,
and wall/monotonic clock skew; interrupted runs cannot pass. The short smoke
variant verifies the harness but cannot establish a stable memory baseline.
The 24-hour representative production workload remains required before stable v1.

On 2 November 2026 the user accepted the reviewed rc.1 run's 2,249 -> 3,107 MiB
median RSS as a documented RC limitation. The original relative-memory result
remains failed; this is a specific release decision, not a blanket waiver for
future regressions. Stable v1 still requires long-term memory validation.
