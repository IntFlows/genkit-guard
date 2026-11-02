import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { genkit, z } from 'genkit';
import { guard, guardMiddleware, InMemoryPiiVaultStorage, GuardOperationalError, GuardModelError } from '../dist/index.js';
import { ModelSingleton } from '../dist/util/singleton.js';
import { analyzeIntentStructured } from '../dist/intent/intentAnalyzer.js';

const base = { intent: { semantic: { intents: { support: 'Support' } } }, logging: { enabled: false } };
beforeEach(() => {
  ModelSingleton.getExtractor = async () => async () => ({ tolist: () => [[1, 0], [1, 0]] });
  ModelSingleton.getPIIClassifier = async () => async () => [];
});
function sanitized(error, Class, code) {
  assert.ok(error instanceof Class);
  assert.equal(error.code, code);
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(String(error), /private@example.com/);
  return true;
}

test('negative cosine scores use the actual best description and threshold', async () => {
  ModelSingleton.getExtractor = async () => async () => ({ tolist: () => [[1, 0], [-1, 0]] });
  assert.deepEqual(await analyzeIntentStructured('Opposite', { support: 'Support' }, -0.5),
    { intent: 'support', score: -1, allowed: false });
  assert.equal((await analyzeIntentStructured('Opposite', { support: 'Support' }, -1)).allowed, true);
});

test('empty intents never allow a request even at zero or negative thresholds', async () => {
  for (const threshold of [0, -1]) {
    assert.deepEqual(await analyzeIntentStructured('Anything', {}, threshold),
      { intent: '', score: 0, allowed: false });
  }
});

test('invalid intent similarity becomes a sanitized model failure before provider execution', async () => {
  ModelSingleton.getExtractor = async () => async () => ({ tolist: () => [[0, 0], [0, 0]] });
  await assert.rejects(guard(base).model({ prompt: 'Help' }, {}, () => assert.fail('Provider executed')),
    error => sanitized(error, GuardModelError, 'MODEL_UNAVAILABLE'));
});

for (const factory of [guard, guardMiddleware, config => guard({ ...config, tools: { defaultAction: 'allow' } })]) {
  test(`${factory.name || 'native guard'} rejects streaming before models, provider and chunks`, async () => {
    ModelSingleton.getExtractor = async () => assert.fail('Local model loaded');
    const ai = genkit({});
    let chunks = 0;
    const model = ai.defineModel({ name: 'test/rc-stream' }, async () => assert.fail('Provider executed'));
    await assert.rejects(ai.generate({ model, prompt: 'Help', use: [factory(base)], onChunk: () => chunks++ }),
      error => error instanceof TypeError && /does not support streaming/.test(error.message));
    const result = ai.generateStream({ model, prompt: 'Help', use: [factory(base)] });
    await Promise.all([
      assert.rejects(result.response, /does not support streaming/),
      assert.rejects(async () => { for await (const chunk of result.stream) chunks++; }, /does not support streaming/),
    ]);
    assert.equal(chunks, 0);
  });
}

