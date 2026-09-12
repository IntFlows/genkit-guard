// Optional standalone demo; not required by the package or consuming applications.
// Run from example/: npx tsx src/tool-controls.ts
// Build the parent repository first with npm run build.

import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { guard, initGuard, defineGuardConfig, GuardToolError } from '../../dist/index.js';

const config = defineGuardConfig({
  policyVersion: 'support-v1',
  intent: { semantic: { threshold: 0.5, intents: { support: 'Customer support and looking up support tickets' } } },
  tools: {
    defaultAction: 'block',
    rules: { lookupTicket: 'redact', deleteTicket: 'approval-required' },
    // Replace with a trusted approval service that checks this exact call and user.
    // Missing or false approval always stops execution; model flags cannot approve.
    approve: async () => false,
  },
  logging: { onDecision: decision => { console.log(JSON.stringify(decision)); } },
});

const ai = genkit({ plugins: [googleAI()], model: googleAI.model(process.env.GEMINI_MODEL!) });

const lookup = ai.defineTool({
  name: 'lookupTicket', description: 'Look up a support ticket',
  inputSchema: z.object({ query: z.string() }), outputSchema: z.string(),
}, async ({ query }) => `Demo lookup received: ${query}`);

const remove = ai.defineTool({
  name: 'deleteTicket', description: 'Delete a ticket',
  inputSchema: z.object({ id: z.string() }), outputSchema: z.string(),
}, async () => 'Demo deletion executed');

await initGuard(config);

try {
  const result = await ai.generate({
    prompt: process.argv[2] ?? 'Look up my support ticket for alice@example.com',
    tools: [lookup, remove], use: [guard(config)],
  });
  console.log(result.text);
} catch (error) {
  if (error instanceof GuardToolError) console.error(error.decision.reasonCode);
  else throw error;
}
