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
  The package uses local `all-MiniLM-L6-v2` and `bert-base-NER` Models, these Models are downloaded once and cached locally.

- **Drop‑in Genkit Middleware**  
  Works with `ai.generate`, `ai.generateStream`, and Genkit flows.

---

### 📦 Installation

```bash
npm install @intflows/genkit-guard
```

This library uses lightweight transformer models (MiniLM + BERT‑NER).  
Download them once:

```bash
npx genkit-guard-download
```

This creates:

```
./models/
```

Models are cached locally and reused across runs.

---

## 🚀 Quick Start

### **1. Initialize the guard once at startup**

```ts
import { initGuard } from "@intflows/genkit-guard";

await initGuard();
```

This loads MiniLM + NER from `./models` (or downloads them if missing).

---

### **2. Add the guard to your Genkit flow**

```ts
import { googleAI } from "@genkit-ai/google-genai";
import { genkit, z } from "genkit";
import { guard } from "@intflows/genkit-guard";

const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-2.5-flash"),
});

export const integrationFlow = ai.defineFlow(
  {
    name: "integrationFlow",
    inputSchema: z.object({ question: z.string() }),
    outputSchema: z.object({
      type: z.literal("success"),
      description: z.string(),
      answer: z.string(),
    }),
  },
  async (input) => {
    const response = await ai.generate({
      system: "You are an Azure Integration Architect.",
      prompt: input.question,
      use: [
        guard({
          intent: {
            mode: "semantic",
            allowedIntent: "integration_question",
            semantic: {
              threshold: 0.7,
              intents: {
                integration_question:
                  "Technical questions about APIs, Azure Blobs, data workflows, file downloads, and Azure Cloud integrations.",
              },
            },
          },
          pii: {
            reversible: true,
          },
        }),
      ],
    });

    return response.output;
  }
);
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
- Names (NER)  
- AU identifiers (Medicare, TFN, ABN, etc.)

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

---

## 🛡️ Why This Library Exists

Genkit provides a powerful LLM framework, but production systems need:

- intent boundaries  
- PII protection  
- jailbreak resistance  
- predictable behavior  

This library adds those guardrails without heavy dependencies or complex setup.

---

## Further Extension

We plan to add Auth and Tool Middleware in further stages

# 📄 License

Apache‑2.0