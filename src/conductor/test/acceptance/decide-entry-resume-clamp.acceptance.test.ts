import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StepName } from '../../src/types/index.js';
import { readState } from '../../src/engine/state.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import {
  cleanupDecideEntryFixture,
  conductorFor,
  createDecideEntryFixture,
  readOptional,
  recordingFailureRunner,
  resolvedState,
  type DecideEntryFixture,
  writeFixtureState,
} from './decide-entry-fixture.js';

// Story 2. Production call site: Conductor.run()'s verdict-aware resume clamp.
describe('acceptance: autonomous resume clamp refuses DECIDE targets', () => {
  let fixture: DecideEntryFixture;

  beforeEach(async () => {
    fixture = await createDecideEntryFixture(
      await mkdtemp(join(tmpdir(), 'decide-entry-resume-clamp-')),
    );
  });

  afterEach(async () => {
    await cleanupDecideEntryFixture(fixture);
  });

  it('halts before a verdict-aware clamp can dispatch stories and leaves its state unresolved', async () => {
    const initialState = resolvedState({ stories: 'failed' });
    await writeFixtureState(fixture, initialState);
    await writeVerdict(fixture.root, 'stories', {
      satisfied: false,
      checkedAt: 1,
      reason: 'stories artifact is missing',
    });
    const ran: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(ran), { resume: true }).run();

    expect(ran).toEqual([]);
    expect(await readOptional(fixture.root, '.pipeline/HALT.class')).toBe('needs-human');
    const halt = await readOptional(fixture.root, '.pipeline/HALT');
    expect(halt).toMatch(/Source gate:\s*resume-clamp/i);
    expect(halt).toMatch(/Requested target:\s*stories/i);
    const state = await readState(fixture.statePath);
    expect(state).toMatchObject({ ok: true, value: initialState });
  });

  it('still clamps to and dispatches a known BUILD target', async () => {
    await writeFixtureState(fixture, resolvedState({ build: 'failed' }));
    await writeVerdict(fixture.root, 'build', {
      satisfied: false,
      checkedAt: 1,
      reason: 'build needs repair',
    });
    const ran: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(ran), { resume: true }).run();

    expect(ran[0]).toBe('build');
    expect(await readOptional(fixture.root, '.pipeline/HALT')).not.toMatch(/DECIDE entry refused/i);
  });
});
