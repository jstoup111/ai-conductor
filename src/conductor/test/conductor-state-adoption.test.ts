import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from './test-conductor.js';
import { readState, writeState } from '../src/engine/state.js';
import type { ConductState } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

describe('refused state-change adoption', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('keeps refused skipped-to-stale fields in disk, memory, and the persistence snapshot while applying the rest of the batch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conductor-state-adoption-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const state: ConductState = { manual_test: 'skipped', build_review: 'done' };
    await writeState(statePath, state);

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
    });
    (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot = { ...state };

    await expect((conductor as unknown as {
      commitStateChanges(state: ConductState, name: string, changes: Record<string, unknown>): Promise<void>;
    }).commitStateChanges(state, 'direct restage bypassing the skip-preserving helper', {
      build_review: 'stale',
      manual_test: 'stale',
    })).resolves.toBeUndefined();

    const onDisk = await readState(statePath);
    if (!onDisk.ok) throw new Error('conduct state must remain readable');
    const snapshot = (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot;
    expect(onDisk.value).toMatchObject({ build_review: 'stale', manual_test: 'skipped' });
    expect(state).toMatchObject({ build_review: 'stale', manual_test: 'skipped' });
    expect(snapshot).toMatchObject({ build_review: 'stale', manual_test: 'skipped' });
  });

  it('persistPendingStateChanges restores a refused skipped-to-stale field in disk, memory, and snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conductor-state-adoption-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const state: ConductState = { manual_test: 'stale' };
    await writeState(statePath, { manual_test: 'skipped' } as ConductState);

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
    });
    (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot = {
      manual_test: 'skipped',
    };

    await expect((conductor as unknown as {
      persistPendingStateChanges(state: ConductState, name: string): Promise<void>;
    }).persistPendingStateChanges(state, 'restage ship tail after build kickback')).resolves.toBeUndefined();

    const onDisk = await readState(statePath);
    if (!onDisk.ok) throw new Error('conduct state must remain readable');
    const snapshot = (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot;
    expect(onDisk.value.manual_test).toBe('skipped');
    expect(state.manual_test).toBe('skipped');
    expect(snapshot.manual_test).toBe('skipped');
  });

  it('saveConductorStepStatus does not adopt a refused skipped-to-stale field into memory or snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conductor-state-adoption-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const state: ConductState = { manual_test: 'skipped' };
    await writeState(statePath, state);

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
    });
    (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot = { ...state };

    await expect((conductor as unknown as {
      saveConductorStepStatus(state: ConductState, step: 'manual_test', status: 'stale'): Promise<void>;
    }).saveConductorStepStatus(state, 'manual_test', 'stale')).resolves.toBeUndefined();

    const onDisk = await readState(statePath);
    if (!onDisk.ok) throw new Error('conduct state must remain readable');
    const snapshot = (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot;
    expect(onDisk.value.manual_test).toBe('skipped');
    expect(state.manual_test).toBe('skipped');
    expect(snapshot.manual_test).toBe('skipped');
  });

  it('applyStateMutation leaves a refused skipped-to-stale field out of the persistence snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conductor-state-adoption-'));
    dirs.push(dir);
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const state: ConductState = { manual_test: 'skipped' };
    await writeState(statePath, state);

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
    });
    (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot = { ...state };

    await expect((conductor as unknown as {
      applyStateMutation(mutation: {
        field: 'manual_test'; expected: 'skipped'; intent: string; next: 'stale';
      }): Promise<void>;
    }).applyStateMutation({
      field: 'manual_test',
      expected: 'skipped',
      intent: 'restage ship tail after build kickback',
      next: 'stale',
    })).resolves.toBeUndefined();

    const onDisk = await readState(statePath);
    if (!onDisk.ok) throw new Error('conduct state must remain readable');
    const snapshot = (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot;
    expect(onDisk.value.manual_test).toBe('skipped');
    expect(state.manual_test).toBe('skipped');
    expect(snapshot.manual_test).toBe('skipped');
  });
});
