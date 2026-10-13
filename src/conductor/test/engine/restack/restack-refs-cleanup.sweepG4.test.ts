// Teardown and reclaim call sites of deleteFeatureConductorRefs (Task 38),
// driven through the production `sweepMergeableLabels` shipped-record teardown
// and `reconcileMergedPark` against real local Git.  The engine Git runner
// that both call sites build with `makeGitRunner` is wrapped (not replaced) so
// the test can observe — and selectively fail — the exact argv and stdin the
// cleanup sends to the Git process boundary.
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitResult, GitRunner } from '../../../src/engine/rebase.js';

const boundary = vi.hoisted(() => ({
  calls: [] as Array<{ cwd: string; args: string[]; input?: string }>,
  /** Return a result to short-circuit one call at the process boundary. */
  intercept: undefined as undefined | ((args: string[]) => GitResult | undefined),
}));

vi.mock('../../../src/engine/rebase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/rebase.js')>();
  return {
    ...actual,
    makeGitRunner: (cwd: string): GitRunner => {
      const real = actual.makeGitRunner(cwd);
      return async (args, opts) => {
        boundary.calls.push({ cwd, args: [...args], input: opts?.input });
        const intercepted = boundary.intercept?.(args);
        if (intercepted) return intercepted;
        return real(args, opts);
      };
    },
  };
});

vi.mock('../../../src/engine/restack/restack-refs-cleanup.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-refs-cleanup.js')>();
  return { ...actual, deleteFeatureConductorRefs: vi.fn(actual.deleteFeatureConductorRefs) };
});

