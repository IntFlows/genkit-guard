export type PiiVaultEntry = {
  token: string;
  value: string;
};

export interface PiiVaultStorage {
  get(scopeId: string, token: string): string | undefined | Promise<string | undefined>;
  getByToken?(token: string): string | undefined | Promise<string | undefined>;
  set(scopeId: string, token: string, value: string): void | Promise<void>;
  entries(scopeId: string): PiiVaultEntry[] | Promise<PiiVaultEntry[]>;
}

export type PiiVaultStorageAdapter = {
  get: PiiVaultStorage['get'];
  getByToken?: PiiVaultStorage['getByToken'];
  set: PiiVaultStorage['set'];
  entries: PiiVaultStorage['entries'];
};

export function createPiiVaultStorage(adapter: PiiVaultStorageAdapter): PiiVaultStorage {
  return adapter;
}

export type RedisPiiVaultClient = {
  hGet?: (key: string, field: string) => Promise<string | null | undefined>;
  hSet?: (key: string, field: string, value: string) => Promise<unknown>;
  hGetAll?: (key: string) => Promise<Record<string, string>>;
  hget?: (key: string, field: string) => Promise<string | null | undefined>;
  hset?: (key: string, field: string, value: string) => Promise<unknown>;
  hgetall?: (key: string) => Promise<Record<string, string>>;
  expire?: (key: string, seconds: number) => Promise<unknown>;
};

export type RedisPiiVaultStorageOptions = {
  keyPrefix?: string;
  tokenIndexKey?: string;
  ttlSeconds?: number;
};

export function createRedisPiiVaultStorage(
  redis: RedisPiiVaultClient,
  options: RedisPiiVaultStorageOptions = {}
): PiiVaultStorage {
  const keyPrefix = options.keyPrefix ?? 'genkit-guard:pii';
  const tokenIndexKey = options.tokenIndexKey ?? `${keyPrefix}:tokens`;

  const hGet = redis.hGet?.bind(redis) ?? redis.hget?.bind(redis);
  const hSet = redis.hSet?.bind(redis) ?? redis.hset?.bind(redis);
  const hGetAll = redis.hGetAll?.bind(redis) ?? redis.hgetall?.bind(redis);

  if (!hGet || !hSet || !hGetAll) {
    throw new Error('Redis PII vault storage requires hGet/hSet/hGetAll or hget/hset/hgetall methods.');
  }

  const scopeKey = (scopeId: string) => `${keyPrefix}:scope:${scopeId}`;

  async function maybeExpire(key: string) {
    if (options.ttlSeconds && redis.expire) {
      await redis.expire(key, options.ttlSeconds);
    }
  }

  return createPiiVaultStorage({
    async get(scopeId, token) {
      return (await hGet(scopeKey(scopeId), token)) ?? undefined;
    },
    async getByToken(token) {
      return (await hGet(tokenIndexKey, token)) ?? undefined;
    },
    async set(scopeId, token, value) {
      const scopedKey = scopeKey(scopeId);
      await hSet(scopedKey, token, value);
      await hSet(tokenIndexKey, token, value);
      await maybeExpire(scopedKey);
      await maybeExpire(tokenIndexKey);
    },
    async entries(scopeId) {
      const values = await hGetAll(scopeKey(scopeId));
      return Object.entries(values).map(([token, value]) => ({ token, value }));
    },
  });
}

export class InMemoryPiiVaultStorage implements PiiVaultStorage {
  private scopes = new Map<string, Map<string, string>>();
  private tokenIndex = new Map<string, string>();

  get(scopeId: string, token: string) {
    return this.scopes.get(scopeId)?.get(token);
  }

  getByToken(token: string) {
    return this.tokenIndex.get(token);
  }

  set(scopeId: string, token: string, value: string) {
    this.getScope(scopeId).set(token, value);
    this.tokenIndex.set(token, value);
  }

  entries(scopeId: string): PiiVaultEntry[] {
    return Array.from(this.getScope(scopeId), ([token, value]) => ({ token, value }));
  }

  private getScope(scopeId: string) {
    let scope = this.scopes.get(scopeId);
    if (!scope) {
      scope = new Map<string, string>();
      this.scopes.set(scopeId, scope);
    }
    return scope;
  }
}

export const defaultPiiVaultStorage = new InMemoryPiiVaultStorage();
