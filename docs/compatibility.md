# Framework compatibility

Install Genkit and its provider plugin within the supported 1.x range; preserve exact application resolutions in a lockfile. The supported peer range lives in `package.json`; the lockfile records the exact development baseline. New major versions require validation before widening that range.

| Integration | Coverage |
| --- | --- |
| Genkit JavaScript, legacy `guard(config)` | Model masking, restoration and blocked responses |
| Genkit JavaScript, native `guardMiddleware(config)` | Model hooks and tool interception |
| `guard(config)` with tool policies | Native allow, block, redact and approval-required execution |
| Multi-turn tools | Token recovery, PII scanning, fallback and audit persistence |
| Provider protocol metadata | Preserve thought signatures, tool names and call references through masking and restoration |
| Structured responses | Nested string restoration |
| Shared TypeScript configuration | Public `GuardConfig` accepted by native middleware and `ai.generate` |
| Node.js 22 and 24 | CI matrix, minimum peer and newest version within the supported peer range |
| Provider plugins | Provider-independent mock models exercise real Genkit orchestration; live provider calls are not tested |
| Streaming | Rejected with TypeError before provider execution; use non-streaming generation |
| Browser, edge runtimes, Genkit Go/Python/Dart | Not supported by this Node.js package |

The compatibility workflow runs on pushes, pull requests, manual dispatch and weekly. It resolves the minimum target from package metadata and the newest target within the declared peer range, prints the resolved version, and runs the deterministic suite and packed consumer. The `RC required checks` aggregate requires the compatibility matrix, Redis and dependency audits to succeed. Configure that status as required in GitHub branch protection; a workflow file cannot enforce repository settings. A configured CI target is not a passed remote run; inspect results for the exact release commit.

Run `npm ci` and `npm test` locally. To check supported-latest Genkit without changing the lockfile, install the peer range from package.json (`genkit@^1.42.0` for this baseline), then run `npm test` and `npm run test:package`. Restore the locked installation with `npm ci`. Do not substitute `genkit@latest`: a new major needs separate validation.

Tests stub local inference to avoid model downloads and provider credentials. Real model quality, deployment-specific native inference binaries and Redis connectivity need separate environment validation; use `npm run test:redis` for a configured Redis service.

A separate CI job runs the real Redis suite against a Redis 7 service on Node.js 22, covering scoped isolation, cross-turn restoration, concurrent writes and TTL expiry. This job does not download models or call providers.

Each compatibility target also installs the packed tarball into a clean temporary consumer and verifies public imports, declarations and Genkit blocking without model downloads. TTL-enabled Redis adapters now require Redis 7+ and a node-redis-compatible EVAL adapter; see the [RC migration notes](./release-rc.1.md). Local Redis 8.10.2 passed; remote Redis 7 coverage remains unverified.

## Reproduce the local matrix

Use `npm run test:compatibility -- minimum` and
`npm run test:compatibility -- latest` with the intended Node runtime. For an
isolated Node 24 invocation on Linux, use
`npx --yes --package=node@24 --call "node scripts/test-compatibility-isolated.js minimum"`
and repeat with `latest`. Run cells sequentially: native ONNX installers can use
substantial temporary disk space even though inference is mocked. The helper
copies the source and wiki fixtures into a unique consumer, installs the selected
Genkit target, runs the complete suite and packed-package check, saves versions,
source provenance and exit statuses under `docs/validation/node-*/`, then removes
its temporary installation. Package installation can download native binaries;
these compatibility checks do not download model weights or call providers.


The RC audit gate classifies locked dependency ancestry. Genkit-only inherited
findings remain in the full report under the user decision of 2 November 2026.
Direct/shared library paths, unclassified paths and audit execution errors still
fail the required aggregate. It does not label the complete graph vulnerability-free.
