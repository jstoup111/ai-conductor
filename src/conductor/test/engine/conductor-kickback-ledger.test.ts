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
    gate: 'build_review' | 'wiring_check',
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
      ...(gate === 'wiring_check'
        ? { build_review: 'skipped' }
        : { wiring_check: 'done', test_suite: 'done' }),
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
              rubric: { tautology: true, scope: false, rootCause: false },
              findings: lastReason === '' ? {} : { tautology: [lastReason] },
            }),
          );
        } else if (step === 'wiring_check' && gate === 'wiring_check') {
          await writeFile(
            join(dir, '.pipeline/wiring-evidence.json'),
            JSON.stringify({
              schema: 1,
              base: 'base',
              head: 'unavailable',
              layer2: { applicable: false },
              waivers: [],
              tasks: [
                {
                  id: 't1',
                  contract: 'src/x.ts#foo',
                  gaps: [{ kind: 'orphan-export', message: lastReason }],
                },
              ],
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

  it('resumes the wiring_check budget on a second dispatch over an unchanged worktree', async () => {
    await writeState(statePath, {
      run_started_at: 1,
      complexity_tier: 'S',
      track: 'technical',
      build: 'done',
      build_review: 'skipped',
    });

    const evidence = (gap: boolean) =>
      JSON.stringify({
        schema: 1,
        base: 'base',
        // This bounded engine fixture deliberately has no Git repository:
        // `currentTreeHash` therefore yields the same indeterminate value on
        // both dispatches. The acceptance spec owns the real-Git tree witness.
        head: 'unavailable',
        layer2: { applicable: false },
        waivers: [],
        tasks: gap
          ? [{ id: 't1', contract: 'src/x.ts#foo', gaps: [{ kind: 'orphan-export', message: 'foo unreachable' }] }]
          : [],
      });
    const satisfy = async (step: string) => {
      if (step === 'build') {
        await writeFile(
          join(dir, '.pipeline/task-status.json'),
          JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
        );
      } else if (step === 'wiring_check') {
        await writeFile(join(dir, '.pipeline/wiring-evidence.json'), evidence(false));
      } else if (step === 'finish') {
        await writeFile(join(dir, '.pipeline/finish-choice'), 'keep');
      }
      return { success: true };
    };
    const makeConductor = (runner: StepRunner, events: ConductorEventEmitter) =>
      new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        mode: 'auto',
        fromStep: 'wiring_check',
        maxRetries: 1,
        config: {
          build_review: { enabled: false },
          kickback_escalation: { enabled: false },
        },
        fullSuiteVerifier: {
          ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
          inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
        },
      } as never);

    let firstWiringRun = true;
    await makeConductor(
      {
        run: async (step) => {
          if (step === 'wiring_check' && firstWiringRun) {
            firstWiringRun = false;
            await writeFile(join(dir, '.pipeline/wiring-evidence.json'), evidence(true));
            return { success: true };
          }
          return satisfy(step);
        },
      },
      new ConductorEventEmitter(),
    ).run();

    const persistedAfterFirst = await readKickbackLedger(dir);
    await writeState(statePath, {
      run_started_at: 1,
      complexity_tier: 'S',
      track: 'technical',
      build: 'done',
      build_review: 'skipped',
    });
    const secondEvents = new ConductorEventEmitter();
    const secondKickbacks: number[] = [];
    const secondHalts: string[] = [];
    secondEvents.on('kickback', (event) => {
      if (event.type === 'kickback' && event.from === 'wiring_check') secondKickbacks.push(event.count);
    });
    secondEvents.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') secondHalts.push(event.reason);
    });
    await makeConductor(
      {
        run: async (step) => {
          if (step === 'wiring_check') {
            await writeFile(join(dir, '.pipeline/wiring-evidence.json'), evidence(true));
            return { success: true };
          }
          return satisfy(step);
        },
      },
      secondEvents,
    ).run();

    await writeState(statePath, {
      run_started_at: 1,
      complexity_tier: 'S',
      track: 'technical',
      build: 'done',
      build_review: 'skipped',
    });
    const thirdEvents = new ConductorEventEmitter();
    const thirdKickbacks: number[] = [];
    const thirdHalts: string[] = [];
    thirdEvents.on('kickback', (event) => {
      if (event.type === 'kickback' && event.from === 'wiring_check') thirdKickbacks.push(event.count);
    });
    thirdEvents.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') thirdHalts.push(event.reason);
    });
    await makeConductor(
      {
        run: async (step) => {
          if (step === 'wiring_check') {
            await writeFile(join(dir, '.pipeline/wiring-evidence.json'), evidence(true));
            return { success: true };
          }
          return satisfy(step);
        },
      },
      thirdEvents,
    ).run();

    expect({
      persistedCount: persistedAfterFirst.gates.wiring_check?.count,
      secondKickbacks,
      secondHalt: secondHalts[0],
      thirdKickbacks,
      thirdHalt: thirdHalts[0],
    }).toEqual({
      persistedCount: 1,
      secondKickbacks: [2],
      secondHalt: undefined,
      thirdKickbacks: [],
      thirdHalt: expect.stringMatching(/wiring_check.*cap 2/i),
    });
  });

  describe('reason-instability regression (Task 11, #984)', () => {
    it('terminates at the kickback cap when the unchanged wiring gap text varies each dispatch', async () => {
      await writeState(statePath, {
        run_started_at: 1,
        complexity_tier: 'S',
        track: 'technical',
        build: 'done',
        build_review: 'skipped',
      });

      const evidence = (reason: string) =>
        JSON.stringify({
          schema: 1,
          base: 'base',
          // This bounded engine fixture deliberately has no Git repository:
          // `currentTreeHash` is therefore the same indeterminate value on
          // every dispatch. Reason text is deliberately not a budget key.
          head: 'unavailable',
          layer2: { applicable: false },
          waivers: [],
          tasks: [{ id: 't1', contract: 'src/x.ts#foo', gaps: [{ kind: 'orphan-export', message: reason }] }],
        });
      const satisfy = async (step: string) => {
        if (step === 'build') {
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 't1', status: 'completed' }] }),
          );
        } else if (step === 'wiring_check') {
          await writeFile(join(dir, '.pipeline/wiring-evidence.json'), evidence('not used'));
        } else if (step === 'finish') {
          await writeFile(join(dir, '.pipeline/finish-choice'), 'keep');
        }
        return { success: true };
      };
      const makeConductor = (runner: StepRunner, events: ConductorEventEmitter) =>
        new Conductor({
          stateFilePath: statePath,
          stepRunner: runner,
          events,
          projectRoot: dir,
          verifyArtifacts: true,
          mode: 'auto',
          fromStep: 'wiring_check',
          maxRetries: 1,
          config: {
            build_review: { enabled: false },
            kickback_escalation: { enabled: false },
          },
          fullSuiteVerifier: {
            ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
            inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
          },
        } as never);

      const firstReason = 'grader wording: export foo lacks a consumer';
      await makeConductor(
        {
          run: async (step) => {
            if (step === 'wiring_check') {
              await writeFile(join(dir, '.pipeline/wiring-evidence.json'), evidence(firstReason));
              return { success: true };
            }
            return satisfy(step);
          },
        },
        new ConductorEventEmitter(),
      ).run();

      await writeState(statePath, {
        run_started_at: 1,
        complexity_tier: 'S',
        track: 'technical',
        build: 'done',
        build_review: 'skipped',
      });

      const secondReason = 'rephrased diagnosis: no reachable caller for foo';
      const secondEvents = new ConductorEventEmitter();
      const secondKickbacks: Array<{ count: number; evidence: string }> = [];
      const secondHalts: string[] = [];
      secondEvents.on('kickback', (event) => {
        if (event.type === 'kickback' && event.from === 'wiring_check') {
          secondKickbacks.push({ count: event.count, evidence: event.evidence ?? '' });
        }
      });
      secondEvents.on('loop_halt', (event) => {
        if (event.type === 'loop_halt') secondHalts.push(event.reason);
      });
      await makeConductor(
        {
          run: async (step) => {
            if (step === 'wiring_check') {
              await writeFile(join(dir, '.pipeline/wiring-evidence.json'), evidence(secondReason));
              return { success: true };
            }
            return satisfy(step);
          },
        },
        secondEvents,
      ).run();

      await writeState(statePath, {
        run_started_at: 1,
        complexity_tier: 'S',
        track: 'technical',
        build: 'done',
        build_review: 'skipped',
      });
      const thirdEvents = new ConductorEventEmitter();
      const thirdHalts: string[] = [];
      thirdEvents.on('loop_halt', (event) => {
        if (event.type === 'loop_halt') thirdHalts.push(event.reason);
      });
      await makeConductor(
        {
          run: async (step) => {
            if (step === 'wiring_check') {
              await writeFile(join(dir, '.pipeline/wiring-evidence.json'), evidence(secondReason));
              return { success: true };
            }
            return satisfy(step);
          },
        },
        thirdEvents,
      ).run();

      expect({ secondKickbacks, secondHalt: secondHalts[0], thirdHalt: thirdHalts[0] }).toEqual({
        secondKickbacks: [{ count: 2, evidence: secondReason }],
        secondHalt: undefined,
        thirdHalt: expect.stringMatching(/wiring_check.*cap 2.*no reachable caller/i),
      });
    });
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

    it('names wiring_check, its cap lap, and the recorded gap reason in a needs-human HALT', async () => {
      const lastReason = 'route foo through the application entry point';

      await expect(runCapHalt('wiring_check', lastReason)).resolves.toEqual({
        body: expect.stringMatching(
          /wiring_check[\s\S]*cap 2[\s\S]*route foo through the application entry point/i,
        ),
        haltClass: 'needs-human',
        recordedReason: lastReason,
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
});
