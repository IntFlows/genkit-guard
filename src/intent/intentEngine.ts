import { cos_sim } from '@huggingface/transformers';
import { ModelSingleton } from '../util/singleton.js';

const INJECTION_PATTERNS = [
  'ignore instructions',
  'reveal secrets',
  'bypass security',
  'system prompt',
  'internal policy',
  'developer message'
];

export async function analyzeIntent(userInput: string, intentDesc: string) {
  const extractor = await ModelSingleton.getExtractor();

  const output = await extractor(
    [`intent: ${intentDesc}`, `intent: ${userInput}`],
    { pooling: 'mean', normalize: true }
  );

  const vectors = output.tolist() as number[][];
  const score = cos_sim(vectors[0], vectors[1]);

  return typeof score === 'number' ? score : (score as any).data[0];
}

export async function detectInjection(userInput: string) {
  return INJECTION_PATTERNS.some(p =>
    userInput.toLowerCase().includes(p)
  );
}