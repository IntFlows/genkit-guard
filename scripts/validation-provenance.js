import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function provenance() {
  const git = args => spawnSync('git', args, { encoding: 'utf8' }).stdout?.trim() ?? '';
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'scripts',
    'package.json', 'package-lock.json', 'tsconfig.json', '.github/workflows']).split('\n').filter(Boolean);
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    hash.update(file + '\0'); hash.update(await readFile(file)); hash.update('\0');
  }
  return { commit: git(['rev-parse', 'HEAD']), dirty: !!git(['status', '--porcelain']),
    sourceSha256: hash.digest('hex'), sourceFiles: [...new Set(files)].sort() };
}
