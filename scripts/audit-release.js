import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { provenance } from './validation-provenance.js';
import { evaluateAuditPolicy } from './audit-policy.js';

const directory = process.argv[2] ?? 'docs/validation';
await mkdir(directory, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const evidence = { timestamp: new Date().toISOString(), node: process.version,
  source: await provenance(),
  lockSha256: createHash('sha256').update(await readFile('package-lock.json')).digest('hex'), results: {} };
const audits = {};
for (const [name, args] of [['full', []], ['runtime', ['--omit=dev']]]) {
  const result = spawnSync(npm, ['audit', '--json', ...args], {
    encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 20 * 1024 * 1024,
  });
  await writeFile(`${directory}/audit-${name}.json`, result.stdout ?? '');
  let audit;
  try { audit = JSON.parse(result.stdout); } catch { /* Recorded below as an audit error. */ }
  if (audit) audits[name] = audit;
  evidence.results[name] = { exitCode: result.status, vulnerabilities: audit?.metadata?.vulnerabilities,
    error: result.error?.message ?? audit?.error ?? (!audit ? result.stderr : undefined) };
  console.log(name, JSON.stringify(evidence.results[name]));
}
evidence.policy = evaluateAuditPolicy(JSON.parse(await readFile('package-lock.json', 'utf8')), audits);
await writeFile(`${directory}/audit-summary.json`, JSON.stringify(evidence, null, 2));
// Accepted inherited findings remain visible; audit failures and direct/shared findings block.
process.exitCode = Object.values(evidence.results).some(result => ![0, 1].includes(result.exitCode) || result.error || !result.vulnerabilities) || !evidence.policy.passed ? 1 : 0;

