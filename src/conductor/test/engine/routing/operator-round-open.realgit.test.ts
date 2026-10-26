// Covers: task:9, task:16
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { openOperatorRound } from '../../../src/engine/routing/operator-round.js';
import { createRouteRecord, readRepairMarker, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { readRoutedGrowthSnapshot, rebuildLedgerFromReceipts } from '../../../src/engine/routing/round-receipt.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

const roots: string[] = [];
const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const priorRoundId = parseRoundId('r2')!;
const routedSealedAuthored = 3;
const routing = {
  cursor: { kind: 'active' },
  config: { stacked_prs: { route_whole_feature_fixes: true } },
};

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'operator-round-open-'));
  roots.push(repo);
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'operator-round@example.invalid']);
  await git(['config', 'user.name', 'Operator round']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'initial']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(repo, 'child.txt'), 'closed child\n');
  await git(['add', 'child.txt']);
  await git(['commit', '-qm', 'closed child']);
  const closure = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', child), closure]);
  await writeFile(join(repo, 'manual.txt'), 'pre-existing reviewer edit\n');
  await git(['add', 'manual.txt']);
  await git(['commit', '-qm', 'reviewer edit']);
  const existingCommit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['checkout', '-qb', leafBranchFor('demo'), closure]);
  await writeFile(join(repo, 'leaf.txt'), 'leaf\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'leaf']);
  await mkdir(join(repo, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));
  return { repo, git, closure, existingCommit };
}

function open(subject: Awaited<ReturnType<typeof fixture>>, git: GitRunner = subject.git) {
  return openOperatorRound({
    worktree: subject.repo,
    slug: 'demo',
    roundId,
    host: child,
    reason: 'land reviewer edits in child one',
    operator: 'operator@example.test',
    carried: [],
    emitter: new ConductorEventEmitter(),
    git,
  });
}

describe('open operator round (real local Git)', () => {
  // Covers: task:16
  it('opens an undeclared landing without the dispatch-side region-entry refusal', async () => {
    const subject = await fixture();

    await expect(open(subject)).resolves.toMatchObject({ kind: 'opened', pinnedBase: subject.closure });
    const stored = await readRouteRecord(subject.repo, 'demo', roundId);
    expect(stored).toMatchObject({ kind: 'record', record: { kind: 'operator', hosts: { 1: 'repairing' } } });
    if (stored.kind !== 'record') throw new Error('missing opened operator round');
    expect(stored.record.operator?.declaration).toBeUndefined();
  });

  it('opens the land round on its closed host and restages only its region', async () => {
    const subject = await fixture();

    await expect(open(subject)).resolves.toMatchObject({ kind: 'opened', pinnedBase: subject.closure });
    await expect(subject.git(['symbolic-ref', '--short', 'HEAD'])).resolves.toMatchObject({ stdout: 'feat/c1/demo' });
    await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'marker', marker: { host: 1, roundId } });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record',
      record: {
        kind: 'operator',
        hosts: { 1: 'repairing' },
        entry: { host: 1, pinnedBase: subject.closure },
        operator: { origin: 'land', reason: 'land reviewer edits in child one' },
      },
    });
    await expect(readFile(join(subject.repo, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8').then(JSON.parse))
      .resolves.toMatchObject({ acceptance_specs: 'pending', build: 'done', test_suite: 'pending', build_review: 'pending' });
  });

  it('keeps existing post-closure work and pins the closure rather than the current host tip', async () => {
    const subject = await fixture();

    await expect(open(subject)).resolves.toMatchObject({ kind: 'opened', pinnedBase: subject.closure });
    await expect(subject.git(['rev-parse', 'HEAD']).then((result) => result.stdout.trim())).resolves.toBe(subject.existingCommit);
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { entry: { pinnedBase: subject.closure } },
    });
  });

  // Covers: task:rem-as-built-rem-as-built-r3
  it('seals an operator round with the routed denominator so receipt accounting remains readable', async () => {
    const subject = await fixture();
    const prior = await createRouteRecord(subject.repo, 'demo', {
      roundId: priorRoundId,
      sealedAuthored: routedSealedAuthored,
      kind: 'audit',
      items: [],
      allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    }, { git: subject.git });
    if (prior.kind !== 'created') throw new Error(`could not create prior route: ${prior.kind}`);

    await expect(open(subject)).resolves.toMatchObject({ kind: 'opened', pinnedBase: subject.closure });
    await expect(readRouteRecord(subject.repo, 'demo', roundId, { git: subject.git })).resolves.toMatchObject({
      kind: 'record', record: { sealedAuthored: routedSealedAuthored },
    });
    await expect(readRoutedGrowthSnapshot(subject.repo, 'demo', routing, subject.git)).resolves.toEqual({
      pendingAllocationTaskIds: [], sealedAuthored: routedSealedAuthored,
    });
    await expect(rebuildLedgerFromReceipts(subject.repo, 'demo', routing, subject.git)).resolves.toEqual({ kind: 'rebuilt' });
  });

  it('resumes after a post-marker crash without another route, switch, pin, or restage', async () => {
    const subject = await fixture();
    const calls: string[][] = [];
    let crashed = false;
    let routeTransactions = 0;
    const crashing: GitRunner = async (args, options) => {
      calls.push(args);
      const result = await subject.git(args, options);
      if (!crashed && args[0] === 'update-ref' && args[1] === '--stdin') {
        routeTransactions += 1;
        if (routeTransactions === 2) {
          crashed = true;
          throw new Error('crash after marker transaction');
        }
      }
      return result;
    };

    await expect(open(subject, crashing)).resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('marker') });
    const replay: GitRunner = async (args, options) => {
      calls.push(args);
      return subject.git(args, options);
    };
    await expect(open(subject, replay)).resolves.toMatchObject({ kind: 'opened', pinnedBase: subject.closure });
    const routes = await subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/']);
    expect(routes.stdout.split('\n').filter(Boolean)).toHaveLength(1);
    expect(calls.filter((args) => args[0] === 'switch')).toHaveLength(1);
    await expect(subject.git(['symbolic-ref', '--short', 'HEAD'])).resolves.toMatchObject({ stdout: 'feat/c1/demo' });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'repairing' }, entry: { pinnedBase: subject.closure } },
    });
  });
});
