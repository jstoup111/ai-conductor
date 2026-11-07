// Covers: task:14
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { checkOperatorTips, formatOperatorHaltReason, parseOperatorHaltReason } from '../../../src/engine/routing/operator-round.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';

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

async function fixture(carried = false) {
  const repo = await mkdtemp(join(tmpdir(), 'operator-tip-check-'));
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
  await git(['config', 'user.email', 'operator-tip@example.invalid']);
  await git(['config', 'user.name', 'Operator tip check']);
  await commit('base', '.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1Tip = await commit('closed child one', 'one.txt', 'one\n');
  await git(['update-ref', closureRefFor('demo', c1), c1Tip]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2Tip = await commit('closed child two', 'two.txt', 'two\n');
  await git(['update-ref', closureRefFor('demo', c2), c2Tip]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const leafTip = await commit('leaf', 'leaf.txt', 'leaf\n');
  await git(['checkout', '-q', 'feat/c1/demo']);
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { one: 1, two: 2 }, titles: ['one', 'two'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  const created = await createRouteRecord(repo, 'demo', {
    roundId,
    sealedAuthored: 0,
    kind: 'operator',
    items: [],
    allocation: { [c1]: { remTaskIds: [], blockBodies: [] } },
    operator: {
      origin: 'land', reason: 'land reviewer edit', operator: 'operator@example.test', entryStep: 'acceptance_specs',
      carried: carried ? [{ child: c2, tip: c2Tip as never }] : [],
      otherTips: { 'feat/c2/demo': c2Tip as never, 'feat/daemon-demo': leafTip as never },
      priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} },
    },
  }, { git });
  if (created.kind !== 'created') throw new Error(`route creation failed: ${created.kind}`);
  const admitted = await admitRound(repo, 'demo', created.record, c1, { git });
  if (admitted.kind !== 'admitted') throw new Error(`route admission failed: ${admitted.detail}`);
  const stored = await readRouteRecord(repo, 'demo', roundId, { git });
  if (stored.kind !== 'record') throw new Error('operator round unavailable');
  return { repo, git, c2Tip, leafTip, stored, commit };
}

describe('operator branch tip checks (real local Git)', () => {
  it('reports moved non-host and carried branches with their recorded and current tips', async () => {
    const subject = await fixture(true);
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    const current = await subject.commit('bypass the hook', 'review.txt', 'moved\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);

    await expect(checkOperatorTips({ worktree: subject.repo, slug: 'demo', record: subject.stored.record, git: subject.git }))
      .resolves.toEqual({ kind: 'moved', branches: [{ branch: 'feat/c2/demo', recorded: subject.c2Tip, current }] });
  });

  it('ignores halt-record-only leaf commits', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await subject.commit('record halt', '.docs/halted/demo.md', 'halt\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);

    await expect(checkOperatorTips({ worktree: subject.repo, slug: 'demo', record: subject.stored.record, git: subject.git }))
      .resolves.toEqual({ kind: 'clear' });
  });

  it('does not treat exit-restack rewrites as an active operator-tip violation', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/c2/demo']);
    await subject.commit('restacked child two', 'restacked-two.txt', 'two\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await subject.commit('restacked leaf', 'restacked-leaf.txt', 'leaf\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const afterExit = { ...subject.stored.record, hosts: { [c1]: 'restacked' as const } };

    await expect(checkOperatorTips({ worktree: subject.repo, slug: 'demo', record: afterExit, git: subject.git }))
      .resolves.toEqual({ kind: 'clear' });
  });

  it('round-trips the operator halt reason and halts before a moved leaf can restack', async () => {
    const subject = await fixture();
    const reason = formatOperatorHaltReason('operator-round-branch-moved', roundId);
    expect(parseOperatorHaltReason(reason)).toEqual({ reason: 'operator-round-branch-moved', roundId });
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    await subject.commit('bypass the hook', 'review.txt', 'moved\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const calls: string[][] = [];
    const recording: GitRunner = async (args, options) => {
      calls.push([...args]);
      return subject.git(args, options);
    };

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: recording })).resolves.toMatchObject({ kind: 'halted' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(`${reason}\n`);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('feat/daemon-demo');
    expect(calls.some((args) => args[0] === 'update-ref')).toBe(false);
  });
});
