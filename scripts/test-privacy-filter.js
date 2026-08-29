import assert from 'node:assert/strict';
import { detectPII, privacyFilterOutputToMatches } from '../dist/pii/detector.js';
import { ModelSingleton, PRIVACY_FILTER_PIPELINE_TASK } from '../dist/util/singleton.js';
import { InMemoryPiiVaultStorage } from '../dist/pii/storage.js';
import { PiiTokenizer } from '../dist/pii/tokenizer.js';
import { guard } from '../dist/index.js';

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
const originalGetExtractor = ModelSingleton.getExtractor;
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

// Reproduce a Genkit multi-turn response: an inner turn creates the token in one scope, while
// the final response passes through middleware attached to another context and scope.
const crossTurnStorage = new InMemoryPiiVaultStorage();
const innerTurn = new PiiTokenizer({ scopeId: 'inner-turn', storage: crossTurnStorage });
const crossTurnMasked = await innerTurn.mask('owner@example.com', [
  { type: 'EMAIL', value: 'owner@example.com' },
]);

ModelSingleton.getExtractor = async () => async () => ({ tolist: () => [] });
ModelSingleton.getPIIClassifier = async () => async () => [];

try {
  const middleware = guard({
    intent: { semantic: { threshold: 0, intents: {} } },
    pii: {
      mode: 'classifier',
      vault: { storage: crossTurnStorage, scopeId: 'outer-turn' },
    },
    logging: { enabled: false },
  });

  const response = await middleware.model(
    { prompt: 'Fetch blob metadata' },
    {},
    async () => ({ answer: `File owner: ${crossTurnMasked.maskedText}` })
  );
  assert.deepEqual(response, { answer: 'File owner: owner@example.com' });

  const unknownTokenResponse = await middleware.model(
    { prompt: 'Fetch blob metadata' },
    {},
    async () => ({ answer: '[[EMAIL_unknownnamespace_99]]' })
  );
  assert.deepEqual(unknownTokenResponse, { answer: '[[EMAIL_unknownnamespace_99]]' });

  let toolInput;
  await middleware.tool(
    { toolRequest: { name: 'sendEmail', input: { recipient: crossTurnMasked.maskedText } } },
    {},
    async (request) => {
      toolInput = request.toolRequest.input;
      return { sent: true };
    }
  );
  assert.deepEqual(toolInput, { recipient: 'owner@example.com' });
} finally {
  ModelSingleton.getExtractor = originalGetExtractor;
  ModelSingleton.getPIIClassifier = originalGetPIIClassifier;
}

console.log('Privacy Filter pipeline, masking and cross-turn unmasking tests passed.');
