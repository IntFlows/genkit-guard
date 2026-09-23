import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('wiki preview never pushes; publish updates pages and preserves unrelated files', () => {
  const work = mkdtempSync(join(tmpdir(), 'wiki-test-'));
  const run = (cmd, args, cwd = work) => {
    const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  try {
    const remote = join(work, 'remote.git'); const seed = join(work, 'seed'); const source = join(work, 'pages');
    run('git', ['init', '--bare', remote]); run('git', ['clone', remote, seed]);
    writeFileSync(join(seed, 'Home.md'), 'Preserve me');
    run('git', ['add', '.'], seed); run('git', ['commit', '-m', 'initial'], seed); run('git', ['push', 'origin', 'HEAD'], seed);
    mkdirSync(source); writeFileSync(join(source, '1.-Home.md'), '# New home'); writeFileSync(join(source, 'README.md'), 'Do not publish');
    const args = [resolve('scripts/publish-wiki.js'), '--repo', remote, '--source', source];
    const before = run('git', ['rev-parse', 'HEAD'], remote);
    assert.match(run(process.execPath, args), /Preview only/);
    assert.equal(run('git', ['rev-parse', 'HEAD'], remote), before);
    assert.match(run(process.execPath, [...args, '--publish']), /published/);
    assert.equal(run('git', ['show', 'HEAD:1.-Home.md'], remote), '# New home');
    assert.equal(run('git', ['show', 'HEAD:Home.md'], remote), 'Preserve me');
    assert.doesNotMatch(run('git', ['ls-tree', '--name-only', 'HEAD'], remote), /README/);
    assert.match(run(process.execPath, [...args, '--publish']), /nothing to publish/);
    // The consolidated wiki is the default source; preview must still be read-only.
    const afterPublish = run('git', ['rev-parse', 'HEAD'], remote);
    const defaultPreview = run(process.execPath, [resolve('scripts/publish-wiki.js'), '--repo', remote]);
    assert.match(defaultPreview, /11\.-Framework-Compatibility/);
    assert.match(defaultPreview, /12\.-Security-and-Operational-Errors/);
    assert.match(defaultPreview, /Preview only/);
    assert.equal(run('git', ['rev-parse', 'HEAD'], remote), afterPublish);
  } finally { rmSync(work, { recursive: true, force: true }); }
});
