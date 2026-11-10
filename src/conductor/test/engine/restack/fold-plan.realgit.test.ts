// Covers: task:13, task:14
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { collectFoldSet, placeFoldCommits } from '../../../src/engine/restack/fold-plan.js';
import { createRouteRecord, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId, type HostPlacement } from '../../../src/engine/routing/route-types.js';
import type { FoldRange } from '../../../src/engine/restack/fold-types.js';

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
    await mkdir(join(repo, path, '..'), { recursive: true });
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

    const ranges: FoldRange[] = [
      { host: hostOne, roundId: parseRoundId('r1')!, leafEntryTip: firstEntry as never, exitTip: firstExit as never },
      { host: hostThree, roundId: parseRoundId('r2')!, leafEntryTip: thirdEntry as never, exitTip: thirdExit as never },
    ];
    await expect(collectFoldSet({ ranges, slug, git: makeGitRunner(subject.repo) })).resolves.toEqual({
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

    await expect(collectFoldSet({ ranges: [{ host: hostOne, roundId: parseRoundId('r1')!, leafEntryTip: entry as never, exitTip: wrongOwner as never }], slug, git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'refused', reason: 'fold-owner-invalid', commit: wrongOwner, host: hostOne });
  });

  it('refuses a deferred placement without its exit boundary', async () => {
    const subject = await fixture();
    const entry = await subject.head();
    await markClosed(subject, 1);
    await subject.addPlacement('r1', hostOne, { state: 'deferred', leafEntryTip: entry as never });

    await expect(collectFoldSet({ ranges: [{ host: hostOne, roundId: parseRoundId('r1')!, leafEntryTip: entry as never }], slug, git: makeGitRunner(subject.repo) }))
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

    await expect(collectFoldSet({ ranges: [{ host: hostOne, roundId: parseRoundId('r1')!, leafEntryTip: entry as never, exitTip: merge as never }], slug, git: makeGitRunner(subject.repo) }))
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

    await expect(collectFoldSet({ ranges: [{ host: hostOne, roundId: parseRoundId('r1')!, leafEntryTip: entry as never, exitTip: operator as never }], slug, git: makeGitRunner(subject.repo) })).resolves.toEqual({
      kind: 'collected', commits: [{ sha: operator, roundId: 'r1', owner: hostOne }],
    });
  });
});

