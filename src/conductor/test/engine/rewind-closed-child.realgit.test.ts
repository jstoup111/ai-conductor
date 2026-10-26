// Covers: task:27
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchRewindCommand } from '../../src/engine/rewind.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { leafBranchFor } from '../../src/engine/feature-branch-identity.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { readRouteRecord } from '../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';
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

async function closedChildFixture(options: { missingChildState?: boolean } = {}): Promise<{ root: string; repo: string; c1Closure: string }> {
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
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1Closure = await commit('close child one', 'one.txt', 'one\n');
  await git(['update-ref', closureRefFor('demo', c1), c1Closure]);
  await git(['checkout', '-qb', 'feat/c2/demo', c1Closure]);
  const c2Closure = await commit('close child two', 'two.txt', 'two\n');
  await git(['update-ref', closureRefFor('demo', c2), c2Closure]);
  await git(['checkout', '-qb', leafBranchFor('demo'), c2Closure]);
  await commit('leaf', 'leaf.txt', 'leaf\n');
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

describe('rewind --child on a closed child (real local Git)', () => {
  it('opens a halted closed child rewind', async () => {
    const subject = await closedChildFixture();
    const childTwoPath = join(subject.repo, '.pipeline', 'children', '2', 'conduct-state.json');
    const leafStatePath = join(subject.repo, '.pipeline', 'conduct-state.json');
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
        childTwoState: await readFile(childTwoPath, 'utf8'),
        leafState: await readFile(leafStatePath, 'utf8'),
        errors: error.mock.calls,
      }).toStrictEqual({
        exitCode: 0,
        route: { kind: 'operator', origin: 'rewind', entryStep: 'test_suite', declarationTip: subject.c1Closure },
        childOneState: { acceptance_specs: 'done', build: 'done', test_suite: 'pending', build_review: 'pending' },
        haltExists: false,
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
});
