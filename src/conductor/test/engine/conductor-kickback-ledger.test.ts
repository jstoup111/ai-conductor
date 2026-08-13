import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import {
  KICKBACK_LEDGER_PATH,
  readKickbackLedger,
  writeKickbackLedger,
} from '../../src/engine/kickback-ledger.js';
import { HALT_MARKER, readHaltClass } from '../../src/engine/halt-marker.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('conductor kickback ledger lifecycle (Task 7, #984)', () => {
  let dir: string;
  let statePath: string;
  let ledgerPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-kickback-ledger-'));
    statePath = join(dir, 'conduct-state.json');
    ledgerPath = join(dir, KICKBACK_LEDGER_PATH);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function firstDispatchSentinel(): StepRunner {
    return {
      run: async () => {
        throw new Error('stop after fresh-session initialization');
      },
    };
  }

  async function runCapHalt(
    gate: 'build_review',
    lastReason: string,
  ): Promise<{ body: string; haltClass: string; recordedReason: string | undefined }> {
    await writeState(statePath, {
      run_started_at: 1,
      complexity_tier: 'S',
      track: 'technical',
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      prd: 'done',
      stories: 'done',
      conflict_check: 'skipped',
      plan: 'done',
      architecture_diagram: 'skipped',
      architecture_review: 'skipped',
      acceptance_specs: 'skipped',
      build: 'done',
      wiring_check: 'skipped',
      test_suite: 'done',
    });

    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
          );
        } else if (step === 'build_review') {
          await writeFile(
            join(dir, '.pipeline/build-review.json'),
            JSON.stringify({
              verdict: 'FAIL',
              rubric: { tautology: true, scope: false, rootCause: false, completeness: false, wiring: false },
              findings: lastReason === '' ? {} : { tautology: [lastReason] },
            }),
          );
        }
        return { success: true };
      },
    };

    await new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      daemon: gate === 'build_review',
      fromStep: gate,
      maxRetries: 1,
      config: {
        build_review: { enabled: gate === 'build_review' },
        kickback_escalation: { enabled: false },
      },
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
    } as never).run();

    const ledger = await readKickbackLedger(dir);
    return {
      body: await readFile(join(dir, HALT_MARKER), 'utf8'),
      haltClass: await readHaltClass(dir),
      recordedReason: ledger.gates[gate]?.lastReason,
    };
  }

  it('clears the kickback ledger when the feature session has not started', async () => {
    await writeFile(ledgerPath, JSON.stringify({ version: 1, gates: {} }), 'utf8');
    await writeFile(statePath, JSON.stringify({}), 'utf8');

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: firstDispatchSentinel(),
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: { max_retries: 1 } as never,
      fromStep: 'bootstrap',
    });

    await conductor.run().catch(() => {});

    expect(existsSync(ledgerPath)).toBe(false);
  });

  it('preserves the kickback ledger when the feature session has already started', async () => {
    await writeFile(ledgerPath, JSON.stringify({ version: 1, gates: {} }), 'utf8');
    await writeFile(statePath, JSON.stringify({ run_started_at: 1 }), 'utf8');

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: firstDispatchSentinel(),
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: { max_retries: 1 } as never,
      fromStep: 'bootstrap',
    });

    await conductor.run().catch(() => {});

    expect(existsSync(ledgerPath)).toBe(true);
  });

  describe('classified cap HALTs (Task 14, #984)', () => {
    it('names build_review, its cap lap, and the recorded failure reason in a needs-human HALT', async () => {
      const lastReason = 'build review says the implementation is tautological';

      await expect(runCapHalt('build_review', lastReason)).resolves.toEqual({
        body: expect.stringMatching(
          /build_review[\s\S]*cap 2[\s\S]*build review says the implementation is tautological/i,
        ),
        haltClass: 'needs-human',
        recordedReason: expect.stringContaining(lastReason),
      });
    });

    it('uses a stated placeholder when build_review has no recorded failure reason', async () => {
      await expect(runCapHalt('build_review', '')).resolves.toEqual({
        body: expect.stringMatching(/build_review[\s\S]*cap 2[\s\S]*(no .*reason|without reasons)/i),
        haltClass: 'needs-human',
        recordedReason: 'grader returned FAIL without reasons',
      });
    });
  });

  it('records actionable wiring findings under build_review and re-dispatches build without a wiring_check ledger entry', async () => {
    await writeState(statePath, {
      run_started_at: 1,
      complexity_tier: 'S',
      track: 'technical',
      worktree: 'done', memory: 'done', explore: 'done', prd: 'done', stories: 'done',
      conflict_check: 'skipped', plan: 'done', architecture_diagram: 'skipped',
      architecture_review: 'skipped', acceptance_specs: 'skipped',
      wiring_check: 'skipped', test_suite: 'done',
    });
    const calls: string[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        calls.push(step);
        if (step === 'build') {
          await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
            tasks: [{ id: 't1', status: 'completed' }],
          }));
        }
        if (step === 'build_review') {
          await writeFile(join(dir, '.pipeline/build-review.json'), JSON.stringify({
            verdict: 'FAIL',
            rubric: { tautology: false, scope: false, rootCause: false, completeness: false, wiring: true },
            findings: { wiring: ['missing wiring from command to handler'] },
          }));
        }
        return { success: true };
      },
    };

    await new Conductor({
      stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter(),
      projectRoot: dir, verifyArtifacts: true, mode: 'auto', daemon: true,
      fromStep: 'build_review', maxRetries: 1,
      config: { build_review: { enabled: true }, kickback_escalation: { enabled: false } },
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
    } as never).run();

    const ledger = await readKickbackLedger(dir);
    expect(calls).toContain('build');
    expect(calls).not.toContain('wiring_check');
    // Only build_review's structured rubric evidence may own this rework.
    // A generic FAIL reason would leave this vulnerable to the retired
    // wiring_check path satisfying the same assertion.
    expect(ledger.gates.build_review?.lastReason).toBe(
      '[wiring] missing wiring from command to handler',
    );
    expect(ledger.gates.wiring_check).toBeUndefined();
  });

  it('preserves cumulative kickbacks while capturing the build_review baseline', async () => {
    await writeState(statePath, {
      run_started_at: 1,
      complexity_tier: 'S',
      track: 'technical',
      worktree: 'done', memory: 'done', explore: 'done', prd: 'done', stories: 'done',
      conflict_check: 'skipped', plan: 'done', architecture_diagram: 'skipped',
      architecture_review: 'skipped', acceptance_specs: 'skipped',
      wiring_check: 'skipped', test_suite: 'done',
    });
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 0,
          cumulative: 2,
          treeHash: null,
          lastReason: 'previous failure',
          priorVerdict: true,
          resolvedBefore: 0,
        },
      },
    });

    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build_review') {
          await writeFile(join(dir, '.pipeline/build-review.json'), JSON.stringify({
            verdict: 'FAIL',
            rubric: { tautology: true, scope: false, rootCause: false, completeness: false, wiring: false },
            findings: { tautology: ['semantic failure remains'] },
          }));
        }
        if (step === 'build') {
          buildRuns += 1;
          if (buildRuns === 1) {
            await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
              tasks: [{ id: 't1', status: 'completed' }],
            }));
          } else {
            throw new Error('stop after second kickback capture');
          }
        }
        return { success: true };
      },
    };

    await new Conductor({
      stateFilePath: statePath, stepRunner: runner, events: new ConductorEventEmitter(),
      projectRoot: dir, verifyArtifacts: true, mode: 'auto', daemon: true,
      fromStep: 'build_review', maxRetries: 1,
      config: { build_review: { enabled: true }, kickback_escalation: { enabled: false } },
      fullSuiteVerifier: {
        ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
        inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
      },
    } as never).run().catch(() => {});

    expect((await readKickbackLedger(dir)).gates.build_review).toMatchObject({
      cumulative: 4,
      priorVerdict: false,
      resolvedBefore: 1,
    });
  });
});
