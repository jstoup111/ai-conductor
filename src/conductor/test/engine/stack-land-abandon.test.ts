// Covers: task:24, task:rem-as-built-rem-as-built-r11, task:rem-as-built-rem-as-built-r12
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { detectStackLandCommand } from '../../src/cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { acquireFeatureDispatchLease } from '../../src/engine/feature-dispatch-lease.js';
import { leafBranchFor } from '../../src/engine/feature-branch-identity.js';
import { createOwnedPark, releaseOwnedPark } from '../../src/engine/park-marker.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { abandonOperatorRound, formatOperatorHaltReason, openOperatorRound } from '../../src/engine/routing/operator-round.js';
import { reconcileRounds } from '../../src/engine/routing/round-admission.js';
import { readRepairMarker, readRouteRecord, transitionHost, writeRoutingTransaction } from '../../src/engine/routing/route-record-store.js';
import { closureRefFor, rejectedPinRefFor } from '../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';
import { dispatchStackLandCommand } from '../../src/engine/stack-land-cli.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeSliceTopologyFixture } from './slice-topology-fixture.js';

const roots: string[] = [];
const host = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-land-abandon-'));
  roots.push(repo);
  const git = makeGitRunner(repo);
  const commit = async (message: string, path: string, value: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '--no-verify', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'stack-land-abandon@example.invalid']);
  await git(['config', 'user.name', 'Stack land abandon']);
  await commit('base', '.gitignore', '.pipeline/\n.daemon/\n');
  await commit('routing', '.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { one: 1, leaf: 2 }, titles: ['one', 'leaf'] }, storyOwnership: { S1: 1, S2: 2 },
  });
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closure = await commit('closed child', 'one.txt', 'closed\n');
  await git(['update-ref', closureRefFor('demo', host), closure]);
  const landing = await commit('review landing', 'review.txt', 'landing\n');
  await git(['checkout', '-qb', leafBranchFor('demo'), closure]);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await git(['checkout', '-q', 'feat/c1/demo']);
  await mkdir(join(repo, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({ acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }));
  await writeFile(join(repo, '.pipeline', 'children', '1', 'kickback-ledger.json'), JSON.stringify({ version: 1, gates: {}, routedRepairCredit: { roundId, consumed: true } }) + '\n');
  const park = await createOwnedPark(repo, 'demo');
  if (!park.created) throw new Error('expected owned park');
  const opened = await openOperatorRound({
    worktree: repo, slug: 'demo', roundId, host, reason: 'discard reviewer edit', operator: 'operator@example.test', carried: [], park: { token: park.token }, emitter: new ConductorEventEmitter(), git,
  });
  if (opened.kind !== 'opened') throw new Error(opened.detail);
  return { repo, git, closure, landing, commit, park };
}

async function abandon(subject: Awaited<ReturnType<typeof fixture>>, deps: Record<string, unknown> = {}, output: string[] = []) {
  return dispatchStackLandCommand({ kind: 'stack-land-abandon', slug: 'demo' }, {
    cwd: subject.repo, resolveMainRoot: async () => subject.repo, resolveWorktree: async () => subject.repo, print: (line: string) => output.push(line), ...deps,
  } as never);
}

async function record(subject: Awaited<ReturnType<typeof fixture>>) {
  const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.git });
  if (stored.kind !== 'record') throw new Error('route record unavailable');
  return stored;
}

