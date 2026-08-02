import assert from 'node:assert/strict';
import net from 'node:net';
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
const keyPrefix = `genkit-guard:test:${Date.now()}`;
const storage = createRedisPiiVaultStorage(redis, { keyPrefix, ttlSeconds: 60 });

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

  console.log('Live Redis PII vault test passed.');
} finally {
  await redis.del(`${keyPrefix}:tokens`).catch(() => {});
  await redis.del(`${keyPrefix}:scope:tenant:userA`).catch(() => {});
  await redis.del(`${keyPrefix}:scope:tenant:userB`).catch(() => {});
  await redis.del(`${keyPrefix}:scope:tenant:userA:later`).catch(() => {});
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
