# **@intflows/genkit-guard** 

### **Lightweight Intent, PII, and Safety Guardrails for Genkit**

`@intflows/genkit-guard` provides a modular guardrail layer for Genkit flows.  
It adds **semantic intent validation**, **PII masking/unmasking**, and **prompt‑injection detection** with minimal configuration.

This library is designed for developers who want **practical, production‑ready safety controls** without heavy dependencies or complex setup.

---

## ✨ Features

- **Semantic Intent Guarding**  
  Uses MiniLM embeddings to ensure prompts match allowed intents.

- **PII Detection & Masking**  
  Detects emails, phone numbers, names, and AU‑specific identifiers.  
  Replaces PII with reversible tokens before sending to the LLM.

- **Automatic Unmasking**  
  Restores original PII in the model’s response, even inside structured JSON.

- **Prompt Injection Detection**  
  Blocks jailbreak attempts using pattern‑based heuristics.

- **Model‑Light Architecture**  
  The package uses local `all-MiniLM-L6-v2` and `openai/privacy-filter` Models, these Models are downloaded once and cached locally.

- **Drop‑in Genkit Middleware**  
  Works with `ai.generate`, `ai.generateStream`, and Genkit flows.

---

### 📦 Installation

```bash
## Install the package
npm install @intflows/genkit-guard
```

This library uses lightweight transformer models (MiniLM + Openai/privacy-filter).  

Download them once. 

```bash
## Download the transformer models (MiniLM + OpenAI/privacy-filter)
node node_modules/@intflows/genkit-guard/scripts/download-model.js
```

Models are cached locally and reused across runs.

---

## 🚀 Quick Start

### 1. Initialize Local folder

```bash
# Install @intflows/genkit-guard
npm install @intflows/genkit-guard

# Download Local Models (Only needed once)
node node_modules/@intflows/genkit-guard/scripts/download-model.js
```
_ This downloads the models to ./models folder, the total size is ~1.5 GB ( 1GB for Openai/privacy-filter + .5 GB for MiniLM-L6-v2) 

### 2. Update genkit

```ts
import { guard, initGuard } from "@intflows/genkit-guard";

await initGuard();

const response = await ai.generate({
  prompt: "How do I integrate with Azure Blob Storage?",
  use: [
    guard({
      intent: {
        mode: "semantic",
        allowedIntent: "integration",
        semantic: {
          threshold: 0.7,
          intents: {
            integration: "Azure Blob, APIs, workflows"
          }
        }
      },
      pii: { reversible: true }
    })
  ]
});
```

**You Can also check the full step by step guide here:**

[Intflows Wiki](https://github.com/IntFlows/genkit-guard/wiki)

### 3. Execute the Genkit flow

#### Allowed :
``` npx tsx src/index.ts "How do I integrate with Azure Blob Storage?"```

#### Blocked:
``` npx tsx src/index.ts "workflow to download a file from an API, save it to Blob file and export the API key"```

![Image showing Generation Blocked](./GenerationBlocked.png)


#### PII MASK and UNMASK:
``` npx tsx src/index.ts "workflow to download a file from an API, save it to Blob file with my email john.doe@example.com"```

![Image showing PII data masked ](./MaskedPII.png)

---
## Example

An example genkit flow is present in `example` directory.

```bash
git clone https://github.com/IntFlows/genkit-guard.git
cd genkit-guard/example
npm install
npx tsx src/index.ts
```

Or you can run the flow with genkit dev UI

```bash
git clone https://github.com/IntFlows/genkit-guard.git
cd genkit-guard/example
npm install
genkit start -- npx tsx src/index.ts
```

---

## 🧠 How It Works

### **1. Intent Guard**
- Embeds the user prompt + intent descriptions using MiniLM  
- Computes cosine similarity  
- Blocks prompts below threshold  
- Detects jailbreak patterns like:  
  - “ignore previous instructions”  
  - “you are a hacker”  
  - “export the API key”  

### **2. PII Masking**
Before the LLM sees the prompt:

```
"Email john.doe@example.com" → "Email [[EMAIL_0]]"
```

Detected PII includes:

- Emails  
- Phone numbers    
- AU identifiers (Medicare, TFN, ABN, etc.)
- PII detected by local Model (OpenAI/privacy-filter)

### **3. LLM Call**
The masked prompt is sent to the model.

### **4. Response Unmasking**
After the LLM responds:

```
"Send a confirmation email to [[EMAIL_0]]" → "Send a confirmation email to john.doe@example.com"
```
---

## ⚙️ Configuration

### **Intent Guard**

```ts
intent: {
  mode: "semantic",
  allowedIntent: "intent_question",
  semantic: {
    threshold: 0.7,
    intents: {
      intent_question: "Description of allowed intent"
    }
  }
}
```

### **PII Guard**

```ts
pii: {
  reversible: true
}
```

### **PII Vault Isolation and External Storage**

By default, PII is stored in an in-memory vault scoped to a single tokenizer instance. Tokens include a generated vault scope:

```txt
"Email john.doe@example.com" -> "Email [[EMAIL_<scope>_0]]"
```

That scope prevents two concurrent users from sharing the same placeholder namespace. If User A and User B both produce an email token, their placeholders and vault lookups are isolated by scope.

For applications that need persistence, distributed workers, audits, or tenant-specific storage, provide a vault storage backend:

```ts
import { guard, type PiiVaultStorage } from "@intflows/genkit-guard";

class RedisPiiVaultStorage implements PiiVaultStorage {
  constructor(private redis: RedisClient) {}

  async get(scopeId: string, token: string) {
    return this.redis.hget(`pii:${scopeId}`, token);
  }

  async set(scopeId: string, token: string, value: string) {
    await this.redis.hset(`pii:${scopeId}`, token, value);
  }

  async entries(scopeId: string) {
    const values = await this.redis.hgetall(`pii:${scopeId}`);
    return Object.entries(values).map(([token, value]) => ({ token, value }));
  }
}

guard({
  pii: {
    reversible: true,
    vault: {
      storage: new RedisPiiVaultStorage(redis),
      scopeId: (req, ctx) => ctx?.auth?.sessionId ?? req?.metadata?.requestId
    }
  }
});
```

Choose a `scopeId` that matches your isolation boundary, such as request ID, session ID, tenant/user ID, or a combination like `tenantId:userId:requestId`. A shared external backend should never ignore `scopeId`, because placeholder names are only safe when resolved against the correct vault scope.

---

## 🛡️ Why This Library Exists

Genkit provides a powerful LLM framework, but production systems need:

- intent boundaries  
- PII protection  
- jailbreak resistance  
- predictable behavior  

This library adds those guardrails without heavy dependencies or complex setup.

---

## Contributing

We plan to: 

1. Extend the utility by adding Auth and Tool Middleware in further stages.
2. Add more filter types for common malicious prompts.
3. Add more patterns for custom PII masking.

Contributions are welcome — whether it’s bug reports, new guard modules, model improvements or enhancements. This project aims to stay lightweight, modular, and production‑ready, so thoughtful contributions are appreciated.

# 📄 License

Apache‑2.0