async function snapshot(subject: Awaited<ReturnType<typeof fixture>>) {
  return {
    branch: (await subject.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout,
    marker: await readRepairMarker(subject.repo, 'demo', { git: subject.git }),
    record: (await record(subject)).record,
    park: await readFile(join(subject.repo, '.daemon', 'parked', 'demo'), 'utf8'),
    region: await readFile(join(subject.repo, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8'),
  };
}

describe('stack land --abandon', () => {
  it('parses and abandons under its lease, clearing its park and operator halt', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), `${formatOperatorHaltReason('operator-round-undeclared', roundId)}\n`);
    await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), 'needs-human\n');
    await expect(readFile(join(subject.repo, '.daemon', 'parked', 'demo'), 'utf8'))
      .resolves.toContain(`owned-park-token: ${subject.park.token}`);

    expect(detectStackLandCommand(['node', 'ai-conductor', 'stack', 'land', '--slug', 'demo', '--abandon']))
      .toEqual({ kind: 'stack-land-abandon', slug: 'demo' });
    const output: string[] = [];
    expect(await abandon(subject, {}, output), output.join('\n')).toBe(0);

    await expect(subject.git(['rev-parse', 'refs/heads/feat/c1/demo'])).resolves.toMatchObject({ stdout: subject.closure });
    await expect(subject.git(['rev-parse', rejectedPinRefFor('demo', roundId, host)])).resolves.toMatchObject({ stdout: subject.landing });
    await expect(readFile(join(subject.repo, '.daemon', 'parked', 'demo'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await record(subject)).record).toMatchObject({ phase: 'closed', hosts: { 1: 'abandoned' } });
  });

  it('preserves a park recreated under foreign ownership during abandon', async () => {
    const subject = await fixture();
    let foreignToken: string | undefined;

    const output: string[] = [];
    expect(await abandon(subject, {
      abandonRound: async (input: Parameters<typeof abandonOperatorRound>[0]) => {
        await releaseOwnedPark(subject.repo, 'demo', subject.park.token);
        const foreign = await createOwnedPark(subject.repo, 'demo');
        if (!foreign.created) throw new Error('expected foreign owned park');
        foreignToken = foreign.token;
        return abandonOperatorRound(input);
      },
    }, output), output.join('\n')).toBe(0);

    await expect(readFile(join(subject.repo, '.daemon', 'parked', 'demo'), 'utf8'))
      .resolves.toContain(`owned-park-token: ${foreignToken}`);
  });

  it('refuses a built host and a live lease without changing the landing', async () => {
    const built = await fixture();
    const stored = await record(built);
    const transitioned = transitionHost(stored, host, 'built', { credit: false });
    if (transitioned.kind !== 'updated') throw new Error('could not enter built');
    await writeRoutingTransaction(built.repo, 'demo', [{ kind: 'update-record', previous: stored, record: transitioned.record }], { git: built.git });
    const beforeBuilt = await snapshot(built);
    const builtOutput: string[] = [];
    await expect(abandon(built, {}, builtOutput)).resolves.toBe(1);
    expect(builtOutput.join('\n')).toMatch(/exit restack/i);
    expect(await snapshot(built)).toEqual(beforeBuilt);

    const leased = await fixture();
    const beforeLease = await snapshot(leased);
    const lease = await acquireFeatureDispatchLease(leased.repo, 'demo', 'daemon dispatch');
    if (lease.kind !== 'acquired') throw new Error('could not take lease');
    const leaseOutput: string[] = [];
    await expect(abandon(leased, {}, leaseOutput)).resolves.toBe(1);
    expect(leaseOutput.join('\n')).toMatch(/daemon dispatch/i);
    expect(await snapshot(leased)).toEqual(beforeLease);
    await lease.lease.release();
  });

  it('preserves dirty work, yet pins a rewritten host tip', async () => {
    const dirty = await fixture();
    await writeFile(join(dirty.repo, 'dirty.txt'), 'keep me\n');
    const output: string[] = [];
    await expect(abandon(dirty, {}, output)).resolves.toBe(1);
    expect(output.join('\n')).toMatch(/dirty worktree/i);
    await expect(readFile(join(dirty.repo, 'dirty.txt'), 'utf8')).resolves.toBe('keep me\n');

    const rewritten = await fixture();
    const rewrittenTip = await rewritten.commit('rewritten review', 'rewrite.txt', 'rewritten\n');
    const rewrittenOutput: string[] = [];
    expect(await abandon(rewritten, {}, rewrittenOutput), rewrittenOutput.join('\n')).toBe(0);
    await expect(rewritten.git(['rev-parse', rejectedPinRefFor('demo', roundId, host)])).resolves.toMatchObject({ stdout: rewrittenTip });
  });

  it('resumes a moved-stage crash on the host without spending existing ledger credit', async () => {
    const subject = await fixture();
    const ledger = await readFile(join(subject.repo, '.pipeline', 'children', '1', 'kickback-ledger.json'), 'utf8');
    const crashing: GitRunner = async (args, options) => args[0] === 'read-tree'
      ? { exitCode: 1, stdout: '', stderr: 'simulated crash' }
      : subject.git(args, options);
    await expect(abandon(subject, { abandonRound: (input: Parameters<typeof abandonOperatorRound>[0]) => abandonOperatorRound({ ...input, git: crashing }) })).resolves.toBe(1);
    expect((await record(subject)).record.operator?.abandon?.stage).toBe('moved');

    const syncedOn: string[] = [];
    const recovering: GitRunner = async (args, options) => {
      if (args[0] === 'read-tree') syncedOn.push((await subject.git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim());
      return subject.git(args, options);
    };
    const recoveryOutput: string[] = [];
    expect(await abandon(subject, {
      abandonRound: (input: Parameters<typeof abandonOperatorRound>[0]) => abandonOperatorRound({ ...input, git: recovering }),
      reconcileRounds: (worktree: string, slug: string) => reconcileRounds(worktree, slug, { git: recovering }),
    }, recoveryOutput), recoveryOutput.join('\n')).toBe(0);
    expect(syncedOn).toEqual(['feat/c1/demo']);
    await expect(readFile(join(subject.repo, '.pipeline', 'children', '1', 'kickback-ledger.json'), 'utf8')).resolves.toBe(ledger);
    expect((await record(subject)).record).toMatchObject({ phase: 'closed', hosts: { 1: 'abandoned' } });
  });

  it('keeps an owned park across a mid-abandon crash after the landing park was released', async () => {
    const subject = await fixture();
    await releaseOwnedPark(subject.repo, 'demo', subject.park.token);
    const crashing: GitRunner = async (args, options) => args[0] === 'read-tree'
      ? { exitCode: 1, stdout: '', stderr: 'simulated crash' }
      : subject.git(args, options);

    await abandon(subject, { abandonRound: (input: Parameters<typeof abandonOperatorRound>[0]) => abandonOperatorRound({ ...input, git: crashing }) });

    await expect(readFile(join(subject.repo, '.daemon', 'parked', 'demo'), 'utf8')).resolves.toContain('owned-park-token:');
  });

  it('abandons an open rewind-origin round through the round authority', async () => {
    const subject = await fixture();
    const stored = await record(subject);
    const rewind = {
      ...stored.record,
      operator: { ...stored.record.operator!, origin: 'rewind' as const },
    };
    await writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: stored, record: rewind }], { git: subject.git });

    const output: string[] = [];
    expect(await abandon(subject, {}, output), output.join('\n')).toBe(0);
    expect((await record(subject)).record).toMatchObject({ phase: 'closed', hosts: { 1: 'abandoned' } });
  });

  it('abandons an admitted landing from a clean checkout before the host switch', async () => {
    const subject = await fixture();
    await subject.git(['switch', '-q', leafBranchFor('demo')]);

    const output: string[] = [];
    expect(await abandon(subject, {}, output), output.join('\n')).toBe(0);
    expect((await record(subject)).record).toMatchObject({ phase: 'closed', hosts: { 1: 'abandoned' } });
  });
});
