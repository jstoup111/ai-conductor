import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StepName } from '../../src/types/index.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import {
  MAX_KICKBACKS_PER_GATE,
  writeKickbackLedger,
} from '../../src/engine/kickback-ledger.js';
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

  async function seedPlanTask(): Promise<void> {
    await mkdir(join(fixture.root, '.docs/plans'), { recursive: true });
    await writeFile(
      join(fixture.root, `.docs/plans/${FEATURE_SLUG}.md`),
      '# Plan\n\n### Task 1: fixture\n\n**Dependencies:** none\n',
      'utf-8',
    );
    await writeFile(
      join(fixture.root, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
      'utf-8',
    );
  }

  it('detects an unknown target outside gate topology and halts with its name verbatim', async () => {
    await seedPlanTask();
    await writeFixtureState(fixture, resolvedState({ build: 'pending' }));
    const unknownTarget = 'custom_decide_target' as StepName;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
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
    expect(halt).toMatch(/Why refused:.*could not be resolved from the configured steps/is);
  });

  it('still rewinds to a configured BUILD target', async () => {
    await seedPlanTask();
    await writeFixtureState(fixture, resolvedState({ build: 'pending' }));
    let wiringRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          await writeVerdict(fixture.root, 'wiring_check', {
            satisfied: false,
            checkedAt: 1,
            kickback: { from: 'build', evidence: 'wiring must be re-checked after BUILD work' },
          });
        }
        if (step === 'wiring_check') wiringRuns += 1;
        return { success: true };
      },
    };

    await conductorFor(fixture, runner, { fromStep: 'build' }).run();

    expect(wiringRuns).toBe(1);
  });

  it('keeps the ping-pong cap reason ahead of an unknown-target refusal', async () => {
    await seedPlanTask();
    const unknownTarget = 'custom_decide_target' as StepName;
    await writeKickbackLedger(fixture.root, {
      version: 1,
      gates: {
        [unknownTarget]: {
          count: MAX_KICKBACKS_PER_GATE,
          treeHash: null,
          lastReason: 'prior ping-pong round',
          priorVerdict: true,
          resolvedBefore: 1_000,
        },
      },
    });
    await writeFixtureState(fixture, resolvedState({ build: 'pending', run_started_at: 1 }));
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          await writeVerdict(fixture.root, unknownTarget, {
            satisfied: false,
            checkedAt: 1,
            kickback: { from: 'build', evidence: 'custom gate remains unresolved' },
          });
        }
        return { success: true };
      },
    };

    await conductorFor(fixture, runner, { fromStep: 'build' }).run();

    const halt = await readOptional(fixture.root, '.pipeline/HALT');
    expect(halt).toMatch(/kickback ping-pong: custom_decide_target re-opened/i);
    expect(halt).toContain(`cap ${MAX_KICKBACKS_PER_GATE}`);
    expect(halt).not.toMatch(/could not be established/i);
  });
});
