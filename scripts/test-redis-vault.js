import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createRedisPiiVaultStorage } from '../dist/index.js';
import { PiiTokenizer } from '../dist/pii/tokenizer.js';

class RespRedisClient {
  constructor(host = '127.0.0.1', port = 6379) {
    this.host = host;
    this.port = port;
  }

  async hGet(key, field) {
    return this.command('HGET', key, field);
  }

  async hSet(key, field, value) {
    return this.command('HSET', key, field, value);
  }

  async hGetAll(key) {
    const values = await this.command('HGETALL', key);
    const out = {};
    for (let i = 0; i < values.length; i += 2) {
      out[values[i]] = values[i + 1];
    }
    return out;
  }

  async eval(script, { keys, arguments: args }) {
    return this.command('EVAL', script, String(keys.length), ...keys, ...args);
  }

  async expire(key, seconds) {
    return this.command('EXPIRE', key, String(seconds));
  }

  async del(key) {
    return this.command('DEL', key);
  }

  command(...parts) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let buffer = Buffer.alloc(0);

      socket.setTimeout(3000);
      socket.once('error', reject);
      socket.once('close', () => reject(new Error('Redis connection closed before response')));
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error(`Timed out connecting to Redis at ${this.host}:${this.port}`));
      });
      socket.once('connect', () => {
        socket.write(encodeCommand(parts));
      });
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          const [value, offset] = parseResp(buffer, 0);
          if (offset <= buffer.length) {
            socket.end();
            resolve(value);
          }
        } catch (error) {
          if (error.message !== 'Incomplete RESP response') {
            socket.destroy();
            reject(error);
          }
        }
      });
    });
  }
}

const redis = new RespRedisClient(process.env.REDIS_HOST ?? '127.0.0.1', Number(process.env.REDIS_PORT ?? 6379));
const keyPrefix = `genkit-guard:test:${randomUUID()}`;
const storage = createRedisPiiVaultStorage(redis, { keyPrefix, ttlSeconds: 60 });
const cleanupKeys = new Set([`${keyPrefix}:tokens`]);
for (const scope of ['tenant:userA', 'tenant:userB', 'tenant:userA:later']) {
  cleanupKeys.add(`${keyPrefix}:scope:${scope}`);
}

