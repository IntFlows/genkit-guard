import { googleAI } from "@genkit-ai/google-genai";
import { genkit, z } from "genkit";
import { initGuard, guard } from "@intflows/genkit-guard";

await initGuard();

const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model("gemini-3.1-flash-lite-preview"),
});

// ---------------------------
// Simulated Tool
// ---------------------------
const fetchBlobMetadata = ai.defineTool(
  {
    name: "fetchBlobMetadata",
    description:
      "Fetches metadata for a given blob in Azure Blob Storage using its precise path string.",
    inputSchema: z.object({
      blobName: z.string(),
    }),
    outputSchema: z.object({
      exists: z.boolean(),
      size: z.number(),
      contentType: z.string(),
      fileOwner: z.string().optional(),
    }),
  },
  async (input) => {
    console.log('\n================ [TOOL INTERCEPTION HIT] ================');
    console.log('👉 Input object as seen natively inside fetchBlobMetadata code:', JSON.stringify(input, null, 2));
  
    console.log('=========================================================\n');

    return {
      exists: true,
      size: 1024,
      contentType: "application/json",
      fileOwner: "john.doe@example.com"
    };
  }
);

// ---------------------------
// Flow Definition
// ---------------------------
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
      system: "You are an Azure Integration Architect. Execute a tool query whenever a file path or name is provided.",
      prompt: input.question,
      // Provide tools globally so the model can choose to call them
      tools: [fetchBlobMetadata], 
      use: [
        guard({
          intent: {
            mode: "semantic",
            allowedIntent: "integration_question",
            semantic: {
              threshold: 0.2,
              intents: {
                integration_question:
                  "Technical questions about APIs, Azure Blobs, data workflows, file downloads, and Azure Cloud integrations.",
              },
            },
          },
          pii: { reversible: true },
        }),
      ],
    });

    console.log('\n================ [MIDDLEWARE HISTORY TRACE] ================');
    console.log('🔍 Complete message loop history sent over the wire to LLM provider:');
    console.log(JSON.stringify(response.messages, null, 2));
    console.log('=============================================================\n');

    return {
      type: "success",
      description: "AI-generated answer to the integration question",
      answer: response.text,
    } as const;
  }
);

async function main() {
  const input = process.argv[2];
  
  // We explicitly embed the PII data directly into the target string required by the tool call
  const targetPrompt = input || "Fetch metadata for the blob named 'sensitive-user-data-john.doe@example.com.json' inside Azure Blob Storage.";
  
  const result = await integrationFlow({ question: targetPrompt });
  console.log('Final Flow Return Object to Client:', result);
}

main().catch(console.error);