import {
  guard,
  createRedisPiiVaultStorage,
  type GuardBlockedResponse,
  type GuardConfig,
  type GuardContext,
  type GuardRequest,
  type GuardRunner,
  type RedisPiiVaultClient,
} from '../src/index.js';

const redis: RedisPiiVaultClient = {
  async hGet() {
    return undefined;
  },
  async hSet() {},
  async hGetAll() {
    return {};
  },
};

const config: GuardConfig = {
  pii: {
    reversible: true,
    vault: {
      storage: createRedisPiiVaultStorage(redis),
      scopeId: (req, ctx) => {
        const sessionId = ctx.auth?.sessionId;
        const requestId = req.metadata?.requestId;
        return typeof sessionId === 'string'
          ? sessionId
          : typeof requestId === 'string' ? requestId : undefined;
      },
    },
  },
};

const middleware: GuardRunner = guard(config);
const request: GuardRequest = { prompt: 'hello', metadata: { requestId: 'request-1' } };
const context: GuardContext = { auth: { sessionId: 'session-1' } };
const result: Promise<string | GuardBlockedResponse> = middleware(
  request,
  context,
  async () => 'ok'
);
void result;
