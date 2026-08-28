import { guard, createRedisPiiVaultStorage, type RedisPiiVaultClient } from '../src/index.js';

const redis: RedisPiiVaultClient = {
  async hGet() {
    return undefined;
  },
  async hSet() {},
  async hGetAll() {
    return {};
  },
};

guard({
  pii: {
    reversible: true,
    vault: {
      storage: createRedisPiiVaultStorage(redis),
      scopeId: (req: any, ctx: any) => ctx?.auth?.sessionId ?? req?.metadata?.requestId,
    },
  },
});
