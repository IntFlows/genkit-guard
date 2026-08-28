import type { PiiVaultStorage } from '../pii/storage.js';

export type GuardLogSeverity = 'debug' | 'info' | 'warn' | 'error';

export interface GuardRequest {
  prompt?: unknown;
  messages?: unknown[];
  docs?: unknown;
  metadata?: Record<string, unknown>;
  toolRequest?: {
    name?: string;
    input?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GuardContext {
  context?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  [key: string]: unknown;
}

export type GuardScopeResolver = (
  request: Readonly<GuardRequest>,
  context: Readonly<GuardContext>
) => string | undefined;

export interface GuardConfig {
  intent?: {
    mode?: 'semantic' | (string & {});
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
      scopeId?: string | GuardScopeResolver;
    };
  };
  logging?: {
    enabled?: boolean;
    level?: GuardLogSeverity;
    serviceName?: string;
  };
  models?: {
    extractor?: string;
  };
}

export type GuardNext<
  TRequest extends GuardRequest = GuardRequest,
  TResponse = unknown,
> = (request: TRequest, context: GuardContext) => TResponse | Promise<TResponse>;

export interface GuardHooks {
  model<TRequest extends GuardRequest = GuardRequest, TResponse = unknown>(
    request: TRequest,
    context: GuardContext,
    next: GuardNext<TRequest, TResponse>
  ): Promise<TResponse | GuardBlockedResponse>;
  tool<TRequest extends GuardRequest = GuardRequest, TResponse = unknown>(
    request: TRequest,
    context: GuardContext,
    next: GuardNext<TRequest, TResponse>
  ): Promise<TResponse>;
}

export interface GuardBlockedResponse {
  finishReason: 'blocked';
  output: {
    type: 'error';
    status: 'BLOCKED';
    message: string;
  };
  metadata?: Record<string, unknown>;
}

export interface GuardRunner extends GuardHooks {
  <TRequest extends GuardRequest = GuardRequest, TResponse = unknown>(
    request: TRequest,
    context: GuardContext,
    next: GuardNext<TRequest, TResponse>
  ): Promise<TResponse | GuardBlockedResponse>;
  <TRequest extends GuardRequest = GuardRequest, TResponse = unknown>(
    request: TRequest,
    next: (request: TRequest) => TResponse | Promise<TResponse>
  ): Promise<TResponse | GuardBlockedResponse>;
}
