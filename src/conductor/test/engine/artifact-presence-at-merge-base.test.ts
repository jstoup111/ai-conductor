// Covers: task:5
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitAll, initTestRepo } from '../fixtures/git-repo.js';
import { artifactPresenceAtMergeBase } from '../../src/engine/adr-assumption-ledger-scope.js';

let repo: string;

async function write(relativePath: string, contents: string): Promise<void> {
  const path = join(repo, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, contents);
}

async function git(...args: string[]): Promise<void> {
  const { execa } = await import('execa');
  await execa('git', args, { cwd: repo });
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'artifact-presence-at-merge-base-'));
  await initTestRepo(repo);
  await write('.docs/plans/inherited.md', '# Inherited plan\n');
  await commitAll(repo, 'base plan');
  await git('checkout', '-b', 'feature');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('artifactPresenceAtMergeBase', () => {
  it('returns absent when the plan was added only after the feature diverged', async () => {
    await write('.docs/plans/feature-only.md', '# Feature plan\n');
    await commitAll(repo, 'add feature-only plan');

    await expect(artifactPresenceAtMergeBase(repo, '.docs/plans/feature-only.md')).resolves.toEqual({
      kind: 'absent',
    });
  });

  it('returns present for a default-branch plan, even when the feature appends to it', async () => {
    await write('.docs/plans/inherited.md', '# Inherited plan\n\nFeature remediation\n');
    await commitAll(repo, 'extend inherited plan');

    await expect(artifactPresenceAtMergeBase(repo, '.docs/plans/inherited.md')).resolves.toEqual({
      kind: 'present',
    });
  });

  it('returns a detailed unresolved result rather than throwing outside a Git repository', async () => {
    const nonRepo = await mkdtemp(join(tmpdir(), 'artifact-presence-non-repo-'));
    try {
      const result = await artifactPresenceAtMergeBase(nonRepo, '.docs/plans/any.md');

      expect(result.kind).toBe('merge-base-unresolved');
      if (result.kind === 'merge-base-unresolved') expect(result.detail).not.toBe('');
    } finally {
      await rm(nonRepo, { recursive: true, force: true });
    }
  });
});
