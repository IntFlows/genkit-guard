import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = path.resolve(root, process.argv[2] ?? '../genkit-guard-test-app');
await access(path.join(app, 'scripts/refresh-guard.mjs'));
await access(path.join(app, 'scripts/integration.test.mjs'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [['run', 'refresh:guard'], ['test']]) {
  const result = spawnSync(npm, args, { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Independent app ${args.join(' ')} failed`);
}