for (const failure of ['vault', 'model', 'audit-store', 'audit-callback', 'provider', 'tool']) {
  test(`${failure} after/beside tool execution preserves boundary and never retries side effects`, async () => {
    const ai = genkit({});
    let executions = 0, providers = 0;
    const original = new Error('private@example.com');
    const memory = new InMemoryPiiVaultStorage();
    const storage = {
      set: memory.set.bind(memory), get: memory.get.bind(memory),
      getByToken: token => {
        if (executions && failure === 'vault') throw original;
        return memory.getByToken(token);
      },
      entries: scope => {
        if (executions && failure === 'vault') throw original;
        return memory.entries(scope);
      },
    };
    ModelSingleton.getPIIClassifier = async () => async () => {
      if (executions && failure === 'model') throw original;
      return [];
    };
    const saved = [];
    const config = { ...base, pii: { vault: { storage } }, logging: { enabled: false,
      store: { append: decision => {
        saved.push(decision);
        if (executions && failure === 'audit-store') throw original;
      } },
      onDecision: () => { if (executions && failure === 'audit-callback') throw original; },
    } };
    const tool = ai.defineTool({ name: 'commitSideEffect', description: 'Synthetic side effect',
      inputSchema: z.object({ email: z.string() }), outputSchema: z.string() }, async input => {
      executions++;
      assert.equal(input.email, 'private@example.com');
      if (failure === 'tool') throw original;
      return 'committed';
    });
    const model = ai.defineModel({ name: 'test/rc-boundary' }, async request => {
      providers++;
      if (providers === 2 && failure === 'provider') throw original;
      assert.doesNotMatch(JSON.stringify(request.messages), /private@example.com/);
      return { message: { role: 'model', content: providers === 1
        ? [{ toolRequest: { name: 'commitSideEffect', ref: 'one', input: {
          email: request.messages[0].content[0].text.match(/\[\[EMAIL_[^\]]+\]\]/)[0],
        } } }] : [{ text: 'Done' }] } };
    });
    await assert.rejects(ai.generate({ model, tools: [tool], prompt: 'Help private@example.com',
      use: [guardMiddleware(config)] }), error => {
      if (failure === 'vault') return sanitized(error, GuardOperationalError, 'VAULT_UNAVAILABLE');
      if (failure === 'model') return sanitized(error, GuardModelError, 'MODEL_UNAVAILABLE');
      if (failure.startsWith('audit')) return sanitized(error, GuardOperationalError, 'AUDIT_UNAVAILABLE');
      assert.equal(error, original); return true;
    });
    assert.equal(executions, 1);
    assert.equal(providers, failure === 'provider' ? 2 : 1);
    assert.ok(saved.length > 0);
  });
}

test('restoration can fail after provider completion without retrying it', async () => {
  let completed = 0;
  const memory = new InMemoryPiiVaultStorage();
  const storage = { get: memory.get.bind(memory), set: memory.set.bind(memory),
    entries: scope => { if (completed) throw new Error('private@example.com'); return memory.entries(scope); } };
  await assert.rejects(guard({ ...base, pii: { vault: { storage } } }).model(
    { prompt: 'Help private@example.com' }, {}, async req => { completed++; return { text: req.prompt }; }),
    error => sanitized(error, GuardOperationalError, 'VAULT_UNAVAILABLE'));
  assert.equal(completed, 1);
});

test('RC root runtime exports and factory aliases remain frozen', async () => {
  const api = await import('../dist/index.js');
  assert.deepEqual(Object.keys(api).sort(), [
    'GuardModelError', 'GuardOperationalError', 'GuardToolError', 'InMemoryPiiVaultStorage',
    'createGuardDecisionStore', 'createJsonlDecisionStore', 'createPiiVaultStorage',
    'createRedisPiiVaultStorage', 'defaultPiiVaultStorage', 'defineGuardConfig',
    'guard', 'guardAction', 'guardDecisionSchema', 'guardMiddleware', 'guardPlugin', 'initGuard',
  ].sort());
  assert.equal(api.guardAction, api.guard);
  assert.equal(api.guardPlugin, api.guardMiddleware.plugin);
});

test('RC memory acceptance is specific to the reviewed run and never waives errors or latency', async () => {
  const { evaluateRcSoak } = await import('./evaluate-rc-soak.js');
  const reviewed = { runId: '9f14c07d-ee75-4aec-ac6a-96f6da002037', packageVersion: '1.0.0-rc.1',
    smoke: false, status: 'failed', passed: false, baselineRss: 2358476800, finalRss: 3258224640,
    memoryGate: false, expired: true, maxClockSkewMs: 1, errors: [],
    phases: [{ concurrency: 10, durationMs: 1809000, completed: 799, p95: 7888.895, errors: 0,
      coverage: { expectedInjectionRejections: 79, structuredGenerations: 79 } }] };
  assert.equal(evaluateRcSoak(reviewed).accepted, true);
  for (const change of [
    r => { r.runId = 'unreviewed'; }, r => { r.finalRss++; }, r => { r.errors.push({ message: 'failure' }); },
    r => { r.phases[0].p95 = 9001; }, r => { r.expired = false; },
    r => { r.phases[0].durationMs = 1000; }, r => { r.maxClockSkewMs = 60000; },
  ]) { const altered = structuredClone(reviewed); change(altered); assert.equal(evaluateRcSoak(altered).accepted, false); }
});
