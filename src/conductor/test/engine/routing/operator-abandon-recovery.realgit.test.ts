// Covers: task:23
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { readVerdict, writeVerdict } from '../../../src/engine/gate-verdicts.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { abandonOperatorRound, openOperatorRound } from '../../../src/engine/routing/operator-round.js';
import { readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { writeState } from '../../../src/engine/state.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { sealSliceTopologyPositions, writeSliceTopologyFixture } from '../slice-topology-fixture.js';

const roots: string[] = [];
const host = parseChildId(1)!;
const carried = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const leafGates = ['prd_audit', 'architecture_review_as_built', 'manual_test'] as StepName[];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(options: { readonly carry?: boolean } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'operator-abandon-recovery-'));
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
  await git(['config', 'user.email', 'operator-abandon-recovery@example.invalid']);
  await git(['config', 'user.name', 'Operator abandon recovery']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'initial']);
  await commit('base', 'base.txt', 'base\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), [
    'stacked_prs:', '  enabled: true', '  max_slices: 3', '  route_whole_feature_fixes: true', '',
  ].join('\n'));
  await git(['add', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'configure routing']);
  await writeSliceTopologyFixture(repo, {
    slug: 'demo', version: 1, runId: 'run-1', status: 'done', entries: [], materializeTopologyCommit: true,
    sliceMembership: { taskSlices: { one: 1, two: 2, leaf: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  });
  await sealSliceTopologyPositions(repo, { slug: 'demo', sliceMembership: { taskSlices: { one: 1, two: 2, leaf: 3 }, titles: ['one', 'two', 'leaf'] } });

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closedOne = await commit('closed child one', 'child-1.txt', 'closed\n');
  await git(['update-ref', closureRefFor('demo', host), closedOne]);
  const rejectedTip = await commit('reviewer edit', 'reviewer-edit.txt', 'review\n');

  await git(['checkout', '-qb', 'feat/c2/demo', closedOne]);
  const closedTwo = await commit('closed child two', 'child-2.txt', 'closed\n');
  await git(['update-ref', closureRefFor('demo', carried), closedTwo]);
  const carriedTip = options.carry ? await commit('carried reviewer edit', 'carried-edit.txt', 'review\n') : closedTwo;

  await git(['checkout', '-qb', leafBranchFor('demo'), closedTwo]);
  await commit('leaf', 'leaf.txt', 'leaf\n');

  await mkdir(join(repo, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
  }, null, 2) + '\n');
  const root = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
  await writeState(join(repo, '.pipeline', 'conduct-state.json'), root);
  for (const gate of leafGates) await writeVerdict(repo, gate, { satisfied: true, reason: 'before abandon', checkedAt: 1 });
  const rootBytes = await readFile(join(repo, '.pipeline', 'conduct-state.json'), 'utf8');
  const verdictBytes = Object.fromEntries(await Promise.all(leafGates.map(async (gate) => [gate, await readFile(join(repo, '.pipeline', 'gates', `${gate}.json`), 'utf8')] as const)));

  const opened = await openOperatorRound({
    worktree: repo, slug: 'demo', roundId, host, reason: 'discard reviewer landing', operator: 'operator@example.test',
    carried: options.carry ? [{ child: carried, tip: carriedTip as never }] : [], emitter: new ConductorEventEmitter(), git,
  });
  if (opened.kind !== 'opened') throw new Error(opened.detail);
  return { repo, git, closedOne, rejectedTip, carriedTip, rootBytes, verdictBytes };
}

async function branch(git: GitRunner): Promise<string> {
  return (await git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
}

async function rootIsUnchanged(subject: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await expect(readFile(join(subject.repo, '.pipeline', 'conduct-state.json'), 'utf8')).resolves.toBe(subject.rootBytes);
  for (const gate of leafGates) {
    await expect(readFile(join(subject.repo, '.pipeline', 'gates', `${gate}.json`), 'utf8')).resolves.toBe(subject.verdictBytes[gate]!);
    await expect(readVerdict(subject.repo, gate)).resolves.toMatchObject({ satisfied: true });
  }
}

function crashAfter(stage: 'moved' | 'synced' | 'abandoned', subject: Awaited<ReturnType<typeof fixture>>): GitRunner {
  let armAfterSyncedRecord = false;
  return async (args, options) => {
    if (stage === 'moved' && args[0] === 'read-tree') return { exitCode: 1, stdout: '', stderr: 'simulated crash' };
    if (stage === 'synced' && args[0] === 'hash-object' && options?.input?.includes('"stage":"synced"')) armAfterSyncedRecord = true;
    const result = await subject.git(args, options);
    if (
      (stage === 'synced' && armAfterSyncedRecord && args[0] === 'update-ref' && args[1] === '--stdin')
      || (stage === 'abandoned' && args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes('delete refs/conductor/demo/repairing'))
    ) return { ...result, exitCode: 1, stderr: 'simulated crash' };
    return result;
  };
}

describe('operator abandon recovery (real local Git)', () => {
  it('returns to the leaf without re-pending whole-feature gates', async () => {
    const subject = await fixture();
    await expect(abandonOperatorRound({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git })).resolves.toEqual({ kind: 'abandoned' });

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: subject.git })).resolves.toMatchObject({ kind: 'clear' });
    await expect(branch(subject.git)).resolves.toBe('feat/daemon-demo');
    await expect(readRouteRecord(subject.repo, 'demo', roundId, { git: subject.git })).resolves.toMatchObject({ kind: 'record', record: { phase: 'closed', hosts: { 1: 'abandoned' } } });
    await rootIsUnchanged(subject);
  });

  it.each(['moved', 'synced', 'abandoned'] as const)('resumes the %s durable abandon stage once, synchronizing only on the host', async (stage) => {
    const subject = await fixture();
    await expect(abandonOperatorRound({ worktree: subject.repo, slug: 'demo', roundId, host, git: crashAfter(stage, subject) })).resolves.toMatchObject({ kind: 'refused' });
    const syncBranches: string[] = [];
    let syncs = 0;
    const recovering: GitRunner = async (args, options) => {
      if (args[0] === 'read-tree') {
        syncs += 1;
        syncBranches.push(await branch(subject.git));
      }
      return subject.git(args, options);
    };

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: recovering })).resolves.toMatchObject({ kind: 'clear' });
    expect(syncs).toBe(stage === 'moved' ? 1 : 0);
    expect(syncBranches).toEqual(stage === 'moved' ? ['feat/c1/demo'] : []);
    await expect(branch(subject.git)).resolves.toBe('feat/daemon-demo');
    await expect(readRouteRecord(subject.repo, 'demo', roundId, { git: subject.git })).resolves.toMatchObject({ kind: 'record', record: { phase: 'closed', hosts: { 1: 'abandoned' } } });
    await rootIsUnchanged(subject);
  });

  it('halts the still-carried child after abandoning its host landing', async () => {
    const subject = await fixture({ carry: true });
    await expect(abandonOperatorRound({ worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git })).resolves.toEqual({ kind: 'abandoned' });

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: subject.git })).resolves.toMatchObject({ kind: 'halted' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('unlanded-closed-child-commits: child 2');
  });
});
