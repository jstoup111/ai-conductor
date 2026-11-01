// Covers: task:57
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { parseBuilderClaim, settleRoutedBuildClaim, verifyPrerequisiteClaim } from '../../../src/engine/routing/prerequisite-claim.js';
import { closureRefFor, repairMarkerRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const c3 = parseChildId(3)!;
const roundId = parseRoundId('r1')!;

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'prerequisite-claim-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await writeFile(join(repo, 'src-a.ts'), 'export const parseA = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'base']);

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed1 = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', c1), closed1]);
  await writeFile(join(repo, 'host-work.ts'), 'export const hostWork = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'host work']);

  await git(['checkout', '-qb', 'feat/c2/demo', closed1]);
  await writeFile(join(repo, 'src-b.ts'), 'export const parseB = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'child two prerequisite']);
  const closed2 = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', c2), closed2]);

  await git(['checkout', '-qb', leafBranchFor('demo'), closed2]);
  await writeFile(join(repo, 'src-c.ts'), 'export const parseC = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'leaf prerequisite']);
  await git(['checkout', '-q', 'feat/c1/demo']);
  return { repo, git, closed1, closed2 };
}

async function routingRefs(git: GitRunner) {
  const refs = await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/']);
  return refs.stdout.trim();
}

describe('builder prerequisite claim verification (real local Git)', () => {
  it('verifies parseB only at child 2 when it is exported there and absent from child 1', async () => {
    const subject = await fixture();
    try {
      await expect(verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c2, symbols: ['parseB'] },
        host: c1, slug: 'demo', git: subject.git,
      })).resolves.toEqual({ kind: 'verified', destination: c2, ref: closureRefFor('demo', c2) });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('rejects a claim already present at the host without moving its marker or any ref', async () => {
    const subject = await fixture();
    try {
      await subject.git(['update-ref', closureRefFor('demo', c1), subject.closed2]);
      const before = await routingRefs(subject.git);
      await expect(verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c2, symbols: ['parseB'] },
        host: c1, slug: 'demo', git: subject.git,
      })).resolves.toMatchObject({ kind: 'unverified' });
      expect(await routingRefs(subject.git)).toBe(before);
      expect((await subject.git(['rev-parse', '-q', '--verify', repairMarkerRefFor('demo')])).exitCode).toBe(1);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('refuses downward claims and rejects destinations missing a classified prerequisite input without moving refs', async () => {
    const subject = await fixture();
    try {
      const before = await routingRefs(subject.git);
      await expect(verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c1, symbols: ['parseB'] },
        host: c2, slug: 'demo', git: subject.git,
      })).resolves.toMatchObject({ kind: 'refused-not-above' });
      await expect(verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c2, symbols: ['parseB'] },
        host: c1, slug: 'demo', prerequisitePaths: ['src-c.ts'], git: subject.git,
      })).resolves.toMatchObject({ kind: 'unverified' });
      expect(await routingRefs(subject.git)).toBe(before);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('checks a leaf claim at the leaf tip without reading a closed ref for that destination', async () => {
    const subject = await fixture();
    try {
      const forbidden = closureRefFor('demo', c3);
      const git: GitRunner = async (args, options) => {
        if (args.includes(forbidden)) throw new Error('leaf destination must not read a closed ref');
        return subject.git(args, options);
      };
      await expect(verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c3, paths: ['src-c.ts'] },
        host: c2, slug: 'demo', leaf: c3, git,
      })).resolves.toEqual({ kind: 'verified', destination: c3, ref: `refs/heads/${leafBranchFor('demo')}` });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('does not treat an intermediate child with no closure as the sealed leaf', async () => {
    const subject = await fixture();
    try {
      await subject.git(['update-ref', '-d', closureRefFor('demo', c2)]);
      const before = await routingRefs(subject.git);
      const leafRef = `refs/heads/${leafBranchFor('demo')}`;
      const git: GitRunner = async (args, options) => {
        if (args.includes(leafRef)) throw new Error('intermediate destination must not read the leaf tip');
        return subject.git(args, options);
      };
      await expect(verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c2, symbols: ['parseB'] },
        host: c1, slug: 'demo', leaf: c3, git,
      })).resolves.toMatchObject({ kind: 'unverified' });
      expect(await routingRefs(subject.git)).toBe(before);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('turns malformed claims into a failed attempt boundary and leaves absent results unchanged for normal BUILD handling', async () => {
    const subject = await fixture();
    try {
      const before = await routingRefs(subject.git);
      expect(parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: '2' })).toEqual({ kind: 'malformed' });
      await expect(settleRoutedBuildClaim({
        structuredResult: { outcome: 'blocked-by-prerequisite', child: '2' }, worktree: subject.repo, slug: 'demo', roundId, host: c1, git: subject.git,
      })).resolves.toEqual({ kind: 'failed', detail: 'routed prerequisite claim is malformed' });
      await expect(settleRoutedBuildClaim({
        structuredResult: undefined, worktree: subject.repo, slug: 'demo', roundId, host: c1, git: subject.git,
      })).resolves.toEqual({ kind: 'none' });
      expect(await routingRefs(subject.git)).toBe(before);
      expect((await subject.git(['rev-parse', '-q', '--verify', repairMarkerRefFor('demo')])).exitCode).toBe(1);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('rejects evidence-free claims before verification or rerouting', async () => {
    const subject = await fixture();
    try {
      const before = await routingRefs(subject.git);
      const calls: string[] = [];
      const git: GitRunner = async (args, options) => {
        calls.push(args[0] ?? '');
        if (args[0] === 'update-ref') throw new Error('evidence-free claims must not reroute');
        return subject.git(args, options);
      };

      await expect(verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c2 }, host: c1, slug: 'demo', git,
      })).resolves.toEqual({ kind: 'unverified', detail: 'claim has no prerequisite paths or symbols' });
      await expect(settleRoutedBuildClaim({
        structuredResult: { outcome: 'blocked-by-prerequisite', child: 2 }, worktree: subject.repo, slug: 'demo', roundId, host: c1, git,
      })).resolves.toEqual({ kind: 'failed', detail: 'routed prerequisite claim is malformed' });

      expect(calls).not.toContain('update-ref');
      expect(await routingRefs(subject.git)).toBe(before);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });
});
