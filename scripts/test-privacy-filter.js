import assert from 'node:assert/strict';
import { detectPII, privacyFilterOutputToMatches } from '../dist/pii/detector.js';
import { ModelSingleton, PRIVACY_FILTER_PIPELINE_TASK } from '../dist/util/singleton.js';
import { InMemoryPiiVaultStorage } from '../dist/pii/storage.js';
import { PiiTokenizer } from '../dist/pii/tokenizer.js';

assert.equal(PRIVACY_FILTER_PIPELINE_TASK, 'token-classification');

const input = 'Contact Alice Smith at alice@example.com. Her key is sk-live-secret.';
const expectedSpans = [
  { entity_group: 'private_person', word: ' Alice Smith' },
  { entity_group: 'private_email', word: ' alice@example.com' },
  { entity_group: 'secret', word: ' sk-live-secret' },
];

assert.deepEqual(privacyFilterOutputToMatches(input, expectedSpans), [
  { type: 'NAME', value: 'Alice Smith' },
  { type: 'EMAIL', value: 'alice@example.com' },
  { type: 'SECRET', value: 'sk-live-secret' },
]);

assert.deepEqual(
  privacyFilterOutputToMatches('Home: 10 Green Street', [
    { entity_group: 'private_address', start: 6, end: 21, word: 'wrong fallback' },
    { entity_group: 'O', word: 'Home' },
    { entity_group: 'private_date', word: 'not present' },
    null,
  ]),
  [{ type: 'ADDRESS', value: '10 Green Street' }]
);
assert.deepEqual(privacyFilterOutputToMatches(input, { invalid: true }), []);

const originalGetPIIClassifier = ModelSingleton.getPIIClassifier;
let receivedOptions;
ModelSingleton.getPIIClassifier = async () => async (_text, options) => {
  receivedOptions = options;
  return expectedSpans;
};

try {
  const detection = await detectPII(input, { mode: 'classifier' });
  assert.deepEqual(receivedOptions, { aggregation_strategy: 'simple' });

  // The regex email and model email are deduplicated; model-only name and secret become matches.
  assert.deepEqual(detection.matches, [
    { type: 'EMAIL', value: 'alice@example.com' },
    { type: 'NAME', value: 'Alice Smith' },
    { type: 'SECRET', value: 'sk-live-secret' },
  ]);

  const storage = new InMemoryPiiVaultStorage();
  const tokenizer = new PiiTokenizer({ scopeId: 'privacy-filter-test', storage });
  const masked = await tokenizer.mask(input, detection.matches);

  assert.doesNotMatch(masked.maskedText, /Alice Smith|alice@example\.com|sk-live-secret/);
  assert.match(masked.maskedText, /\[\[NAME_/);
  assert.match(masked.maskedText, /\[\[EMAIL_/);
  assert.match(masked.maskedText, /\[\[SECRET_/);
  assert.equal(await tokenizer.unmask(masked.maskedText), input);
} finally {
  ModelSingleton.getPIIClassifier = originalGetPIIClassifier;
}

console.log('Privacy Filter pipeline and masking tests passed.');
