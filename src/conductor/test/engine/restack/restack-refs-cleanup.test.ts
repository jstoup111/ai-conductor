// Covers: task:4, task:38
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_CHILD_ID, parseChildId } from '../../../src/engine/child-context.js';
import { reconcileMergedPark } from '../../../src/engine/park-reconciliation.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
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
import {
  redRefFor,
  rejectedPinRefFor,
  repairMarkerRefFor,
  revalidationQueueRefFor,
  routeRecordRefFor,
} from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import type { RestackOpId } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-refs-cleanup-'));
  repositories.push(repo);
  const nativeGit = (args: string[]) => execFile('git', args, { cwd: repo });
  await nativeGit(['init', '-q', '-b', 'main']);
  await nativeGit(['config', 'user.email', 'cleanup@example.test']);
  await nativeGit(['config', 'user.name', 'Ref cleanup']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await nativeGit(['add', 'base.txt']);
  await nativeGit(['commit', '-qm', 'base']);
  return { repo, git: makeGitRunner(repo) };
}

async function seedRefs(subject: Awaited<ReturnType<typeof fixture>>) {
  const child = parseChildId(1);
  if (!child) throw new Error('child 1 should be valid');
  const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
  for (const ref of featureConductorRefNames('demo')) {
    if (ref !== journalRefFor('demo')) await subject.git(['update-ref', ref, tip]);
  }
  const journal: RestackJournal = {
    opId: 'cleanup-journal' as RestackOpId,
    cause: 'base-refresh',
    committer: { name: 'Ref cleanup', email: 'cleanup@example.test', date: '2030-01-02T03:04:05Z' },
    dirtyPaths: [],
    refs: [],
    ranges: [{ child, oldParent: tip as never, oldTip: tip as never, kind: 'active' }],
    children: [{ child, status: 'pending' }],
    state: 'planned',
    owner: { host: 'cleanup-host', pid: 1, processStartTime: '0' },
  };
  const journalBlob = await writeRestackJournalBlob(subject.repo, journal);
  await subject.git(['update-ref', journalRefFor('demo'), journalBlob]);
  await subject.git(['update-ref', stagingRefFor('demo', child), tip]);
  return { child, tip };
}

function routingFixtureRefs() {
  const r1 = parseRoundId('r1');
  const r2 = parseRoundId('r2');
  if (!r1 || !r2) throw new Error('fixture route ids should be valid');
  return [
    routeRecordRefFor('demo', r1),
    rejectedPinRefFor('demo', r1, 1),
    routeRecordRefFor('demo', r2),
    repairMarkerRefFor('demo'),
    revalidationQueueRefFor('demo'),
    redRefFor('demo', parseChildId(1)!),
  ];
}

