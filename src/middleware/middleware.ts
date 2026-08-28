import { generateMiddleware, z } from 'genkit';
import { analyzeIntentStructured, detectInjection } from '../intent/intentAnalyzer.js';
import { detectPII } from '../pii/detector.js';
import { PiiTokenizer } from '../pii/tokenizer.js';
import { defaultPiiVaultStorage, type PiiVaultStorage } from '../pii/storage.js';
import type {
  GuardBlockedResponse,
  GuardConfig,
  GuardContext,
  GuardHooks,
  GuardLogSeverity,
  GuardNext,
  GuardRequest,
  GuardRunner,
  GuardScopeResolver,
} from './types.js';

export type {
  GuardBlockedResponse,
  GuardConfig,
  GuardContext,
  GuardHooks,
  GuardLogSeverity,
  GuardNext,
  GuardRequest,
  GuardRunner,
  GuardScopeResolver,
} from './types.js';

const GUARD_CONTEXT_KEY = '__genkitGuard';

const guardConfigSchema = z.object({
  intent: z.object({
    mode: z.string().optional(),
    allowedIntent: z.string().optional(),
    semantic: z.object({
      threshold: z.number().optional(),
      intents: z.record(z.string(), z.string()),
    }).optional(),
  }).optional(),
  pii: z.object({
    reversible: z.boolean().optional(),
    model: z.string().optional(),
    mode: z.enum(['ner', 'classifier']).optional(),
    vault: z.object({
      storage: z.custom<PiiVaultStorage>().optional(),
      scopeId: z.custom<string | GuardScopeResolver>().optional(),
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
});

interface GuardState {
  tokenizers: PiiTokenizer[];
}

export const guardMiddleware = generateMiddleware(
  {
    name: 'genkitGuard',
    description: 'Blocks prompt injection and disallowed intent, masks PII before model calls, restores PII for tool calls, and audits tool PII access.',
    configSchema: guardConfigSchema,
  },
  ({ config }) => createGuardHooks(config) as never
);

export const guardPlugin = guardMiddleware.plugin;

export function guard(config?: GuardConfig): GuardRunner {
  const hooks = createGuardHooks(config);
  const baseMiddleware = guardMiddleware(config);

  const fnRunner = async (
    req: GuardRequest,
    ctxOrNext: GuardContext | ((request: GuardRequest) => unknown),
    maybeNext?: GuardNext
  ) => {
    if (typeof maybeNext === 'function') {
      return hooks.model(req, ctxOrNext as GuardContext, maybeNext);
    }

    const next = ctxOrNext as (request: GuardRequest) => unknown;
    return hooks.model(req, {}, async (modifiedReq) => next(modifiedReq || req));
  };

  const source = Object.assign({}, baseMiddleware, hooks);

  for (const key of Object.keys(source)) {
    if (key === 'name') continue;

    Object.defineProperty(fnRunner, key, {
      value: (source as Record<string, unknown>)[key],
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  return fnRunner as GuardRunner;
}

export const guardAction = guard;

export function createGuardHooks(config?: GuardConfig): GuardHooks {
  const logger = createLogger(config);

  const hooks = {
    model: async (req: GuardRequest, ctx: GuardContext, next: GuardNext) => {
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

    tool: async (req: GuardRequest, ctx: GuardContext, next: GuardNext) => {
      const state = getGuardState(ctx);
      const toolName = req?.toolRequest?.name;

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

  return hooks as GuardHooks;
}

function getInputText(req: GuardRequest): string {
  if (typeof req.prompt === 'string') {
    return req.prompt;
  }

  const lastMessage = req.messages?.[req.messages.length - 1];
  const firstContent = isRecord(lastMessage) && Array.isArray(lastMessage.content)
    ? lastMessage.content[0]
    : undefined;

  if (typeof firstContent?.text === 'string') {
    return firstContent.text;
  }

  if (typeof firstContent === 'string') {
    return firstContent;
  }

  return collectStrings(lastMessage).join('\n');
}

function collectModelRequestText(req: GuardRequest): string {
  return [
    ...collectStrings(req?.prompt),
    ...collectStrings(req?.messages),
    ...collectStrings(req?.docs),
  ].join('\n');
}

async function maskModelRequest(req: GuardRequest, tokenizer: PiiTokenizer, matches: { type: string; value: string }[]) {
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

async function unmaskObject<T>(obj: T, tokenizers: PiiTokenizer[]): Promise<T> {
  return transformStrings(obj, async (value) => {
    let result = value;

    for (const tokenizer of tokenizers) {
      result = await tokenizer.unmask(result);
    }

    return result;
  });
}

async function transformStrings<T>(obj: T, transform: (value: string) => string | Promise<string>): Promise<T> {
  if (typeof obj === 'string') {
    return await transform(obj) as T;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      obj[i] = await transformStrings(obj[i], transform);
    }
    return obj;
  }

  if (obj !== null && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = await transformStrings(record[key], transform);
    }
    return obj;
  }

  return obj;
}

function collectStrings(obj: unknown): string[] {
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

function getGuardState(ctx: GuardContext = {}): GuardState {
  ctx.context = ctx.context || {};
  const state = ctx.context[GUARD_CONTEXT_KEY];
  if (isGuardState(state)) return state;
  const newState: GuardState = { tokenizers: [] };
  ctx.context[GUARD_CONTEXT_KEY] = newState;
  return newState;
}

function pushTokenizer(ctx: GuardContext, tokenizer: PiiTokenizer) {
  const state = getGuardState(ctx);
  state.tokenizers.push(tokenizer);
}

function createTokenizer(config: GuardConfig | undefined, req: GuardRequest, ctx: GuardContext) {
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
  const levelRank: Record<GuardLogSeverity, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  const severityNumber: Record<GuardLogSeverity, number> = {
    debug: 5,
    info: 9,
    warn: 13,
    error: 17,
  };

  return (severity: GuardLogSeverity, eventName: string, body: string, attributes: Record<string, unknown> = {}) => {
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

function block(message: string, metadata?: Record<string, unknown>): GuardBlockedResponse {
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

function isGuardState(value: unknown): value is GuardState {
  return typeof value === 'object' && value !== null && Array.isArray((value as GuardState).tokenizers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
