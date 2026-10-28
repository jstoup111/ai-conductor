// Covers: task:15
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRouteRecord, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { REKICK_SENTINEL } from '../../../src/engine/daemon-rekick.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';

const roots: string[] = [];
const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-operator-'));
  roots.push(repo);
  const git = makeGitRunner(repo);
  const commit = async (message: string, path: string, value: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'stack-preflight-operator@example.invalid']);
  await git(['config', 'user.name', 'Stack preflight operator']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'initial']);
  await commit('base', '.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await commit('closed child', 'child.txt', 'child\n');
  await git(['update-ref', closureRefFor('demo', child), closed]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const leaf = await commit('leaf', 'leaf.txt', 'leaf\n');
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { child: 1, leaf: 2 }, titles: ['child', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  const created = await createRouteRecord(repo, 'demo', {
    roundId,
    sealedAuthored: 0,
    kind: 'operator',
    items: [],
    allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    operator: {
      origin: 'land', reason: 'reviewer landing', operator: 'operator@example.test', entryStep: 'acceptance_specs',
      carried: [], otherTips: { 'feat/daemon-demo': leaf as never },
      priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} },
    },
  }, { git });
  if (created.kind !== 'created') throw new Error(`route creation failed: ${created.kind}`);
  const admitted = await admitRound(repo, 'demo', created.record, child, { git });
  if (admitted.kind !== 'admitted') throw new Error(`route admission failed: ${admitted.detail}`);
  return { repo, git, leaf };
}

async function declareLanding(subject: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git: subject.git });
  if (stored.kind !== 'record' || stored.record.operator === undefined) throw new Error('operator round is unavailable');
  await expect(writeRoutingTransaction(subject.repo, 'demo', [{
    kind: 'update-record',
    previous: stored,
    record: {
      ...stored.record,
      operator: { ...stored.record.operator, declaration: { tip: subject.leaf as never, at: '2026-10-26T00:00:00.000Z' } },
    },
  }], { git: subject.git })).resolves.toEqual({ kind: 'updated' });
}

describe('stack preflight operator landing guard (real local Git)', () => {
  it('halts an undeclared landing before any restack, region navigation, or routed exit', async () => {
    const subject = await fixture();
    const refsBefore = (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/conductor/demo/'])).stdout;
    const reconcileRounds = vi.fn(async () => ({ kind: 'navigate-leaf-to-build' as const, roundId, host: child }));

    await expect(runStackPreflight({
      worktree: subject.repo, slug: 'demo', git: subject.git, reconcileRounds,
    })).resolves.toMatchObject({ kind: 'halted' });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('Operator-Halt: operator-round-undeclared r1\n');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'operator round r1 landing on child 1 is awaiting ai-conductor stack land --done or ai-conductor stack land --abandon',
    );
    expect(reconcileRounds).not.toHaveBeenCalled();
    expect((await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/conductor/demo/'])).stdout).toBe(refsBefore);
  });

  it('halts an undeclared landing before a due base-refresh deferral and preserves REKICK', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, REKICK_SENTINEL), 'rekick\n');
    const refsBefore = (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/conductor/demo/'])).stdout;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const reconcileRounds = vi.fn(async () => ({ kind: 'navigate-leaf-to-build' as const, roundId, host: child }));

    try {
      await expect(runStackPreflight({
        worktree: subject.repo, slug: 'demo', baseRefreshDue: true, git: subject.git, events, reconcileRounds,
      })).resolves.toMatchObject({ kind: 'halted' });
    } finally {
      persister.stop();
    }

    await expect(readFile(join(subject.repo, REKICK_SENTINEL), 'utf8')).resolves.toBe('rekick\n');
    expect(reconcileRounds).not.toHaveBeenCalled();
    expect((await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/conductor/demo/'])).stdout).toBe(refsBefore);
    await expect(readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8')).resolves.not.toContain('deferred-base-refresh');
  });

  it('navigates the declared operator landing for child 1 without a HALT', async () => {
    const subject = await fixture();
    await declareLanding(subject);
    const reconcileRounds = vi.fn(async () => ({ kind: 'navigate-leaf-to-build' as const, roundId, host: child }));

    await expect(runStackPreflight({
      worktree: subject.repo, slug: 'demo', git: subject.git, reconcileRounds,
    })).resolves.toEqual({ kind: 'navigate-leaf-to-build', roundId, host: child });

    expect(reconcileRounds).toHaveBeenCalledTimes(1);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
  });
});
