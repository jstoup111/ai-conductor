import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import {
  KICKBACK_LEDGER_PATH,
  readKickbackLedger,
} from '../../src/engine/kickback-ledger.js';
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

    expect({
      persistedCount: persistedAfterFirst.gates.wiring_check?.count,
      secondKickbacks,
      secondHalt: secondHalts[0],
    }).toEqual({
      persistedCount: 1,
      secondKickbacks: [2],
      secondHalt: expect.stringMatching(/wiring_check.*cap 2/i),
    });
  });
});
