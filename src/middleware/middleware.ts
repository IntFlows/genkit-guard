import { generateMiddleware, z } from 'genkit';
import { analyzeIntentStructured, detectInjection } from '../intent/intentAnalyzer.js';
import { detectPII } from '../pii/detector.js';
import { PiiTokenizer } from '../pii/tokenizer.js';
import { defaultPiiVaultStorage, type PiiVaultStorage } from '../pii/storage.js';

const GUARD_CONTEXT_KEY = '__genkitGuard';

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
    vault: z.object({
      storage: z.any().optional(),
      scopeId: z.any().optional(),
    }).optional(),
  }).optional(),
  logging: z.object({
    enabled: z.boolean().optional(),
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    serviceName: z.string().optional(),
  }).optional(),
  models: z.object({
    extractor: z.string().optional(),
  }).optional(),
}).passthrough();

export type GuardConfig = {
  intent?: {
    mode?: string;
    allowedIntent?: string;
    semantic?: {
      threshold?: number;
      intents: Record<string, string>;
    };
  };
  pii?: {
    reversible?: boolean;
    model?: string;
    mode?: 'ner' | 'classifier';
    vault?: {
      storage?: PiiVaultStorage;
      scopeId?: string | ((req: any, ctx: any) => string | undefined);
    };
  };
  logging?: {
    enabled?: boolean;
    level?: LogSeverity;
    serviceName?: string;
  };
  models?: {
    extractor?: string;
  };
  [key: string]: any;
};
type LogSeverity = 'debug' | 'info' | 'warn' | 'error';

interface GuardState {
  tokenizers: PiiTokenizer[];
}

export const guardMiddleware = generateMiddleware(
  {
    name: 'genkitGuard',
    description: 'Blocks prompt injection and disallowed intent, masks PII before model calls, restores PII for tool calls, and audits tool PII access.',
    configSchema: guardConfigSchema,
  },
  ({ config }) => createGuardHooks(config)
);

export const guardPlugin = guardMiddleware.plugin;

