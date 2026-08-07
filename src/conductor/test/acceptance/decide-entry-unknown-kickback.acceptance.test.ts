import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StepName } from '../../src/types/index.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import {
  cleanupDecideEntryFixture,
  conductorFor,
  createDecideEntryFixture,
  FEATURE_SLUG,
  readOptional,
  resolvedState,
  type DecideEntryFixture,
  writeFixtureState,
} from './decide-entry-fixture.js';

// Story 3 and Story 5. Production call site: both Conductor.run() kickback scans.
describe('acceptance: unknown persisted kickback targets fail closed', () => {
  let fixture: DecideEntryFixture;

  beforeEach(async () => {
    fixture = await createDecideEntryFixture(
      await mkdtemp(join(tmpdir(), 'decide-entry-unknown-kickback-')),
    );
  });

  afterEach(async () => {
    await cleanupDecideEntryFixture(fixture);
  });

  it('detects an unknown target outside gate topology and halts with its name verbatim', async () => {
    await mkdir(join(fixture.root, '.docs/plans'), { recursive: true });
    await writeFile(
      join(fixture.root, `.docs/plans/${FEATURE_SLUG}.md`),
      '# Plan\n\n### Task 1: fixture\n\n**Dependencies:** none\n',
      'utf-8',
    );
    await writeFixtureState(fixture, resolvedState({ build: 'pending' }));
    const unknownTarget = 'custom_decide_target' as StepName;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          await writeFile(
            join(fixture.root, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
            'utf-8',
          );
          await writeVerdict(fixture.root, unknownTarget, {
            satisfied: false,
            checkedAt: 1,
            kickback: {
              from: 'build',
              evidence: 'custom gate could not resolve its requested phase',
            },
          });
        }
        return { success: true };
      },
    };

    await conductorFor(fixture, runner, { fromStep: 'build' }).run();

    expect(await readOptional(fixture.root, '.pipeline/HALT.class')).toBe('needs-human');
    const halt = await readOptional(fixture.root, '.pipeline/HALT');
    expect(halt).toMatch(/Source gate:\s*build/i);
    expect(halt).toMatch(/Requested target:\s*custom_decide_target/i);
    expect(halt).toMatch(/Evidence:.*custom gate could not resolve/is);
    expect(halt).toMatch(/Why refused:.*phase.*could not be established/is);
  });
});
