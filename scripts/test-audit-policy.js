import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAuditPolicy } from './audit-policy.js';
const lock = { packages: {
  '': { dependencies: { zod: '^4' }, devDependencies: { genkit: '^1' } },
  'node_modules/zod': {},
  'node_modules/genkit': { dependencies: { old: '1', zod: '^4' } },
  'node_modules/genkit/node_modules/old': {}, 'node_modules/unreviewed': {},
} };
const finding = nodes => ({ full: { vulnerabilities: { advisory: { nodes, severity: 'high' } } } });
test('only Genkit-only paths receive the accepted inherited classification', () => {
  assert.equal(evaluateAuditPolicy(lock, finding(['node_modules/genkit/node_modules/old'])).passed, true);
  for (const nodes of [['node_modules/zod'], ['node_modules/unreviewed'], [], ['node_modules/genkit/node_modules/old', 'node_modules/zod']]) {
    assert.equal(evaluateAuditPolicy(lock, finding(nodes)).passed, false);
  }
});
