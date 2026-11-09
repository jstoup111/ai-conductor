// Covers: task:13
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { collectFoldSet } from '../../../src/engine/restack/fold-plan.js';
import { createRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId, type HostPlacement } from '../../../src/engine/routing/route-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const slug = 'demo';
const hostOne = parseChildId(1)!;
const hostTwo = parseChildId(2)!;
const hostThree = parseChildId(3)!;
const leaf = parseChildId(4)!;

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

function trailers(round: string, owner: string): string {
  return `\n\nRound: ${round}\nOwner: ${owner}`;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'fold-plan-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'maintenance.auto', 'false']);
  await git(['config', 'gc.auto', '0']);
  await git(['config', 'user.email', 'fold@example.invalid']);
  await git(['config', 'user.name', 'Fold planner']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', `feat/daemon-${slug}`]);

  const commit = async (path: string, content: string, message: string) => {
    await writeFile(join(repo, path), content);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  const head = async () => (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const addPlacement = async (round: string, host: typeof hostOne, placement: HostPlacement, extra: { readonly allocation?: readonly typeof hostOne[] } = {}) => {
    const roundId = parseRoundId(round)!;
    const hosts = extra.allocation ?? [host];
    const created = await createRouteRecord(repo, slug, {
      roundId, kind: 'audit', sealedAuthored: 1, execution: 'leaf',
      items: [{ findingId: `finding-${host}`, kind: 'audit', owner: host, host, reason: 'repair', fallback: [] }],
      allocation: Object.fromEntries(hosts.map((candidate) => [candidate, { remTaskIds: [], blockBodies: [] }])),
      placements: { [host]: placement },
    }, { git: makeGitRunner(repo) });
    if (created.kind !== 'created') throw new Error(`could not create route record: ${created.kind}`);
  };
  return { repo, git, commit, head, addPlacement };
}

async function markClosed(subject: Awaited<ReturnType<typeof fixture>>, host: number) {
  await subject.git(['update-ref', closureRefFor(slug, parseChildId(host)!), await subject.head()]);
}

describe('collectFoldSet (real local Git)', () => {
  it('collects deferred host ranges in leaf order and excludes commits outside every range', async () => {
    const subject = await fixture();
    await subject.commit('leaf-build.txt', 'leaf build\n', 'leaf build');
    const firstEntry = await subject.head();
    await markClosed(subject, 1);
    const hostOneFix = await subject.commit('host-one.txt', 'one\n', `host one${trailers('r1', 'c1')}`);
    const operatorInside = await subject.commit('operator.txt', 'operator\n', `operator repair${trailers('r1', 'c1')}`);
    const firstExit = await subject.head();
    await subject.commit('operator-outside.txt', 'outside\n', 'operator outside');
    const thirdEntry = await subject.head();
    await markClosed(subject, 3);
    const hostThreeFix = await subject.commit('host-three.txt', 'three\n', `host three${trailers('r2', 'c3')}`);
    const thirdExit = await subject.head();
    await subject.commit('halt-record.txt', 'halt\n', 'halt record');
    await subject.addPlacement('r1', hostOne, { state: 'deferred', leafEntryTip: firstEntry as never, exitTip: firstExit as never });
    await subject.addPlacement('r2', hostThree, { state: 'deferred', leafEntryTip: thirdEntry as never, exitTip: thirdExit as never });

    await expect(collectFoldSet({ worktree: subject.repo, slug, git: makeGitRunner(subject.repo) })).resolves.toEqual({
      kind: 'collected', commits: [
        { sha: hostOneFix, roundId: 'r1', owner: hostOne },
        { sha: operatorInside, roundId: 'r1', owner: hostOne },
        { sha: hostThreeFix, roundId: 'r2', owner: hostThree },
      ],
    });
  });

  it('refuses a commit attributed to another host', async () => {
    const subject = await fixture();
    const entry = await subject.head();
    await markClosed(subject, 1);
    const wrongOwner = await subject.commit('wrong-owner.txt', 'wrong\n', `wrong owner${trailers('r1', 'c2')}`);
    await subject.addPlacement('r1', hostOne, { state: 'deferred', leafEntryTip: entry as never, exitTip: wrongOwner as never });

    await expect(collectFoldSet({ worktree: subject.repo, slug, git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'refused', reason: 'fold-owner-invalid', commit: wrongOwner, host: hostOne });
  });

  it('refuses a deferred placement without its exit boundary', async () => {
    const subject = await fixture();
    const entry = await subject.head();
    await markClosed(subject, 1);
    await subject.addPlacement('r1', hostOne, { state: 'deferred', leafEntryTip: entry as never });

    await expect(collectFoldSet({ worktree: subject.repo, slug, git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'refused', reason: 'fold-owner-invalid', commit: entry, host: hostOne });
  });

  it('refuses a merge commit inside a deferred host range', async () => {
    const subject = await fixture();
    const entry = await subject.head();
    await markClosed(subject, 1);
    await subject.git(['branch', 'side', entry]);
    await subject.git(['checkout', '-q', 'side']);
    await subject.commit('side.txt', 'side\n', 'side');
    await subject.git(['checkout', '-q', `feat/daemon-${slug}`]);
    await subject.commit('main.txt', 'main\n', `main${trailers('r1', 'c1')}`);
    await subject.git(['merge', '--no-ff', 'side', '-m', `merge${trailers('r1', 'c1')}`]);
    const merge = await subject.head();
    await subject.addPlacement('r1', hostOne, { state: 'deferred', leafEntryTip: entry as never, exitTip: merge as never });

    await expect(collectFoldSet({ worktree: subject.repo, slug, git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'refused', reason: 'fold-owner-invalid', commit: merge, host: hostOne });
  });

  it('ignores placed and leaf placements plus hosts with no placement while retaining an operator commit inside a deferred range', async () => {
    const subject = await fixture();
    const entry = await subject.head();
    await markClosed(subject, 1);
    const operator = await subject.commit('operator.txt', 'operator\n', `operator fix${trailers('r1', 'c1')}`);
    await subject.addPlacement('r1', hostOne, { state: 'deferred', leafEntryTip: entry as never, exitTip: operator as never }, { allocation: [hostOne, hostThree] });
    await markClosed(subject, 2);
    await subject.addPlacement('r2', hostTwo, { state: 'placed', leafEntryTip: entry as never, exitTip: operator as never });
    const leafEntry = await subject.head();
    await subject.commit('leaf-fix.txt', 'leaf\n', `leaf fix${trailers('r3', 'leaf')}`);
    const leafExit = await subject.head();
    await subject.addPlacement('r3', leaf, { state: 'deferred', leafEntryTip: leafEntry as never, exitTip: leafExit as never });

    await expect(collectFoldSet({ worktree: subject.repo, slug, git: makeGitRunner(subject.repo) })).resolves.toEqual({
      kind: 'collected', commits: [{ sha: operator, roundId: 'r1', owner: hostOne }],
    });
  });
});
