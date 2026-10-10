import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { makeGitRunner, performRebase } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCallback);

interface RebasedFixture {
  repo: string;
  featureTree: string;
  childBefore: string;
  childAfter: string;
}

async function rebaseFixture(withOperatorConfig: boolean): Promise<RebasedFixture> {
  const repo = await mkdtemp(join(tmpdir(), 'rebase-pinned-config-'));
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  try {
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'pinned@example.invalid']);
    await git(['config', 'user.name', 'Pinned config test']);
    await writeFile(join(repo, 'base.txt'), 'base\n');
    await git(['add', '.']);
    await git(['commit', '-qm', 'base']);

    await git(['checkout', '-qb', 'feature']);
    await writeFile(join(repo, 'feature.txt'), 'feature\n');
    await git(['add', '.']);
    await git(['commit', '-qm', 'feature work']);
    await git(['branch', 'feat/c1/demo']);
    const childBefore = (await git(['rev-parse', 'feat/c1/demo'])).stdout.trim();

    await git(['checkout', '-q', 'main']);
    await writeFile(join(repo, 'upstream.txt'), 'upstream\n');
    await git(['add', '.']);
    await git(['commit', '-qm', 'upstream work']);
    await git(['checkout', '-q', 'feature']);

    if (withOperatorConfig) {
      await git(['config', 'rebase.updateRefs', 'true']);
      await git(['config', 'rebase.autoSquash', 'true']);
      await git(['config', 'merge.renames', 'false']);
    }

    await expect(performRebase(makeGitRunner(repo), repo, 'main')).resolves.toMatchObject({ kind: 'changed' });
    const featureTree = (await git(['rev-parse', 'HEAD^{tree}'])).stdout.trim();
    const childAfter = (await git(['rev-parse', 'feat/c1/demo'])).stdout.trim();
    return { repo, featureTree, childBefore, childAfter };
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}

describe('performRebase pinned config (real local Git)', () => {
  it('ignores operator rebase and rename preferences and does not move an N=1 child branch', async () => {
    const baseline = await rebaseFixture(false);
    const configured = await rebaseFixture(true);
    try {
      expect(configured.featureTree).toBe(baseline.featureTree);
      expect(configured.childAfter).toBe(configured.childBefore);
      expect(configured.childAfter).not.toBe((await execFile('git', ['rev-parse', 'HEAD'], { cwd: configured.repo })).stdout.trim());
    } finally {
      await Promise.all([
        rm(baseline.repo, { recursive: true, force: true }),
        rm(configured.repo, { recursive: true, force: true }),
      ]);
    }
  });
});