import { parseChildId } from '../../../src/engine/child-context.js';
import { phaseMarkerPath } from '../../../src/engine/phase-marker.js';
import { enrollWatch, readWatch, sweepMergeableLabels } from '../../../src/engine/mergeable-sweep.js';
import { reconcileMergedPark, reconcileParkedFeatures } from '../../../src/engine/park-reconciliation.js';
import type { GhRunner, GitRunner as ReclaimGitRunner } from '../../../src/engine/pr-labels.js';
import { forcePushWithExpectedLease, pushedTipRef } from '../../../src/engine/push-lease.js';
import { readCascadeCounts } from '../../../src/engine/restack/cascade-cap.js';
import {
  journalRefFor,
  stagingRefFor,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import {
  deleteFeatureConductorRefs,
  featureConductorRefNames,
} from '../../../src/engine/restack/restack-refs-cleanup.js';
import type { RestackOpId } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const PR_URL = 'https://github.com/acme/repo/pull/7';
const LEAF = 'feat/daemon-demo';

beforeEach(() => {
  boundary.calls.length = 0;
  boundary.intercept = undefined;
  vi.mocked(deleteFeatureConductorRefs).mockClear();
});

afterEach(async () => {
  boundary.intercept = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function nativeGit(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

async function refOid(cwd: string, ref: string): Promise<string | undefined> {
  try {
    return await nativeGit(cwd, 'rev-parse', '-q', '--verify', ref);
  } catch {
    return undefined;
  }
}

async function conductorRefSnapshot(cwd: string): Promise<string> {
  return nativeGit(cwd, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/');
}

/**
 * A project root whose `origin/main` carries `.docs/shipped/demo.md`, the
 * durable proof that both the sweep teardown and the reclaim helper act on.
 */
async function projectFixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-refs-cleanup-sweepG4-'));
  roots.push(repo);
  await nativeGit(repo, 'init', '-q', '-b', 'main');
  await nativeGit(repo, 'config', 'user.email', 'cleanup@example.test');
  await nativeGit(repo, 'config', 'user.name', 'Ref cleanup');
  await writeFile(join(repo, '.gitignore'), '.daemon/\n.worktrees/\n.pipeline/\n');
  await mkdir(join(repo, '.docs', 'shipped'), { recursive: true });
  await writeFile(join(repo, '.docs', 'shipped', 'demo.md'), '# shipped demo\n');
  await nativeGit(repo, 'add', '.');
  await nativeGit(repo, 'commit', '-qm', 'ship demo');
  await nativeGit(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return repo;
}

/** Seed every finite feature ref plus a journal that names a staging ref. */
async function seedFeatureRefs(repo: string) {
  const child = parseChildId(1);
  if (!child) throw new Error('child 1 should be valid');
  const tip = await nativeGit(repo, 'rev-parse', 'HEAD');
  for (const ref of featureConductorRefNames('demo')) {
    if (ref !== journalRefFor('demo')) await nativeGit(repo, 'update-ref', ref, tip);
  }
  const journal: RestackJournal = {
    opId: 'sweep-cleanup-journal' as RestackOpId,
    cause: 'base-refresh',
    committer: { name: 'Ref cleanup', email: 'cleanup@example.test', date: '2030-01-02T03:04:05Z' },
    dirtyPaths: [],
    refs: [],
    ranges: [{ child, oldParent: tip as never, oldTip: tip as never, kind: 'active' }],
    children: [{ child, status: 'pending' }],
    state: 'planned',
    owner: { host: 'cleanup-host', pid: 1, processStartTime: '0' },
  };
  const blob = await writeRestackJournalBlob(repo, journal);
  await nativeGit(repo, 'update-ref', journalRefFor('demo'), blob);
  await nativeGit(repo, 'update-ref', stagingRefFor('demo', child), tip);
  const expected = [...featureConductorRefNames('demo'), stagingRefFor('demo', child)];
  return { child, tip, expected };
}

/** The reclaim helper's evidence reads, run against real local Git. */
const reclaimGit: ReclaimGitRunner = async (args, opts) => {
  const result = await execFile('git', args, { cwd: opts.cwd });
  return { stdout: String(result.stdout) };
};

function mergedGh(): GhRunner {
  return (async (args: string[]) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN', statusCheckRollup: [], labels: [], isDraft: false }),
      };
    }
    return { stdout: '' };
  }) as GhRunner;
}

async function runShippedTeardownSweep(repo: string, logs: string[] = []) {
  await enrollWatch(repo, { prUrl: PR_URL, slug: 'demo', repoCwd: repo });
  const teardowns: string[] = [];
  await sweepMergeableLabels({
    projectRoot: repo,
    runGh: mergedGh(),
    log: (message) => logs.push(message),
    shippedRecordProbe: async () => 'present',
    teardownWorktree: async (worktree) => { teardowns.push(worktree.branch); },
  });
  return { teardowns, logs };
}

/** Every Git call the cleanup made; asserts the explicit-name, no-glob shape. */
function expectExplicitDeleteTransaction(repo: string, expectedRefs: readonly string[]) {
  const calls = boundary.calls.filter((call) => call.cwd === repo);
  expect(calls.map(({ args }) => args[0])).not.toContain('for-each-ref');
  const transactions = calls.filter(({ args }) => args[0] === 'update-ref');
  expect(transactions.map(({ args }) => args)).toEqual([['update-ref', '--stdin']]);
  const lines = (transactions[0]!.input ?? '').split('\n').filter(Boolean);
  expect(lines[0]).toBe('start');
  expect(lines.slice(-2)).toEqual(['prepare', 'commit']);
  const deletes = lines.slice(1, -2);
  for (const line of deletes) expect(line).toMatch(/^delete refs\/conductor\/demo\/[^\s*?[\]]+ [0-9a-f]{40}$/);
  expect(deletes.map((line) => line.split(' ')[1]).sort()).toEqual([...expectedRefs].sort());
  // Every candidate is named explicitly before the transaction. The cleanup
  // protocol batches those explicit names through cat-file; it never discovers
  // a prefix or probes refs one at a time.
  const probes = calls.filter(({ args }) => args[0] === 'cat-file' && args[1] === '--batch-check');
  const probedRefs = probes.flatMap(({ input }) => (input ?? '').split('\n').filter(Boolean));
  for (const ref of expectedRefs) expect(probedRefs).toContain(ref);
  for (const call of calls) expect(call.args.join(' ')).not.toMatch(/[*?]/);
}

describe('feature conductor ref cleanup at its production call sites (real local Git)', () => {
  // Covers: task:38
  it('shipped-record teardown and reconcileMergedPark each delete every finite feature ref and journal staging ref through one explicit-name transaction', async () => {
    // Fixture 1: the mergeable sweep's shipped-record teardown.
    const sweepRepo = await projectFixture();
    const sweepSeed = await seedFeatureRefs(sweepRepo);
    const { teardowns, logs } = await runShippedTeardownSweep(sweepRepo);
    expect(teardowns).toEqual([LEAF]);
    expect(logs).toContain('[mergeable-sweep] reaped demo — reason: shipped-record-on-main');
    for (const ref of sweepSeed.expected) expect(await refOid(sweepRepo, ref)).toBeUndefined();
    expectExplicitDeleteTransaction(sweepRepo, sweepSeed.expected);

    // Fixture 2: the single-slug reclaim helper.
    boundary.calls.length = 0;
    const reclaimRepo = await projectFixture();
    const reclaimSeed = await seedFeatureRefs(reclaimRepo);
    const outcome = await reconcileMergedPark({ projectRoot: reclaimRepo, slug: 'demo', runGit: reclaimGit });
    expect(outcome).toEqual({ slug: 'demo', steps: ['worktree-removed', 'branch-absent'] });
    for (const ref of reclaimSeed.expected) expect(await refOid(reclaimRepo, ref)).toBeUndefined();
    expectExplicitDeleteTransaction(reclaimRepo, reclaimSeed.expected);
    expect(vi.mocked(deleteFeatureConductorRefs).mock.calls.map(([slug]) => slug)).toEqual(['demo', 'demo']);
  });

  // Covers: task:38
  it('after shipped-record teardown a feature reusing the slug leases its first force push on the no-record path and starts at zero cascades', async () => {
    const repo = await projectFixture();
    const remoteRoot = await mkdtemp(join(tmpdir(), 'restack-refs-cleanup-sweepG4-origin-'));
    roots.push(remoteRoot);
    const remote = join(remoteRoot, 'origin.git');
    await nativeGit(repo, 'init', '-q', '--bare', '--initial-branch=main', remote);
    await nativeGit(repo, 'remote', 'add', 'origin', remote);
    await nativeGit(repo, 'push', '-q', 'origin', 'main');
    const stale = await nativeGit(repo, 'rev-parse', 'HEAD');
    // The shipped feature's published branch and its durable records.
    await nativeGit(repo, 'checkout', '-qb', LEAF);
    await writeFile(join(repo, 'old.txt'), 'old feature\n');
    await nativeGit(repo, 'add', 'old.txt');
    await nativeGit(repo, 'commit', '-qm', 'old feature');
    await nativeGit(repo, 'push', '-q', 'origin', `HEAD:refs/heads/${LEAF}`);
    await nativeGit(repo, 'fetch', '-q', 'origin', `+refs/heads/${LEAF}:refs/remotes/origin/${LEAF}`);
    const oldRemote = await nativeGit(repo, 'rev-parse', `refs/remotes/origin/${LEAF}`);
    // A pushed record that no longer names the remote tip, and spent cascades.
    await nativeGit(repo, 'update-ref', pushedTipRef('demo', LEAF), stale);
    const blob = await new Promise<string>((resolve, reject) => {
      const child = execFileCallback('git', ['hash-object', '-w', '--stdin'], { cwd: repo }, (error, stdout) => {
        if (error) reject(error); else resolve(stdout.trim());
      });
      child.stdin?.end(JSON.stringify({ version: 1, counts: { 1: 2, 2: 1 } }));
    });
    await nativeGit(repo, 'update-ref', 'refs/conductor/demo/cascades', blob);
    await nativeGit(repo, 'checkout', '-q', 'main');

    await runShippedTeardownSweep(repo);

    // A new feature reusing slug `demo` starts from main; its HEAD does not
    // contain the shipped branch's remote tip.
    await nativeGit(repo, 'checkout', '-qB', LEAF, 'main');
    await writeFile(join(repo, 'new.txt'), 'new feature\n');
    await nativeGit(repo, 'add', 'new.txt');
    await nativeGit(repo, 'commit', '-qm', 'new feature');
    const newHead = await nativeGit(repo, 'rev-parse', 'HEAD');

    const pushes: string[][] = [];
    const result = await forcePushWithExpectedLease({
      cwd: repo,
      slug: 'demo',
      branch: LEAF,
      remoteGit: async (args) => {
        pushes.push([...args]);
        await nativeGit(repo, ...args);
        return { kind: 'executed' };
      },
    });

    expect(result).toEqual({ kind: 'executed' });
    // The no-record path leases against the tracking ref captured before the
    // fetch; a surviving stale record would have refused this push.
    expect(pushes).toEqual([[
      'push', 'origin', `HEAD:refs/heads/${LEAF}`, `--force-with-lease=refs/heads/${LEAF}:${oldRemote}`,
    ]]);
    expect(await nativeGit(remote, 'rev-parse', `refs/heads/${LEAF}`)).toBe(newHead);
    const counts = await readCascadeCounts(repo, 'demo');
    expect(counts).toMatchObject({ kind: 'counts', counts: { version: 1, counts: {} } });
  });

  // Covers: task:38
  it('reclaim refusals for an in-flight feature, a live phase marker, an invalid slug and a live HALT never call deleteFeatureConductorRefs and leave every demo conductor ref unchanged', async () => {
    const repo = await projectFixture();
    await seedFeatureRefs(repo);
    const before = await conductorRefSnapshot(repo);
    expect(before.split('\n')).toHaveLength(featureConductorRefNames('demo').length + 1);

    await expect(reconcileMergedPark({ projectRoot: repo, slug: 'demo', isFeatureInFlight: () => true, runGit: reclaimGit }))
      .resolves.toEqual({ slug: 'demo', steps: [], refusal: 'in-flight' });

    await mkdir(join(repo, '.worktrees', 'demo', '.pipeline'), { recursive: true });
    await writeFile(
      phaseMarkerPath(join(repo, '.worktrees', 'demo')),
      `phase: build\nwritten: ${new Date().toISOString()}\n`,
    );
    await expect(reconcileMergedPark({ projectRoot: repo, slug: 'demo', runGit: reclaimGit }))
      .resolves.toEqual({ slug: 'demo', steps: [], refusal: 'in-flight' });
    await rm(phaseMarkerPath(join(repo, '.worktrees', 'demo')), { force: true });

    for (const slug of ['Demo', '../demo', 'demo/x', '-demo']) {
      await expect(reconcileMergedPark({ projectRoot: repo, slug, runGit: reclaimGit }))
        .resolves.toEqual({ slug, steps: [], refusal: 'invalid-slug' });
    }

    // A live HALT: the reclaim sweep retains the candidate before the helper,
    // although its merged, shipped leaf branch would otherwise be reclaimed.
    await nativeGit(repo, 'branch', LEAF);
    await writeFile(join(repo, '.worktrees', 'demo', '.pipeline', 'HALT'), 'needs-human\n');
    const swept = await reconcileParkedFeatures({
      projectRoot: repo,
      runGit: reclaimGit,
      worktreeListing: async () => [{ slug: 'demo', branch: LEAF }],
    });
    expect(swept.counts.reconciled).toBe(0);
    expect(swept.entries).toEqual([{ slug: 'demo', classification: 'unclassified', annotation: undefined }]);

    expect(deleteFeatureConductorRefs).not.toHaveBeenCalled();
    expect(await conductorRefSnapshot(repo)).toBe(before);
  });

  // Covers: task:38
  it('a failed or partial ref deletion leaves the teardown reap and the reclaim decision intact and a re-run deletes the remaining refs', async () => {
    // Shipped-record teardown: the whole transaction fails once.
    const sweepRepo = await projectFixture();
    const sweepSeed = await seedFeatureRefs(sweepRepo);
    boundary.intercept = (args) => args[0] === 'update-ref' && args[1] === '--stdin'
      ? { exitCode: 1, stdout: '', stderr: 'simulated transaction failure' }
      : undefined;
    const failed = await runShippedTeardownSweep(sweepRepo);
    expect(failed.teardowns).toEqual([LEAF]);
    expect(failed.logs).toContain('[mergeable-sweep] reaped demo — reason: shipped-record-on-main');
    expect(failed.logs.some((line) => line.includes('reap failed'))).toBe(false);
    expect(await readWatch(sweepRepo)).toEqual([]);
    for (const ref of sweepSeed.expected) expect(await refOid(sweepRepo, ref)).toBeDefined();
    boundary.intercept = undefined;
    const rerun = await runShippedTeardownSweep(sweepRepo);
    expect(rerun.logs).toContain('[mergeable-sweep] reaped demo — reason: shipped-record-on-main');
    for (const ref of sweepSeed.expected) expect(await refOid(sweepRepo, ref)).toBeUndefined();

    // reconcileMergedPark: a failed explicit-name batch leaves the reclaim
    // decision intact; a re-run finishes the same finite transaction.
    const reclaimRepo = await projectFixture();
    const reclaimSeed = await seedFeatureRefs(reclaimRepo);
    boundary.intercept = (args) => args[0] === 'cat-file' && args[1] === '--batch-check'
      ? { exitCode: 128, stdout: '', stderr: 'simulated read failure' }
      : undefined;
    await expect(reconcileMergedPark({ projectRoot: reclaimRepo, slug: 'demo', runGit: reclaimGit }))
      .resolves.toEqual({ slug: 'demo', steps: ['worktree-removed', 'branch-absent'] });
    for (const ref of reclaimSeed.expected) expect(await refOid(reclaimRepo, ref)).toBeDefined();
    boundary.intercept = (args) => args[0] === 'update-ref' && args[1] === '--stdin'
      ? { exitCode: 1, stdout: '', stderr: 'simulated transaction failure' }
      : undefined;
    await expect(reconcileMergedPark({ projectRoot: reclaimRepo, slug: 'demo', runGit: reclaimGit }))
      .resolves.toEqual({ slug: 'demo', steps: ['worktree-removed', 'branch-absent'] });
    for (const ref of reclaimSeed.expected) expect(await refOid(reclaimRepo, ref)).toBeDefined();
    boundary.intercept = undefined;
    await expect(reconcileMergedPark({ projectRoot: reclaimRepo, slug: 'demo', runGit: reclaimGit }))
      .resolves.toEqual({ slug: 'demo', steps: ['worktree-removed', 'branch-absent'] });
    expect(await conductorRefSnapshot(reclaimRepo)).toBe('');
  });
});
