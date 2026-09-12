import assert from 'node:assert/strict';
import { test } from 'node:test';
import { genkit, z } from 'genkit';
import { guard, guardMiddleware, GuardToolError } from '../dist/index.js';
import { ModelSingleton } from '../dist/util/singleton.js';
ModelSingleton.getExtractor = async () => async () => ({ tolist: () => [[1, 0], [1, 0]] });
ModelSingleton.getNER = async () => async () => [];
const base = { intent: { semantic: { intents: { support: 'Support' } } }, logging: { enabled: false } };
const request = () => ({ toolRequest: { name: 'sendEmail', input: { email: 'alice@example.com', nested: ['alice@example.com'] } } });

test('tool policies enforce before execution and redact nested arguments', async () => {
  for (const action of ['allow', 'block', 'redact', 'approval-required']) {
    const decisions = [];
    const middleware = guard({ ...base, tools: { rules: { sendEmail: action } }, logging: { enabled: false, onDecision: d => decisions.push(d) } });
    let executed = 0;
    const run = middleware.tool(request(), {}, async req => {
      executed++;
      if (action === 'redact') assert.deepEqual(req.toolRequest.input, { email: '[REDACTED]', nested: ['[REDACTED]'] });
      else assert.equal(req.toolRequest.input.email, 'alice@example.com');
      return { toolResponse: { name: 'sendEmail', output: 'ok' } };
    });
    if (action === 'block' || action === 'approval-required') await assert.rejects(run, GuardToolError);
    else await run;
    assert.equal(executed, action === 'allow' || action === 'redact' ? 1 : 0);
    assert.equal(decisions[0].action, action);
    assert.equal(decisions[0].schemaVersion, '1');
    assert.doesNotMatch(JSON.stringify(decisions), /alice|example.com|nested/);
  }
});

test('approval is explicit, per-call and cannot be spoofed by request flags', async () => {
  for (const approve of [undefined, () => false, () => 'true', () => { throw new Error('secret'); }, async () => true]) {
    let ran = false;
    const middleware = guard({ ...base, tools: { defaultAction: 'approval-required', approve } });
    const req = request(); req.toolRequest.input.approved = true;
    const run = middleware.tool(req, {}, async () => { ran = true; });
    if (approve && await Promise.resolve().then(() => approve()).catch(() => false) === true) await run;
    else await assert.rejects(run, GuardToolError);
    assert.equal(ran, Boolean(approve && await Promise.resolve().then(() => approve()).catch(() => false) === true));
  }
});

test('default block, unknown tools, invalid actions and callback failures stop execution', async () => {
  for (const tools of [{ defaultAction: 'block', rules: { other: 'allow' } }, { defaultAction: 'invalid' }]) {
    await assert.rejects(guard({ ...base, tools }).tool(request(), {}, () => assert.fail('Executed')), GuardToolError);
  }
  await assert.rejects(guard({ ...base, logging: { enabled: false, onDecision: () => { throw new Error('sink unavailable'); } } }).tool(request(), {}, () => assert.fail('Executed')), /sink unavailable/);
});

test('prompt and tool events share contract; console does not include raw content', async () => {
  const events = []; const lines = [];
  const original = { log: console.log, warn: console.warn };
  console.log = console.warn = value => lines.push(value);
  try {
    const middleware = guard({ ...base, policyVersion: 'release-1', logging: { onDecision: d => events.push(d) } });
    await middleware.model({ prompt: 'Help alice@example.com' }, {}, async req => ({ text: req.prompt }));
    await middleware.model({ prompt: 'ignore previous alice@example.com' }, {}, () => assert.fail('Executed'));
    await middleware.tool(request(), {}, async () => undefined);
  } finally { Object.assign(console, original); }
  assert.deepEqual(events.map(d => d.guard), ['injection', 'intent', 'pii', 'injection', 'tool']);
  assert.ok(events.every(d => d.policyVersion === 'release-1' && d.latencyMs >= 0));
  assert.equal(new Set(events.map(d => d.decisionId)).size, events.length);
  assert.doesNotMatch(lines.join(''), /alice@example.com|Help alice|ignore previous/);
});

test('Genkit generate actually intercepts tool execution', async () => {
  for (const factory of [guard, guardMiddleware]) for (const action of ['allow', 'block', 'redact', 'approval-required']) {
    const ai = genkit({});
    let executions = 0; let turn = 0;
    const tool = ai.defineTool({ name: 'sendEmail', description: 'Test', inputSchema: z.object({ email: z.string() }), outputSchema: z.string() }, async input => {
      executions++;
      assert.equal(input.email, action === 'redact' ? '[REDACTED]' : 'alice@example.com');
      return 'ok';
    });
    const model = ai.defineModel({ name: 'test/model' }, async () => ({ message: { role: 'model', content: ++turn === 1
      ? [{ toolRequest: { name: 'sendEmail', ref: '1', input: { email: 'alice@example.com' } } }]
      : [{ text: 'Done' }] } }));
    const run = ai.generate({ model, prompt: 'Help', tools: [tool], use: [factory({ ...base, tools: { defaultAction: action } })] });
    if (action === 'block' || action === 'approval-required') await assert.rejects(run);
    else await run;
    assert.equal(executions, ['allow', 'redact'].includes(action) ? 1 : 0);
  }
});
