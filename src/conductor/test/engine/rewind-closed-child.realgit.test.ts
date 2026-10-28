// Covers: task:27, task:31
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchRewindCommand } from '../../src/engine/rewind.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { leafBranchFor } from '../../src/engine/feature-branch-identity.js';
import { acquireFeatureDispatchLease } from '../../src/engine/feature-dispatch-lease.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { verdictPathFor } from '../../src/engine/gate-verdicts.js';
import { reconcileRounds } from '../../src/engine/routing/round-admission.js';
import { requestRoutedExit } from '../../src/engine/routing/routed-exit.js';
import { readRevalidationQueue, readRouteRecord } from '../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';
import { writePublicationRecord } from '../../src/engine/stack-publication-record.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from './slice-topology-fixture.js';

const roots: string[] = [];
const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const rewindRound = parseRoundId('r1')!;

const fixtureFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function closedChildFixture(options: { missingChildState?: boolean; openChildTwo?: boolean } = {}): Promise<{ root: string; repo: string; c1Closure: string }> {
  const root = await mkdtemp(join(tmpdir(), 'rewind-closed-child-'));
  roots.push(root);
  const repo = join(root, 'worktree');
  await mkdir(repo);
  const git = makeGitRunner(repo);
  const commit = async (message: string, path: string, contents: string) => {
    await writeFile(join(repo, path), contents);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'rewind-closed-child@example.invalid']);
  await git(['config', 'user.name', 'Rewind closed child']);
  await commit('ignore pipeline', '.gitignore', '.pipeline/\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await commit('configure routed stack', '.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await writeSliceTopologyFixture(repo, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { one: 1, two: 2, three: 3 }, titles: ['one', 'two', 'three'] },
    storyOwnership: {},
  }, fixtureFilesystem);
  await git(['add', '.docs']);
  await git(['commit', '-qm', 'record stack topology']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1Closure = await commit('close child one', 'one.txt', 'one\n');
  await git(['update-ref', closureRefFor('demo', c1), c1Closure]);
  await git(['checkout', '-qb', 'feat/c2/demo', c1Closure]);
  const c2Closure = await commit('close child two', 'two.txt', 'two\n');
  if (!options.openChildTwo) await git(['update-ref', closureRefFor('demo', c2), c2Closure]);
  await git(['checkout', '-qb', leafBranchFor('demo'), c2Closure]);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  if (!options.missingChildState) {
    await mkdir(join(repo, '.pipeline', 'children', '1'), { recursive: true });
    await writeFile(join(repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
    }));
  }
  await mkdir(join(repo, '.pipeline', 'children', '2'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
  }));
  await writeFile(join(repo, '.pipeline', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', manual_test: 'done', last_step: 'manual_test',
  }));
  await writeFile(join(repo, '.pipeline', 'HALT'), 'operator action required\n');
  await writeFile(join(repo, '.pipeline', 'HALT.class'), 'needs-human\n');
  return { root, repo, c1Closure };
}

async function flatFeatureFixture(): Promise<{ root: string; repo: string }> {
  const root = await mkdtemp(join(tmpdir(), 'rewind-flat-feature-'));
  roots.push(root);
  const repo = join(root, 'worktree');
  await mkdir(repo);
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'rewind-flat@example.invalid']);
  await git(['config', 'user.name', 'Rewind flat feature']);
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await writeFile(join(repo, '.docs', 'plans', 'demo.md'), '# Implementation Plan: demo\n\n### Task 1: Flat task\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'flat feature']);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  return { root, repo };
}

