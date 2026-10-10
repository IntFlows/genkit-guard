# v0.3.0 release notes (unreleased)

The package remains v0.2.0 until the stability checklist passes. These notes describe changes prepared for v0.3.0.

## Redis retention

TTL-enabled writes use one script per hash to combine HSET and EXPIRE. The script checks command permissions before writing. A network failure between client commands can no longer leave a newly written hash without its requested TTL. Scope and token-index writes remain separate; strict errors or a memory fallback do not imply rollback. A reply lost after script execution is an ambiguous completed write. Server persistence and crash recovery remain deployment responsibilities.

**Migration:** TTL requires Redis 7 or newer and an `eval(script, { keys, arguments })` client method. Node-redis clients expose this signature. For ioredis/custom clients, provide an adapter, for example:

```ts
const client = {
  hget: redis.hget.bind(redis),
  hset: redis.hset.bind(redis),
  hgetall: redis.hgetall.bind(redis),
  eval: (script: string, { keys, arguments: args }: { keys: string[]; arguments: string[] }) =>
    redis.eval(script, keys.length, ...keys, ...args)
};
```

Non-TTL adapters retain their HSET path. TTL is limited to positive integer seconds up to 2147483647. Redis credentials need EVAL, HSET and EXPIRE for the configured keys as well as the read commands. Each script uses one key, so this change does not introduce a multi-key cluster-slot requirement; Redis Cluster itself has not been validated.

Existing keys left without TTL by previous versions need separate inspection. No migration deletes or rewrites deployed data automatically.

The fallback mirror removes expired hashes before writes refresh their TTL, preventing expired data from reappearing. Redis reads after recovery remain authoritative, including misses. Memory-only writes are not replayed.

## Package validation

The published file allowlist now includes only the model-download script, built code, package metadata, README and license. Development test scripts are excluded. `npm run test:package` builds and packs the project, installs that tarball into a separate temporary consumer, verifies public ESM imports and TypeScript declarations, and exercises Genkit blocking with a mock provider through legacy and native middleware. It uses the Genkit version selected in the current test installation. It does not verify real inference or permitted model execution.

## Retention review

The public default in-memory vault retains values for the process lifetime. It is suitable only when that retention policy is acceptable; applications needing expiry should configure Redis TTL or a custom storage adapter with retention controls. Reading entries for an unknown scope no longer creates an empty scope. The Redis fallback has lazy expiry and no background cleanup or bounded capacity; avoid unbounded unique scopes in long-lived processes with fallback enabled. No lifecycle methods are added to the public API in this change.

## Validation and remaining gates

See [the stability checklist](./stability-v0.3.0.md) for recorded evidence and remaining work. Configured CI is not a passed remote run. Real-model validation, complete configuration review and release-commit compatibility results remain required.

## Configuration validation and API review

Known settings are validated before loading guard models or calling a provider. `defineGuardConfig` and `guard` reject malformed fields with TypeError; `initGuard` rejects its promise. Native middleware uses the same schema through Genkit and hook creation. This moves invalid actions/labels and malformed callbacks/adapters from execution errors to configuration errors. Model IDs must be nonempty; semantic thresholds are finite in [-1, 1]. Infrastructure error codes and decision schema v1 remain unchanged.

The [API inventory](./api-v0.3.0.md) records exports, defaults, legacy fields and decisions to resolve before the RC. The [soak protocol](./soak-validation.md) defines workloads and acceptance criteria; it has not yet been run.

## Dependency review

On 2026-10-04, the complete locked installation audit reported 49 moderate and 7 high findings, with zero critical findings. High-severity paths include Genkit/core/firebase/google-cloud and OpenTelemetry core/sdk-node/sdk-trace-node. Some advisory recommendations propose genkit 0.5.17, an incompatible downgrade below the supported peer range; no forced downgrade or unverified override is applied. Consumer installations include the required Genkit peer, so a production-only library audit cannot clear the consumer graph. These unresolved findings remain a release-review gate.
## Real-model integration and placeholder preservation

The independent consumer app tests a packed library with actual MiniLM/privacy-filter inference and Redis, capturing immutable request snapshots at a controlled Genkit provider boundary. Five checks pass, including three middleware variants, tool loops, reused history, injection blocking and semantic rejection. See [independent testing](./independent-testing.md) for commands and evidence. This does not imply live Gemini compatibility or a completed soak.

Real inference exposed a restoration bug: classifier matches could replace an existing placeholder, or part of its namespace, with another token. Masking now preserves recognized opaque placeholders while masking matching values outside them. This also protects newly created placeholders from later matches in the same operation. Existing conversation history already containing corrupted placeholders should be restarted; this fix does not repair corrupted historical strings.