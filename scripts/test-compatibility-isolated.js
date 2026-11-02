import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { provenance } from './validation-provenance.js';

// Keep dependency selection out of the working checkout and the running independent app.
const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
assert.ok(['minimum', 'latest'].includes(mode), 'Use minimum or latest');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json')));
const target = mode === 'minimum' ? pkg.peerDependencies.genkit.match(/\d+\.\d+\.\d+/)[0] : pkg.peerDependencies.genkit;
const temporary = await mkdtemp(path.join(tmpdir(), 'guard-compatibility-'));
const output = path.resolve(root, process.argv[3] ?? `docs/validation/node-${process.versions.node}-${mode}`);
await mkdir(output, { recursive: true });
const log = await open(path.join(output, 'checks.log'), 'w');
const evidence = { timestamp: new Date().toISOString(), node: process.version, mode, target, temporary, source: await provenance(), checks: [] };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  for (const file of ['src', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'LICENSE']) {
    await cp(path.join(root, file), path.join(temporary, file), { recursive: true });
  }
  // The publish-preview regression reads the repository's local wiki fixtures.
  await mkdir(path.join(temporary, 'docs'));
  await cp(path.join(root, 'docs/wiki'), path.join(temporary, 'docs/wiki'), { recursive: true });
  for (const args of [['ci', '--no-audit', '--no-fund'],
    ['install', '--no-save', '--package-lock=false', '--no-audit', '--no-fund', `genkit@${target}`],
    ['test'], ['run', 'test:package']]) {
    const result = spawnSync(npm, args, { cwd: temporary, stdio: ['ignore', log.fd, log.fd], shell: process.platform === 'win32' });
    evidence.checks.push({ command: ['npm', ...args], exitCode: result.status, error: result.error?.message });
    assert.equal(result.status, 0, `npm ${args.join(' ')} failed; inspect ${output}/checks.log`);
  }
  evidence.genkit = JSON.parse(await readFile(path.join(temporary, 'node_modules/genkit/package.json'))).version;
  evidence.passed = true;
} catch (error) {
  evidence.passed = false; evidence.error = error.message;
  process.exitCode = 1;
} finally {
  await log.close();
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(evidence, null, 2));
  // Logs/provenance stay in the checkout; release the unique temporary installation.
  await rm(temporary, { recursive: true, force: true });
  console.log(JSON.stringify(evidence));
}
