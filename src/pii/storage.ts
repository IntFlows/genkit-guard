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
  /** Node-redis-compatible EVAL adapter. Required with ttlSeconds (Redis 7+). */
  eval?: (script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>;
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

// Each hash write and its expiry execute without client-side interleaving.
// Redis 7+ ACL preflight prevents HSET succeeding when EXPIRE is denied.
const writeExpiringHash = `
if not redis.acl_check_cmd('HSET', KEYS[1], ARGV[1], ARGV[2]) or
   not redis.acl_check_cmd('EXPIRE', KEYS[1], ARGV[3]) then
  return redis.error_reply('ERR PII vault write permissions unavailable')
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

export function createRedisPiiVaultStorage(
  redis: RedisPiiVaultClient,
  options: RedisPiiVaultStorageOptions = {}
): PiiVaultStorage {
  const keyPrefix = options.keyPrefix ?? 'genkit-guard:pii';
  const tokenIndexKey = options.tokenIndexKey ?? `${keyPrefix}:tokens`;
  const ttlSeconds = options.ttlSeconds;

  if (ttlSeconds !== undefined && (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 2_147_483_647)) {
    throw new Error('Redis PII vault ttlSeconds must be a positive integer no greater than 2147483647.');
  }

  if (ttlSeconds !== undefined && typeof redis.eval !== 'function') {
    throw new Error('Redis PII vault ttlSeconds requires an eval method on the Redis client and Redis 7 or newer.');
  }

  const hGet = redis.hGet?.bind(redis) ?? redis.hget?.bind(redis);
  const hSet = redis.hSet?.bind(redis) ?? redis.hset?.bind(redis);
  const hGetAll = redis.hGetAll?.bind(redis) ?? redis.hgetall?.bind(redis);

  if (!hGet || !hSet || !hGetAll) {
    throw new Error('Redis PII vault storage requires hGet/hSet/hGetAll or hget/hset/hgetall methods.');
  }

  const scopeKey = (scopeId: string) => `${keyPrefix}:scope:${scopeId}`;
  const fallback = options.fallbackToMemory ? new ExpiringInMemoryPiiVaultStorage(ttlSeconds) : undefined;

  async function writeHash(key: string, token: string, value: string) {
    if (ttlSeconds === undefined) {
      await hSet!(key, token, value);
    } else {
      await redis.eval!(writeExpiringHash, {
        keys: [key], arguments: [token, value, String(ttlSeconds)],
      });
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
          await writeHash(scopedKey, token, value);
          await writeHash(tokenIndexKey, token, value);
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
  private readonly scopes = new Map<string, Map<string, string>>();
  private readonly tokenIndex = new Map<string, string>();
  private readonly scopeExpiresAt = new Map<string, number>();
  private tokenIndexExpiresAt?: number;

  constructor(private readonly ttlSeconds?: number) {}

  get(scopeId: string, token: string) {
    this.expireScope(scopeId);
    return this.scopes.get(scopeId)?.get(token);
  }

  getByToken(token: string) {
    this.expireTokenIndex();
    return this.tokenIndex.get(token);
  }

  set(scopeId: string, token: string, value: string) {
    // Remove expired hashes before refreshing TTL, just as Redis does on HSET.
    this.expireScope(scopeId);
    this.expireTokenIndex();
    let scope = this.scopes.get(scopeId);
    if (!scope) {
      scope = new Map<string, string>();
      this.scopes.set(scopeId, scope);
    }
    scope.set(token, value);
    this.tokenIndex.set(token, value);
    if (this.ttlSeconds !== undefined) {
      const expiry = Date.now() + this.ttlSeconds * 1_000;
      this.scopeExpiresAt.set(scopeId, expiry);
      this.tokenIndexExpiresAt = expiry;
    }
  }

  entries(scopeId: string) {
    this.expireScope(scopeId);
    return Array.from(this.scopes.get(scopeId) ?? [], ([token, value]) => ({ token, value }));
  }

  private expireScope(scopeId: string) {
    const expiry = this.scopeExpiresAt.get(scopeId);
    if (expiry !== undefined && expiry <= Date.now()) {
      this.scopes.delete(scopeId);
      this.scopeExpiresAt.delete(scopeId);
    }
  }

  private expireTokenIndex() {
    if (this.tokenIndexExpiresAt !== undefined && this.tokenIndexExpiresAt <= Date.now()) {
      this.tokenIndex.clear();
      this.tokenIndexExpiresAt = undefined;
    }
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
    return Array.from(this.scopes.get(scopeId) ?? [], ([token, value]) => ({ token, value }));
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
