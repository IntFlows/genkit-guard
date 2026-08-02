import assert from 'node:assert/strict';
import {
  createPiiVaultStorage,
  createRedisPiiVaultStorage,
  InMemoryPiiVaultStorage,
} from '../dist/index.js';
import { PiiTokenizer } from '../dist/pii/tokenizer.js';

class FakeRedis {
  hashes = new Map();
  expirations = new Map();

  async hGet(key, field) {
    return this.hashes.get(key)?.[field] ?? null;
  }

  async hSet(key, field, value) {
    const hash = this.hashes.get(key) ?? {};
    hash[field] = value;
    this.hashes.set(key, hash);
  }

  async hGetAll(key) {
    return this.hashes.get(key) ?? {};
  }

  async expire(key, seconds) {
    this.expirations.set(key, seconds);
  }
}

const memory = new InMemoryPiiVaultStorage();
await memory.set('scope-a', '[[EMAIL_token_0]]', 'a@example.com');
assert.equal(await memory.get('scope-a', '[[EMAIL_token_0]]'), 'a@example.com');
assert.equal(await memory.get('scope-b', '[[EMAIL_token_0]]'), undefined);
assert.equal(await memory.getByToken('[[EMAIL_token_0]]'), 'a@example.com');

const custom = createPiiVaultStorage({
  async get(scopeId, token) {
    return scopeId === 'custom' && token === '[[EMAIL_custom_0]]' ? 'custom@example.com' : undefined;
  },
  async set() {},
  async entries(scopeId) {
    return scopeId === 'custom'
      ? [{ token: '[[EMAIL_custom_0]]', value: 'custom@example.com' }]
      : [];
  },
});

const customTokenizer = new PiiTokenizer({ scopeId: 'custom', storage: custom });
assert.equal(await customTokenizer.unmask('Hi [[EMAIL_custom_0]]'), 'Hi custom@example.com');

const redis = new FakeRedis();
const redisStorage = createRedisPiiVaultStorage(redis, {
  keyPrefix: 'test:pii',
  ttlSeconds: 60,
});

const userATokenizer = new PiiTokenizer({ scopeId: 'tenant:userA', storage: redisStorage });
const userBTokenizer = new PiiTokenizer({ scopeId: 'tenant:userB', storage: redisStorage });

const userAMasked = await userATokenizer.mask('Email alice@example.com', [
  { type: 'EMAIL', value: 'alice@example.com' },
]);
const userBMasked = await userBTokenizer.mask('Email bob@example.com', [
  { type: 'EMAIL', value: 'bob@example.com' },
]);

assert.notEqual(userAMasked.maskedText, userBMasked.maskedText);
assert.equal(await userATokenizer.unmask(userAMasked.maskedText), 'Email alice@example.com');
assert.equal(await userBTokenizer.unmask(userBMasked.maskedText), 'Email bob@example.com');
assert.equal(await userATokenizer.unmask(userBMasked.maskedText), userBMasked.maskedText);

const laterPassTokenizer = new PiiTokenizer({ scopeId: 'tenant:userA:later', storage: redisStorage });
await laterPassTokenizer.importTokens(userAMasked.maskedText);
assert.equal(await laterPassTokenizer.unmask(userAMasked.maskedText), 'Email alice@example.com');

console.log('PII vault storage tests passed.');
