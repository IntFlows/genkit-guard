# README suggestions for v0.0.14

1. Lead with: **Keep Genkit requests on topic and mask personal data before model calls.** Explain local inference and reversible masking in one sentence.
2. Consolidate duplicate installation sections and show the shared configuration quick start from the new wiki.
3. Add: **New in v0.0.14: one configuration for startup and runtime, custom intent models, and fine-tuned PII labels.**
4. Show an input, namespaced masking token and restored response immediately after quick start. Link detailed model and Redis configuration to the wiki.
5. Replace unmeasured lightweight and production-ready claims with concrete model/cache behavior. Clarify that NER is the default and classifier mode is explicit; model sizes vary.
6. Remove the repeated Redis introduction and fix redis-scan.png to redis-scan.PNG for case-sensitive rendering.
7. State that existing inline options work and that a custom extractor now also affects runtime scoring. Explain that classifier models need compatible q4 weights.

## Proposed quick-start copy

Create `src/guard.config.ts`:

```ts
import { defineGuardConfig } from "@intflows/genkit-guard";
export default defineGuardConfig({
  models: { extractor: "Xenova/all-MiniLM-L6-v2" },
  intent: { semantic: {
    threshold: 0.7,
    intents: { integration: "Azure Blob Storage, APIs and integration workflows" }
  } },
  pii: { mode: "classifier", model: "openai/privacy-filter", reversible: true }
});
```

Use the shared configuration in your Genkit application:

```ts
import { guard, initGuard } from "@intflows/genkit-guard";
import guardConfig from "./guard.config.js";
await initGuard(guardConfig);
// ai is your configured Genkit instance.
const response = await ai.generate({
  prompt: "How do I integrate with Azure Blob Storage?",
  use: [guard(guardConfig)]
});
```

Superseded: README.md now uses the developer-focused structure from README-new.md, corrected to the actual v0.0.14 APIs, with the Hugging Face Space link.
