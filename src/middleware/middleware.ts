import { generateMiddleware, z } from 'genkit';
import { analyzeIntentStructured, detectInjection } from '../intent/intentAnalyzer.js';
import { detectPII } from '../pii/detector.js';
import { PiiTokenizer } from '../pii/tokenizer.js';

const guardConfigSchema = z.object({
  intent: z.object({
    mode: z.string().optional(),
    allowedIntent: z.string().optional(),
    semantic: z.object({
      threshold: z.number().optional(),
      intents: z.record(z.string(), z.string()),
    }),
  }).optional(),
  pii: z.object({
    reversible: z.boolean().optional(),
    model: z.string().optional(),
    mode: z.enum(['ner', 'classifier']).optional(),
  }).optional(),
  models: z.object({
    extractor: z.string().optional(),
  }).optional(),
}).passthrough();

export const guardMiddleware = generateMiddleware(
  {
    name: 'genkitGuard',
    description: 'Blocks prompt injection and disallowed intent, then masks PII before model calls and unmasks model responses.',
    configSchema: guardConfigSchema,
  },
  ({ config }) => createGuardHooks(config)
);

export const guardPlugin = guardMiddleware.plugin;

export function guard(config?: z.infer<typeof guardConfigSchema>) {
  const hooks = createGuardHooks(config);
  const baseMiddleware = guardMiddleware(config);

  // 1. Create the wrapper function runner
  const fnRunner = async (req: any, ctxOrNext: any, maybeNext?: any) => {
    if (typeof maybeNext === 'function') {
      return hooks.model(req, ctxOrNext, maybeNext);
    }
    return hooks.model(req, {}, async (modifiedReq: any) => ctxOrNext(modifiedReq || req));
  };

  // 2. Combine the base middleware properties and custom hooks into a source object
  const source = Object.assign({}, baseMiddleware, hooks);

  // 3. Safely copy properties onto the function runner, explicitly skipping the read-only 'name' property
  for (const key of Object.keys(source)) {
    if (key === 'name') continue; // Prevent the TypeError
    
    // Use defineProperty or simple assignment for everything else
    Object.defineProperty(fnRunner, key, {
      value: (source as any)[key],
      writable: true,
      configurable: true,
      enumerable: true
    });
  }

  return fnRunner;
}

function createGuardHooks(config?: z.infer<typeof guardConfigSchema>) {
  return {
    model: async (req: any, ctx: any, next: any) => {
      const input = getInputText(req);

      const isInjection = await detectInjection(input);
      if (isInjection) {
        console.warn('[Intent Guard] Prompt injection pattern detected in input');
        return block('Prompt injection detected', {
          reason: 'pattern_match',
        });
      }

      console.log("[Intent Guard] Analyzing intent for user's input");

      const intentResult = await analyzeIntentStructured(
        input,
        config?.intent?.semantic?.intents ?? {},
        config?.intent?.semantic?.threshold ?? 0.7
      );

      console.log(`[Intent Guard] Detected intent: ${intentResult.intent} (score: ${intentResult.score.toFixed(2)})`);

      if (!intentResult.allowed) {
        console.warn(`[Intent Guard] Intent "${intentResult.intent}" not allowed ${intentResult.allowed}`);
        return block('Intent not allowed', {
          intent: intentResult.intent,
          score: intentResult.score,
        });
      }

      const piiResponse = await detectPII(input, {
        model: config?.pii?.model,
        mode: config?.pii?.mode,
      });
      const piiMatches = piiResponse?.matches || [];

      console.log(`[PII Guard] Detected PII: ${piiMatches.length} matches found` + (piiResponse.classifier ? ' (classifier output present)' : ''));

      const tokenizer = new PiiTokenizer();
      const piiResult = tokenizer.mask(input, piiMatches);

      console.log(`[PII Guard] Masked PII: ${piiResult.piiTypes.length} types found`);

      req.metadata = {
        ...req.metadata,
        piiTokenizer: tokenizer,
        intent: intentResult.intent,
        score: intentResult.score,
        piiDetected: piiMatches.length > 0,
        piiTypes: piiResult.piiTypes,
        maskedInput: piiResult.maskedText,
        piiModel: config?.pii?.model,
        piiMode: config?.pii?.mode,
        piiClassifierOutput: piiResponse.classifier,
      };

      replaceInputText(req, piiResult.maskedText);

      const res = await next(req, ctx);

      console.log('[PII Guard] Unmasking response if needed');
      unmaskResponse(res, tokenizer);
      console.log('[PII Guard] Deep unmasking complete across all candidates and custom fields.');

      return res;
    },
  };
}

function getInputText(req: any): string {
  if (typeof req.prompt === 'string') {
    return req.prompt;
  }

  const lastMessage = req.messages?.[req.messages.length - 1];
  const firstContent = lastMessage?.content?.[0];

  if (typeof firstContent?.text === 'string') {
    return firstContent.text;
  }

  if (typeof firstContent === 'string') {
    return firstContent;
  }

  return '';
}

function replaceInputText(req: any, text: string) {
  if (typeof req.prompt === 'string') {
    req.prompt = text;
  }

  req.messages = [
    {
      role: 'user',
      content: [{ text }],
    },
  ];
}

function unmaskResponse(res: any, tokenizer: PiiTokenizer) {
  const transform = (obj: any): any => {
    if (typeof obj === 'string') {
      return tokenizer.unmask(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(transform);
    }

    if (obj !== null && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        obj[key] = transform(obj[key]);
      }
      return obj;
    }

    return obj;
  };

  transform(res);
}

function block(message: string, metadata?: any) {
  return {
    finishReason: 'blocked',
    output: {
      type: 'error',
      status: 'BLOCKED',
      message,
    },
    metadata,
  };
}
