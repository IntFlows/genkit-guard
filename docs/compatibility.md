# Framework compatibility

Install `genkit` and your provider plugin without pinning a release in setup instructions. The supported peer range lives in `package.json`; the lockfile records the exact development baseline. New major versions require validation before widening that range.

| Integration | Coverage |
| --- | --- |
| Genkit JavaScript, legacy `guard(config)` | Model masking, restoration and blocked responses |
| Genkit JavaScript, native `guardMiddleware(config)` | Model hooks and tool interception |
| `guard(config)` with tool policies | Native allow, block, redact and approval-required execution |
| Multi-turn tools | Token recovery, PII scanning, fallback and audit persistence |
| Structured responses | Nested string restoration |
| Shared TypeScript configuration | Public `GuardConfig` accepted by native middleware and `ai.generate` |
| Node.js 22 and 24 | CI matrix, minimum peer and latest stable Genkit |
| Provider plugins | Provider-independent mock models exercise real Genkit orchestration; live provider calls are not tested |
| Streaming | No guarantee that emitted chunks are restored or withheld; use non-streaming generation for guarded output |
| Browser, edge runtimes, Genkit Go/Python/Dart | Not supported by this Node.js package |

The compatibility workflow runs on pushes, pull requests, manual dispatch and weekly. It resolves the minimum target from package metadata and the latest stable target from npm, prints the resolved version, and runs the deterministic suite. A configured CI target is not a claim that its remote run has passed; inspect the workflow results for your commit.

Run `npm ci` and `npm test` locally. To check the newest stable Genkit without changing the lockfile, run `npm install --no-save --package-lock=false genkit@latest`, then `npm test`. Restore the locked installation with `npm ci`.

Tests stub local inference to avoid model downloads and provider credentials. Real model quality, deployment-specific native inference binaries and Redis connectivity need separate environment validation; use `npm run test:redis` for a configured Redis service.