export function guard(config?: GuardConfig) {
  const hooks = createGuardHooks(config);
  const baseMiddleware = guardMiddleware(config as any);

  const fnRunner = async (req: any, ctxOrNext: any, maybeNext?: any) => {
    if (typeof maybeNext === 'function') {
      return hooks.model(req, ctxOrNext, maybeNext);
    }

    return hooks.model(req, {}, async (modifiedReq: any) => ctxOrNext(modifiedReq || req));
  };

  const source = Object.assign({}, baseMiddleware, hooks);

  for (const key of Object.keys(source)) {
    if (key === 'name') continue;

    Object.defineProperty(fnRunner, key, {
      value: (source as any)[key],
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  return fnRunner;
}

export const guardAction = guard;

function createGuardHooks(config?: GuardConfig) {
  const logger = createLogger(config);

  return {
    model: async (req: any, ctx: any, next: any) => {
      const input = getInputText(req);

      logger('info', 'guard.model.start', 'Starting guard checks for model request');

      const isInjection = await detectInjection(input);
      if (isInjection) {
        logger('warn', 'guard.intent.blocked', 'Prompt injection pattern detected', {
          reason: 'pattern_match',
        });

        return block('Prompt injection detected', {
          reason: 'pattern_match',
        });
      }

      logger('info', 'guard.intent.analysis.start', 'Analyzing request intent');

      const intentResult = await analyzeIntentStructured(
        input,
        config?.intent?.semantic?.intents ?? {},
        config?.intent?.semantic?.threshold ?? 0.7
      );

      logger('info', 'guard.intent.analysis.complete', 'Intent analysis completed', {
        intent: intentResult.intent,
        score: roundScore(intentResult.score),
        allowed: intentResult.allowed,
      });

      if (!intentResult.allowed) {
        logger('warn', 'guard.intent.blocked', 'Intent not allowed', {
          intent: intentResult.intent,
          score: roundScore(intentResult.score),
        });

        return block('Intent not allowed', {
          intent: intentResult.intent,
          score: intentResult.score,
        });
      }

      const textForPii = collectModelRequestText(req);
      const piiResponse = await scanPII(textForPii, config);
      const piiMatches = piiResponse?.matches || [];
      const tokenizer = createTokenizer(config, req, ctx);
      const piiTypes = uniqueTypes(piiMatches);

      await tokenizer.importTokens(textForPii);
      await maskModelRequest(req, tokenizer, piiMatches);
      pushTokenizer(ctx, tokenizer);

      logger(piiMatches.length > 0 ? 'warn' : 'info', 'guard.model.pii.masked', 'PII scan completed for model request', {
        piiDetected: piiMatches.length > 0,
        piiMatchCount: piiMatches.length,
        piiTypes,
        piiMode: config?.pii?.mode ?? 'ner',
        classifierOutputPresent: Boolean(piiResponse.classifier),
      });

      req.metadata = {
        ...req.metadata,
        intent: intentResult.intent,
        score: intentResult.score,
        piiDetected: piiMatches.length > 0,
        piiTypes,
        maskedInput: getInputText(req),
        piiModel: config?.pii?.model,
        piiMode: config?.pii?.mode,
        piiClassifierOutput: piiResponse.classifier,
      };

      const res = await next(req, ctx);

      const unmaskedResponse = await unmaskObject(res, getGuardState(ctx).tokenizers);
      logger('info', 'guard.model.response.unmasked', 'Model response unmasked for downstream execution', {
        piiTypes,
      });

      return unmaskedResponse;
    },

    tool: async (req: any, ctx: any, next: any) => {
      const state = getGuardState(ctx);
      const toolName = req?.toolRequest?.name;

      // Genkit may provide a fresh middleware context for a tool turn. Create a recovery
      // tokenizer that uses the configured vault so opaque tokens can be rehydrated safely.
      if (state.tokenizers.length === 0) {
        state.tokenizers.push(createTokenizer(config, req, ctx));
      }

      if (req?.toolRequest && 'input' in req.toolRequest) {
        req.toolRequest.input = await unmaskObject(req.toolRequest.input, state.tokenizers);
      }

      const toolInputText = collectStrings(req?.toolRequest?.input).join('\n');
      const piiResponse = await scanPII(toolInputText, config);
      const piiMatches = piiResponse?.matches || [];
      const piiTypes = uniqueTypes(piiMatches);

      req.metadata = {
        ...req.metadata,
        piiDetected: piiMatches.length > 0,
        piiTypes,
        piiMatchCount: piiMatches.length,
      };

      logger(piiMatches.length > 0 ? 'warn' : 'info', 'guard.tool.pii.checked', 'Tool request PII scan completed', {
        toolName,
        piiDetected: piiMatches.length > 0,
        piiMatchCount: piiMatches.length,
        piiTypes,
      });

      const res = await next(req, ctx);

      const toolResponseText = collectStrings(res).join('\n');
      if (toolResponseText) {
        const responsePii = await scanPII(toolResponseText, config);
        const responseMatches = responsePii?.matches || [];

        logger(responseMatches.length > 0 ? 'warn' : 'info', 'guard.tool.response.pii.checked', 'Tool response PII scan completed', {
          toolName,
          piiDetected: responseMatches.length > 0,
          piiMatchCount: responseMatches.length,
          piiTypes: uniqueTypes(responseMatches),
        });
      }

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

  return collectStrings(lastMessage).join('\n');
}

function collectModelRequestText(req: any): string {
  return [
    ...collectStrings(req?.prompt),
    ...collectStrings(req?.messages),
    ...collectStrings(req?.docs),
  ].join('\n');
}

async function maskModelRequest(req: any, tokenizer: PiiTokenizer, matches: { type: string; value: string }[]) {
  if (typeof req.prompt === 'string') {
    req.prompt = (await tokenizer.mask(req.prompt, matches)).maskedText;
  }

  if (req.messages) {
    req.messages = await transformStrings(req.messages, async (value) => (await tokenizer.mask(value, matches)).maskedText);
  }

  if (req.docs) {
    req.docs = await transformStrings(req.docs, async (value) => (await tokenizer.mask(value, matches)).maskedText);
  }
}

async function unmaskObject(obj: any, tokenizers: PiiTokenizer[]) {
  return transformStrings(obj, async (value) => {
    let result = value;

    for (const tokenizer of tokenizers) {
      // A token may have been produced by another model/tool turn with a different Genkit
      // context or vault scope. Import only opaque tokens actually present in this value.
      await tokenizer.importTokens(result);
      result = await tokenizer.unmask(result);
    }

    return result;
  });
}

async function transformStrings(obj: any, transform: (value: string) => string | Promise<string>): Promise<any> {
  if (typeof obj === 'string') {
    return await transform(obj);
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      obj[i] = await transformStrings(obj[i], transform);
    }
    return obj;
  }

  if (obj !== null && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      obj[key] = await transformStrings(obj[key], transform);
    }
    return obj;
  }

  return obj;
}

function collectStrings(obj: any): string[] {
  if (typeof obj === 'string') {
    return [obj];
  }

  if (Array.isArray(obj)) {
    return obj.flatMap(collectStrings);
  }

  if (obj !== null && typeof obj === 'object') {
    return Object.values(obj).flatMap(collectStrings);
  }

  return [];
}

async function scanPII(text: string, config?: GuardConfig) {
  if (!text.trim()) {
    return {
      matches: [],
      classifier: undefined,
    };
  }

  return detectPII(text, {
    model: config?.pii?.model,
    mode: config?.pii?.mode,
  });
}

function getGuardState(ctx: any = {}): GuardState {
  ctx.context = ctx.context || {};
  ctx.context[GUARD_CONTEXT_KEY] = ctx.context[GUARD_CONTEXT_KEY] || { tokenizers: [] };
  return ctx.context[GUARD_CONTEXT_KEY];
}

function pushTokenizer(ctx: any, tokenizer: PiiTokenizer) {
  const state = getGuardState(ctx);
  state.tokenizers.push(tokenizer);
}

function createTokenizer(config: GuardConfig | undefined, req: any, ctx: any) {
  const configuredScope = config?.pii?.vault?.scopeId;
  const scopeId = typeof configuredScope === 'function'
    ? configuredScope(req, ctx)
    : configuredScope;

  return new PiiTokenizer({
    scopeId: typeof scopeId === 'string' ? scopeId : undefined,
    storage: config?.pii?.vault?.storage ?? defaultPiiVaultStorage,
  });
}

function uniqueTypes(matches: { type: string }[]) {
  return Array.from(new Set(matches.map((match) => match.type.toLowerCase())));
}

function roundScore(score: number) {
  return Math.round(score * 10000) / 10000;
}

function createLogger(config?: GuardConfig) {
  const enabled = config?.logging?.enabled ?? true;
  const minimumLevel = config?.logging?.level ?? 'info';
  const serviceName = config?.logging?.serviceName ?? '@intflows/genkit-guard';
  const levelRank: Record<LogSeverity, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  const severityNumber: Record<LogSeverity, number> = {
    debug: 5,
    info: 9,
    warn: 13,
    error: 17,
  };

  return (severity: LogSeverity, eventName: string, body: string, attributes: Record<string, any> = {}) => {
    if (!enabled || levelRank[severity] < levelRank[minimumLevel]) {
      return;
    }

    const record = {
      timestamp: new Date().toISOString(),
      severityText: severity.toUpperCase(),
      severityNumber: severityNumber[severity],
      body,
      resource: {
        attributes: {
          'service.name': serviceName,
        },
      },
      attributes: {
        'event.name': eventName,
        'code.namespace': 'genkit-guard',
        ...attributes,
      },
    };

    const line = JSON.stringify(record);
    if (severity === 'error') {
      console.error(line);
    } else if (severity === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  };
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
