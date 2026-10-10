// Covers: task:9
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

  it('does not let a flat completed build skip the active child build in Conductor selection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conduct-state-overlay-'));
    roots.push(root);
    const child = parseChildId(2)!;
    await writeState(join(root, '.pipeline', 'conduct-state.json'), {
      coverage_binding: 'done',
      build: 'done',
    });
    await createRoutedConductStateStore(root, child).apply({
      field: 'test_suite', expected: undefined, next: 'pending', intent: 'create child state without build',
    });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      daemon: false,
    } as never);
    const state: ConductState = { coverage_binding: 'done', build: 'done' };

    await (conductor as unknown as {
      activateChildRegionState: (value: ConductState, id: typeof child) => Promise<void>;
    }).activateChildRegionState(state, child);

    expect(state.build).toBeUndefined();
    expect(selectNextGate({ steps: ALL_STEPS, state, verdicts: {}, regionStart: 'build' }))
      .toMatchObject({ kind: 'run', step: 'build' });
  });
});
