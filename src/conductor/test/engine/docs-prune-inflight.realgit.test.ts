// Covers: task:14, task:16
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { initTestRepo } from '../fixtures/git-repo.js';
import { commitDocsPruneDeletion } from '../../src/engine/docs-prune.js';
import { makeGitRunner, performRebase, runTier1, type GitRunner } from '../../src/engine/rebase.js';

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
  const origin = join(repo, 'origin.git');
  await gitOk(git, ['init', '--bare', '--initial-branch=main', origin]);
  await mkdir(join(repo, '.docs', 'coherence'), { recursive: true });
  await writeFile(join(repo, path), 'base coherence\n');
  await gitOk(git, ['add', '-A']);
  await gitOk(git, ['commit', '-qm', 'base artifact']);
  await gitOk(git, ['remote', 'add', 'origin', origin]);
  await gitOk(git, ['push', '-u', 'origin', 'main']);
  await gitOk(git, ['remote', 'set-head', 'origin', '--auto']);
  await gitOk(git, ['branch', 'feature']);
  await gitOk(git, ['checkout', 'feature']);
  await writeFile(join(repo, path), 'feature edit that must survive\n');
  await gitOk(git, ['commit', '-am', 'feature edits coherence']);
  await gitOk(git, ['checkout', 'main']);
  const prePruneHead = (await gitOk(git, ['rev-parse', 'main'])).trim();
  const pruneCommit = await commitDocsPruneDeletion({ repoDir: repo, startPoint: 'main', removable: [path], git });
  expect(pruneCommit, 'the prune produced a new commit').not.toBe(prePruneHead);
  expect(await gitOk(git, ['show', '--name-status', '--format=', pruneCommit]), 'the prune commit deletes the artifact').toContain(`D\t${path}`);
  await gitOk(git, ['update-ref', 'refs/heads/main', pruneCommit]);
  await gitOk(git, ['push', 'origin', 'main']);
  expect(await gitOk(git, ['ls-tree', '-r', '--name-only', 'origin/main']), 'origin/main no longer carries the artifact').not.toContain(path);
  await gitOk(git, ['checkout', 'feature']);

  const outcome = await performRebase(git, repo, 'main');
  expect(['changed', 'conflict_halt'], `a real upstream deletion must change or stop the rebase (got ${outcome.kind})`).toContain(outcome.kind);
  if (outcome.kind === 'changed') {
    expect((await git(['merge-base', '--is-ancestor', pruneCommit, 'HEAD'])).exitCode, 'the rebased feature descends from the prune commit').toBe(0);
    await expect(readFile(join(repo, path), 'utf8'), 'rebase replayed the feature edit over the deletion').resolves.toContain('feature edit that must survive');
    return;
  }

  const tier1 = await runTier1(git, repo);
  if (tier1.remaining.includes(path)) {
    expect(outcome.conflicts, 'tier-1 stopped and the original rebase stop reported the pruned path').toContain(path);
  } else {
    await expect(readFile(join(repo, path), 'utf8'), 'tier-1 resolved the conflict and retained the feature edit').resolves.toContain('feature edit that must survive');
  }
  await git(['rebase', '--abort']);
});
