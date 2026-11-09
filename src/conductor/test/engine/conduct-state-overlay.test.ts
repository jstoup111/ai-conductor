// Covers: task:1, task:9, task:rem-prd-audit-rem-prd-audit-S4.2-r1, task:rem-as-built-rem-asbuilt-b00b54a4-2-r1
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseChildId } from '../../src/engine/child-context.js';
import { Conductor } from '../../src/engine/conductor.js';
import {
  createRoutedConductStateStore,
  readConductStateOverlay,
} from '../../src/engine/conduct-state-store.js';
import { selectNextGate } from '../../src/engine/selector.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('child-routed conduct state', () => {
  it('keeps feature state flat and overlays region statuses from the selected child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conduct-state-overlay-'));
    roots.push(root);
    const flatPath = join(root, '.pipeline', 'conduct-state.json');
    await writeState(flatPath, { build: 'done', worktree: 'done', last_step: 'worktree' });
    const one = createRoutedConductStateStore(root, parseChildId(1)!);
    const two = createRoutedConductStateStore(root, parseChildId(2)!);

    await one.apply({ field: 'test_suite', expected: undefined, next: 'done', intent: 'child one suite' });
    await two.apply({ field: 'test_suite', expected: undefined, next: 'failed', intent: 'child two suite' });

    await expect(readConductStateOverlay(root, parseChildId(2)!)).resolves.toEqual({
      ok: true,
      value: { worktree: 'done', test_suite: 'failed' },
    });
    await expect(readFile(flatPath, 'utf8')).resolves.toContain('"build": "done"');
    await expect(readFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), 'utf8')).resolves.toContain('"test_suite": "done"');
    await expect(readFile(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), 'utf8')).resolves.toContain('"test_suite": "failed"');
  });

  it('keeps a region completion cursor with its child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conduct-state-overlay-'));
    roots.push(root);
    const child = parseChildId(2)!;
    const state = createRoutedConductStateStore(root, child);

    await state.applyBatch({
      name: 'complete child build',
      mutations: [
        { field: 'build', expected: undefined, next: 'done', intent: 'complete child build' },
        { field: 'last_step', expected: undefined, next: 'build', intent: 'record child cursor' },
      ],
    });

    await expect(readConductStateOverlay(root, child)).resolves.toMatchObject({
      ok: true,
      value: { build: 'done', last_step: 'build' },
    });
    await expect(readFile(join(root, '.pipeline', 'conduct-state.json'), 'utf8')).rejects.toThrow();
  });

  it('records a feature-wide step after the region when the expectation is the child cursor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conduct-state-overlay-'));
    roots.push(root);
    const child = parseChildId(2)!;
    const flatPath = join(root, '.pipeline', 'conduct-state.json');
    await writeState(flatPath, { plan_review: 'done', last_step: 'plan_review' });
    const state = createRoutedConductStateStore(root, child);
    await state.applyBatch({
      name: 'complete child review',
      mutations: [
        { field: 'build_review', expected: undefined, next: 'done', intent: 'complete child review' },
        { field: 'last_step', expected: undefined, next: 'build_review', intent: 'record child cursor' },
      ],
    });

    await expect(state.applyBatch({
      name: 'save step status',
      mutations: [
        { field: 'manual_test', expected: undefined, next: 'done', intent: 'save manual_test step status' },
        { field: 'last_step', expected: 'build_review', next: 'manual_test', intent: 'record last completed step' },
      ],
    })).resolves.toMatchObject({ kind: 'applied' });

    await expect(readFile(flatPath, 'utf8')).resolves.toContain('"last_step": "manual_test"');
  });

  it('records a region step after a feature-wide step when the expectation is the flat cursor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conduct-state-overlay-'));
    roots.push(root);
    const child = parseChildId(2)!;
    await writeState(join(root, '.pipeline', 'conduct-state.json'), { manual_test: 'done', last_step: 'rebase' });
    const state = createRoutedConductStateStore(root, child);
    await state.applyBatch({
      name: 'complete child review',
      mutations: [
        { field: 'build_review', expected: undefined, next: 'done', intent: 'complete child review' },
        { field: 'last_step', expected: undefined, next: 'build_review', intent: 'record child cursor' },
      ],
    });

    await expect(state.applyBatch({
      name: 'save step status',
      mutations: [
        { field: 'build', expected: undefined, next: 'done', intent: 'save build step status' },
        { field: 'last_step', expected: 'rebase', next: 'build', intent: 'record last completed step' },
      ],
    })).resolves.toMatchObject({ kind: 'applied' });

    await expect(readConductStateOverlay(root, child)).resolves.toMatchObject({
      ok: true,
      value: { build: 'done', last_step: 'build' },
    });
  });

  it('still refuses a cursor expectation that matches neither document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conduct-state-overlay-'));
    roots.push(root);
    const child = parseChildId(2)!;
    const flatPath = join(root, '.pipeline', 'conduct-state.json');
    await writeState(flatPath, { last_step: 'plan_review' });
    const state = createRoutedConductStateStore(root, child);
    await state.applyBatch({
      name: 'complete child review',
      mutations: [
        { field: 'build_review', expected: undefined, next: 'done', intent: 'complete child review' },
        { field: 'last_step', expected: undefined, next: 'build_review', intent: 'record child cursor' },
      ],
    });

    const result = await state.applyBatch({
      name: 'save step status',
      mutations: [
        { field: 'manual_test', expected: undefined, next: 'done', intent: 'save manual_test step status' },
        { field: 'last_step', expected: 'prd_audit', next: 'manual_test', intent: 'record last completed step' },
      ],
    });

    expect(result.kind).not.toBe('applied');
    await expect(readFile(flatPath, 'utf8')).resolves.toContain('"last_step": "plan_review"');
  });

  it('reopens only child 3 in the #3394 routed state layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conduct-state-overlay-'));
    roots.push(root);
    const flatPath = join(root, '.pipeline', 'conduct-state.json');
    const childOnePath = join(root, '.pipeline', 'children', '1', 'conduct-state.json');
    const childTwoPath = join(root, '.pipeline', 'children', '2', 'conduct-state.json');
    await writeState(flatPath, { plan_review: 'done' });
    await createRoutedConductStateStore(root, parseChildId(1)!).apply({
      field: 'test_suite', expected: undefined, next: 'done', intent: 'complete child one suite',
    });
    await createRoutedConductStateStore(root, parseChildId(2)!).apply({
      field: 'test_suite', expected: undefined, next: 'done', intent: 'complete child two suite',
    });
    await createRoutedConductStateStore(root, parseChildId(3)!).apply({
      field: 'test_suite', expected: undefined, next: 'pending', intent: 'reopen child three suite',
    });
    const originalFeature = await readFile(flatPath, 'utf-8');
    const originalChildOne = await readFile(childOnePath, 'utf-8');
    const originalChildTwo = await readFile(childTwoPath, 'utf-8');

    await expect(createRoutedConductStateStore(root, parseChildId(3)!).applyBatch({
      name: 'reopen selected gate after rebase',
      mutations: [{
        field: 'test_suite',
        expected: 'done',
        intent: 'reopen test_suite selected gate',
        next: 'pending',
      }],
    })).resolves.toEqual({ kind: 'applied' });

    await expect(readFile(flatPath, 'utf-8')).resolves.toBe(originalFeature);
    await expect(readFile(childOnePath, 'utf-8')).resolves.toBe(originalChildOne);
    await expect(readFile(childTwoPath, 'utf-8')).resolves.toBe(originalChildTwo);
  });

  it('does not let a flat completed build skip the active child build in Conductor selection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conduct-state-overlay-'));
    roots.push(root);
    const child = parseChildId(2)!;
    await writeState(join(root, '.pipeline', 'conduct-state.json'), {
      plan_review: 'done',
      build: 'done',
    });
    await createRoutedConductStateStore(root, child).apply({
      field: 'test_suite', expected: undefined, next: 'pending', intent: 'create child state without build',
    });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      daemon: false,
      events: new ConductorEventEmitter(),
    } as never);
    const state: ConductState = { plan_review: 'done', build: 'done' };

    await (conductor as unknown as {
      activateChildRegionState: (value: ConductState, id: typeof child) => Promise<void>;
    }).activateChildRegionState(state, child);

    expect(state.build).toBeUndefined();
    expect(selectNextGate({ steps: ALL_STEPS, state, verdicts: {}, regionStart: 'build' }))
      .toMatchObject({ kind: 'run', step: 'build' });
  });
});
