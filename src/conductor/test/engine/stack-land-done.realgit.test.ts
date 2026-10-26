// Covers: task:19
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { detectStackLandCommand } from '../../src/cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { acquireFeatureDispatchLease } from '../../src/engine/feature-dispatch-lease.js';
import { leafBranchFor } from '../../src/engine/feature-branch-identity.js';
import { createOwnedPark } from '../../src/engine/park-marker.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { formatOperatorHaltReason, openOperatorRound } from '../../src/engine/routing/operator-round.js';
import { readRouteRecord } from '../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';
import { dispatchStackLandCommand } from '../../src/engine/stack-land-cli.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from './slice-topology-fixture.js';

const roots: string[] = [];
const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(options: { landing?: boolean; carried?: boolean } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'stack-land-done-'));
  roots.push(repo);
  const git = makeGitRunner(repo);
  const commit = async (message: string, path: string, contents: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), contents);
    await git(['add', path]);
    await git(['commit', '--no-verify', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'stack-land-done@example.invalid']);
  await git(['config', 'user.name', 'Stack land done']);
  await commit('base', '.gitignore', '.pipeline/\n.daemon/\n');
  await commit('routing enabled', '.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closure = await commit('closed child one', 'one.txt', 'one\n');
  await git(['update-ref', closureRefFor('demo', c1), closure]);
  if (options.landing !== false) await commit('reviewer landing', 'review.txt', 'landing\n');
  const hostTip = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['checkout', '-qb', 'feat/c2/demo', closure]);
  const c2Tip = await commit('closed child two', 'two.txt', 'two\n');
  await git(['update-ref', closureRefFor('demo', c2), c2Tip]);
  await git(['checkout', '-qb', leafBranchFor('demo'), closure]);
  const leafTip = await commit('leaf', 'leaf.txt', 'leaf\n');
  await git(['checkout', '-q', 'feat/c1/demo']);
  await mkdir(join(repo, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { one: 1, two: 2 }, titles: ['one', 'two'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  const park = await createOwnedPark(repo, 'demo');
  if (!park.created) throw new Error('expected an owned park');
  const opened = await openOperatorRound({
    worktree: repo, slug: 'demo', roundId, host: c1, reason: 'rename reviewer flag', operator: 'operator@example.test',
    carried: options.carried ? [{ child: c2, tip: c2Tip as never }] : [], park: { token: park.token },
    emitter: new ConductorEventEmitter(), git,
  });
  if (opened.kind !== 'opened') throw new Error(`could not open landing: ${opened.detail}`);
  return { repo, git, closure, hostTip, c2Tip, leafTip, commit };
}

async function done(subject: Awaited<ReturnType<typeof fixture>>, output: string[] = []) {
  return dispatchStackLandCommand({ kind: 'stack-land-done', slug: 'demo' } as never, {
    cwd: subject.repo,
    resolveMainRoot: async () => subject.repo,
    resolveWorktree: async () => subject.repo,
    print: (line) => output.push(line),
  });
}

async function record(subject: Awaited<ReturnType<typeof fixture>>) {
  const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.git });
  if (stored.kind !== 'record') throw new Error('route record unavailable');
  return stored.record;
}

