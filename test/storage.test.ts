import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPiiVaultStorage,
  createRedisPiiVaultStorage,
  InMemoryPiiVaultStorage,
  type RedisPiiVaultClient,
} from '../src/pii/storage.js';
import { PiiTokenizer } from '../src/pii/tokenizer.js';

class FakeRedis implements RedisPiiVaultClient {
  hashes = new Map<string, Record<string, string>>();
  expirations = new Map<string, number>();
  failed = false;

  async hGet(key: string, field: string) {
    this.assertAvailable();
    return this.hashes.get(key)?.[field] ?? null;
  }

  async hSet(key: string, field: string, value: string) {
    this.assertAvailable();
    const hash = this.hashes.get(key) ?? {};
    hash[field] = value;
    this.hashes.set(key, hash);
  }

  async hGetAll(key: string) {
    this.assertAvailable();
    return this.hashes.get(key) ?? {};
  }

  async expire(key: string, seconds: number) {
    this.assertAvailable();
    this.expirations.set(key, seconds);
  }

  private assertAvailable() {
    if (this.failed) throw new Error('Redis unavailable');
  }
}

afterEach(() => vi.useRealTimers());

describe('PII vault storage', () => {
  it('isolates in-memory values by scope while supporting token lookup', async () => {
    const storage = new InMemoryPiiVaultStorage();
    await storage.set('a', 'token', 'secret');

    expect(await storage.get('a', 'token')).toBe('secret');
    expect(await storage.get('b', 'token')).toBeUndefined();
    expect(await storage.getByToken('token')).toBe('secret');
    expect(await storage.entries('a')).toEqual([{ token: 'token', value: 'secret' }]);
  });

  it('creates a custom adapter without changing its methods', async () => {
    const adapter = createPiiVaultStorage({
      get: async () => 'value',
      getByToken: async () => 'indexed',
      set: async () => undefined,
      entries: async () => [{ token: 'token', value: 'value' }],
    });

    expect(await adapter.get('scope', 'token')).toBe('value');
    expect(await adapter.getByToken?.('token')).toBe('indexed');
  });

  it('supports camel-case and lower-case Redis client methods', async () => {
    const hashes = new Map<string, Record<string, string>>();
    const lowerCaseClient: RedisPiiVaultClient = {
      hget: async (key, field) => hashes.get(key)?.[field] ?? null,
      hset: async (key, field, value) => {
        const hash = hashes.get(key) ?? {};
        hash[field] = value;
        hashes.set(key, hash);
      },
      hgetall: async (key) => hashes.get(key) ?? {},
    };
    const storage = createRedisPiiVaultStorage(lowerCaseClient);
    await storage.set('scope', 'token', 'value');

    expect(await storage.get('scope', 'token')).toBe('value');
    expect(await storage.getByToken?.('token')).toBe('value');
    expect(await storage.entries('scope')).toEqual([{ token: 'token', value: 'value' }]);
  });

  it('applies TTL to scoped and token-index hashes', async () => {
    const redis = new FakeRedis();
    const storage = createRedisPiiVaultStorage(redis, { keyPrefix: 'test', ttlSeconds: 60 });
    await storage.set('scope', 'token', 'value');

    expect(redis.expirations).toEqual(new Map([
      ['test:scope:scope', 60],
      ['test:tokens', 60],
    ]));
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid TTL %s', (ttlSeconds) => {
    expect(() => createRedisPiiVaultStorage(new FakeRedis(), { ttlSeconds })).toThrow(
      'positive integer'
    );
  });

  it('requires expire support when TTL is configured', () => {
    expect(() => createRedisPiiVaultStorage({
      hGet: async () => null,
      hSet: async () => undefined,
      hGetAll: async () => ({}),
    }, { ttlSeconds: 60 })).toThrow('requires an expire method');
  });

  it('rejects incompatible Redis clients at construction', () => {
    expect(() => createRedisPiiVaultStorage({})).toThrow('requires hGet/hSet/hGetAll');
  });

  it('propagates Redis failures by default', async () => {
    const redis = new FakeRedis();
    const storage = createRedisPiiVaultStorage(redis);
    redis.failed = true;

    await expect(storage.get('scope', 'token')).rejects.toThrow('Redis unavailable');
    await expect(storage.set('scope', 'token', 'value')).rejects.toThrow('Redis unavailable');
    await expect(storage.entries('scope')).rejects.toThrow('Redis unavailable');
  });

  it('uses its warm memory mirror for all operations during an outage', async () => {
    const redis = new FakeRedis();
    const storage = createRedisPiiVaultStorage(redis, { fallbackToMemory: true });
    await storage.set('scope', 'token', 'value');
    redis.failed = true;

    expect(await storage.get('scope', 'token')).toBe('value');
    expect(await storage.getByToken?.('token')).toBe('value');
    expect(await storage.entries('scope')).toEqual([{ token: 'token', value: 'value' }]);
    await expect(storage.set('scope', 'second', 'offline')).resolves.toBeUndefined();
    expect(await storage.get('scope', 'second')).toBe('offline');
  });

  it('expires fallback scope and token-index data using the configured TTL', async () => {
    vi.useFakeTimers();
    const redis = new FakeRedis();
    const storage = createRedisPiiVaultStorage(redis, { ttlSeconds: 1, fallbackToMemory: true });
    await storage.set('scope', 'token', 'value');
    redis.failed = true;
    await vi.advanceTimersByTimeAsync(1_001);

    expect(await storage.get('scope', 'token')).toBeUndefined();
    expect(await storage.getByToken?.('token')).toBeUndefined();
    expect(await storage.entries('scope')).toEqual([]);
  });
});

describe('PII tokenizer', () => {
  it('masks, reuses tokens, reports types and restores values', async () => {
    const tokenizer = new PiiTokenizer({ scopeId: 'scope' });
    const result = await tokenizer.mask('alice@example.com alice@example.com', [
      { type: 'EMAIL', value: 'alice@example.com' },
      { type: 'EMAIL', value: 'missing@example.com' },
    ]);

    expect(result.maskedText.match(/\[\[EMAIL_/g)).toHaveLength(2);
    expect(result.piiTypes).toEqual(['email']);
    expect(Object.keys(result.pii)).toHaveLength(1);
    expect(await tokenizer.unmask(result.maskedText)).toBe('alice@example.com alice@example.com');
  });

  it('imports externally stored tokens into a later scope', async () => {
    const storage = new InMemoryPiiVaultStorage();
    const first = new PiiTokenizer({ scopeId: 'first', storage });
    const masked = await first.mask('alice@example.com', [
      { type: 'EMAIL', value: 'alice@example.com' },
    ]);
    const later = new PiiTokenizer({ scopeId: 'later', storage });
    await later.importTokens(masked.maskedText);

    expect(await later.unmask(masked.maskedText)).toBe('alice@example.com');
  });

  it('does nothing when token lookup is unsupported', async () => {
    const tokenizer = new PiiTokenizer({
      scopeId: 'scope',
      storage: createPiiVaultStorage({
        get: async () => undefined,
        set: async () => undefined,
        entries: async () => [],
      }),
    });

    await expect(tokenizer.importTokens('[[EMAIL_namespace_0]]')).resolves.toBeUndefined();
  });
});
