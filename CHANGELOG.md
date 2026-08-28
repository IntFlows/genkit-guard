# Changelog

## 0.1.0

- Added a typed public middleware API, including request, context, hook, runner, scope resolver,
  blocked-response, logging and initialization contracts.
- Added deterministic Vitest coverage for model and tool middleware behavior.
- Added Redis vault TTL validation and opt-in in-memory runtime fallback.
- Corrected the Redis example so the client connects before guard and Genkit initialization.
- Added GitHub Actions validation on Node.js 20, 22 and 24.