describe('placeFoldCommits (real local Git)', () => {
  async function placementFixture() {
    const subject = await fixture();
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    await subject.commit('src/server/identity.ts', 'export function startPlaying(name: string) {}\n', 'identity');
    await subject.commit('scripts/executable.sh', '#!/bin/sh\necho hi\n', 'executable');
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    await subject.git(['checkout', '-qb', 'feat/c3/demo']);
    await subject.commit('tests/load/ten-players.ts', "import { startPlaying } from '../../src/server/identity.js';\nstartPlaying('one');\n", 'ten players');
    await subject.git(['checkout', '-qb', 'feat/c4/demo']);
    await subject.git(['branch', '-f', `feat/daemon-${slug}`, 'HEAD']);
    await subject.git(['checkout', '-q', `feat/daemon-${slug}`]);
    return subject;
  }

  it('places each path on the lowest accepting child at or above its owner', async () => {
    const subject = await placementFixture();
    const source = await subject.commit(
      'src/server/identity.ts',
      'export function startPlaying(name: string, secret: string) {}\n',
      `thread secret${trailers('r1', 'c1')}`,
    );
    await writeFile(join(subject.repo, 'tests/load/ten-players.ts'), "import { startPlaying } from '../../src/server/identity.js';\nstartPlaying('one', 'secret');\n");
    await subject.git(['add', 'tests/load/ten-players.ts']);
    await subject.git(['commit', '-qm', `update players${trailers('r1', 'c1')}`]);
    const combined = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    await subject.git(['reset', '--soft', `${source}^`]);
    await subject.git(['commit', '-qm', `thread secret${trailers('r1', 'c1')}`]);
    const folded = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();

    await expect(placeFoldCommits({
      worktree: subject.repo,
      slug,
      commits: [{ sha: folded as never, roundId: parseRoundId('r1')!, owner: hostOne }],
      git: makeGitRunner(subject.repo),
    })).resolves.toEqual({
      kind: 'planned',
      commits: [{
        sha: folded,
        roundId: 'r1',
        owner: hostOne,
        parts: [
          expect.objectContaining({
            kind: 'hunks', child: hostOne, path: 'src/server/identity.ts', reason: 'owner',
            hunk: expect.objectContaining({ path: 'src/server/identity.ts' }),
          }),
          expect.objectContaining({
            kind: 'hunks', child: hostThree, path: 'tests/load/ten-players.ts', reason: 'introduced-above-owner',
            hunk: expect.objectContaining({ path: 'tests/load/ten-players.ts' }),
          }),
        ],
      }],
    });
    expect(combined).not.toBe(folded);
  });

  it('places an empty tdd evidence commit whole on its owner', async () => {
    const subject = await placementFixture();
    await subject.git(['commit', '--allow-empty', '-qm', `tdd evidence${trailers('r1', 'c1')}`]);
    const empty = await subject.head();

    await expect(placeFoldCommits({
      worktree: subject.repo,
      slug,
      commits: [{ sha: empty as never, roundId: parseRoundId('r1')!, owner: hostOne }],
      git: makeGitRunner(subject.repo),
    })).resolves.toEqual({
      kind: 'planned',
      commits: [{
        sha: empty,
        roundId: 'r1',
        owner: hostOne,
        parts: [{ kind: 'whole', child: hostOne, paths: [], reason: 'owner' }],
      }],
    });
  });

  it('places binary, mode-only, and empty-file path changes on their accepting child', async () => {
    const subject = await placementFixture();
    await writeFile(join(subject.repo, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    await chmod(join(subject.repo, 'scripts', 'executable.sh'), 0o755);
    await writeFile(join(subject.repo, 'new-empty.txt'), '');
    await subject.git(['add', 'binary.bin', 'scripts/executable.sh', 'new-empty.txt']);
    await subject.git(['commit', '-qm', `hunkless changes${trailers('r1', 'c1')}`]);
    const hunkless = await subject.head();

    await expect(placeFoldCommits({
      worktree: subject.repo,
      slug,
      commits: [{ sha: hunkless as never, roundId: parseRoundId('r1')!, owner: hostOne }],
      git: makeGitRunner(subject.repo),
    })).resolves.toEqual({
      kind: 'planned',
      commits: [{
        sha: hunkless,
        roundId: 'r1',
        owner: hostOne,
        parts: [
          expect.objectContaining({ kind: 'hunks', child: hostOne, path: 'binary.bin', reason: 'owner', hunk: expect.objectContaining({ path: 'binary.bin' }) }),
          expect.objectContaining({ kind: 'hunks', child: hostOne, path: 'new-empty.txt', reason: 'owner', hunk: expect.objectContaining({ path: 'new-empty.txt' }) }),
          expect.objectContaining({ kind: 'hunks', child: hostOne, path: 'scripts/executable.sh', reason: 'owner', hunk: expect.objectContaining({ path: 'scripts/executable.sh' }) }),
        ],
      }],
    });
  });

  it('records each hunk separately with only its source patch', async () => {
    const subject = await placementFixture();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await writeFile(join(subject.repo, 'src/server/identity.ts'), "export const owner = 'c1';\nexport function startPlaying(name: string) {}\nexport const stable = 'initial';\n");
    await subject.git(['add', 'src/server/identity.ts']);
    await subject.git(['commit', '-qm', 'child one identity']);
    await subject.git(['branch', '-f', 'feat/c2/demo', 'HEAD']);
    await subject.git(['branch', '-f', 'feat/c3/demo', 'HEAD']);
    await subject.git(['checkout', '-q', 'feat/c3/demo']);
    await writeFile(join(subject.repo, 'src/server/identity.ts'), "export const owner = 'c3';\nexport function startPlaying(name: string) {}\nexport const stable = 'initial';\n");
    await subject.git(['add', 'src/server/identity.ts']);
    await subject.git(['commit', '-qm', 'child three identity']);
    await subject.git(['branch', '-f', 'feat/c4/demo', 'HEAD']);
    await subject.git(['branch', '-f', `feat/daemon-${slug}`, 'HEAD']);
    await subject.git(['checkout', '-q', `feat/daemon-${slug}`]);
    await writeFile(join(subject.repo, 'src/server/identity.ts'), "export const owner = 'folded';\nexport function startPlaying(name: string) {}\nexport const stable = 'changed';\n");
    await subject.git(['add', 'src/server/identity.ts']);
    await subject.git(['commit', '-qm', `two identity hunks${trailers('r1', 'c1')}`]);
    const source = await subject.head();

    const result = await placeFoldCommits({
      worktree: subject.repo,
      slug,
      commits: [{ sha: source as never, roundId: parseRoundId('r1')!, owner: hostOne }],
      git: makeGitRunner(subject.repo),
    });

    expect(result.kind).toBe('planned');
    if (result.kind !== 'planned') return;
    const parts = result.commits[0]!.parts.filter((part) => part.kind === 'hunks');
    expect(parts).toHaveLength(2);
    const ownerHunk = parts.find((part) => part.hunk.patch.includes("+export const owner = 'folded';"));
    const stableHunk = parts.find((part) => part.hunk.patch.includes("+export const stable = 'changed';"));
    expect(ownerHunk).toMatchObject({ child: hostThree, path: 'src/server/identity.ts', reason: 'introduced-above-owner' });
    expect(ownerHunk?.hunk.patch).not.toContain("stable = 'changed'");
    expect(stableHunk).toMatchObject({ child: hostOne, path: 'src/server/identity.ts', reason: 'owner' });
    expect(stableHunk?.hunk.patch).not.toContain("owner = 'folded'");
  });

  const block = '### Task rem-prd-audit-T1: Repair\n**Done when:**\n- fixed\n**Child:** 1\n**Round:** r1\n';

  async function frozenFixture(plan: string) {
    const subject = await placementFixture();
    await mkdir(join(subject.repo, '.docs', 'plans'), { recursive: true });
    await writeFile(join(subject.repo, '.docs', 'plans', 'demo.md'), plan);
    await writeFile(join(subject.repo, 'src/server/identity.ts'), 'export function startPlaying(name: string, secret: string) {}\n');
    await subject.git(['add', '.docs/plans/demo.md', 'src/server/identity.ts']);
    await subject.git(['commit', '-qm', `append frozen remediation${trailers('r1', 'c1')}`]);
    const frozen = await subject.head();
    const created = await createRouteRecord(subject.repo, slug, {
      roundId: parseRoundId('r2')!, kind: 'audit', sealedAuthored: 1, execution: 'leaf',
      items: [{ findingId: 'frozen', kind: 'audit', owner: hostOne, host: hostOne, reason: 'repair', fallback: [] }],
      allocation: { [hostOne]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: [block] } },
      placements: { [hostOne]: { state: 'deferred', leafEntryTip: frozen as never, exitTip: frozen as never } },
    }, { git: makeGitRunner(subject.repo) });
    if (created.kind !== 'created') throw new Error('could not create frozen allocation');
    const planned = placeFoldCommits({
      worktree: subject.repo,
      slug,
      commits: [{ sha: frozen as never, roundId: parseRoundId('r2')!, owner: hostOne }],
      git: makeGitRunner(subject.repo),
      frozenBlocksFor: async (source) => {
        const stored = await readRouteRecord(subject.repo, slug, source.roundId, { git: makeGitRunner(subject.repo) });
        if (stored.kind !== 'record') return undefined;
        const allocation = stored.record.allocation[source.owner];
        return allocation === undefined ? undefined : allocation.blockBodies.map((body, index) => ({ id: allocation.remTaskIds[index]!, body }));
      },
    });
    return { frozen, plan: await planned };
  }

  it('re-materializes a frozen block on its owner and places the non-block lines sharing its hunk', async () => {
    const { frozen, plan } = await frozenFixture(`# Demo\n\n${block}`);

    expect(plan).toEqual({
      kind: 'planned',
      commits: [{
        sha: frozen,
        roundId: 'r2',
        owner: hostOne,
        parts: [
          { kind: 'blocks', child: hostOne, paths: [], reason: 'owner', blocks: [{ id: 'rem-prd-audit-T1', body: block }] },
          expect.objectContaining({
            kind: 'hunks', child: hostOne, path: '.docs/plans/demo.md', reason: 'owner',
            hunk: expect.objectContaining({ path: '.docs/plans/demo.md', patch: expect.stringMatching(/^\+# Demo$/m) }),
          }),
          expect.objectContaining({
            kind: 'hunks', child: hostOne, path: 'src/server/identity.ts', reason: 'owner',
            hunk: expect.objectContaining({ path: 'src/server/identity.ts' }),
          }),
        ],
      }],
    });
    if (plan.kind !== 'planned') return;
    const residual = plan.commits[0]!.parts.find((part) => part.kind === 'hunks' && part.path === '.docs/plans/demo.md');
    expect(residual?.kind === 'hunks' ? residual.hunk.patch : '').not.toContain('rem-prd-audit-T1');
  });

  it('refuses a frozen block whose hunk interleaves non-block lines it cannot split out', async () => {
    const interleaved = block.replace('**Done when:**\n', '**Done when:**\n- operator note\n');
    const { frozen, plan } = await frozenFixture(`# Demo\n\n${interleaved}`);

    expect(plan).toEqual({ kind: 'refused', reason: 'fold-residual-unexpressible', commit: frozen, paths: ['.docs/plans/demo.md'] });
  });
});