describe('deleteFeatureConductorRefs (real local Git)', () => {
  // Covers: task:12
  it('lists conflict and every child resolution ref, then deletes them during single-slug reclaim', async () => {
    const subject = await fixture();
    const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    const expected = [
      'refs/conductor/demo/restack/conflict/record',
      'refs/conductor/demo/restack/conflict/parent',
      ...Array.from({ length: MAX_CHILD_ID }, (_unused, index) => `refs/conductor/demo/restack/resolution/c${index + 1}`),
    ];

    expect(featureConductorRefNames('demo')).toEqual(expect.arrayContaining(expected));
    for (const ref of expected) await subject.git(['update-ref', ref, tip]);

    await expect(deleteFeatureConductorRefs('demo', subject.git)).resolves.toBe(true);
    for (const ref of expected) {
      await expect(subject.git(['rev-parse', '-q', '--verify', ref])).resolves.toMatchObject({ exitCode: 1 });
    }
  });

  // Covers: task:12
  it('leaves another slug’s conflict and resolution refs intact', async () => {
    const subject = await fixture();
    const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    const protectedRefs = [
      'refs/conductor/demo/restack/conflict/record',
      'refs/conductor/demo/restack/conflict/parent',
      ...Array.from({ length: MAX_CHILD_ID }, (_unused, index) => `refs/conductor/demo/restack/resolution/c${index + 1}`),
    ];
    for (const ref of protectedRefs) await subject.git(['update-ref', ref, tip]);

    await expect(deleteFeatureConductorRefs('dem', subject.git)).resolves.toBe(true);
    for (const ref of protectedRefs) {
      await expect(subject.git(['rev-parse', '-q', '--verify', ref])).resolves.toMatchObject({ exitCode: 0 });
    }
  });

  it('uses closure-gated, explicit batched names to remove routing refs but leaves a prefix decoy', async () => {
    const subject = await fixture();
    const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    const closure = 'refs/conductor/demo/closed/c1';
    const routingRefs = routingFixtureRefs();
    for (const ref of [closure, ...routingRefs, 'refs/conductor/demo/routes-extra']) {
      await subject.git(['update-ref', ref, tip]);
    }

    const calls: Array<{ args: string[]; input?: string }> = [];
    const recordingGit: GitRunner = async (args, options) => {
      calls.push({ args: [...args], input: options?.input });
      return subject.git(args, options);
    };
    await expect(deleteFeatureConductorRefs('demo', recordingGit)).resolves.toBe(true);

    for (const ref of routingRefs) {
      await expect(subject.git(['rev-parse', '-q', '--verify', ref])).resolves.toMatchObject({ exitCode: 1 });
    }
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/routes-extra']))
      .resolves.toMatchObject({ exitCode: 0 });

    const batches = calls.filter(({ args }) => args[0] === 'cat-file' && args[1] === '--batch-check');
    expect(batches).toHaveLength(2);
    expect(batches[0]?.input?.trim().split('\n').slice(0, 9)).toEqual([
      'refs/conductor/demo/closed/c1', 'refs/conductor/demo/closed/c2', 'refs/conductor/demo/closed/c3',
      'refs/conductor/demo/closed/c4', 'refs/conductor/demo/closed/c5', 'refs/conductor/demo/closed/c6',
      'refs/conductor/demo/closed/c7', 'refs/conductor/demo/closed/c8', 'refs/conductor/demo/closed/c9',
    ]);
    expect(batches[1]?.input?.trim().split('\n')).toEqual(expect.arrayContaining(routingRefs));
    expect(calls.map(({ args }) => args[0])).not.toContain('for-each-ref');
    expect(calls.flatMap(({ args }) => args).some((argument) => argument.endsWith('*') || argument.endsWith('/'))).toBe(false);

    const transaction = calls.find(({ args }) => args[0] === 'update-ref' && args[1] === '--stdin');
    for (const ref of routingRefs) expect(transaction?.input).toContain(`delete ${ref} ${tip}`);
  });

  it('does not probe or remove stale routing refs when no explicit closure ref exists', async () => {
    const subject = await fixture();
    const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    const staleRoute = routingFixtureRefs()[0]!;
    await subject.git(['update-ref', staleRoute, tip]);

    const calls: Array<{ args: string[]; input?: string }> = [];
    const recordingGit: GitRunner = async (args, options) => {
      calls.push({ args: [...args], input: options?.input });
      return subject.git(args, options);
    };
    await expect(deleteFeatureConductorRefs('demo', recordingGit)).resolves.toBe(true);

    expect(await subject.git(['rev-parse', '-q', '--verify', staleRoute])).toMatchObject({ exitCode: 0 });
    const routingName = /(?:routes\/|rejected\/|repairing|revalidate|red\/)/;
    expect(calls.flatMap(({ args }) => args).join('\n')).not.toMatch(routingName);
    expect(calls.map(({ input }) => input ?? '').join('\n')).not.toMatch(routingName);
  });

  it('uses a closed c2 ref to find routing state after the child worktree state is gone', async () => {
    const subject = await fixture();
    const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    const route = routingFixtureRefs()[0]!;
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', tip]);
    await subject.git(['update-ref', route, tip]);
    await expect(access(join(subject.repo, '.pipeline', 'children'))).rejects.toThrow();

    const calls: Array<{ args: string[]; input?: string }> = [];
    const recordingGit: GitRunner = async (args, options) => {
      calls.push({ args: [...args], input: options?.input });
      return subject.git(args, options);
    };
    await expect(deleteFeatureConductorRefs('demo', recordingGit)).resolves.toBe(true);

    const batches = calls.filter(({ args }) => args[0] === 'cat-file' && args[1] === '--batch-check');
    expect(batches).toHaveLength(2);
    expect(batches[0]?.input).toContain('refs/conductor/demo/closed/c1\nrefs/conductor/demo/closed/c2');
    expect(batches[1]?.input).toContain(route);
    await expect(subject.git(['rev-parse', '-q', '--verify', route])).resolves.toMatchObject({ exitCode: 1 });
  });

  it('retains closure refs when the routing probe is incomplete so a later teardown can remove routing state', async () => {
    const subject = await fixture();
    const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    const closure = 'refs/conductor/demo/closed/c1';
    const route = routeRecordRefFor('demo', parseRoundId('r1')!);
    await subject.git(['update-ref', closure, tip]);
    await subject.git(['update-ref', route, tip]);

    let failRoutingProbe = true;
    const flakyGit: GitRunner = async (args, options) => {
      if (failRoutingProbe && args[0] === 'cat-file' && args[1] === '--batch-check' && options?.input?.includes(route)) {
        return { exitCode: 1, stdout: '', stderr: 'routing probe failed' };
      }
      return subject.git(args, options);
    };

    await expect(deleteFeatureConductorRefs('demo', flakyGit)).resolves.toBe(false);
    await expect(subject.git(['rev-parse', '-q', '--verify', closure])).resolves.toMatchObject({ exitCode: 0 });
    await expect(subject.git(['rev-parse', '-q', '--verify', route])).resolves.toMatchObject({ exitCode: 0 });

    failRoutingProbe = false;
    await expect(deleteFeatureConductorRefs('demo', flakyGit)).resolves.toBe(true);
    await expect(subject.git(['rev-parse', '-q', '--verify', closure])).resolves.toMatchObject({ exitCode: 1 });
    await expect(subject.git(['rev-parse', '-q', '--verify', route])).resolves.toMatchObject({ exitCode: 1 });
  });

  it('deletes the finite pushed, cascade, leaf, journal and journal-named staging refs in one explicit transaction', async () => {
    const subject = await fixture();
    const { child, tip } = await seedRefs(subject);

    const calls: Array<{ args: string[]; input?: string }> = [];
    const recordingGit: GitRunner = async (args, options) => {
      calls.push({ args: [...args], input: options?.input });
      return subject.git(args, options);
    };
    await expect(deleteFeatureConductorRefs('demo', recordingGit)).resolves.toBe(true);

    for (const ref of [...featureConductorRefNames('demo'), stagingRefFor('demo', child)]) {
      await expect(subject.git(['rev-parse', '-q', '--verify', ref])).resolves.toMatchObject({ exitCode: 1 });
    }
    const transaction = calls.find(({ args }) => args[0] === 'update-ref' && args[1] === '--stdin');
    expect(transaction?.input).toContain(`delete ${stagingRefFor('demo', child)} ${tip}`);
    expect(calls.map(({ args }) => args[0])).not.toContain('for-each-ref');
    expect(transaction?.input).not.toMatch(/[?*]/);
    expect(transaction?.input?.split('\n').filter((line) => line.startsWith('delete '))).toHaveLength(
      featureConductorRefNames('demo').length + 1,
    );
  });

  it('leaves a reused slug with no pushed record and zero cascade count', async () => {
    const subject = await fixture();
    const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
    await subject.git(['update-ref', 'refs/conductor/demo/pushed/feat/daemon-demo', tip]);
    const cascadeBlob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ version: 1, counts: { 1: 2 } }) })).stdout.trim();
    await subject.git(['update-ref', 'refs/conductor/demo/cascades', cascadeBlob]);

    await expect(deleteFeatureConductorRefs('demo', subject.git)).resolves.toBe(true);
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/pushed/feat/daemon-demo']))
      .resolves.toMatchObject({ exitCode: 1 });
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/cascades']))
      .resolves.toMatchObject({ exitCode: 1 });
  });

  it('does not throw on a failed deletion transaction, and a later cleanup deletes the untouched refs', async () => {
    const subject = await fixture();
    const { child } = await seedRefs(subject);
    let failTransaction = true;
    const flakyGit: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref' && args[1] === '--stdin' && failTransaction) {
        failTransaction = false;
        return { exitCode: 1, stdout: '', stderr: 'simulated transaction failure' };
      }
      return subject.git(args, options);
    };

    await expect(deleteFeatureConductorRefs('demo', flakyGit)).resolves.toBe(false);
    await expect(subject.git(['rev-parse', '-q', '--verify', journalRefFor('demo')])).resolves.toMatchObject({ exitCode: 0 });
    await expect(deleteFeatureConductorRefs('demo', flakyGit)).resolves.toBe(true);
    await expect(subject.git(['rev-parse', '-q', '--verify', stagingRefFor('demo', child)])).resolves.toMatchObject({ exitCode: 1 });
  });

  it('does not touch any feature refs when reclaim refuses an in-flight feature', async () => {
    const subject = await fixture();
    const { child } = await seedRefs(subject);

    await expect(reconcileMergedPark({
      projectRoot: subject.repo,
      slug: 'demo',
      isFeatureInFlight: () => true,
    })).resolves.toEqual({ slug: 'demo', steps: [], refusal: 'in-flight' });

    for (const ref of [...featureConductorRefNames('demo'), stagingRefFor('demo', child)]) {
      await expect(subject.git(['rev-parse', '-q', '--verify', ref])).resolves.toMatchObject({ exitCode: 0 });
    }
  });
});