try {
  const userA = new PiiTokenizer({ scopeId: 'tenant:userA', storage });
  const userB = new PiiTokenizer({ scopeId: 'tenant:userB', storage });

  const maskedA = await userA.mask('Email alice@example.com', [
    { type: 'EMAIL', value: 'alice@example.com' },
  ]);
  const maskedB = await userB.mask('Email bob@example.com', [
    { type: 'EMAIL', value: 'bob@example.com' },
  ]);

  assert.equal(await userA.unmask(maskedA.maskedText), 'Email alice@example.com');
  assert.equal(await userB.unmask(maskedB.maskedText), 'Email bob@example.com');
  assert.equal(await userA.unmask(maskedB.maskedText), maskedB.maskedText);

  const laterPass = new PiiTokenizer({ scopeId: 'tenant:userA:later', storage });
  await laterPass.importTokens(maskedA.maskedText);
  assert.equal(await laterPass.unmask(maskedA.maskedText), 'Email alice@example.com');

  // Concurrent writes in one scope and across scopes must preserve every token.
  const writes = Array.from({ length: 20 }, (_, i) => ({
    scope: i < 10 ? 'shared' : `concurrent-${i}`,
    token: `token-${i}`,
    value: `synthetic-${i}@example.com`,
  }));
  for (const { scope } of writes) cleanupKeys.add(`${keyPrefix}:scope:${scope}`);
  await Promise.all(writes.map(({ scope, token, value }) => storage.set(scope, token, value)));
  for (const { scope, token, value } of writes) {
    assert.equal(await storage.get(scope, token), value);
    assert.equal(await storage.getByToken(token), value);
  }
  assert.equal((await storage.entries('shared')).length, 10);

  for (const key of cleanupKeys) {
    assert.ok(await redis.command('TTL', key) > 0, `Missing TTL on ${key}`);
  }
  // A wrong-type index rejects the second script; the completed scope retains its TTL.
  const partialPrefix = `${keyPrefix}:partial`;
  const partialScope = `${partialPrefix}:scope:partial`;
  const partialIndex = `${partialPrefix}:tokens`;
  cleanupKeys.add(partialScope);
  cleanupKeys.add(partialIndex);
  await redis.command('SET', partialIndex, 'wrong-type');
  const partial = createRedisPiiVaultStorage(redis, { keyPrefix: partialPrefix, ttlSeconds: 60 });
  await assert.rejects(partial.set('partial', 'token', 'synthetic@example.com'), /WRONGTYPE/);
  assert.ok(await redis.command('TTL', partialScope) > 0);
  assert.equal(await partial.get('partial', 'token'), 'synthetic@example.com');
  const expiryPrefix = `${keyPrefix}:expiry`;
  cleanupKeys.add(`${expiryPrefix}:tokens`);
  cleanupKeys.add(`${expiryPrefix}:scope:expiry`);
  const expiring = createRedisPiiVaultStorage(redis, { keyPrefix: expiryPrefix, ttlSeconds: 1 });
  await expiring.set('expiry', 'old', 'old@example.com');
  assert.equal(await expiring.get('expiry', 'old'), 'old@example.com');
  const deadline = Date.now() + 5000;
  while (await redis.command('EXISTS', `${expiryPrefix}:scope:expiry`, `${expiryPrefix}:tokens`)) {
    assert.ok(Date.now() < deadline, 'Redis vault keys did not expire within five seconds');
    await delay(50);
  }
  assert.equal(await expiring.get('expiry', 'old'), undefined);
  assert.equal(await expiring.getByToken('old'), undefined);
  assert.deepEqual(await expiring.entries('expiry'), []);
  await expiring.set('expiry', 'new', 'new@example.com');
  assert.equal(await expiring.get('expiry', 'old'), undefined);
  assert.equal(await expiring.getByToken('old'), undefined);
  assert.equal(await expiring.getByToken('new'), 'new@example.com');
  // Fault only this test's TCP proxy; never stop a shared Redis server.
  let disconnected = false;
  const sockets = new Set();
  const proxy = net.createServer(socket => {
    if (disconnected) { socket.destroy(); return; }
    const upstream = net.createConnection({ host: redis.host, port: redis.port });
    for (const connection of [socket, upstream]) {
      sockets.add(connection);
      connection.on('error', () => { socket.destroy(); upstream.destroy(); });
      connection.once('close', () => sockets.delete(connection));
    }
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  try {
    const client = new RespRedisClient('127.0.0.1', proxy.address().port);
    const outagePrefix = `${keyPrefix}:outage`;
    for (const suffix of ['strict', 'fallback']) {
      cleanupKeys.add(`${outagePrefix}:${suffix}:tokens`);
      cleanupKeys.add(`${outagePrefix}:${suffix}:scope:session`);
    }
    const strict = createRedisPiiVaultStorage(client, { keyPrefix: `${outagePrefix}:strict`, ttlSeconds: 60 });
    const fallback = createRedisPiiVaultStorage(client, { keyPrefix: `${outagePrefix}:fallback`, ttlSeconds: 60, fallbackToMemory: true });
    await strict.set('session', 'before', 'before@example.com');
    await fallback.set('session', 'before', 'before@example.com');
    disconnected = true;
    for (const socket of sockets) socket.destroy();
    await assert.rejects(strict.get('session', 'before'));
    await assert.rejects(strict.set('session', 'during', 'during@example.com'));
    const tokenizer = new PiiTokenizer({ storage: strict, scopeId: 'session' });
    await assert.rejects(tokenizer.unmask('anything'), { code: 'VAULT_UNAVAILABLE' });
    assert.equal(await fallback.get('session', 'before'), 'before@example.com');
    await fallback.set('session', 'during', 'during@example.com');
    assert.equal(await fallback.get('session', 'during'), 'during@example.com');
    disconnected = false;
    assert.equal(await strict.get('session', 'before'), 'before@example.com');
    assert.equal(await strict.get('session', 'during'), undefined);
    assert.equal(await fallback.get('session', 'during'), undefined, 'Recovery must not replay memory-only writes');
    await fallback.set('session', 'after', 'after@example.com');
    assert.equal(await fallback.get('session', 'after'), 'after@example.com');
    console.log('Live Redis disconnect/recovery passed: strict failure, fallback mirror, authoritative recovery, no replay.');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
  }
  console.log('Live Redis PII vault tests passed: isolation, cross-turn restoration, concurrent writes and expiry.');
} finally {
  await Promise.all([...cleanupKeys].map((key) => redis.del(key)));
}

function encodeCommand(parts) {
  return `*${parts.length}\r\n${parts.map((part) => {
    const value = String(part);
    return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }).join('')}`;
}

function parseResp(buffer, offset) {
  if (offset >= buffer.length) {
    throw new Error('Incomplete RESP response');
  }

  const prefix = String.fromCharCode(buffer[offset]);
  if (prefix === '+') return parseSimple(buffer, offset);
  if (prefix === '-') {
    const [message] = parseSimple(buffer, offset);
    throw new Error(message);
  }
  if (prefix === ':') {
    const [value, next] = parseSimple(buffer, offset);
    return [Number(value), next];
  }
  if (prefix === '$') return parseBulk(buffer, offset);
  if (prefix === '*') return parseArray(buffer, offset);
  throw new Error(`Unsupported RESP prefix: ${prefix}`);
}

function parseSimple(buffer, offset) {
  const end = buffer.indexOf('\r\n', offset);
  if (end === -1) throw new Error('Incomplete RESP response');
  return [buffer.toString('utf8', offset + 1, end), end + 2];
}

function parseBulk(buffer, offset) {
  const [lengthText, valueStart] = parseSimple(buffer, offset);
  const length = Number(lengthText);
  if (length === -1) return [null, valueStart];
  const valueEnd = valueStart + length;
  if (buffer.length < valueEnd + 2) throw new Error('Incomplete RESP response');
  return [buffer.toString('utf8', valueStart, valueEnd), valueEnd + 2];
}

function parseArray(buffer, offset) {
  const [lengthText, start] = parseSimple(buffer, offset);
  const values = [];
  let next = start;
  for (let i = 0; i < Number(lengthText); i++) {
    const [value, newOffset] = parseResp(buffer, next);
    values.push(value);
    next = newOffset;
  }
  return [values, next];
}
