import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import {
  bumpKickbackGateInLedger,
  KICKBACK_LEDGER_PATH,
  MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW,
  readKickbackLedger,
  writeKickbackLedger,
} from '../../src/engine/kickback-ledger.js';
import { HALT_MARKER, readHaltClass } from '../../src/engine/halt-marker.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type { ConductorEvent } from '../../src/types/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import type { RebaseOutcome } from '../../src/engine/rebase.js';

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

  async function settleBuildReview(verdict: 'PASS' | 'FAIL'): Promise<void> {
    await rm(join(dir, '.pipeline/build-review.json'), { force: true });
    await writeState(statePath, {
      run_started_at: 1,
      complexity_tier: 'S',
      track: 'technical',
      worktree: 'done', memory: 'done', explore: 'done', prd: 'done', stories: 'done',
      conflict_check: 'skipped', plan: 'done', architecture_diagram: 'skipped',
      architecture_review: 'skipped', acceptance_specs: 'skipped', build: 'done',
      wiring_check: 'skipped', test_suite: 'done',
    });

    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build_review') {
          await writeFile(join(dir, '.pipeline/build-review.json'), JSON.stringify({
            verdict,
            rubric: verdict === 'PASS'
              ? { tautology: false, scope: false, rootCause: false, completeness: false }
              : { tautology: true, scope: false, rootCause: false, completeness: false },
            findings: verdict === 'FAIL' ? { tautology: ['semantic failure remains'] } : {},
          }));
          return { success: true };
        }
        if (step === 'build') {
          await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
            tasks: [{ id: 't1', status: 'completed' }],
          }));
          return { success: true };
        }
        throw new Error('stop after build_review ledger transition');
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
              rubric: { tautology: true, scope: false, rootCause: false, completeness: false },
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
            rubric: { tautology: false, scope: false, rootCause: false, completeness: true },
            findings: { completeness: ['missing wiring from command to handler'] },
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
      '[completeness] missing wiring from command to handler',
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
            rubric: { tautology: true, scope: false, rootCause: false, completeness: false },
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

    const events = new ConductorEventEmitter();
    const kickbacks: Array<Extract<ConductorEvent, { type: 'kickback' }>> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });

    await new Conductor({
      stateFilePath: statePath, stepRunner: runner, events,
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
    expect(kickbacks[0]).toMatchObject({ count: 1, cumulativeCount: 3 });
  });

  it('retains build_review cumulative failures after a PASS while a FAIL consumes another lap', async () => {
    const initialEntry = {
      count: 2,
      cumulative: 4,
      treeHash: '0123456789abcdef0123456789abcdef01234567',
      lastReason: 'repeated semantic failure',
      priorVerdict: true,
      resolvedBefore: 1,
    };

    const runVerdict = async (verdict: 'PASS' | 'FAIL') => {
      await writeState(statePath, {
        run_started_at: 1,
        complexity_tier: 'S',
        track: 'technical',
        worktree: 'done', memory: 'done', explore: 'done', prd: 'done', stories: 'done',
        conflict_check: 'skipped', plan: 'done', architecture_diagram: 'skipped',
        architecture_review: 'skipped', acceptance_specs: 'skipped', build: 'done',
        wiring_check: 'skipped', test_suite: 'done',
      });
      await writeKickbackLedger(dir, { version: 1, gates: { build_review: initialEntry } });

      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(join(dir, '.pipeline/build-review.json'), JSON.stringify({
              verdict,
              rubric: verdict === 'PASS'
                ? { tautology: false, scope: false, rootCause: false, completeness: false }
                : { tautology: true, scope: false, rootCause: false, completeness: false },
            }));
            return { success: true };
          }
          throw new Error('stop after build_review status recording');
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

      return (await readKickbackLedger(dir)).gates.build_review;
    };

    const passEntry = await runVerdict('PASS');
    const failEntry = await runVerdict('FAIL');

    expect([passEntry, failEntry]).toEqual([
      initialEntry,
      expect.objectContaining({ cumulative: initialEntry.cumulative + 1 }),
    ]);
  });

  it('leaves every lap-counting entry field intact after build_review PASS completes', async () => {
    const initialEntry = {
      count: 2,
      cumulative: 4,
      rubricFailures: { tautology: 3, completeness: 1 },
      mechanicalFaultAllowance: 2,
      treeHash: '0123456789abcdef0123456789abcdef01234567',
      lastReason: 'repeated semantic failure',
      priorVerdict: true,
      resolvedBefore: 1,
    };
    const lapCounts = Object.fromEntries(
      Object.entries(initialEntry).filter(([field, value]) => (
        field !== 'count' &&
        field !== 'resolvedBefore' &&
        (typeof value === 'number' ||
          (typeof value === 'object' && value !== null && Object.values(value).every((item) => typeof item === 'number')))
      )),
    );

    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: initialEntry,
      },
    });

    await settleBuildReview('PASS');

    const afterPass = (await readKickbackLedger(dir)).gates.build_review ?? {};
    expect(Object.fromEntries(
      Object.entries(afterPass).filter(([field]) => field in lapCounts),
    )).toEqual(lapCounts);
  });

  it('increments a later consumed kickback from the cumulative count retained through PASS', async () => {
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: 4,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'repeated semantic failure',
          priorVerdict: true,
          resolvedBefore: 1,
        },
      },
    });

    await settleBuildReview('PASS');
    await bumpKickbackGateInLedger(dir, 'build_review', {
      treeHash: 'fedcba9876543210fedcba9876543210fedcba98',
      resolvedCount: 1,
      reason: 'semantic failure remains',
    });

    expect((await readKickbackLedger(dir)).gates.build_review?.cumulative).toBe(5);
  });

  it('reaches the cumulative cap when PASSes are interleaved with consumed build_review kickbacks', async () => {
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW - 1,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'repeated semantic failure',
          priorVerdict: true,
          resolvedBefore: 1,
        },
      },
    });

    await settleBuildReview('PASS');
    await bumpKickbackGateInLedger(dir, 'build_review', {
      treeHash: 'fedcba9876543210fedcba9876543210fedcba98',
      resolvedCount: 1,
      reason: 'semantic failure remains',
    });
    await settleBuildReview('PASS');
    await bumpKickbackGateInLedger(dir, 'build_review', {
      treeHash: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      resolvedCount: 2,
      reason: 'another semantic failure remains',
    });

    expect((await readKickbackLedger(dir)).gates.build_review?.cumulative).toBe(
      MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW + 1,
    );
  });

  describe('Task 5: rebase credit is limited to an actually-invalidated build_review', () => {
    const buildReviewEntry = (cumulative: number) => ({
      count: 1,
      cumulative,
      treeHash: '0123456789abcdef0123456789abcdef01234567',
      lastReason: 'prior review finding',
      priorVerdict: false,
      resolvedBefore: 2,
    });

    async function advanceChangedRebase(
      outcome: RebaseOutcome,
      invalidated: readonly StepName[],
      gates: Record<string, ReturnType<typeof buildReviewEntry>>,
    ): Promise<{
      kickbacks: Array<Extract<ConductorEvent, { type: 'kickback' }>>;
      persistedKickbacks: Array<Record<string, unknown>>;
    }> {
      const state = Object.fromEntries(
        ALL_STEPS.map((step) => [step.name, 'done']),
      ) as ConductState;
      state.complexity_tier = 'S';
      await writeState(statePath, state);
      await writeKickbackLedger(dir, { version: 1, gates });

      for (const target of invalidated) {
        await writeVerdict(dir, target, {
          satisfied: false,
          checkedAt: 1,
          kickback: {
            from: 'rebase',
            evidence: 'file-changing rebase invalidated this gate',
          },
        });
      }

      const events = new ConductorEventEmitter();
      const kickbacks: Array<Extract<ConductorEvent, { type: 'kickback' }>> = [];
      events.on('kickback', (event) => {
        if (event.type === 'kickback') kickbacks.push(event);
      });
      const persister = new EventPersister(join(dir, '.pipeline', 'events.jsonl'), events);
      persister.start();
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: { run: async () => ({ success: true }) },
        events,
        verifyArtifacts: true,
        config: { build_review: { enabled: true } },
      } as never);
      (conductor as unknown as { lastRebaseOutcome: RebaseOutcome }).lastRebaseOutcome = outcome;

      await (conductor as unknown as {
        advanceTail: (
          step: typeof ALL_STEPS[number],
          state: ConductState,
          stuckGate: Map<StepName, number>,
          steps: typeof ALL_STEPS,
          indexOf: (name: StepName) => number,
        ) => Promise<number | null | 'halt'>;
      }).advanceTail(
        ALL_STEPS.find((step) => step.name === 'rebase')!,
        state,
        new Map(),
        ALL_STEPS,
        (name) => ALL_STEPS.findIndex((step) => step.name === name),
      );
      persister.stop();
      const eventsPath = join(dir, '.pipeline', 'events.jsonl');
      const persistedKickbacks = (existsSync(eventsPath) ? await readFile(eventsPath, 'utf-8') : '')
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((event) => event.type === 'kickback');
      return { kickbacks, persistedKickbacks };
    }

    it('credits build_review before re-opening it after a changed rebase invalidates its judged surface', async () => {
      await advanceChangedRebase(
        {
          kind: 'changed',
          changedCodePaths: ['src/feature.ts'],
          featureSurface: ['src/feature.ts'],
        },
        ['build_review'],
        { build_review: buildReviewEntry(4) },
      );

      expect((await readKickbackLedger(dir)).gates.build_review?.cumulative).toBe(0);
    });

    it('emits and persists a build_review convergence credit with its target gate', async () => {
      const { kickbacks, persistedKickbacks } = await advanceChangedRebase(
        {
          kind: 'changed',
          changedCodePaths: ['src/feature.ts'],
          featureSurface: ['src/feature.ts'],
        },
        ['build_review'],
        { build_review: buildReviewEntry(4) },
      );

      expect(kickbacks).toContainEqual(expect.objectContaining({
        type: 'kickback',
        from: 'rebase',
        to: 'build_review',
        convergenceCredit: { gate: 'build_review' },
      }));
      expect(persistedKickbacks).toContainEqual(expect.objectContaining({
        type: 'kickback',
        from: 'rebase',
        to: 'build_review',
        convergenceCredit: { gate: 'build_review' },
      }));
    });

    it('does not credit a build_review that classifyGateInvalidation preserves for a surface miss', async () => {
      await writeVerdict(dir, 'build_review', { satisfied: true, checkedAt: 1 });
      const { kickbacks, persistedKickbacks } = await advanceChangedRebase(
        {
          kind: 'changed',
          changedCodePaths: ['src/foreign.ts'],
          featureSurface: ['src/feature.ts'],
        },
        [],
        { build_review: buildReviewEntry(4) },
      );

      expect((await readKickbackLedger(dir)).gates.build_review?.cumulative).toBe(4);
      expect(kickbacks).not.toContainEqual(expect.objectContaining({
        to: 'build_review',
        convergenceCredit: expect.anything(),
      }));
      expect(persistedKickbacks).not.toContainEqual(expect.objectContaining({
        to: 'build_review',
        convergenceCredit: expect.anything(),
      }));
    });

    it('credits only build_review when the same rebase invalidates several gates', async () => {
      await advanceChangedRebase(
        {
          kind: 'changed',
          changedCodePaths: ['src/feature.ts'],
          featureSurface: ['src/feature.ts'],
        },
        ['build_review', 'manual_test', 'prd_audit'],
        {
          build_review: buildReviewEntry(4),
          manual_test: buildReviewEntry(7),
          prd_audit: buildReviewEntry(9),
        },
      );

      const gates = (await readKickbackLedger(dir)).gates;
      expect({
        build_review: gates.build_review?.cumulative,
        manual_test: gates.manual_test?.cumulative,
        prd_audit: gates.prd_audit?.cumulative,
      }).toEqual({ build_review: 0, manual_test: 7, prd_audit: 9 });
    });

    it('does not issue a second credit when the subsequent consumed rebase kickback is recorded', async () => {
      await advanceChangedRebase(
        {
          kind: 'changed',
          changedCodePaths: ['src/feature.ts'],
          featureSurface: ['src/feature.ts'],
        },
        ['build_review'],
        { build_review: buildReviewEntry(4) },
      );
      await bumpKickbackGateInLedger(dir, 'build_review', {
        treeHash: 'fedcba9876543210fedcba9876543210fedcba98',
        resolvedCount: 3,
        reason: 'a later build_review failure consumed one new lap',
      });

      expect((await readKickbackLedger(dir)).gates.build_review?.cumulative).toBe(1);
    });

    it('credits build_review on the fail-closed rebase fallback when its surface is uncomputable', async () => {
      await advanceChangedRebase(
        { kind: 'changed', changedCodePaths: ['src/a.ts'] },
        ['build_review', 'manual_test', 'prd_audit', 'architecture_review_as_built'],
        { build_review: buildReviewEntry(4) },
      );

      expect((await readKickbackLedger(dir)).gates.build_review?.cumulative).toBe(0);
    });
  });

  it('keeps count\'s existing per-tree budget behavior across a PASS and later consumed kickback', async () => {
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        build_review: {
          count: 2,
          cumulative: 0,
          treeHash: '0123456789abcdef0123456789abcdef01234567',
          lastReason: 'repeated semantic failure',
          priorVerdict: true,
          resolvedBefore: 1,
        },
      },
    });

    await settleBuildReview('PASS');
    const afterPass = (await readKickbackLedger(dir)).gates.build_review;
    await settleBuildReview('FAIL');
    const afterKickback = (await readKickbackLedger(dir)).gates.build_review;

    expect([afterPass?.count, afterKickback?.count]).toEqual([2, 2]);
  });

  it('records eight build_review laps cumulatively while preserving per-tree counts', async () => {
    const events = new ConductorEventEmitter();
    const kickbacks: Array<Extract<ConductorEvent, { type: 'kickback' }>> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });

    for (let lap = 1; lap <= 8; lap += 1) {
      await writeState(statePath, {
        run_started_at: 1,
        complexity_tier: 'S',
        track: 'technical',
        worktree: 'done', memory: 'done', explore: 'done', prd: 'done', stories: 'done',
        conflict_check: 'skipped', plan: 'done', architecture_diagram: 'skipped',
        architecture_review: 'skipped', acceptance_specs: 'skipped',
        wiring_check: 'skipped', test_suite: 'done',
      });
      await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
        tasks: Array.from({ length: lap }, (_, id) => ({ id: `t${id}`, status: 'completed' })),
      }));

      const runner: StepRunner = {
        run: async (step) => {
          if (step === 'build_review') {
            await writeFile(join(dir, '.pipeline/build-review.json'), JSON.stringify({
              verdict: 'FAIL',
              rubric: { tautology: true, scope: false, rootCause: false, completeness: false },
              findings: { tautology: ['semantic failure remains'] },
            }));
            return { success: true };
          }
          throw new Error('stop after recording this build_review kickback');
        },
      };

      await new Conductor({
        stateFilePath: statePath, stepRunner: runner, events,
        projectRoot: dir, verifyArtifacts: true, mode: 'auto', daemon: true,
        fromStep: 'build_review', maxRetries: 1,
        config: {
          build_review: { enabled: true },
          cumulative_kickback_bound: { enabled: false },
          kickback_escalation: { enabled: false },
        },
        fullSuiteVerifier: {
          ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
          inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
        },
      } as never).run().catch(() => {});
    }

    const buildReviewKickbacks = kickbacks.filter((event) => event.from === 'build_review');
    expect(buildReviewKickbacks.map(({ count, cumulativeCount }) => ({ count, cumulativeCount }))).toEqual(
      Array.from({ length: 8 }, (_, index) => ({ count: 1, cumulativeCount: index + 1 })),
    );

    const otherGateKickback: Extract<ConductorEvent, { type: 'kickback' }> = {
      type: 'kickback', from: 'test_suite', to: 'build', count: 1,
    };
    expect(otherGateKickback.cumulativeCount).toBeUndefined();
  });
});
