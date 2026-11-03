import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, cp, symlink, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { provenance } from './validation-provenance.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = path.resolve(root, process.argv[2] ?? '../genkit-guard-test-app');
const consumer = await mkdtemp(path.join(tmpdir(), 'guard-real-consumer-'));
const output = path.resolve(root, process.argv[3] ?? `docs/validation/independent-${new Date().toISOString().slice(0, 10)}`);
await mkdir(output, { recursive: true });
const log = await open(path.join(output, 'independent.log'), 'w');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const evidence = { timestamp: new Date().toISOString(), source: await provenance(), consumer, checks: [] };
function run(args, cwd, capture = false) {
  const result = spawnSync(npm, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32',
    stdio: capture ? 'pipe' : ['ignore', log.fd, log.fd] });
  evidence.checks.push({ command: ['npm', ...args], exitCode: result.status });
  assert.equal(result.status, 0, result.stderr ?? 'Independent consumer failed');
  return result.stdout;
}
try {
  run(['run', 'build'], root);
  const packed = JSON.parse(run(['pack', '--json', '--pack-destination', consumer], root, true))[0];
  evidence.tarball = { filename: packed.filename, integrity: packed.integrity, shasum: packed.shasum };
  const genkit = JSON.parse(await readFile(path.join(root, 'node_modules/genkit/package.json'))).version;
  const redis = JSON.parse(await readFile(path.join(app, 'node_modules/redis/package.json'))).version;
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(['install', '--no-audit', '--no-fund', path.join(consumer, packed.filename), `genkit@${genkit}`, `redis@${redis}`], consumer);
  await cp(path.join(consumer, 'package-lock.json'), path.join(output, 'independent-package-lock.json'));
  await mkdir(path.join(consumer, 'scripts'));
  await cp(path.join(app, 'scripts/integration.test.mjs'), path.join(consumer, 'scripts/integration.test.mjs'));
  await symlink(path.join(app, 'models'), path.join(consumer, 'models'), 'dir');
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=600000', 'scripts/integration.test.mjs'],
    { cwd: consumer, stdio: ['ignore', log.fd, log.fd] });
  evidence.checks.push({ command: 'node --test scripts/integration.test.mjs', exitCode: result.status });
  await cp(path.join(consumer, 'test-results/integration.json'), path.join(output, 'independent.json'));
  assert.equal(result.status, 0, 'Real-model integration failed; inspect independent.log');
  evidence.passed = true;
} catch (error) { evidence.passed = false; evidence.error = error.message; process.exitCode = 1; }
finally {
  await log.close();
  await writeFile(path.join(output, 'independent-provenance.json'), JSON.stringify(evidence, null, 2));
  await rm(consumer, { recursive: true, force: true });
  console.log(JSON.stringify(evidence));
}
