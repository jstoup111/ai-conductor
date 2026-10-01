// Covers: task:3, task:5, task:6
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { makeGitRunner, performRebase, proveFlattenedReplay, type FlattenedReplayPlan, type GitRunner } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCallback);

async function snapshot(repo: string) {
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  return Promise.all([
    git(['rev-parse', 'HEAD']).then(({ stdout }) => stdout),
    git(['ls-files', '--stage']).then(({ stdout }) => stdout),
    git(['status', '--porcelain', '--ignored']).then(({ stdout }) => stdout),
    git(['for-each-ref']).then(({ stdout }) => stdout),
  ]);
}

describe('proveFlattenedReplay real local Git (Task 3)', () => {
  it('does not mutate checkout state on refusals or a successful dry run', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'rebase-flatten-'));
    try {
      const git = (args: string[]) => execFile('git', args, { cwd: repo });
      await git(['init', '-q', '-b', 'main']);
      await git(['config', 'user.email', 'test@example.invalid']);
      await git(['config', 'user.name', 'Flatten test']);
      await writeFile(join(repo, 'base.txt'), 'base\n');
      await git(['add', '.']); await git(['commit', '-qm', 'base']);
      const base = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      await git(['checkout', '-qb', 'feature']);
      await writeFile(join(repo, 'feature.txt'), 'feature\n');
      await git(['add', '.']); await git(['commit', '-qm', 'feature']);
      const feature = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, 'target.txt'), 'target\n');
      await git(['add', '.']); await git(['commit', '-qm', 'target']);
      const target = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      await git(['checkout', '-q', 'feature']);
      const plan: FlattenedReplayPlan = { entries: [{ kind: 'ordinary', sha: feature }], audit: { flattenedMerges: [], ancestryOnlyMerges: [], sideLineageCount: 0 }, pairs: [], absorptionPoints: [] };
      const before = await snapshot(repo);
      const real = makeGitRunner(repo);
      const mismatch: GitRunner = async (args, opts) => args[0] === 'rev-parse' && args[1] === 'HEAD^{tree}' ? { exitCode: 0, stdout: `${'f'.repeat(40)}\n`, stderr: '' } : real(args, opts);
      await expect(proveFlattenedReplay(mismatch, plan, base, target)).resolves.toMatchObject({ kind: 'refused' });
      expect(await snapshot(repo)).toEqual(before);
      const failed: GitRunner = async (args, opts) => args[0] === 'merge-tree' ? { exitCode: 2, stdout: '', stderr: 'failed command' } : real(args, opts);
      await expect(proveFlattenedReplay(failed, plan, base, target)).resolves.toMatchObject({ kind: 'refused' });
      expect(await snapshot(repo)).toEqual(before);
      await expect(proveFlattenedReplay(real, plan, base, target)).resolves.toMatchObject({ kind: 'proven' });
      expect(await snapshot(repo)).toEqual(before);
    } finally { await rm(repo, { recursive: true, force: true }); }
  });
});

