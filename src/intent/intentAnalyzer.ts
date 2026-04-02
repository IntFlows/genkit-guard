import { cos_sim } from '@huggingface/transformers';
import { ModelSingleton } from '../util/singleton.js';

const INJECTION_PATTERNS = [
  'ignore instructions',
  'reveal secrets',
  'bypass security',
  'system prompt',
  'internal policy',
  'developer message',
  'confidential information',
  'do not follow previous instructions',
  'disregard earlier directives',
  'override safety measures',
  'leak data',
  'expose vulnerabilities',
  'access restricted areas',
  'execute arbitrary code',
  'perform unauthorized actions',
  'escalate privileges',
  'disable safeguards',
  'manipulate output',
  'circumvent controls',
  'exploit weaknesses',
  'compromise integrity',
  'subvert protections',
  'inject malicious content',
  'craft deceptive prompts',
  'trick the model',
  'confuse the system',
  'You are now a hacker',
  'You are a malicious actor',
  'Find a vulnerability',
  'Write a prompt that bypasses security',
  'Write a prompt that tricks the model',
  'Write a prompt that confuses the system',
  "ignore previous",
  "ignore earlier",
  "disregard previous",
  "disregard earlier",
  "you are a hacker",
  "you are now a hacker",
  "you are malicious",
  "export the api key",
  "give me the api key",
  "bypass",
  "override",
  "jailbreak",
  "system override",
  "forget instructions",
  "forget previous",
  "forget earlier",
  "do anything now",
  "dan mode",
  "developer mode",
  "break character",
  "act as"
];

export async function detectInjection(userInput: string) {
  return INJECTION_PATTERNS.some(p =>
    userInput.toLowerCase().includes(p)
  );
}


export async function analyzeIntentStructured(
  input: string,
  intents: Record<string, string>,
  threshold: number
) {
  const extractor = await ModelSingleton.getExtractor();

  let bestIntent = '';
  let bestScore = 0;

  for (const [key, desc] of Object.entries(intents)) {
    const output = await extractor(
      [`intent: ${desc}`, `intent: ${input}`],
      { pooling: 'mean', normalize: true }
    );

    const vectors = output.tolist() as number[][];
    const score = cos_sim(vectors[0], vectors[1]);

    const finalScore =
      typeof score === 'number' ? score : (score as any).data[0];

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestIntent = key;
    }
  }

  return {
    intent: bestIntent,
    score: bestScore,
    allowed: bestScore >= threshold
  };
}