describe('rewind --child on a closed child (real local Git)', () => {
  it('refuses --child on a flat feature before changing refs or state', async () => {
    const subject = await flatFeatureFixture();
    const git = makeGitRunner(subject.repo);
    const before = {
      refs: (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout,
      pipeline: await readFile(join(subject.repo, '.pipeline', 'conduct-state.json'), 'utf8').catch(() => '<absent>'),
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand({ kind: 'rewind', child: '1', target: 'test_suite' }, subject.repo)).resolves.toBe(1);
      expect(error.mock.calls.flat().join('\n')).toContain('stacked feature');
      await expect(Promise.all([
        git(['for-each-ref', '--format=%(refname) %(objectname)']).then((result) => result.stdout),
        readFile(join(subject.repo, '.pipeline', 'conduct-state.json'), 'utf8').catch(() => '<absent>'),
      ])).resolves.toEqual([before.refs, before.pipeline]);
    } finally {
      error.mockRestore();
    }
  });

  it('opens a halted closed child rewind', async () => {
    const subject = await closedChildFixture();
    const childTwoPath = join(subject.repo, '.pipeline', 'children', '2', 'conduct-state.json');
    const leafStatePath = join(subject.repo, '.pipeline', 'conduct-state.json');
    const testSuiteVerdict = verdictPathFor(subject.repo, 'test_suite', c1);
    const buildReviewVerdict = verdictPathFor(subject.repo, 'build_review', c1);
    await mkdir(join(subject.repo, '.pipeline', 'children', '1', 'gates'), { recursive: true });
    await writeFile(testSuiteVerdict, '{"gate":"test_suite"}\n');
    await writeFile(buildReviewVerdict, '{"gate":"build_review"}\n');
    const childTwoBefore = await readFile(childTwoPath, 'utf8');
    const leafBefore = await readFile(leafStatePath, 'utf8');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const exitCode = await dispatchRewindCommand({
        kind: 'rewind', child: '1', target: 'test_suite', reason: 're-run after flaky fixture',
      } as never, subject.repo, {
        resolveMainRoot: async () => subject.root,
        resolveOperator: async () => 'operator@example.test',
      });
      const route = await readRouteRecord(subject.repo, 'demo', rewindRound);
      const childOneState = JSON.parse(await readFile(join(subject.repo, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8'));
      const haltExists = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8').then(() => true).catch(() => false);

      expect({
        exitCode,
        route: route.kind === 'record'
          ? {
            kind: route.record.kind,
            origin: route.record.operator?.origin,
            entryStep: route.record.operator?.entryStep,
            declarationTip: route.record.operator?.declaration?.tip,
          }
          : route,
        childOneState: {
          acceptance_specs: childOneState.acceptance_specs,
          build: childOneState.build,
          test_suite: childOneState.test_suite,
          build_review: childOneState.build_review,
        },
        haltExists,
        clearedVerdicts: await Promise.all([testSuiteVerdict, buildReviewVerdict].map((path) => readFile(path, 'utf8').then(() => false).catch(() => true))),
        rewindEvent: (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
          .split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((event) => event.type === 'operator_rewind'),
        childTwoState: await readFile(childTwoPath, 'utf8'),
        leafState: await readFile(leafStatePath, 'utf8'),
        errors: error.mock.calls,
      }).toStrictEqual({
        exitCode: 0,
        route: { kind: 'operator', origin: 'rewind', entryStep: 'test_suite', declarationTip: subject.c1Closure },
        childOneState: { acceptance_specs: 'done', build: 'done', test_suite: 'pending', build_review: 'pending' },
        haltExists: false,
        clearedVerdicts: [true, true],
        rewindEvent: expect.objectContaining({ type: 'operator_rewind', child: 1, target: 'test_suite' }),
        childTwoState: childTwoBefore,
        leafState: leafBefore,
        errors: [],
      });
    } finally {
      error.mockRestore();
    }
  });

  it('recreates an absent closed-child region through the mutation port', async () => {
    const subject = await closedChildFixture({ missingChildState: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const exitCode = await dispatchRewindCommand({
        kind: 'rewind', child: '1', target: 'test_suite', reason: 're-run after worktree recreation',
      }, subject.repo, {
        resolveMainRoot: async () => subject.root,
        resolveOperator: async () => 'operator@example.test',
      });

      expect({ exitCode, errors: error.mock.calls }).toStrictEqual({ exitCode: 0, errors: [] });

      await expect(readFile(join(subject.repo, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8').then(JSON.parse))
        .resolves.toMatchObject({ acceptance_specs: 'done', build: 'done', test_suite: 'pending', build_review: 'pending' });
    } finally {
      error.mockRestore();
    }
  });

  it('retains closed-child verdicts and the HALT when operator_rewind cannot persist', async () => {
    const subject = await closedChildFixture();
    const testSuiteVerdict = verdictPathFor(subject.repo, 'test_suite', c1);
    const buildReviewVerdict = verdictPathFor(subject.repo, 'build_review', c1);
    await mkdir(join(subject.repo, '.pipeline', 'children', '1', 'gates'), { recursive: true });
    await writeFile(testSuiteVerdict, '{"gate":"test_suite"}\n');
    await writeFile(buildReviewVerdict, '{"gate":"build_review"}\n');
    await mkdir(join(subject.repo, '.pipeline', 'events.jsonl'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const exitCode = await dispatchRewindCommand({
        kind: 'rewind', child: '1', target: 'test_suite', reason: 're-run after a durable event failure',
      }, subject.repo, {
        resolveMainRoot: async () => subject.root,
        resolveOperator: async () => 'operator@example.test',
      });
      const route = await readRouteRecord(subject.repo, 'demo', rewindRound);

      expect({
        exitCode,
        route: route.kind === 'record'
          ? { kind: route.record.kind, origin: route.record.operator?.origin, entryStep: route.record.operator?.entryStep }
          : route,
        testSuiteVerdict: await readFile(testSuiteVerdict, 'utf8'),
        buildReviewVerdict: await readFile(buildReviewVerdict, 'utf8'),
        halt: await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8'),
        haltClass: await readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8'),
      }).toStrictEqual({
        exitCode: 1,
        route: { kind: 'operator', origin: 'rewind', entryStep: 'test_suite' },
        testSuiteVerdict: '{"gate":"test_suite"}\n',
        buildReviewVerdict: '{"gate":"build_review"}\n',
        halt: 'operator action required\n',
        haltClass: 'needs-human\n',
      });
    } finally {
      error.mockRestore();
    }
  });

  it('routes the next dispatch to test_suite, then returns the no-commit host to the leaf', async () => {
    const subject = await closedChildFixture();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand({
        kind: 'rewind', child: '1', target: 'test_suite', reason: 'repeat the closed child checks',
      }, subject.repo, { resolveMainRoot: async () => subject.root, resolveOperator: async () => 'operator@example.test' })).resolves.toBe(0);

      const entered = await reconcileRounds(subject.repo, 'demo');
      const exited = await requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId: rewindRound, host: c1 });
      const route = await readRouteRecord(subject.repo, 'demo', rewindRound);
      const returned = route.kind === 'record' ? await reconcileRounds(subject.repo, 'demo') : undefined;
      const branch = (await makeGitRunner(subject.repo)(['branch', '--show-current'])).stdout.trim();
      const leaf = JSON.parse(await readFile(join(subject.repo, '.pipeline', 'conduct-state.json'), 'utf8'));

      expect({ entered, exited, returned, branch, gates: { acceptance_specs: leaf.acceptance_specs, build: leaf.build, test_suite: leaf.test_suite, build_review: leaf.build_review, manual_test: leaf.manual_test }, errors: error.mock.calls }).toStrictEqual({
        entered: { kind: 'navigate-leaf-to-build', roundId: 'r1', host: 1, entryStep: 'test_suite' },
        exited: { kind: 'no-commit-done' },
        returned: { kind: 'leaf-returned', roundId: 'r1' },
        branch: 'feat/daemon-demo',
        gates: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', manual_test: 'pending' },
        errors: [],
      });
    } finally {
      error.mockRestore();
    }
  });

  it('restacks a repair from child one and queues child two for revalidation', async () => {
    const subject = await closedChildFixture();
    const git = makeGitRunner(subject.repo);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(dispatchRewindCommand({
        kind: 'rewind', child: '1', target: 'test_suite', reason: 'repair the closed child',
      }, subject.repo, { resolveMainRoot: async () => subject.root, resolveOperator: async () => 'operator@example.test' })).resolves.toBe(0);
      await writeFile(join(subject.repo, 'repair.txt'), 'fixed\n');
      await git(['add', 'repair.txt']);
      await git(['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'repair child one']);

      const exited = await requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId: rewindRound, host: c1 });
      const route = await readRouteRecord(subject.repo, 'demo', rewindRound);
      const queue = await readRevalidationQueue(subject.repo, 'demo');
      const repair = (await git(['rev-parse', 'feat/c1/demo'])).stdout.trim();
      const childTwoContainsRepair = (await git(['merge-base', '--is-ancestor', repair, 'feat/c2/demo'])).exitCode === 0;

      expect({ exited, host: route.kind === 'record' ? route.record.hosts[c1] : undefined, queue: queue.kind === 'queue' ? queue.queue.entries.map(({ child, gates }) => ({ child, gates })) : queue, childTwoContainsRepair, errors: error.mock.calls }).toStrictEqual({
        exited: { kind: 'restacked' },
        host: 'restacked',
        queue: [{ child: 2, gates: ['acceptance_specs', 'build', 'test_suite', 'build_review'] }],
        childTwoContainsRepair: true,
        errors: [],
      });
    } finally {
      error.mockRestore();
    }
  });

  it('refuses the protected closed-child paths and preserves the legacy open-child rewind', async () => {
    const missingHalt = await closedChildFixture();
    await rm(join(missingHalt.repo, '.pipeline', 'HALT'));
    const missingReason = await closedChildFixture();
    const published = await closedChildFixture();
    await expect(writePublicationRecord(published.repo, 'demo', undefined, {
      version: 1,
      members: [
        { position: c1, branch: 'feat/c1/demo', pr: 101 },
        { position: c2, branch: 'feat/c2/demo', pr: 102 },
        { position: parseChildId(3)!, branch: 'feat/daemon-demo', pr: 103 },
      ],
    })).resolves.toEqual({ kind: 'updated' });
    const leased = await closedChildFixture();
    const lease = await acquireFeatureDispatchLease(leased.root, 'demo', 'other command');
    if (lease.kind !== 'acquired') throw new Error('could not create a live lease fixture');
    const open = await closedChildFixture({ openChildTwo: true });
    const routingOff = await closedChildFixture();
    await writeFile(join(routingOff.repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: false\n');
    const routingOffGit = makeGitRunner(routingOff.repo);
    const routingOffBefore = {
      refs: (await routingOffGit(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout,
      halt: await readFile(join(routingOff.repo, '.pipeline', 'HALT'), 'utf8'),
      haltClass: await readFile(join(routingOff.repo, '.pipeline', 'HALT.class'), 'utf8'),
      child: await readFile(join(routingOff.repo, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8'),
      state: await readFile(join(routingOff.repo, '.pipeline', 'conduct-state.json'), 'utf8'),
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const invoke = (repo: string, root: string, reason = 'valid reason') => dispatchRewindCommand(
        { kind: 'rewind', child: '1', target: 'test_suite', reason }, repo,
        { resolveMainRoot: async () => root, resolveOperator: async () => 'operator@example.test' },
      );
      const [noHalt, noReason, isPublished, hasLease, routeDisabled] = await Promise.all([
        invoke(missingHalt.repo, missingHalt.root),
        invoke(missingReason.repo, missingReason.root, ''),
        invoke(published.repo, published.root),
        invoke(leased.repo, leased.root),
        invoke(routingOff.repo, routingOff.root),
      ]);
      const legacy = await dispatchRewindCommand({ kind: 'rewind', child: '2', target: 'build' }, open.repo);
      const openState = JSON.parse(await readFile(join(open.repo, '.pipeline', 'children', '2', 'conduct-state.json'), 'utf8'));
      const route = await readRouteRecord(open.repo, 'demo', rewindRound);

      expect({ exits: [noHalt, noReason, isPublished, hasLease, routeDisabled, legacy], messages: errors.mock.calls.map(([message]) => String(message)), legacyState: { acceptance_specs: openState.acceptance_specs, build: openState.build, test_suite: openState.test_suite, build_review: openState.build_review }, route }).toStrictEqual({
        exits: [1, 1, 1, 1, 1, 0],
        messages: expect.arrayContaining([
          expect.stringContaining('.pipeline/HALT'),
          expect.stringContaining('non-empty reason'),
          expect.stringContaining('#3268'),
          expect.stringContaining('other command'),
          expect.stringContaining('stacked_prs.route_whole_feature_fixes'),
        ]),
        legacyState: { acceptance_specs: 'done', build: 'stale', test_suite: 'stale', build_review: 'stale' },
        route: { kind: 'absent' },
      });
      await expect(Promise.all([
        routingOffGit(['for-each-ref', '--format=%(refname) %(objectname)']).then((result) => result.stdout),
        readFile(join(routingOff.repo, '.pipeline', 'HALT'), 'utf8'),
        readFile(join(routingOff.repo, '.pipeline', 'HALT.class'), 'utf8'),
        readFile(join(routingOff.repo, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8'),
        readFile(join(routingOff.repo, '.pipeline', 'conduct-state.json'), 'utf8'),
      ])).resolves.toEqual([
        routingOffBefore.refs,
        routingOffBefore.halt,
        routingOffBefore.haltClass,
        routingOffBefore.child,
        routingOffBefore.state,
      ]);
    } finally {
      await lease.lease.release();
      errors.mockRestore();
    }
  });
});
