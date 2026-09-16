import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { genkit, z } from 'genkit';
import { guard, guardMiddleware, initGuard, GuardModelError, createJsonlDecisionStore, createGuardDecisionStore } from '../dist/index.js';
import { ModelSingleton } from '../dist/util/singleton.js';

const base = { models: { extractor: 'primary-intent', extractorFallback: 'backup-intent' },
  intent: { semantic: { intents: { support: 'Support' }, threshold: 0.7 } },
  pii: { mode: 'classifier', model: 'primary-pii', fallback: { model: 'backup-pii', mode: 'ner', labelMappings: { LABEL_1: 'NAME' } } },
  logging: { enabled: false } };
const vectors = () => ({ tolist: () => [[1, 0], [1, 0]] });
const methods = ['getExtractor', 'getNER', 'getPIIClassifier'];
async function withModels(overrides, work) {
  const originals = Object.fromEntries(methods.map(name => [name, ModelSingleton[name]]));
  Object.assign(ModelSingleton, { getExtractor: async () => async () => vectors(), getNER: async () => async () => [], getPIIClassifier: async () => async () => [] }, overrides);
  try { await work(); } finally { Object.assign(ModelSingleton, originals); }
}
const event = (id = 'one') => ({ schemaVersion: '1', decisionId: id, timestamp: new Date().toISOString(),
  guard: 'tool', policyVersion: 'test-v1', action: 'allow', reasonCode: 'TOOL_ALLOWED', latencyMs: 1 });

