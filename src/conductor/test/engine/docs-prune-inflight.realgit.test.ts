// Covers: task:14, task:16, task:23
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { initTestRepo } from '../fixtures/git-repo.js';
import { applyOpenPullRequestDeferral, commitDocsPruneDeletion, resolveDocsPruneSelection } from '../../src/engine/docs-prune.js';
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
  const manifestPath = '.docs/f/manifest.json';
  const planPath = '.docs/f/machine/plan.md';
  const storiesPath = '.docs/stories/f.md';
  const decisionPath = '.docs/decisions/adr-f.md';
  const origin = join(repo, 'origin.git');
  await gitOk(git, ['init', '--bare', '--initial-branch=main', origin]);
  await Promise.all([
    mkdir(join(repo, '.docs', 'f', 'machine'), { recursive: true }),
    mkdir(join(repo, '.docs', 'stories'), { recursive: true }),
    mkdir(join(repo, '.docs', 'decisions'), { recursive: true }),
    mkdir(join(repo, '.docs', 'shipped'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(repo, manifestPath), JSON.stringify({
      schemaVersion: 1,
      slug: 'f',
      artifacts: [
        { kind: 'plan', path: planPath },
        { kind: 'stories', path: storiesPath },
        { kind: 'decision', path: decisionPath },
      ],
    })),
    writeFile(join(repo, planPath), 'base plan\n'),
    writeFile(join(repo, storiesPath), 'stories retained\n'),
    writeFile(join(repo, decisionPath), 'decision retained\n'),
    writeFile(join(repo, '.docs/shipped/f.md'), 'shipped\n'),
  ]);
  await gitOk(git, ['add', '-A']);
  await gitOk(git, ['commit', '-qm', 'base artifact']);
  await gitOk(git, ['remote', 'add', 'origin', origin]);
  await gitOk(git, ['push', '-u', 'origin', 'main']);
  await gitOk(git, ['remote', 'set-head', 'origin', '--auto']);
  await gitOk(git, ['branch', 'feature']);
  await gitOk(git, ['checkout', 'feature']);
  await writeFile(join(repo, planPath), 'feature edit that must survive\n');
  await gitOk(git, ['commit', '-am', 'feature edits plan']);
  await gitOk(git, ['checkout', 'main']);
  const prePruneHead = (await gitOk(git, ['rev-parse', 'main'])).trim();
  const selection = await resolveDocsPruneSelection(repo, git);
  expect(selection.removable).toEqual(expect.arrayContaining([manifestPath, planPath]));
  expect(selection.removable).not.toContain(storiesPath);
  expect(selection.removable).not.toContain(decisionPath);
  const pruneCommit = await commitDocsPruneDeletion({ repoDir: repo, startPoint: 'main', removable: selection.removable, git });
  expect(pruneCommit, 'the prune produced a new commit').not.toBe(prePruneHead);
  const prunedPaths = await gitOk(git, ['show', '--name-status', '--format=', pruneCommit]);
  expect(prunedPaths, 'the prune commit deletes the manifest').toContain(`D\t${manifestPath}`);
  expect(prunedPaths, 'the prune commit deletes the listed plan').toContain(`D\t${planPath}`);
  await gitOk(git, ['update-ref', 'refs/heads/main', pruneCommit]);
  await gitOk(git, ['push', 'origin', 'main']);
  const mainTree = await gitOk(git, ['ls-tree', '-r', '--name-only', 'origin/main']);
  expect(mainTree, 'origin/main no longer carries the manifest').not.toContain(manifestPath);
  expect(mainTree, 'origin/main no longer carries the listed plan').not.toContain(planPath);
  expect(mainTree, 'origin/main retains listed stories').toContain(storiesPath);
  expect(mainTree, 'origin/main retains listed decisions').toContain(decisionPath);
  await gitOk(git, ['checkout', 'feature']);

  const outcome = await performRebase(git, repo, 'main');
  expect(['changed', 'conflict_halt'], `a real upstream deletion must change or stop the rebase (got ${outcome.kind})`).toContain(outcome.kind);
  if (outcome.kind === 'changed') {
    expect((await git(['merge-base', '--is-ancestor', pruneCommit, 'HEAD'])).exitCode, 'the rebased feature descends from the prune commit').toBe(0);
    await expect(readFile(join(repo, planPath), 'utf8'), 'rebase replayed the feature edit over the deletion').resolves.toContain('feature edit that must survive');
    return;
  }

  const tier1 = await runTier1(git, repo);
  if (outcome.kind === 'conflict_halt' && tier1.remaining.includes(planPath)) {
    expect(outcome.conflicts, 'tier-1 stopped and the original rebase stop reported the pruned path').toContain(planPath);
  } else {
    await expect(readFile(join(repo, planPath), 'utf8'), 'tier-1 resolved the conflict and retained the feature edit').resolves.toContain('feature edit that must survive');
  }
  await git(['rebase', '--abort']);
});

it('defers a manifest-backed selection as a unit when an open PR changes its manifest', () => {
  const paths = ['.docs/alpha/manifest.json', '.docs/alpha/machine/plan.md', '.docs/coherence/alpha.md'];
  const selection = {
    removable: paths,
    deferred: [],
    skipped: [],
    excluded: [],
    stems: new Map([['alpha', paths]]),
  };

  const outcome = applyOpenPullRequestDeferral(selection, [{
    number: 42,
    url: 'https://example.test/pr/42',
    body: '',
    headSha: 'a'.repeat(40),
    headRef: 'feature/alpha',
    author: 'other',
    changedPaths: ['.docs/alpha/manifest.json'],
  }], 'operator');

  expect(outcome.removable).toEqual([]);
  expect(outcome.deferred).toEqual([{
    stem: 'alpha',
    paths,
    reason: 'open-pr-modifies',
    pullRequests: ['https://example.test/pr/42'],
  }]);
});
