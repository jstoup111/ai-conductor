// Covers: S7.11 (Task 21) — a typed as-built verdict whose code stamp was
// orphaned by an amend scores `absent` so the SHIP tail re-dispatches.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeGitRunner } from '../../src/engine/rebase.js';
import { CUSTOM_COMPLETION_PREDICATES } from '../../src/engine/artifacts.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';

const policy: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'all tiers' },
  planGap: { enabled: true, reason: 'all tiers' },
  adrCompliance: { enabled: false, reason: 'no approved ADRs' },
  diagramDrift: { enabled: false, reason: 'no diagrams' },
};

const repos: string[] = [];
afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

async function repoWithApprovedVerdict(): Promise<{ repo: string; git: ReturnType<typeof makeGitRunner>; stamp: string }> {
  const repo = await mkdtemp(join(tmpdir(), 'as-built-orphan-'));
  repos.push(repo);
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 't@t.com']);
  await git(['config', 'user.name', 'T']);
  await git(['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await writeFile(join(repo, 'a.ts'), 'export const a = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'init']);
  const stamp = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await persistAsBuiltVerdict(repo, { version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [] },
    { attemptId: 'attempt-1', codeStamp: stamp, policy });
  return { repo, git, stamp };
}

const predicate = CUSTOM_COMPLETION_PREDICATES.architecture_review_as_built!;

describe('as-built completion predicate with an orphaned code stamp', () => {
  it('satisfies the gate while the stamp is reachable and unchanged (control)', async () => {
    const { repo, git } = await repoWithApprovedVerdict();

    await expect(predicate(repo, { git, attemptRunId: 'attempt-1' })).resolves.toMatchObject({ done: true });
  });

  it('scores absent after an amend orphans the stamp, even for the same attempt', async () => {
    const { repo, git, stamp } = await repoWithApprovedVerdict();
    await git(['commit', '--amend', '-q', '-m', 'init (amended)']);
    expect((await git(['merge-base', '--is-ancestor', stamp, 'HEAD'])).exitCode).not.toBe(0);

    const result = await predicate(repo, { git, attemptRunId: 'attempt-1' });

    expect(result).toMatchObject({ done: false, routeClass: 'absent' });
    expect(result.reason).toContain(stamp);
  });
});
