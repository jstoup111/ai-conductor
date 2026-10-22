// Covers: task:16
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { initTestRepo } from '../fixtures/git-repo.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';

const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function gitOk(git: GitRunner, args: string[]): Promise<string> {
  const result = await git(args);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

it('keeps a local edit or stops with the pruned path conflict; it never silently discards it', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'docs-prune-inflight-'));
  roots.push(repo);
  await initTestRepo(repo);
  const git = makeGitRunner(repo);
  const path = '.docs/coherence/alpha.md';
  await mkdir(join(repo, '.docs', 'coherence'), { recursive: true });
  await writeFile(join(repo, path), 'base coherence\n');
  await gitOk(git, ['add', '-A']);
  await gitOk(git, ['commit', '-qm', 'base artifact']);
  await gitOk(git, ['branch', 'feature']);
  await gitOk(git, ['checkout', 'feature']);
  await writeFile(join(repo, path), 'feature edit that must survive\n');
  await gitOk(git, ['commit', '-am', 'feature edits coherence']);
  await gitOk(git, ['checkout', 'main']);
  await gitOk(git, ['rm', path]);
  await gitOk(git, ['commit', '-qm', 'docs prune alpha']);
  await gitOk(git, ['checkout', 'feature']);

  const rebased = await git(['rebase', 'main']);
  if (rebased.exitCode === 0) {
    await expect(readFile(join(repo, path), 'utf8')).resolves.toContain('feature edit that must survive');
    return;
  }
  const conflicts = await gitOk(git, ['diff', '--name-only', '--diff-filter=U']);
  expect(conflicts, 'rebase stopped, and the conflict identifies the pruned file').toContain(path);
  await git(['rebase', '--abort']);
});
