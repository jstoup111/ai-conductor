import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StepName } from '../../src/types/index.js';
import { readState } from '../../src/engine/state.js';
import {
  cleanupDecideEntryFixture,
  conductorFor,
  createDecideEntryFixture,
  recordingFailureRunner,
  seedHealthyDecideArtifacts,
  type DecideEntryFixture,
  writeFixtureState,
} from './decide-entry-fixture.js';

const DECIDE_STEPS: StepName[] = [
  'explore',
  'complexity',
  'prd',
  'architecture_diagram',
  'architecture_review',
  'stories',
  'conflict_check',
  'plan',
  'coherence_check',
];

// Story 7. Production call site: Conductor.run() from the start of a daemon-shaped run.
describe('acceptance: healthy DECIDE artifacts fast-forward without provider cost', () => {
  let fixture: DecideEntryFixture;

  beforeEach(async () => {
    fixture = await createDecideEntryFixture(
      await mkdtemp(join(tmpdir(), 'decide-entry-healthy-fast-forward-')),
    );
    await seedHealthyDecideArtifacts(fixture.root);
  });

  afterEach(async () => {
    await cleanupDecideEntryFixture(fixture);
  });

  it('reaches acceptance_specs with zero DECIDE provider dispatches', async () => {
    await writeFixtureState(fixture, {
      feature_desc: 'decide-entry-fixture',
      track: 'technical',
      complexity_tier: 'L',
      worktree: 'done',
      memory: 'done',
    });
    const ran: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(ran)).run();

    expect(ran[0]).toBe('acceptance_specs');
    expect(ran.filter((step) => DECIDE_STEPS.includes(step))).toEqual([]);
  });

  it('Small tier skips its optional DECIDE artifacts and first dispatches BUILD', async () => {
    await writeFixtureState(fixture, {
      feature_desc: 'decide-entry-fixture',
      track: 'technical',
      complexity_tier: 'S',
      worktree: 'done',
      memory: 'done',
    });
    const ran: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(ran)).run();

    expect(ran[0]).toBe('build');
    expect(ran.filter((step) => DECIDE_STEPS.includes(step))).toEqual([]);
    const state = await readState(fixture.statePath);
    expect(state.ok && state.value.architecture_diagram).toBe('skipped');
    expect(state.ok && state.value.architecture_review).toBe('skipped');
    expect(state.ok && state.value.conflict_check).toBe('skipped');
    expect(state.ok && state.value.coherence_check).toBe('skipped');
  });

  it('an unresolved tier defaults to L and therefore skips none of the optional DECIDE steps', async () => {
    await writeFixtureState(fixture, {
      feature_desc: 'decide-entry-fixture',
      track: 'technical',
      worktree: 'done',
      memory: 'done',
      explore: 'skipped',
      complexity: 'skipped',
      prd: 'skipped',
    });
    const ran: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(ran)).run();

    expect(ran[0]).toBe('acceptance_specs');
    expect(ran.filter((step) => DECIDE_STEPS.includes(step))).toEqual([]);
    const state = await readState(fixture.statePath);
    expect(state.ok && state.value.architecture_diagram).toBe('done');
    expect(state.ok && state.value.architecture_review).toBe('done');
    expect(state.ok && state.value.conflict_check).toBe('done');
    expect(state.ok && state.value.coherence_check).toBe('done');
  });
});