describe('stack land --done (real local Git)', () => {
  it('declares the host tip, retains the work order, releases its owned park, and names the revalidation dispatch', async () => {
    const subject = await fixture();
    const output: string[] = [];

    expect(detectStackLandCommand(['node', 'ai-conductor', 'stack', 'land', '--slug', 'demo', '--done']))
      .toEqual({ kind: 'stack-land-done', slug: 'demo' });

    await expect(done(subject, output)).resolves.toBe(0);

    const stored = await record(subject);
    expect(stored.operator?.declaration?.tip).toBe(subject.hostTip);
    expect(stored.allocation[c1]?.retryHint).toContain('rename reviewer flag');
    await expect(readFile(join(subject.repo, '.daemon', 'parked', 'demo'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(output.join('\n')).toMatch(/dispatch.*re-validates child 1/i);
  });

  it('refuses an empty or halt-only landing, the leaf branch, and a dirty worktree without declaring', async () => {
    const empty = await fixture({ landing: false });
    const emptyOutput: string[] = [];
    await expect(done(empty, emptyOutput)).resolves.toBe(1);
    expect(emptyOutput.join('\n')).toMatch(/empty landing.*--abandon/i);
    expect((await record(empty)).operator?.declaration).toBeUndefined();

    const haltOnly = await fixture({ landing: false });
    await haltOnly.commit('halt', '.docs/halted/demo.md', 'halt\n');
    const haltOutput: string[] = [];
    await expect(done(haltOnly, haltOutput)).resolves.toBe(1);
    expect(haltOutput.join('\n')).toMatch(/empty landing.*--abandon/i);
    expect((await record(haltOnly)).operator?.declaration).toBeUndefined();

    const leaf = await fixture();
    await leaf.git(['checkout', '-q', leafBranchFor('demo')]);
    const leafOutput: string[] = [];
    await expect(done(leaf, leafOutput)).resolves.toBe(1);
    expect(leafOutput.join('\n')).toContain('feat/c1/demo');
    expect((await record(leaf)).operator?.declaration).toBeUndefined();

    const dirty = await fixture();
    await writeFile(join(dirty.repo, 'dirty.txt'), 'dirty\n');
    const dirtyOutput: string[] = [];
    await expect(done(dirty, dirtyOutput)).resolves.toBe(1);
    expect(dirtyOutput.join('\n')).toMatch(/dirty worktree/i);
    expect((await record(dirty)).operator?.declaration).toBeUndefined();
  });

  it('refuses a live lease and moved non-host or carried branches without declaring', async () => {
    const leased = await fixture();
    const lease = await acquireFeatureDispatchLease(leased.repo, 'demo', 'other command');
    if (lease.kind !== 'acquired') throw new Error('could not create live lease');
    const leaseOutput: string[] = [];
    await expect(done(leased, leaseOutput)).resolves.toBe(1);
    expect(leaseOutput.join('\n')).toContain('other command');
    expect((await record(leased)).operator?.declaration).toBeUndefined();
    await lease.lease.release();

    const moved = await fixture();
    await moved.git(['checkout', '-q', 'feat/c2/demo']);
    const movedTip = await moved.commit('bypass hook', 'moved.txt', 'moved\n');
    await moved.git(['checkout', '-q', 'feat/c1/demo']);
    const movedOutput: string[] = [];
    await expect(done(moved, movedOutput)).resolves.toBe(1);
    expect(movedOutput.join('\n')).toContain(`feat/c2/demo (recorded ${moved.c2Tip}, current ${movedTip})`);
    expect((await record(moved)).operator?.declaration).toBeUndefined();

    const carried = await fixture({ carried: true });
    await carried.git(['checkout', '-q', 'feat/c2/demo']);
    const carriedTip = await carried.commit('bypass hook', 'carried.txt', 'moved\n');
    await carried.git(['checkout', '-q', 'feat/c1/demo']);
    const carriedOutput: string[] = [];
    await expect(done(carried, carriedOutput)).resolves.toBe(1);
    expect(carriedOutput.join('\n')).toContain(`feat/c2/demo (recorded ${carried.c2Tip}, current ${carriedTip})`);
    expect((await record(carried)).operator?.declaration).toBeUndefined();
  });

  it('clears a restored branch-moved halt at declaration, and on a declared landing resume leaves the record unchanged', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await subject.commit('bypass hook', 'moved.txt', 'moved\n');
    await subject.git(['update-ref', 'refs/heads/feat/c2/demo', subject.c2Tip]);
    await subject.git(['reset', '--hard', '-q', subject.c2Tip]);
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), `${formatOperatorHaltReason('operator-round-branch-moved', roundId)}\n`);
    await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), 'needs-human\n');

    const declarationOutput: string[] = [];
    await expect(done(subject, declarationOutput)).resolves.toBe(0);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const declared = await record(subject);

    await writeFile(join(subject.repo, '.pipeline', 'HALT'), `${formatOperatorHaltReason('operator-round-branch-moved', roundId)}\n`);
    await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), 'needs-human\n');
    const resumeOutput: string[] = [];
    await expect(dispatchStackLandCommand({ kind: 'stack-land', slug: 'demo', child: '1', carry: [], reason: 'rename reviewer flag' }, {
      cwd: subject.repo, resolveMainRoot: async () => subject.repo, resolveWorktree: async () => subject.repo,
      resolveOperator: async () => 'operator@example.test', print: (line) => resumeOutput.push(line),
    })).resolves.toBe(0);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await record(subject)).toEqual(declared);
  });

  it('clears only its undeclared halt and names an unrelated needs-human halt without changing it', async () => {
    const matching = await fixture();
    await mkdir(join(matching.repo, '.pipeline'), { recursive: true });
    await writeFile(join(matching.repo, '.pipeline', 'HALT'), `${formatOperatorHaltReason('operator-round-undeclared', roundId)}\n`);
    await writeFile(join(matching.repo, '.pipeline', 'HALT.class'), 'needs-human\n');
    await expect(done(matching)).resolves.toBe(0);
    await expect(readFile(join(matching.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const unrelated = await fixture();
    const body = 'some-other-needs-human-halt\n';
    await writeFile(join(unrelated.repo, '.pipeline', 'HALT'), body);
    await writeFile(join(unrelated.repo, '.pipeline', 'HALT.class'), 'needs-human\n');
    const output: string[] = [];
    await expect(done(unrelated, output)).resolves.toBe(0);
    await expect(readFile(join(unrelated.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(body);
    expect(output.join('\n')).toMatch(/needs-human HALT remains/i);
  });
});
