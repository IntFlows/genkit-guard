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
  const masked = await tokenizer.mask(`Contact ${email}`, [{ type: 'EMAIL', value: email }]);
  const unmasked = await tokenizer.unmask(masked.maskedText);

  return {
    scopeId,
    email,
    maskedText: masked.maskedText,
    unmasked,
  };
}));

const placeholders = new Set(results.map((result) => result.maskedText));
assert.equal(placeholders.size, userCount, 'each concurrent user should get a unique scoped placeholder');

for (const result of results) {
  assert.equal(result.unmasked, `Contact ${result.email}`);
}

const first = results[0];
const second = results[1];
const firstTokenizer = new PiiTokenizer({ scopeId: first.scopeId, storage });
assert.equal(
  await firstTokenizer.unmask(second.maskedText),
  second.maskedText,
  'one user scope must not resolve another user scope placeholder'
);

console.log(`Concurrent PII vault simulation passed for ${userCount} isolated scopes.`);
