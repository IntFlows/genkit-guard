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

  async eval(_script, { keys, arguments: args }) {
    await this.hSet(keys[0], args[0], args[1]);
    await this.expire(keys[0], Number(args[2]));
    return 1;
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

assert.equal(redis.expirations.get('test:pii:scope:tenant:userA'), 60);
assert.equal(redis.expirations.get('test:pii:tokens'), 60);

class FailingRedis extends FakeRedis {
  failed = false;

  fail() {
    this.failed = true;
  }

  async hGet(key, field) {
    if (this.failed) throw new Error('Redis unavailable');
    return super.hGet(key, field);
  }

  async hSet(key, field, value) {
    if (this.failed) throw new Error('Redis unavailable');
    return super.hSet(key, field, value);
  }

  async hGetAll(key) {
    if (this.failed) throw new Error('Redis unavailable');
    return super.hGetAll(key);
  }
}

const failingRedis = new FailingRedis();
const resilientStorage = createRedisPiiVaultStorage(failingRedis, { fallbackToMemory: true });
await resilientStorage.set('resilient-scope', '[[EMAIL_resilient_0]]', 'safe@example.com');
failingRedis.fail();
assert.equal(
  await resilientStorage.get('resilient-scope', '[[EMAIL_resilient_0]]'),
  'safe@example.com'
);
assert.equal(await resilientStorage.getByToken('[[EMAIL_resilient_0]]'), 'safe@example.com');
assert.deepEqual(await resilientStorage.entries('resilient-scope'), [
  { token: '[[EMAIL_resilient_0]]', value: 'safe@example.com' },
]);
await resilientStorage.set('resilient-scope', '[[PHONE_resilient_1]]', '0400000000');
assert.equal(await resilientStorage.getByToken('[[PHONE_resilient_1]]'), '0400000000');

const strictRedis = new FailingRedis();
const strictStorage = createRedisPiiVaultStorage(strictRedis);
strictRedis.fail();
await assert.rejects(() => strictStorage.get('scope', 'token'), /Redis unavailable/);

assert.throws(
  () => createRedisPiiVaultStorage(new FakeRedis(), { ttlSeconds: 0 }),
  /positive integer/
);
assert.throws(
  () =>
    createRedisPiiVaultStorage(
      { hGet: async () => null, hSet: async () => undefined, hGetAll: async () => ({}) },
      { ttlSeconds: 60 }
    ),
  /requires an eval method/
);

// Without TTL, two separate HSET commands can leave partial data.
class PartialFailureRedis extends FakeRedis {
  writeStep = 0;
  readFailed = false;
  constructor(failAt) {
    super();
    this.failAt = failAt;
  }
  async hGet(key, field) {
    if (this.readFailed) throw new Error('Read outage');
    return super.hGet(key, field);
  }
  async hGetAll(key) {
    if (this.readFailed) throw new Error('Read outage');
    return super.hGetAll(key);
  }
  checkWrite() {
    if (++this.writeStep === this.failAt) throw new Error('Injected partial write failure');
  }
  async hSet(key, field, value) {
    this.checkWrite();
    return super.hSet(key, field, value);
  }
  async eval(_script, { keys, arguments: args }) {
    await this.hSet(keys[0], args[0], args[1]);
    await this.expire(keys[0], Number(args[2]));
    return 1;
  }

  async expire(key, seconds) {
    this.checkWrite();
    return super.expire(key, seconds);
  }
}
for (const failAt of [1, 2]) {
  for (const fallbackToMemory of [false, true]) {
    const partial = new PartialFailureRedis(failAt);
    const vault = createRedisPiiVaultStorage(partial, {
      keyPrefix: 'partial', fallbackToMemory,
    });
    const write = () => vault.set('scope', 'token', 'synthetic@example.com');
    if (fallbackToMemory) await write();
    else await assert.rejects(write, /Injected partial write failure/);
    assert.equal(partial.hashes.get('partial:scope:scope')?.token,
      failAt > 1 ? 'synthetic@example.com' : undefined);
    assert.equal(partial.hashes.get('partial:tokens')?.token,
      failAt > 2 ? 'synthetic@example.com' : undefined);
    assert.equal(partial.expirations.get('partial:scope:scope'), undefined);
    assert.equal(partial.expirations.get('partial:tokens'), undefined);
    // A successful Redis miss is authoritative, even with a warmed mirror.
    assert.equal(await vault.getByToken('token'), failAt > 2 ? 'synthetic@example.com' : undefined);
    if (fallbackToMemory) {
      partial.readFailed = true;
      assert.equal(await vault.get('scope', 'token'), 'synthetic@example.com');
      assert.equal(await vault.getByToken('token'), 'synthetic@example.com');
      assert.deepEqual(await vault.entries('scope'), [{ token: 'token', value: 'synthetic@example.com' }]);
      partial.readFailed = false;
    }
    // Retrying this idempotent storage write completes both hashes and TTLs.
    await write();
    assert.equal(partial.expirations.get('partial:scope:scope'), undefined);
    assert.equal(partial.expirations.get('partial:tokens'), undefined);
  }
}

class ScriptFailureRedis extends FakeRedis {
  calls = 0;
  constructor(failAt, committed) { super(); this.failAt = failAt; this.committed = committed; }
  async eval(script, options) {
    if (++this.calls === this.failAt) {
      if (this.committed) await super.eval(script, options);
      throw new Error('Script acknowledgement unavailable');
    }
    return super.eval(script, options);
  }
}
for (const failAt of [1, 2]) {
  for (const committed of [false, true]) {
    for (const fallbackToMemory of [false, true]) {
      const client = new ScriptFailureRedis(failAt, committed);
      const vault = createRedisPiiVaultStorage(client, { ttlSeconds: 60, fallbackToMemory });
      const write = () => vault.set('scope', 'token', 'synthetic@example.com');
      if (fallbackToMemory) await write();
      else await assert.rejects(write, /acknowledgement unavailable/);
      // Every hash the server committed has a TTL, even after an ambiguous reply.
      for (const key of client.hashes.keys()) assert.equal(client.expirations.get(key), 60);
      assert.equal(client.hashes.size, failAt - 1 + Number(committed));
      await write();
      assert.equal(await vault.getByToken('token'), 'synthetic@example.com');
      assert.equal(client.hashes.size, 2);
    }
  }
}
for (const ttlSeconds of [NaN, Infinity, -1, 0, 1.5, 2147483648, Number.MAX_SAFE_INTEGER]) {
  assert.throws(() => createRedisPiiVaultStorage(new FakeRedis(), { ttlSeconds }), /positive integer/);
}
assert.throws(() => createRedisPiiVaultStorage({
  hGet: async () => null, hSet: async () => {}, hGetAll: async () => ({}), expire: async () => 1,
}, { ttlSeconds: 1 }), /requires an eval method/);
// Recovery never replays memory-only writes or merges them into successful Redis reads.
const recoveringRedis = new FailingRedis();
const recovering = createRedisPiiVaultStorage(recoveringRedis, { fallbackToMemory: true });
await recovering.set('recovery', 'before', 'before@example.com');
recoveringRedis.fail();
await recovering.set('recovery', 'during', 'during@example.com');
assert.equal(await recovering.get('recovery', 'during'), 'during@example.com');
assert.equal(await recovering.getByToken('during'), 'during@example.com');
recoveringRedis.failed = false;
assert.equal(await recovering.get('recovery', 'before'), 'before@example.com');
assert.equal(await recovering.get('recovery', 'during'), undefined);
assert.equal(await recovering.getByToken('during'), undefined);
assert.deepEqual(await recovering.entries('recovery'), [{ token: 'before', value: 'before@example.com' }]);
recoveringRedis.fail();
assert.equal(await recovering.getByToken('during'), 'during@example.com');

for (const operation of [
  () => strictStorage.set('scope', 'token', 'synthetic@example.com'),
  () => strictStorage.getByToken('token'),
  () => strictStorage.entries('scope'),
]) await assert.rejects(operation, /Redis unavailable/);
// Use a controlled clock to test expiry without sleeps or a live Redis server.
const originalNow = Date.now;
let now = 0;
Date.now = () => now;
try {
  const unavailable = new FailingRedis();
  unavailable.fail();
  const expiring = createRedisPiiVaultStorage(unavailable, {
    ttlSeconds: 1,
    fallbackToMemory: true,
  });
  await expiring.set('scope-a', 'old', 'old@example.com');
  now = 999;
  assert.equal(await expiring.get('scope-a', 'old'), 'old@example.com');
  now = 1000;
  // A write at the expiry boundary must not revive old scoped or indexed values.
  await expiring.set('scope-a', 'new', 'new@example.com');
  assert.equal(await expiring.get('scope-a', 'old'), undefined);
  assert.equal(await expiring.getByToken('old'), undefined);
  assert.deepEqual(await expiring.entries('scope-a'), [
    { token: 'new', value: 'new@example.com' },
  ]);
  assert.equal(await expiring.getByToken('new'), 'new@example.com');

  // The shared index can remain alive while an individual scope expires.
  now = 1500;
  await expiring.set('scope-b', 'other', 'other@example.com');
  now = 2000;
  assert.equal(await expiring.getByToken('new'), 'new@example.com');
  await expiring.set('scope-a', 'replacement', 'replacement@example.com');
  assert.equal(await expiring.get('scope-a', 'new'), undefined);
  assert.equal(await expiring.getByToken('new'), 'new@example.com');
  assert.equal(await expiring.get('scope-b', 'other'), 'other@example.com');

  now = 3000;
  assert.equal(await expiring.get('scope-a', 'replacement'), undefined);
  assert.deepEqual(await expiring.entries('scope-a'), []);
  assert.equal(await expiring.getByToken('replacement'), undefined);
  await expiring.set('scope-b', 'fresh', 'fresh@example.com');
  assert.equal(await expiring.get('scope-b', 'other'), undefined);
  assert.equal(await expiring.getByToken('new'), undefined);
  assert.equal(await expiring.getByToken('other'), undefined);
  assert.equal(await expiring.getByToken('fresh'), 'fresh@example.com');

  // Refreshing a live scope retains its existing entries.
  now = 3500;
  await expiring.set('scope-b', 'fresh-2', 'fresh-2@example.com');
  now = 4000;
  assert.equal(await expiring.get('scope-b', 'fresh'), 'fresh@example.com');
  now = 4500;
  assert.equal(await expiring.getByToken('fresh'), undefined);
} finally {
  Date.now = originalNow;
}
// Real classifiers can report opaque token names or fragments as PII.
// Protect both incoming placeholders and placeholders created by earlier matches.
const opaque = '[[EMAIL_priornamespace_0]]';
const opaqueMemory = new InMemoryPiiVaultStorage();
opaqueMemory.set('opaque', opaque, 'owner@example.com');
const opaqueTokenizer = new PiiTokenizer({ scopeId: 'opaque', storage: opaqueMemory });
const protectedResult = await opaqueTokenizer.mask(`Existing ${opaque}; email alice@example.com`, [
  { type: 'EMAIL', value: opaque },
  { type: 'EMAIL', value: 'priornamespace' },
  { type: 'EMAIL', value: 'alice@example.com' },
  { type: 'EMAIL', value: 'EMAIL' },
]);
assert.ok(protectedResult.maskedText.includes(opaque));
assert.doesNotMatch(protectedResult.maskedText, /alice@example\.com/);
assert.equal(Object.keys(protectedResult.pii).length, 2);
assert.equal(await opaqueTokenizer.unmask(protectedResult.maskedText),
  'Existing owner@example.com; email alice@example.com');
// A matching fragment outside the placeholder still receives normal masking.
const plainFragment = await opaqueTokenizer.mask(`EMAIL ${opaque}`, [{ type: 'NAME', value: 'EMAIL' }]);
assert.ok(plainFragment.maskedText.endsWith(opaque));
assert.match(plainFragment.maskedText, /^\[\[NAME_/);
assert.equal(await opaqueTokenizer.unmask(plainFragment.maskedText), 'EMAIL owner@example.com');
console.log('PII vault storage tests passed.');