describe('performRebase real local Git (Task 5)', () => {
  it('refuses a conflicting flattened merge before starting rebase or mutating checkout state', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'rebase-flatten-refusal-'));
    try {
      const git = (args: string[]) => execFile('git', args, { cwd: repo });
      await git(['init', '-q', '-b', 'main']);
      await git(['config', 'user.email', 'test@example.invalid']);
      await git(['config', 'user.name', 'Flatten test']);
      await writeFile(join(repo, 'conflict.txt'), 'base\n');
      await git(['add', '.']); await git(['commit', '-qm', 'base']);
      await git(['checkout', '-qb', 'feature']);
      await writeFile(join(repo, 'feature.txt'), 'feature\n');
      await git(['add', '.']); await git(['commit', '-qm', 'feature work']);
      await git(['checkout', '-qb', 'side']);
      await writeFile(join(repo, 'conflict.txt'), 'side\n');
      await git(['commit', '-qam', 'side changes conflict']);
      await git(['checkout', '-q', 'feature']);
      await git(['merge', '--no-ff', '-m', 'merge side conflict', 'side']);
      const mergeSha = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      const parents = (await git(['rev-parse', 'HEAD^1', 'HEAD^2'])).stdout.trim().split('\n');
      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, 'conflict.txt'), 'main\n');
      await git(['commit', '-qam', 'main changes conflict']);
      await git(['checkout', '-q', 'feature']);
      const before = await snapshot(repo);
      const rebaseStateExists = async (dir: string) => {
        const { stdout } = await git(['rev-parse', '--git-dir']);
        return execFile('test', ['-e', join(repo, stdout.trim(), dir)]).then(() => true, () => false);
      };
      const beforeRebaseDirs = await Promise.all(['rebase-merge', 'rebase-apply'].map(rebaseStateExists));
      const commands: string[][] = [];
      const real = makeGitRunner(repo);
      const outcome = await performRebase(async (args, opts) => {
        commands.push(args);
        return real(args, opts);
      }, repo, 'main');

      expect(outcome).toMatchObject({
        kind: 'flatten_refused', mergeSha, parents, conflicts: ['conflict.txt'],
      });
      if (outcome.kind === 'flatten_refused') expect(outcome.flattenedSha).toMatch(/^[0-9a-f]{40}$/);
      expect(commands.some((args) => args.includes('rebase'))).toBe(false);
      expect(await snapshot(repo)).toEqual(before);
      await expect(Promise.all(['rebase-merge', 'rebase-apply'].map(rebaseStateExists))).resolves.toEqual(beforeRebaseDirs);
    } finally { await rm(repo, { recursive: true, force: true }); }
  });

  it('returns expected subjects for a clean flattened replay', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'rebase-flatten-merge-diff-'));
    try {
      const git = (args: string[]) => execFile('git', args, { cwd: repo });
      await git(['init', '-q', '-b', 'main']);
      await git(['config', 'user.email', 'committer@example.test']);
      await git(['config', 'user.name', 'Committer']);
      await writeFile(join(repo, 'base.txt'), 'base\n');
      await git(['add', '.']); await git(['commit', '-qm', 'base']);
      await git(['checkout', '-qb', 'feature']);
      await writeFile(join(repo, 'feature.txt'), 'feature\n');
      await git(['add', '.']); await git(['commit', '-qm', 'feature work']);
      await git(['branch', 'content-side']);
      await git(['checkout', '-q', 'content-side']);
      await writeFile(join(repo, 'merged.txt'), 'merged content\n');
      await git(['add', '.']); await git(['commit', '-qm', 'side content']);
      await git(['checkout', '-q', 'feature']);
      await git(['merge', '--no-ff', '-m', 'unique content merge', 'content-side']);
      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, 'upstream.txt'), 'upstream\n');
      await git(['add', '.']); await git(['commit', '-qm', 'upstream advance']);
      await git(['checkout', '-q', 'feature']);

      const outcome = await performRebase(makeGitRunner(repo), repo, 'main');

      expect(outcome).toMatchObject({
        kind: 'changed',
        expectedSubjects: ['feature work', 'unique content merge'],
      });
    } finally { await rm(repo, { recursive: true, force: true }); }
  });

  it('flattens duplicated merge lineage, preserves the target tree and omits ancestry-only merges', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'rebase-flatten-perform-'));
    try {
      const git = (args: string[]) => execFile('git', args, { cwd: repo });
      await git(['init', '-q', '-b', 'main']);
      await git(['config', 'user.email', 'committer@example.test']);
      await git(['config', 'user.name', 'Committer']);
      await writeFile(join(repo, 'base.txt'), 'base\n');
      await git(['add', '.']); await git(['commit', '-qm', 'base']);
      await git(['checkout', '-qb', 'feature']);
      await writeFile(join(repo, 'repair.txt'), 'repair\n');
      await git(['add', '.']); await git(['commit', '-qm', 'repair']);

      // A forced merge of an ancestry-only branch must disappear entirely.
      await git(['branch', 'ancestry-only']);
      await git(['checkout', '-q', 'ancestry-only']);
      await git(['commit', '--allow-empty', '-qm', 'ancestry-only side marker']);
      await git(['checkout', '-q', 'feature']);
      await git(['merge', '--no-ff', '--no-edit', 'ancestry-only']);
      const ancestryOnly = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      await writeFile(join(repo, 'after.txt'), 'after\n');
      await git(['add', '.']); await git(['commit', '-qm', 'after ancestry merge']);
      await git(['branch', 'content-side']);
      await git(['checkout', '-q', 'content-side']);
      await writeFile(join(repo, 'side.txt'), 'side content\n');
      await git(['add', '.']); await git(['commit', '-qm', 'side lineage commit']);
      const sideCommit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      await git(['checkout', '-q', 'feature']);
      await execFile('git', ['merge', '--no-ff', '--no-edit', 'content-side'], {
        cwd: repo,
        env: { ...process.env, GIT_AUTHOR_NAME: 'Ada Author', GIT_AUTHOR_EMAIL: 'ada@example.test' },
      });
      const contentMerge = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      const preRebaseHead = contentMerge;

      await git(['checkout', '-q', 'main']);
      await writeFile(join(repo, 'upstream.txt'), 'unrelated advance\n');
      await git(['add', '.']); await git(['commit', '-qm', 'advance unrelated']);
      const base = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      const expectedTree = (await git(['merge-tree', '--write-tree', preRebaseHead, base])).stdout.trim();
      await git(['checkout', '-q', 'feature']);

      const outcome = await performRebase(makeGitRunner(repo), repo, 'main');
      expect(outcome).toMatchObject({ kind: 'changed' });
      if (outcome.kind !== 'changed') throw new Error('expected changed rebase');
      const actualTree = (await git(['rev-parse', 'HEAD^{tree}'])).stdout.trim();
      expect(actualTree).toBe(expectedTree);
      expect(outcome.flatten?.audit.ancestryOnlyMerges).toContain(ancestryOnly);
      expect((await git(['merge-base', '--is-ancestor', ancestryOnly, 'HEAD']).catch(() => ({ stdout: 'no' }))).stdout).toBe('no');
      expect((await git(['log', '--format=%B', 'main..HEAD'])).stdout).toContain(`Flattened-merge: ${contentMerge}`);
      expect((await git(['log', '--format=%an <%ae>', 'main..HEAD'])).stdout).toContain('Ada Author <ada@example.test>');
      expect((await git(['rev-list', '--merges', 'main..HEAD'])).stdout.trim()).toBe('');
      expect((await git(['merge-base', '--is-ancestor', sideCommit, 'HEAD']).catch(() => ({ stdout: 'no' }))).stdout).toBe('no');
    } finally { await rm(repo, { recursive: true, force: true }); }
  });
});
