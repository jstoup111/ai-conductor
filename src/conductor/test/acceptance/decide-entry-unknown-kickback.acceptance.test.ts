import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StepName } from '../../src/types/index.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { renderDecideEntryHalt } from '../../src/engine/decide-entry-policy.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import {
  MAX_KICKBACKS_PER_GATE,
  readKickbackLedger,
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

  it('persists the shared refusal payload for an unknown target outside gate topology', async () => {
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

    let emittedReason: string | undefined;
    fixture.events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') emittedReason = event.reason;
    });

    await conductorFor(fixture, runner, { fromStep: 'build' }).run();

    expect(await readOptional(fixture.root, '.pipeline/HALT.class')).toBe('needs-human');
    const halt = await readOptional(fixture.root, '.pipeline/HALT');
    const expected = renderDecideEntryHalt({
      sourceGate: 'build',
      target: unknownTarget,
      evidence: 'custom gate could not resolve its requested phase',
      reason: "DECIDE target 'custom_decide_target' could not be resolved from the configured steps.",
    });
    expect(halt).toBe(expected + '\n');
    expect(emittedReason).toBe(expected);
  });

  it('routes a configured BUILD target through build_review, not the retired wiring_check path', async () => {
    await seedPlanTask();
    await writeFixtureState(fixture, resolvedState({ build: 'pending' }));
    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        dispatched.push(step);
        if (step === 'build') {
          await writeVerdict(fixture.root, 'build_review', {
            satisfied: false,
            checkedAt: 1,
            kickback: { from: 'build', evidence: 'review must be re-run after BUILD work' },
          });
        }
        return { success: true };
      },
    };

    await conductorFor(fixture, runner, {
      fromStep: 'build',
      config: { build_review: { enabled: true } },
    }).run();

    expect(dispatched.filter((step) => step === 'build_review')).toHaveLength(1);
    expect(dispatched).not.toContain('wiring_check');
    // The failed verdict is owned by build_review: its durable budget entry,
    // unlike the retired compatibility step, records the BUILD rewind.
    const ledger = await readKickbackLedger(fixture.root);
    expect(ledger.gates.build_review?.lastReason).toContain(
      'review must be re-run after BUILD work',
    );
    expect(ledger.gates.wiring_check).toBeUndefined();
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
