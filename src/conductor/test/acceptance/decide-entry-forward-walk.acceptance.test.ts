import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StepName } from '../../src/types/index.js';
import {
  cleanupDecideEntryFixture,
  conductorFor,
  createDecideEntryFixture,
  FEATURE_SLUG,
  pathExists,
  readOptional,
  recordingFailureRunner,
  resolvedState,
  type DecideEntryFixture,
  writeFixtureState,
} from './decide-entry-fixture.js';

// Story 1 and Story 5. Production call site: Conductor.run()'s forward step walk.
describe('acceptance: autonomous forward walk fails closed at DECIDE entry', () => {
  let fixture: DecideEntryFixture;

  beforeEach(async () => {
    fixture = await createDecideEntryFixture(
      await mkdtemp(join(tmpdir(), 'decide-entry-forward-walk-')),
    );
  });

  afterEach(async () => {
    await cleanupDecideEntryFixture(fixture);
  });

  it('halts needs-human with the five-field payload and never dispatches missing stories', async () => {
    await writeFixtureState(
      fixture,
      resolvedState({
        stories: 'pending',
        conflict_check: 'pending',
        plan: 'pending',
        coherence_check: 'pending',
      }),
    );
    const ran: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(ran)).run();

    expect(ran).toEqual([]);
    expect(await readOptional(fixture.root, '.pipeline/HALT.class')).toBe('needs-human');
    const halt = await readOptional(fixture.root, '.pipeline/HALT');
    expect(halt).toMatch(/Source gate:\s*forward-walk/i);
    expect(halt).toMatch(/Requested target:\s*stories/i);
    expect(halt).toMatch(new RegExp(`Evidence:.*\\.docs/stories/${FEATURE_SLUG}\\.md`, 'is'));
    expect(halt).toMatch(/Why refused:.*artifact unsatisfied/is);
    expect(halt).toMatch(/Operator choices:.*named step.*routing target.*reject/is);
  });

  it('interactive conduct still dispatches the same unsatisfied stories step without a refusal HALT', async () => {
    await writeFixtureState(
      fixture,
      resolvedState({ stories: 'pending', conflict_check: 'pending', plan: 'pending' }),
    );
    const ran: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(ran), {
      daemon: false,
      mode: 'default',
      onRecovery: async () => 'quit',
    }).run();

    expect(ran[0]).toBe('stories');
    expect(await pathExists(fixture.root, '.pipeline/HALT')).toBe(false);
    expect(await pathExists(fixture.root, '.pipeline/HALT.class')).toBe(false);
  });
});
