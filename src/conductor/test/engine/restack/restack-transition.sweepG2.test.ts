import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CHILD_REGION_STEPS, parseChildId } from '../../../src/engine/child-context.js';
import { readVerdict, writeVerdict, type GateVerdict } from '../../../src/engine/gate-verdicts.js';
import type { GitRunner } from '../../../src/engine/rebase.js';
import { applyRestackTransition } from '../../../src/engine/restack/restack-transition.js';
import { parseCommitSha, parseRefName } from '../../../src/engine/restack/restack-types.js';
import { selectNextGate } from '../../../src/engine/selector.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { removeAll } from './restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const passed: GateVerdict = { satisfied: true, checkedAt: 1, reason: 'passed' };
const childTwo = parseChildId(2)!;

afterEach(async () => {
  await removeAll(cleanup);
});

function sha(letter: string) {
  return parseCommitSha(letter.repeat(40))!;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

/** Child 2 is the active child: every region gate passed and judged at P = c. */
async function activeChildStore(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'restack-transition-unit-sweep-'));
  cleanup.push(root);
  const store = join(root, '.pipeline', 'children', '2');
  await mkdir(store, { recursive: true });
  await writeFile(join(store, 'conduct-state.json'), JSON.stringify({ acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }));
  await writeFile(join(store, 'build-review.json'), JSON.stringify({ codeStamp: sha('a'), lapId: 'child-review' }));
  for (const gate of CHILD_REGION_STEPS) await writeVerdict(root, gate, passed, childTwo);
  return root;
}

/** P = c, B = b, O = new parent, H = d; the P->H delta is `delta`. */
function tupleGit(delta: string): GitRunner {
  return async (args) => {
    if (args[0] === 'diff') {
      const range = args.slice(2).join(' ');
      if (range === `${sha('c')} ${sha('d')}`) return { exitCode: 0, stdout: delta, stderr: '' };
      if (range === `${sha('b')} ${sha('c')}` || range === `${sha('b')} HEAD`) return { exitCode: 0, stdout: 'src/child.ts\n', stderr: '' };
      if (range === `${sha('a')} ${sha('c')}`) return { exitCode: 0, stdout: delta, stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${sha('b')}\n`, stderr: '' };
    if (args[0] === 'rev-parse' || args[0] === 'merge-tree') return { exitCode: 0, stdout: `${sha('e')}\n`, stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  };
}

async function transition(root: string, delta: string, events: ConductorEventEmitter): Promise<void> {
  await applyRestackTransition({
    worktree: root,
    cause: 'base-refresh',
    oldDefault: sha('b'),
    newDefault: sha('f'),
    activeChild: childTwo,
    ranges: [{ child: childTwo, oldParent: sha('b'), oldTip: sha('c'), kind: 'active' }],
    moves: [{ ref: parseRefName('refs/heads/feat/c2/demo')!, child: childTwo, oldSha: sha('c'), newSha: sha('d') }],
    git: tupleGit(delta),
    events,
  });
}

async function childVerdicts(root: string): Promise<Partial<Record<StepName, GateVerdict>>> {
  const verdicts: Partial<Record<StepName, GateVerdict>> = {};
  for (const gate of CHILD_REGION_STEPS) {
    const verdict = await readVerdict(root, gate, childTwo);
    if (verdict) verdicts[gate] = verdict;
  }
  return verdicts;
}

describe('applyRestackTransition active-child sweep', () => {
  // Covers: S11.1, S11.2, task:18
  it('keeps child 2 gates on an unchanged replay, invalidates only intersected gates in its own store, emits matching events, and resumes no earlier than test_suite', async () => {
    // Unchanged replay: every passed region gate stays passed in the child store.
    const unchanged = await activeChildStore();
    await transition(unchanged, '', new ConductorEventEmitter());
    for (const gate of CHILD_REGION_STEPS) expect(await readVerdict(unchanged, gate, childTwo)).toEqual(passed);

    // The new parent's change intersects test_suite's inputs (any code path).
    const root = await activeChildStore();
    const events = new ConductorEventEmitter();
    const preservedEvents: string[] = [];
    const invalidatedEvents: string[] = [];
    events.on('rebase_gate_preserved', (event) => { if (event.type === 'rebase_gate_preserved') preservedEvents.push(event.gate); });
    events.on('rebase_gate_invalidated', (event) => { if (event.type === 'rebase_gate_invalidated') invalidatedEvents.push(event.gate); });

    await transition(root, 'src/upstream.ts\n', events);

    const verdicts = await childVerdicts(root);
    const invalidated = CHILD_REGION_STEPS.filter((gate) => verdicts[gate]?.satisfied === false);
    const preserved = CHILD_REGION_STEPS.filter((gate) => verdicts[gate]?.preservation !== undefined);
    expect(invalidated).toEqual(['test_suite']);
    expect(verdicts.test_suite).toMatchObject({ satisfied: false, kickback: { from: 'rebase' } });
    expect(preserved).toEqual(['build_review']);
    expect(verdicts.acceptance_specs).toEqual(passed);
    expect(verdicts.build).toEqual(passed);
    // No flat region verdict is written for a stacked child.
    for (const gate of CHILD_REGION_STEPS) {
      expect(await exists(join(root, '.pipeline', 'gates', `${gate}.json`))).toBe(false);
    }
    // The spine reports exactly the applied preserve/invalidate set.
    expect([...new Set(invalidatedEvents)].sort()).toEqual(invalidated);
    expect([...new Set(preservedEvents)].sort()).toEqual(preserved);
    // The child's next selected gate is test_suite: nothing before it reruns.
    const state = JSON.parse(await readFile(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), 'utf8')) as ConductState;
    const regionSteps = ALL_STEPS.filter((step) => (CHILD_REGION_STEPS as readonly string[]).includes(step.name));
    const next = selectNextGate({ steps: regionSteps, state, verdicts, regionStart: 'acceptance_specs' });
    expect(next).toMatchObject({ kind: 'run', step: 'test_suite' });
    const order = regionSteps.map((step) => step.name);
    expect(order.indexOf(next.kind === 'run' ? next.step : 'acceptance_specs')).toBeGreaterThanOrEqual(order.indexOf('test_suite'));
  });
});
