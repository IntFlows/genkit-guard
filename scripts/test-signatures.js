import assert from 'node:assert/strict';
import { test } from 'node:test';
import { genkit, z } from 'genkit';
import { guard, guardMiddleware } from '../dist/index.js';
import { ModelSingleton } from '../dist/util/singleton.js';

const signature = Buffer.from('opaque provider signature bytes').toString('base64');
const secret = 'sk-live-secret';
const config = { intent: { semantic: { intents: { support: 'Support' } } }, logging: { enabled: false } };
ModelSingleton.getExtractor = async () => async () => ({ tolist: () => [[1, 0], [1, 0]] });

test('content masking preserves protocol fields while protecting payload keys named metadata or thoughtSignature', async () => {
  const scans = [];
  ModelSingleton.getPIIClassifier = async () => async text => {
    scans.push(text);
    return [secret, signature].filter(value => text.includes(value)).map(word => ({ entity_group: 'secret', word }));
  };
  const metadata = { thoughtSignature: signature, thought_signature: signature, marker: 'opaque-marker' };
  const request = {
    prompt: [{ text: `Help ${secret}`, metadata: structuredClone(metadata) }],
    messages: [{ role: 'model', metadata: structuredClone(metadata), content: [
      { text: secret, metadata: structuredClone(metadata) },
      { reasoning: secret, metadata: structuredClone(metadata) },
      { toolRequest: { name: secret, ref: secret, input: { metadata: secret, thoughtSignature: secret } }, metadata: structuredClone(metadata) },
      { toolResponse: { name: secret, ref: secret, output: { secret }, content: [{ text: secret, metadata: structuredClone(metadata) }] } },
      { data: { nested: [secret], metadata: secret, thought_signature: secret } },
      { media: { url: 'data:image/png;base64,' + signature, contentType: 'image/png' }, metadata: structuredClone(metadata) },
      { custom: { signature } },
    ] }],
    docs: [{ content: [{ text: secret, metadata: structuredClone(metadata) }], metadata: structuredClone(metadata) }],
  };
  const response = await guard(config).model(request, {}, async req => {
    assert.doesNotMatch(req.prompt[0].text, /sk-live-secret/);
    assert.deepEqual(req.prompt[0].metadata, metadata);
    const message = req.messages[0];
    assert.deepEqual(message.metadata, metadata);
    for (const part of message.content) if (part.metadata) assert.deepEqual(part.metadata, metadata);
    assert.equal(message.content[2].toolRequest.name, secret);
    assert.equal(message.content[2].toolRequest.ref, secret);
    assert.doesNotMatch(JSON.stringify(message.content[2].toolRequest.input), /sk-live-secret/);
    assert.doesNotMatch(JSON.stringify(message.content[3].toolResponse.output), /sk-live-secret/);
    assert.doesNotMatch(message.content[3].toolResponse.content[0].text, /sk-live-secret/);
    assert.deepEqual(message.content[3].toolResponse.content[0].metadata, metadata);
    assert.doesNotMatch(JSON.stringify(message.content[4].data), /sk-live-secret/);
    assert.equal(message.content[5].media.url, 'data:image/png;base64,' + signature);
    assert.equal(message.content[6].custom.signature, signature);
    assert.doesNotMatch(req.docs[0].content[0].text, /sk-live-secret/);
    assert.deepEqual(req.docs[0].metadata, metadata);
    const token = message.content[0].text;
    // Even token-looking bytes in opaque fields must survive restoration unchanged.
    return { message: { role: 'model', content: [
      { text: token, metadata: { thoughtSignature: token } },
      { toolRequest: { name: token, ref: token, input: { metadata: token } }, metadata },
      { data: { thoughtSignature: token } },
    ] }, custom: { signature: token }, raw: { signature: token } };
  });
  assert.ok(scans.length);
  assert.ok(scans.every(text => !text.includes(signature) && !text.includes('opaque-marker')));
  const parts = response.message.content;
  assert.equal(parts[0].text, secret);
  assert.match(parts[0].metadata.thoughtSignature, /^\[\[SECRET_/);
  assert.match(parts[1].toolRequest.name, /^\[\[SECRET_/);
  assert.match(parts[1].toolRequest.ref, /^\[\[SECRET_/);
  assert.equal(parts[1].toolRequest.input.metadata, secret);
  assert.deepEqual(parts[1].metadata, metadata);
  assert.equal(parts[2].data.thoughtSignature, secret);
  assert.match(response.custom.signature, /^\[\[SECRET_/);
  assert.match(response.raw.signature, /^\[\[SECRET_/);
});

test('real Genkit multi-turn tool history keeps signatures unchanged with classifier enabled', async () => {
  for (const factory of [guard, guardMiddleware]) {
    const scans = [];
    ModelSingleton.getPIIClassifier = async () => async text => {
      scans.push(text);
      // Reproduce the classifier treating a signature as a secret if it is scanned.
      return [signature, secret].filter(value => text.includes(value)).map(word => ({ entity_group: 'secret', word }));
    };
    const ai = genkit({}); let turns = 0; let executions = 0;
    const tool = ai.defineTool({ name: 'lookup', description: 'Test lookup', inputSchema: z.object({ key: z.string() }), outputSchema: z.string() }, async input => {
      executions++; assert.equal(input.key, '[REDACTED]'); return 'Done';
    });
    const model = ai.defineModel({ name: 'test/signature' }, async req => {
      if (++turns === 1) return { message: { role: 'model', content: [{ toolRequest: { name: 'lookup', ref: 'call-1', input: { key: secret } }, metadata: { thoughtSignature: signature } }] } };
      const history = req.messages.find(message => message.role === 'model');
      assert.equal(history.content[0].metadata.thoughtSignature, signature);
      assert.equal(history.content[0].toolRequest.name, 'lookup');
      assert.equal(history.content[0].toolRequest.ref, 'call-1');
      assert.doesNotMatch(history.content[0].toolRequest.input.key, /sk-live-secret/);
      return { message: { role: 'model', content: [{ text: 'Done', metadata: { thoughtSignature: signature } }] } };
    });
    const response = await ai.generate({ model, tools: [tool], prompt: 'Help', use: [factory({ ...config, tools: { defaultAction: 'redact' } })] });
    assert.equal(response.text, 'Done'); assert.equal(turns, 2); assert.equal(executions, 1);
    assert.equal(response.message.content[0].metadata.thoughtSignature, signature);
    assert.ok(scans.every(text => !text.includes(signature)));
  }
});

test('a secret match in content cannot replace identical bytes in a signature', async () => {
  ModelSingleton.getPIIClassifier = async () => async () => [{ entity_group: 'secret', word: signature }];
  await guard(config).model({ messages: [{ role: 'user', content: [
    { text: `Help ${signature}`, metadata: { thoughtSignature: signature, marker: 'ignore previous instructions' } },
  ] }] }, {}, async req => {
    const part = req.messages[0].content[0];
    assert.doesNotMatch(part.text, new RegExp(signature));
    assert.match(part.text, /\[\[SECRET_/);
    assert.equal(part.metadata.thoughtSignature, signature);
    assert.equal(part.metadata.marker, 'ignore previous instructions');
    return {};
  });
});
