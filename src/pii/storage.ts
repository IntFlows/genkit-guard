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
  /** Expire Redis vault keys after this many seconds. Omit to keep them indefinitely. */
  ttlSeconds?: number;
  /**
   * Keep a process-local mirror and use it when a Redis operation fails.
   * Disabled by default so Redis failures remain visible to callers.
   */
  fallbackToMemory?: boolean;
};

export function createRedisPiiVaultStorage(
  redis: RedisPiiVaultClient,
  options: RedisPiiVaultStorageOptions = {}
): PiiVaultStorage {
  const keyPrefix = options.keyPrefix ?? 'genkit-guard:pii';
  const tokenIndexKey = options.tokenIndexKey ?? `${keyPrefix}:tokens`;
  const ttlSeconds = options.ttlSeconds;

  if (ttlSeconds !== undefined && (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0)) {
    throw new Error('Redis PII vault ttlSeconds must be a positive integer.');
  }

  if (ttlSeconds !== undefined && !redis.expire) {
    throw new Error('Redis PII vault ttlSeconds requires an expire method on the Redis client.');
  }

  const hGet = redis.hGet?.bind(redis) ?? redis.hget?.bind(redis);
  const hSet = redis.hSet?.bind(redis) ?? redis.hset?.bind(redis);
  const hGetAll = redis.hGetAll?.bind(redis) ?? redis.hgetall?.bind(redis);

  if (!hGet || !hSet || !hGetAll) {
    throw new Error('Redis PII vault storage requires hGet/hSet/hGetAll or hget/hset/hgetall methods.');
  }

  const scopeKey = (scopeId: string) => `${keyPrefix}:scope:${scopeId}`;
  const fallback = options.fallbackToMemory ? new ExpiringInMemoryPiiVaultStorage(ttlSeconds) : undefined;

  async function maybeExpire(key: string) {
    if (ttlSeconds !== undefined) {
      await redis.expire!(key, ttlSeconds);
    }
  }

  async function withFallback<T>(redisOperation: () => Promise<T>, memoryOperation: () => T | Promise<T>) {
    try {
      return await redisOperation();
    } catch (error) {
      if (!fallback) throw error;
      return memoryOperation();
    }
  }

  return createPiiVaultStorage({
    async get(scopeId, token) {
      return withFallback(
        async () => (await hGet(scopeKey(scopeId), token)) ?? undefined,
        () => fallback!.get(scopeId, token)
      );
    },
    async getByToken(token) {
      return withFallback(
        async () => (await hGet(tokenIndexKey, token)) ?? undefined,
        () => fallback!.getByToken(token)
      );
    },
    async set(scopeId, token, value) {
      const scopedKey = scopeKey(scopeId);
      // Warm the opt-in fallback on every write so data written before an outage is available.
      await fallback?.set(scopeId, token, value);
      await withFallback(
        async () => {
          await hSet(scopedKey, token, value);
          await hSet(tokenIndexKey, token, value);
          await maybeExpire(scopedKey);
          await maybeExpire(tokenIndexKey);
        },
        () => undefined
      );
    },
    async entries(scopeId) {
      return withFallback(
        async () => {
          const values = await hGetAll(scopeKey(scopeId));
          return Object.entries(values).map(([token, value]) => ({ token, value }));
        },
        () => fallback!.entries(scopeId)
      );
    },
  });
}

class ExpiringInMemoryPiiVaultStorage implements PiiVaultStorage {
  private readonly storage = new InMemoryPiiVaultStorage();
  private readonly scopeExpiresAt = new Map<string, number>();
  private tokenIndexExpiresAt?: number;

  constructor(private readonly ttlSeconds?: number) {}

  get(scopeId: string, token: string) {
    return this.isScopeExpired(scopeId) ? undefined : this.storage.get(scopeId, token);
  }

  getByToken(token: string) {
    return this.isTokenIndexExpired() ? undefined : this.storage.getByToken(token);
  }

  set(scopeId: string, token: string, value: string) {
    this.storage.set(scopeId, token, value);
    if (this.ttlSeconds !== undefined) {
      const expiry = Date.now() + this.ttlSeconds * 1_000;
      this.scopeExpiresAt.set(scopeId, expiry);
      this.tokenIndexExpiresAt = expiry;
    }
  }

  entries(scopeId: string) {
    return this.isScopeExpired(scopeId) ? [] : this.storage.entries(scopeId);
  }

  private isScopeExpired(scopeId: string) {
    const expiry = this.scopeExpiresAt.get(scopeId);
    return expiry !== undefined && expiry <= Date.now();
  }

  private isTokenIndexExpired() {
    return this.tokenIndexExpiresAt !== undefined && this.tokenIndexExpiresAt <= Date.now();
  }
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
