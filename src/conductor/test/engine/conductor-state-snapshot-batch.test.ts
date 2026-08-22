import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState } from '../../src/types/index.js';

// A store write that leaves the lost-update baseline behind poisons the NEXT
// ordinary transition: it submits a stale `expected` for a field the conductor
// itself already persisted, so the store reports a phantom conflict and the run
// halts. Observed in the daemon as
// `Expected prd_audit to match before persist conductor transition` after the
// selector tail-skip batch marked a track-skipped gate mid-process.
describe('conductor state batches advance the lost-update baseline', () => {
  let dir: string;
  let statePath: string;

  const conductorInternals = (conductor: Conductor) => conductor as unknown as {
    initializeRunState(state: ConductState): Promise<boolean>;
    applyStateBatch(batch: {
      name: string;
      mutations: { field: string; expected: unknown; intent: string; next: unknown }[];
    }): Promise<void>;
    persistPendingStateChanges(state: ConductState, name: string): Promise<void>;
  };

  const newConductor = (): Conductor => {
    const runner: StepRunner = { run: async (): Promise<StepRunResult> => ({ success: true }) };
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: {} as never,
    });
  };

  const readPersisted = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'state-snapshot-batch-'));
    statePath = join(dir, 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({ plan: 'done' }), 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lets an ordinary transition follow a batch that wrote a previously unset field', async () => {
    const conductor = newConductor();
    const internals = conductorInternals(conductor);
    const state = { plan: 'done' } as ConductState;
    await internals.initializeRunState(state);

    // The selector tail-skip batch: prd_audit was absent from state, so its
    // guarded `expected` is undefined and the batch makes 'skipped' durable.
    await internals.applyStateBatch({
      name: 'record selector tail skips',
      mutations: [
        { field: 'prd_audit', expected: undefined, intent: 'record selector tail skips', next: 'skipped' },
      ],
    });
    (state as Record<string, unknown>).prd_audit = 'skipped';

    (state as Record<string, unknown>).last_step = 'build';
    await expect(
      internals.persistPendingStateChanges(state, 'persist conductor transition'),
    ).resolves.toBeUndefined();

    const persisted = await readPersisted();
    expect(persisted.prd_audit).toBe('skipped');
    expect(persisted.last_step).toBe('build');
  });

  it('still persists an in-memory change the batch did not write', async () => {
    const conductor = newConductor();
    const internals = conductorInternals(conductor);
    const state = { plan: 'done' } as ConductState;
    await internals.initializeRunState(state);

    // Changed in memory BEFORE the batch and never submitted with it: adopting
    // a whole-state copy as the new baseline would silently drop this field.
    (state as Record<string, unknown>).complexity_tier = 'M';

    await internals.applyStateBatch({
      name: 'record selector tail skips',
      mutations: [
        { field: 'prd_audit', expected: undefined, intent: 'record selector tail skips', next: 'skipped' },
      ],
    });
    (state as Record<string, unknown>).prd_audit = 'skipped';

    await internals.persistPendingStateChanges(state, 'persist conductor transition');

    const persisted = await readPersisted();
    expect(persisted.complexity_tier).toBe('M');
    expect(persisted.prd_audit).toBe('skipped');
  });
});
