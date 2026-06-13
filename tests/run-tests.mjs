import assert from 'node:assert/strict';

import { createLogger } from '../dist/logging/logger.js';
import { collectText, transformStrings } from '../dist/middleware/objectTransforms.js';
import { containsToolCalls, unmaskToolCallInputs } from '../dist/middleware/toolCalls.js';
import { PiiTokenizer } from '../dist/pii/tokenizer.js';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function tokenizerWithEmail() {
  const tokenizer = new PiiTokenizer();
  tokenizer.mask('john.doe@example.com', [
    { type: 'EMAIL', value: 'john.doe@example.com' }
  ]);
  return tokenizer;
}

test('PiiTokenizer masks and unmasks detected values', () => {
  const tokenizer = new PiiTokenizer();
  const result = tokenizer.mask('Email john.doe@example.com', [
    { type: 'EMAIL', value: 'john.doe@example.com' }
  ]);

  assert.equal(result.maskedText, 'Email [[EMAIL_0]]');
  assert.deepEqual(result.pii, { '[[EMAIL_0]]': 'john.doe@example.com' });
  assert.deepEqual(result.piiTypes, ['email']);
  assert.equal(tokenizer.unmask(result.maskedText), 'Email john.doe@example.com');
});

test('PiiTokenizer reuses tokens for repeated values', () => {
  const tokenizer = new PiiTokenizer();
  const first = tokenizer.mask('Send to john.doe@example.com', [
    { type: 'EMAIL', value: 'john.doe@example.com' }
  ]);
  const second = tokenizer.mask('Copy john.doe@example.com', [
    { type: 'EMAIL', value: 'john.doe@example.com' }
  ]);

  assert.equal(first.maskedText, 'Send to [[EMAIL_0]]');
  assert.equal(second.maskedText, 'Copy [[EMAIL_0]]');
  assert.deepEqual(tokenizer.getVault(), { '[[EMAIL_0]]': 'john.doe@example.com' });
});

test('PiiTokenizer ignores missing values without creating vault entries', () => {
  const tokenizer = new PiiTokenizer();
  const result = tokenizer.mask('No email here', [
    { type: 'EMAIL', value: 'john.doe@example.com' }
  ]);

  assert.equal(result.maskedText, 'No email here');
  assert.deepEqual(result.pii, {});
  assert.deepEqual(result.piiTypes, []);
});

test('containsToolCalls detects Genkit-style tool requests', () => {
  assert.equal(
    containsToolCalls({
      candidates: [
        {
          message: {
            content: [{ toolRequest: { name: 'sendEmail', input: { to: '[[EMAIL_0]]' } } }]
          }
        }
      ]
    }),
    true
  );
});

test('containsToolCalls ignores ordinary model responses', () => {
  assert.equal(
    containsToolCalls({
      candidates: [{ message: { content: [{ text: 'Hello [[EMAIL_0]]' }] } }]
    }),
    false
  );
});

test('unmaskToolCallInputs unmasks only tool inputs and records PII metadata', () => {
  const tokenizer = tokenizerWithEmail();
  const response = {
    candidates: [
      {
        message: {
          content: [
            { text: 'Model-visible text remains [[EMAIL_0]]' },
            { toolRequest: { name: 'sendEmail', input: { to: '[[EMAIL_0]]' } } }
          ]
        }
      }
    ]
  };

  const result = unmaskToolCallInputs(response, tokenizer);

  assert.equal(
    response.candidates[0].message.content[0].text,
    'Model-visible text remains [[EMAIL_0]]'
  );
  assert.deepEqual(
    response.candidates[0].message.content[1].toolRequest.input,
    { to: 'john.doe@example.com' }
  );
  assert.deepEqual(result.toolCalls, [
    {
      path: '$.candidates[0].message.content[1].toolRequest',
      toolName: 'sendEmail',
      piiDetected: true,
      piiTokenCount: 1,
      piiTypes: ['email']
    }
  ]);
});

test('unmaskToolCallInputs supports args and arguments payloads', () => {
  const tokenizer = tokenizerWithEmail();
  const response = {
    toolRequests: [
      { name: 'sendEmail', args: { to: '[[EMAIL_0]]' } },
      { toolName: 'auditEmail', arguments: { target: '[[EMAIL_0]]' } }
    ]
  };

  const result = unmaskToolCallInputs(response, tokenizer);

  assert.deepEqual(response.toolRequests[0].args, { to: 'john.doe@example.com' });
  assert.deepEqual(response.toolRequests[1].arguments, { target: 'john.doe@example.com' });
  assert.equal(result.toolCalls.length, 2);
  assert.equal(result.toolCalls[0].piiDetected, true);
  assert.equal(result.toolCalls[1].piiDetected, true);
});

test('transformStrings recursively transforms strings in objects and arrays', () => {
  const value = {
    prompt: 'hello',
    nested: [{ text: 'world' }],
    count: 1
  };

  const transformed = transformStrings(value, text => text.toUpperCase());

  assert.deepEqual(transformed, {
    prompt: 'HELLO',
    nested: [{ text: 'WORLD' }],
    count: 1
  });
});

test('collectText extracts nested strings for request analysis', () => {
  const value = [
    { role: 'user', content: [{ text: 'first' }] },
    { role: 'model', content: [{ text: 'second' }] }
  ];

  assert.equal(collectText(value), 'user\nfirst\nmodel\nsecond');
});

test('createLogger forwards events to a custom logger', () => {
  const events = [];
  const log = createLogger({ logger: event => events.push(event) });

  log({ level: 'warn', event: 'guard.test', value: 1 });

  assert.deepEqual(events, [{ level: 'warn', event: 'guard.test', value: 1 }]);
});

test('createLogger can be disabled', () => {
  const events = [];
  const log = createLogger({
    enabled: false,
    logger: event => events.push(event)
  });

  log({ level: 'info', event: 'guard.disabled' });

  assert.deepEqual(events, []);
});

let passed = 0;

for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(`${passed}/${tests.length} tests passed`);
