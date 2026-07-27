import assert from 'node:assert/strict';
import { InMemoryPiiVaultStorage } from '../dist/index.js';
import { PiiTokenizer } from '../dist/pii/tokenizer.js';

const storage = new InMemoryPiiVaultStorage();
const userCount = 100;

const users = Array.from({ length: userCount }, (_, index) => ({
  scopeId: `tenantA:user${index}`,
  email: `user${index}@example.com`,
}));

const results = await Promise.all(users.map(async ({ scopeId, email }) => {
  const tokenizer = new PiiTokenizer({ scopeId, storage });
  const prompt = `Fetch metadata for the blob named 'sensitive-user-data-${email}.json' inside Azure Blob Storage.`;
  const masked = await tokenizer.mask(prompt, [{ type: 'EMAIL', value: email }]);

  const simulatedModelToolInput = {
    blobName: masked.maskedText.match(/'([^']+)'/)?.[1],
  };

  const toolInput = {
    blobName: await tokenizer.unmask(simulatedModelToolInput.blobName),
  };

  const simulatedModelResponse = `The blob belongs to ${masked.maskedText.match(/\[\[EMAIL_[^\]]+\]\]/)?.[0]}.`;
  const response = await tokenizer.unmask(simulatedModelResponse);

  return {
    scopeId,
    email,
    prompt,
    maskedText: masked.maskedText,
    toolInput,
    response,
  };
}));

const placeholders = new Set(results.map((result) => result.maskedText));
assert.equal(placeholders.size, userCount, 'each concurrent user should get a unique scoped placeholder');

for (const result of results) {
  assert.equal(result.toolInput.blobName, `sensitive-user-data-${result.email}.json`);
  assert.equal(result.response, `The blob belongs to ${result.email}.`);
}

const first = results[0];
const second = results[1];
const firstTokenizer = new PiiTokenizer({ scopeId: first.scopeId, storage });
assert.equal(
  await firstTokenizer.unmask(second.maskedText),
  second.maskedText,
  'one user scope must not resolve another user scope placeholder'
);

const promptTokenizer = new PiiTokenizer({ scopeId: 'trace:request', storage });
const promptMasked = await promptTokenizer.mask(
  "Fetch metadata for the blob named 'sensitive-user-data-john.doe@example.com.json' inside Azure Blob Storage.",
  [{ type: 'EMAIL', value: 'john.doe@example.com' }]
);

const toolResponseTokenizer = new PiiTokenizer({ scopeId: 'trace:request', storage });
await toolResponseTokenizer.mask(
  'john.doe@example.com',
  [{ type: 'EMAIL', value: 'john.doe@example.com' }]
);

const finalModelResponse = `The metadata for the blob '${promptMasked.maskedText.match(/\[\[EMAIL_[^\]]+\]\]/)?.[0]}' has been successfully retrieved.`;
let unmaskedFinalResponse = finalModelResponse;
for (const tokenizer of [promptTokenizer, toolResponseTokenizer]) {
  unmaskedFinalResponse = await tokenizer.unmask(unmaskedFinalResponse);
}

assert.equal(
  unmaskedFinalResponse,
  "The metadata for the blob 'john.doe@example.com' has been successfully retrieved.",
  'final model output should unmask placeholders created by earlier middleware passes'
);

const firstMiddlewarePass = new PiiTokenizer({ storage });
const firstPassMasked = await firstMiddlewarePass.mask(
  "Fetch metadata for the blob named 'sensitive-user-data-jane.doe@example.com.json' inside Azure Blob Storage.",
  [{ type: 'EMAIL', value: 'sensitive-user-data-jane.doe@example.com.json' }]
);
const laterMiddlewarePass = new PiiTokenizer({ storage });
const crossContextResponse = `The metadata for the blob '${firstPassMasked.maskedText.match(/\[\[EMAIL_[^\]]+\]\]/)?.[0]}' has been successfully retrieved.`;

await laterMiddlewarePass.importTokens(firstPassMasked.maskedText);

assert.equal(
  await laterMiddlewarePass.unmask(crossContextResponse),
  "The metadata for the blob 'sensitive-user-data-jane.doe@example.com.json' has been successfully retrieved.",
  'a later middleware context should resolve an earlier opaque token from the shared default vault'
);

console.log(`Concurrent PII vault simulation passed for ${userCount} isolated scopes.`);
