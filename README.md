# Genkit Guard

Keep Genkit agents on topic, mask personal data before model calls, and control which tools can run.

`@intflows/genkit-guard` adds prompt-injection checks, semantic intent scoring, reversible PII masking, and tool policies to your Genkit application. Guard models run locally through Transformers.js; your generative model can use the provider you choose.

[Try the Hugging Face Space](https://huggingface.co/spaces/intflows/genkit-guard) · [Documentation](https://github.com/IntFlows/genkit-guard/wiki) · [Examples](./example/src)

## Why use it?

Agents can access customer data and trigger real workflows. Genkit Guard gives you controls at the model and tool boundaries:

- **Check requests:** block known injection patterns and reject prompts below your intent similarity threshold.
- **Reduce PII exposure:** mask detected personal data before model calls and restore tokens in responses and tool inputs.
- **Control tools:** allow, block, redact detected PII, or require application approval before execution.
- **Audit decisions:** emit versioned decision events without raw prompts, arguments, or PII values.

Detection is based on patterns and model predictions. It can miss attacks or PII and can reject valid requests; evaluate it on your application's inputs and keep authorization in your application.

## Quick start

Install the package in your Genkit application:

```bash
npm install @intflows/genkit-guard
```

The examples below target **v0.0.14**. The package declares Genkit **1.39.0** as its peer dependency.

Create `src/guard.config.ts`:

```ts
import { defineGuardConfig } from "@intflows/genkit-guard";

export default defineGuardConfig({
  models: { extractor: "Xenova/all-MiniLM-L6-v2" },
  intent: {
    semantic: {
      threshold: 0.7,
      intents: {
        support: "Technical support for Azure Blob Storage, APIs and integrations"
      }
    }
  },
  pii: {
    mode: "classifier",
    model: "openai/privacy-filter"
  },
  tools: {
    defaultAction: "block",
    rules: { searchDocs: "allow" }
  }
});
```

Use the same configuration at startup and in your model call:

```ts
import { guard, initGuard } from "@intflows/genkit-guard";
import guardConfig from "./guard.config.js";

// ai is your configured Genkit instance.
await initGuard(guardConfig);

const response = await ai.generate({
  prompt: "How do I integrate with Azure Blob Storage?",
  use: [guard(guardConfig)]
});

if (response.finishReason === "blocked") {
  console.log("Request blocked by guard policy");
} else {
  console.log(response.text);
}
```

The tool rules apply to tools you separately register and supply to Genkit; they do not create tools. The example permits `searchDocs` and blocks other tool names. Tune intent descriptions and thresholds with representative requests.

`initGuard()` preloads the selected models and can download missing files. Models are cached under `./models` relative to your application's working directory. Download size and memory use depend on the models selected. Configuration is explicitly imported; there is no automatic file discovery.

For a new application, follow the [full setup guide](https://github.com/IntFlows/genkit-guard/wiki/6.-Full-Setup-Guide).

## What happens to a request?

```text
User request
  -> Injection-pattern check
  -> Semantic intent check
  -> PII masking
  -> Generative model
  -> Response token restoration
  -> Tool policy check before any requested tool executes
```

A matching injection phrase such as `ignore previous instructions` blocks the model call. Intent checks compare the prompt with every description in `intent.semantic.intents`; only include categories you want to allow.

PII masking replaces detected values with namespaced tokens:

```text
Input:          Email alice@example.com
Model receives: Email [[EMAIL_<namespace>_0]]
Restored:       Email alice@example.com
```

Restoration also works inside structured responses. Tool policy checks determine whether a requested tool may receive restored values or redacted arguments.

## Tool controls

Add exact tool names to the shared configuration:

```ts
tools: {
  defaultAction: "block",
  rules: {
    searchDocs: "allow",
    summarizeTicket: "redact",
    deleteTicket: "approval-required"
  },
  approve: async ({ toolName, input, context }) => {
    // Connect a trusted approval service for this exact call and user.
    // This example denies every approval request.
    return false;
  }
}
```

| Policy | Behavior |
| --- | --- |
| `allow` | Restore tokens, scan input, then execute |
| `block` | Stop before execution |
| `redact` | Replace detected PII in nested string arguments with `[REDACTED]`, then execute |
| `approval-required` | Execute only when the application's callback returns literal `true` |

Blocked, pending, or denied calls throw `GuardToolError`. Approval UI and durable approval storage belong to the application. Redaction may invalidate a tool's input schema, such as an email field; choose a policy appropriate to the tool.

Without tool policies, the default remains allow. With `tools` configured, `guard()` returns a native Genkit middleware reference. Existing configurations without `tools` retain the legacy callable form. Use `guardMiddleware(config)` for native tool hooks without explicit policies.

See [tool controls and logging](https://github.com/IntFlows/genkit-guard/wiki/9.-Tool-Controls-and-Logging) for the complete behavior.

## Models and PII storage

| Setting | Default |
| --- | --- |
| Intent model | `Xenova/all-MiniLM-L6-v2` |
| PII mode | `ner` |
| NER model | `Xenova/bert-base-NER` |
| Classifier model | `openai/privacy-filter` when classifier mode is selected |
| PII vault | In-memory storage |

The quick start explicitly selects classifier mode. Regex detection also runs for email, Australian phone and identifier patterns, and credit-card-like numbers.

Use `models.extractor` and `pii.model` to select compatible models, and `pii.labelMappings` to map fine-tuned labels to masking types. Classifier mode currently loads `q4` weights. Redis and custom vault adapters support external storage.

- [Shared model configuration](https://github.com/IntFlows/genkit-guard/wiki/8.-Shared-Model-Configuration)
- [PII labels, masking and vaults](https://github.com/IntFlows/genkit-guard/wiki/5.-PII-Guard)

## PII Vault Isolation and External Storage

Masked values are kept in a vault so they can be restored later. By default, the middleware uses process-local in-memory storage with generated vault scopes. Each tokenizer also generates an opaque namespace for its placeholders:

```text
alice@example.com -> [[EMAIL_<namespace>_0]]
```

Namespaces prevent concurrent calls from creating identical placeholder names. Use `pii.vault.scopeId` to group vault entries by request, session, or another application scope. The scope ID is not exposed in the placeholder.

### Redis storage

Use Redis when vault entries need to survive application restarts or be available to multiple workers. Install the client separately:

```bash
npm install redis
```

Extend your shared configuration during application startup:

```ts
import { createClient } from "redis";
import { guard, initGuard, createRedisPiiVaultStorage } from "@intflows/genkit-guard";
import guardConfig from "./guard.config.js";

const redis = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
redis.on("error", () => console.error("PII vault Redis connection error"));
await redis.connect();

const config = {
  ...guardConfig,
  pii: {
    ...guardConfig.pii,
    vault: {
      storage: createRedisPiiVaultStorage(redis, {
        keyPrefix: "my-app:pii",
        ttlSeconds: 3600,
        fallbackToMemory: false
      }),
      // Populate this from trusted application context.
      // If absent, the middleware generates a new scope.
      scopeId: (_req: unknown, ctx: any) => ctx?.context?.piiScopeId
    }
  }
};

await initGuard(config);
// Use guard(config) in your ai.generate({ use: [...] }) calls.
const middleware = guard(config);
```

`ttlSeconds` expires the scoped vault and shared token-index keys; writes refresh their expiry, so it is not a per-entry retention deadline. Without a TTL, Redis entries remain until removed externally. The default in-memory vault has no automatic expiry.

`fallbackToMemory: true` enables a process-local mirror with the same TTL behavior when Redis operations fail. It is disabled by default, so Redis errors propagate. The mirror is not shared across workers, does not survive restarts, and is not automatically replayed into Redis after recovery.

### Custom storage and isolation boundaries

Use `createPiiVaultStorage({ get, set, entries, getByToken })` to connect another database or store. `getByToken` is optional and enables recovery of opaque tokens across model/tool turns.

Scoped reads and writes use `scopeId`, but cross-turn recovery can look up tokens across scopes within the same backend. Scope IDs and opaque namespaces are not tenant authorization controls. For separate tenants, use appropriately isolated storage adapters or Redis prefixes, including separate token indexes, and enforce access in your application. Vault entries contain original PII values; the adapter does not encrypt those values itself.

See the [PII vault documentation](https://github.com/IntFlows/genkit-guard/wiki/5.-PII-Guard) and [Redis integration example](./example/src/index.ts).

## Decision logging

Console logging emits structured JSON. Add an audit callback to your configuration to receive `GuardDecision` events:

```ts
policyVersion: "support-v1",
logging: {
  enabled: true,
  level: "info",
  onDecision: async decision => {
    // Forward the content-free event to your audit sink.
    console.log(JSON.stringify(decision));
  }
}
```

Events include schema version, decision ID, timestamp, guard, policy version, action, reason code, latency, and intent similarity where applicable. The callback runs independently of console settings, is awaited, and stops execution if it fails. It does not provide persistent storage by itself.

## Try it and explore the examples

[Open the Hugging Face Space](https://huggingface.co/spaces/intflows/genkit-guard) to explore the demo. Use synthetic inputs when trying a hosted demo.

- [Integration flow](./example/src/index.ts): Azure Blob workflow with Redis-backed PII storage.
- [Tool controls](./example/src/tool-controls.ts): optional standalone demo of redaction and approval-required policies. This file is not required to use the package.

The tool-controls demo uses the local build. Run `npm install` and `npm run build` in the repository root, then `npm install` in `example`. Set `GEMINI_API_KEY` and `GEMINI_MODEL` for your provider account, and run:

```bash
# From example/
npx tsx src/tool-controls.ts
```

## Roadmap

- **v0.0.14:** shared model configuration, custom PII labels, tool policies and versioned decision events.
- **v0.1.0 planned:** persistent decision logging and explicit fallback-model behavior.
- **Later:** SQLite vault, memory compaction integration, compatibility hardening and stable v1.

## Contributing

Issues, pull requests, model evaluations and security reviews are welcome. Run `npm test` for the deterministic suite; real Redis integration is tested separately with `npm run test:redis`.

## License

[Apache-2.0](./LICENSE)
