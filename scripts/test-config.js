import assert from 'node:assert/strict';
import { guard, initGuard, defineGuardConfig } from '../dist/index.js';
import { ModelSingleton } from '../dist/util/singleton.js';
import { detectPII, privacyFilterOutputToMatches } from '../dist/pii/detector.js';
const calls = [];
const originals = {};
for (const method of ['getExtractor', 'getNER', 'getPIIClassifier']) {
  originals[method] = ModelSingleton[method];
  ModelSingleton[method] = async (name) => {
    calls.push([method, name]);
    return async () => method === 'getExtractor' ? { tolist: () => [[1, 0], [1, 0]] } : [{ entity: 'B-LABEL_1', word: 'Alice' }];
  };
}
try {
  await initGuard();
  assert.deepEqual(calls.splice(0), [['getExtractor', 'Xenova/all-MiniLM-L6-v2'], ['getNER', 'Xenova/bert-base-NER']]);
  for (const mode of ['ner', 'classifier']) {
    const config = defineGuardConfig({
      models: { extractor: 'custom/intent' },
      intent: { semantic: { intents: { support: 'Customer support' } } },
      pii: { mode, model: 'custom/pii', labelMappings: { LABEL_1: 'NAME' } },
      logging: { enabled: false },
    });
    await initGuard(config);
    const result = await guard(config).model({ prompt: 'Help Alice' }, {}, async (req) => {
      assert.match(req.prompt, /\[\[NAME_/);
      assert.doesNotMatch(req.prompt, /Alice/);
      return { text: req.prompt };
    });
    assert.equal(result.text, 'Help Alice');
    const expected = [['getExtractor', 'custom/intent'], [mode === 'ner' ? 'getNER' : 'getPIIClassifier', 'custom/pii']];
    assert.deepEqual(calls.splice(0), [...expected, ...expected]);
  }
  await initGuard({ pii: { mode: 'classifier' } });
  assert.equal(calls.splice(0)[1][1], 'openai/privacy-filter');
  assert.deepEqual(privacyFilterOutputToMatches('Alice', [{ entity: 'S-private_person', word: 'Alice' }], { private_person: null }), []);
  assert.deepEqual(privacyFilterOutputToMatches('Alice', [{ entity: 'B-label_1', word: 'Alice' }], { LABEL_1: 'CUSTOM_NAME' }), [{ type: 'CUSTOM_NAME', value: 'Alice' }]);
  assert.deepEqual(privacyFilterOutputToMatches('Alice', [{ entity: 'toString', word: 'Alice' }]), []);
  assert.throws(() => privacyFilterOutputToMatches('Alice', [{ entity: 'LABEL_1', word: 'Alice' }], { LABEL_1: 'bad-token' }), /uppercase/);
  const regex = await detectPII('alice@example.com', { mode: 'classifier', labelMappings: { LABEL_1: null } });
  assert.equal(regex.matches[0].type, 'EMAIL');
} finally {
  Object.assign(ModelSingleton, originals);
}
console.log('Shared model configuration and compatibility tests passed.');
