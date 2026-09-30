// Covers: task:3
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { makeGitRunner, proveFlattenedReplay, type FlattenedReplayPlan, type GitRunner } from '../../src/engine/rebase.js';

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
