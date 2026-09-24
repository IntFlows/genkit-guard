#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let source = join(root, 'docs/wiki');
let repository = 'https://github.com/IntFlows/genkit-guard.wiki.git';
let publish = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--publish') publish = true;
  else if (['--source', '--repo'].includes(args[i])) {
    const flag = args[i];
    const value = args[++i];
    if (!value || value.startsWith('-')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--source') source = resolve(value);
    else repository = value;
  } else if (args[i] === '--help') {
    console.log('node scripts/publish-wiki.js [--source DIRECTORY] [--repo URL] [--publish]');
    console.log('Default: clone wiki and preview diff. --publish commits and pushes changed numbered pages.');
    process.exit(0);
  } else throw new Error(`Unknown option: ${args[i]}`);
}
source = realpathSync(source);
const pages = readdirSync(source, { withFileTypes: true })
  .filter(entry => entry.isFile() && /^\d+\..+\.md$/.test(entry.name)).map(entry => entry.name).sort();
if (!pages.length) throw new Error('No numbered Markdown wiki pages found');
const work = mkdtempSync(join(tmpdir(), 'genkit-guard-wiki-'));
const checkout = join(work, 'wiki');
function git(args, cwd = work) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Git command failed');
  return result.stdout;
}
try {
  git(['clone', '--', repository, checkout]);
  for (const page of pages) copyFileSync(join(source, page), join(checkout, page));
  git(['add', '--', ...pages], checkout);
  const summary = git(['diff', '--cached', '--stat'], checkout);
  if (!summary.trim()) console.log('Wiki already matches these pages; nothing to publish.');
  else {
    console.log(summary);
    console.log(git(['diff', '--cached', '--'], checkout));
    if (!publish) console.log('Preview only. Run again with --publish to commit and push.');
    else {
      git(['commit', '-m', 'Update Genkit Guard wiki documentation'], checkout);
      // Normal push: concurrent remote updates reject safely; never force-push.
      console.log(git(['push', 'origin', 'HEAD'], checkout));
      console.log('Wiki changes published.');
    }
  }
} finally {
  // Only remove the temporary directory created by this process.
  rmSync(work, { recursive: true, force: true });
}