test('JSONL persists across instances, strips unknown fields and serializes concurrent writers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guard-audit-'));
  try {
    const path = join(dir, 'nested', 'decisions.jsonl');
    const first = createJsonlDecisionStore(path); const second = createJsonlDecisionStore(path);
    assert.deepEqual(await first.read(), []);
    await Promise.all(Array.from({ length: 60 }, (_, i) => (i % 2 ? first : second).append({ ...event(String(i)), rawPrompt: 'secret@example.com' })));
    const saved = await createJsonlDecisionStore(path).read();
    assert.equal(saved.length, 60); assert.equal(new Set(saved.map(d => d.decisionId)).size, 60);
    assert.doesNotMatch(await readFile(path, 'utf8'), /secret@example.com|rawPrompt/);
    assert.throws(() => first.append({ ...event(), schemaVersion: '999' }));
    assert.throws(() => first.append({ ...event(), latencyMs: NaN }));
    const snapshot = event('snapshot'); const pending = first.append(snapshot); snapshot.policyVersion = 'changed'; await pending;
    assert.equal((await first.read()).at(-1).policyVersion, 'test-v1');
    await writeFile(path, '{broken');
    await assert.rejects(first.read(), /Incomplete/);
    await assert.rejects(first.append(event()), /Incomplete/);
    await writeFile(path, 'not-json\n');
    await assert.rejects(first.read(), /line 1/);
    await writeFile(path, ''); await first.append(event('recovered'));
    assert.equal((await first.read())[0].decisionId, 'recovered');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('store delivery is awaited before callback and before tool; failure is closed', async () => {
  await withModels({}, async () => {
    const order = [];
    const store = createGuardDecisionStore({ append: async () => { await new Promise(r => setTimeout(r, 5)); order.push('stored'); } });
    await guard({ ...base, tools: { defaultAction: 'allow' }, logging: { enabled: false, store, onDecision: () => { order.push('callback'); } } })
      .tool({ toolRequest: { name: 'lookup', input: {} } }, {}, async () => { order.push('executed'); });
    assert.deepEqual(order, ['stored', 'callback', 'executed']);
    const failing = guard({ ...base, tools: { defaultAction: 'allow' }, logging: { enabled: false, store: { append: () => { throw new Error('disk unavailable'); } } } });
    await assert.rejects(failing.tool({ toolRequest: { name: 'lookup', input: {} } }, {}, () => assert.fail('executed')), /disk unavailable/);
    await assert.rejects(failing.model({ prompt: 'Help' }, {}, () => assert.fail('executed')), /disk unavailable/);
  });
});

test('startup fallbacks recover load failures for both guard models', async () => {
  const calls = []; const decisions = [];
  await withModels({
    getExtractor: async name => { calls.push(name); if (name === 'primary-intent') throw new Error('load failed'); return async () => vectors(); },
    getPIIClassifier: async name => { calls.push(name); throw new Error('load failed'); },
    getNER: async name => { calls.push(name); return async () => []; },
  }, async () => {
    await initGuard({ ...base, logging: { enabled: false, onDecision: d => { decisions.push(d); } } });
    assert.deepEqual(calls.sort(), ['backup-intent', 'backup-pii', 'primary-intent', 'primary-pii']);
    assert.equal(decisions.length, 2);
    assert.ok(decisions.every(d => d.reasonCode === 'MODEL_FALLBACK_USED'));
  });
});

test('runtime inference fallback masks using its own mode and labels and keeps regex', async () => {
  const calls = []; const decisions = [];
  await withModels({
    getExtractor: async name => async () => { calls.push(name); if (name === 'primary-intent') throw new Error('input secret'); return vectors(); },
    getPIIClassifier: async () => async () => { throw new Error('alice@example.com'); },
    getNER: async name => async () => { calls.push(name); return [{ entity: 'LABEL_1', word: 'Alice' }]; },
  }, async () => {
    const middleware = guard({ ...base, logging: { enabled: false, onDecision: d => { decisions.push(d); } } });
    const result = await middleware.model({ prompt: 'Help Alice at alice@example.com' }, {}, async req => {
      assert.doesNotMatch(req.prompt, /Alice|alice@example.com/);
      assert.match(req.prompt, /NAME_/); assert.match(req.prompt, /EMAIL_/);
      assert.equal(req.metadata.piiEffectiveModel, 'backup-pii');
      assert.equal(req.metadata.piiEffectiveMode, 'ner');
      assert.equal(req.metadata.piiUsedFallback, true);
      return { text: req.prompt };
    });
    assert.equal(result.text, 'Help Alice at alice@example.com');
    assert.deepEqual(calls, ['primary-intent', 'backup-intent', 'backup-pii']);
    assert.equal(decisions.filter(d => d.reasonCode === 'MODEL_FALLBACK_USED').length, 2);
    assert.doesNotMatch(JSON.stringify(decisions), /Alice|alice@example.com|input secret/);
  });
});

test('fallback label mappings do not inherit primary mappings', async () => {
  await withModels({ getPIIClassifier: async name => async () => {
    if (name === 'primary-pii') throw new Error('failed');
    return [{ entity_group: 'private_person', word: 'Alice' }];
  } }, async () => {
    const config = { ...base, pii: { mode: 'classifier', model: 'primary-pii', labelMappings: { private_person: null }, fallback: { model: 'backup-pii' } } };
    await guard(config).model({ prompt: 'Help Alice' }, {}, async req => { assert.match(req.prompt, /NAME_/); return {}; });
  });
});

test('policy rejection and successful primary never call a fallback', async () => {
  const calls = [];
  await withModels({ getExtractor: async name => { calls.push(name); return async () => ({ tolist: () => [[1, 0], [0, 1]] }); } }, async () => {
    const result = await guard(base).model({ prompt: 'Help' }, {}, () => assert.fail('executed'));
    assert.equal(result.finishReason, 'blocked'); assert.deepEqual(calls, ['primary-intent']);
  });
  await withModels({ getExtractor: async name => { assert.equal(name, 'primary-intent'); return async () => vectors(); },
    getPIIClassifier: async name => { assert.equal(name, 'primary-pii'); return async () => []; },
    getNER: async () => assert.fail('fallback loaded'),
  }, async () => { await initGuard(base); await guard(base).model({ prompt: 'Help' }, {}, async () => ({})); });
});

test('both models failing stop startup and model/tool execution; no regex-only bypass', async () => {
  for (const kind of ['intent', 'pii']) {
    const decisions = [];
    const overrides = kind === 'intent'
      ? { getExtractor: async () => { throw new Error('private prompt'); } }
      : { getPIIClassifier: async () => { throw new Error('private prompt'); }, getNER: async () => { throw new Error('private prompt'); } };
    await withModels(overrides, async () => {
      const config = { ...base, logging: { enabled: false, onDecision: d => { decisions.push(d); } } };
      await assert.rejects(initGuard(config), GuardModelError);
      await assert.rejects(guard(config).model({ prompt: 'Help alice@example.com' }, {}, () => assert.fail('executed')), GuardModelError);
      if (kind === 'pii') await assert.rejects(guard(config).tool({ toolRequest: { name: 'lookup', input: 'alice@example.com' } }, {}, () => assert.fail('executed')), GuardModelError);
      assert.ok(decisions.some(d => d.reasonCode === 'MODEL_UNAVAILABLE'));
      assert.doesNotMatch(JSON.stringify(decisions), /private prompt|alice@example.com/);
    });
  }
});

test('audit callback failure after recovery never retries model work', async () => {
  let attempts = 0;
  await withModels({ getExtractor: async name => { attempts++; if (name === 'primary-intent') throw new Error('failed'); return async () => vectors(); } }, async () => {
    await assert.rejects(initGuard({ ...base, logging: { enabled: false, onDecision: () => { throw new Error('audit unavailable'); } } }), /audit unavailable/);
    assert.equal(attempts, 2);
  });
});

test('no configured fallback preserves original error', async () => {
  const original = new Error('original');
  await withModels({ getExtractor: async () => { throw original; } }, async () => {
    await assert.rejects(initGuard(), error => error === original);
  });
});

test('Genkit tools use fallback detection and persistent decision storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guard-genkit-audit-'));
  try {
    await withModels({ getPIIClassifier: async () => async () => { throw new Error('failed'); } }, async () => {
      const store = createJsonlDecisionStore(join(dir, 'audit.jsonl'));
      const ai = genkit({}); let turn = 0; let calls = 0;
      const tool = ai.defineTool({ name: 'lookup', description: 'Test', inputSchema: z.object({ email: z.string() }), outputSchema: z.string() }, async input => {
        assert.equal(input.email, '[REDACTED]'); calls++; return 'ok';
      });
      const model = ai.defineModel({ name: 'test/release2' }, async () => ({ message: { role: 'model', content: ++turn === 1
        ? [{ toolRequest: { name: 'lookup', ref: '1', input: { email: 'alice@example.com' } } }]
        : [{ text: 'Done' }] } }));
      await ai.generate({ model, prompt: 'Help', tools: [tool], use: [guardMiddleware({ ...base, tools: { defaultAction: 'redact' }, logging: { enabled: false, store } })] });
      assert.equal(calls, 1);
      const saved = await store.read();
      assert.ok(saved.some(d => d.reasonCode === 'MODEL_FALLBACK_USED'));
      assert.ok(saved.some(d => d.reasonCode === 'TOOL_REDACTED'));
      assert.doesNotMatch(JSON.stringify(saved), /alice@example.com/);
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('audit store failure after model recovery never retries or executes', async () => {
  let attempts = 0;
  await withModels({ getPIIClassifier: async () => { attempts++; throw new Error('load failed'); },
    getNER: async () => { attempts++; return async () => []; },
  }, async () => {
    const config = { ...base, logging: { enabled: false, store: { append: d => {
      if (d.reasonCode === 'MODEL_FALLBACK_USED') throw new Error('store unavailable');
    } } } };
    await assert.rejects(guard(config).model({ prompt: 'Help' }, {}, () => assert.fail('executed')), /store unavailable/);
    assert.equal(attempts, 2);
  });
});

test('invalid label configuration and downstream failures do not trigger fallback', async () => {
  let backups = 0;
  await withModels({ getPIIClassifier: async () => async () => [{ entity_group: 'private_person', word: 'Alice' }],
    getNER: async () => { backups++; return async () => []; },
  }, async () => {
    const config = { ...base, pii: { ...base.pii, labelMappings: { private_person: 'bad-type' } } };
    await assert.rejects(guard(config).model({ prompt: 'Help Alice' }, {}, () => assert.fail('executed')), /uppercase/);
    await assert.rejects(guard(base).model({ prompt: 'Help Alice' }, {}, () => { throw new Error('downstream failed'); }), /downstream failed/);
    assert.equal(backups, 0);
  });
});

test('both inference attempts failing propagate sanitized GuardModelError', async () => {
  await withModels({ getPIIClassifier: async () => async () => { throw new Error('private input'); },
    getNER: async () => async () => { throw new Error('private input'); },
  }, async () => {
    await assert.rejects(guard(base).model({ prompt: 'Help' }, {}, () => assert.fail('executed')), error => {
      assert.ok(error instanceof GuardModelError); assert.equal(error.code, 'MODEL_UNAVAILABLE');
      assert.doesNotMatch(String(error), /private input/); assert.equal(error.cause, undefined); return true;
    });
  });
});
