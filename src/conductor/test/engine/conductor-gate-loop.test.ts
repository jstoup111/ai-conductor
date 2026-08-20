import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { ConductStateStore } from '../../src/engine/conduct-state-store.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import type { FullSuiteVerifier } from '../../src/engine/full-suite-verifier.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const FIXTURES = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'rebase-invalidated-test-suite-proof-halts-build-review',
);

describe('conductor gate loop: stale test-suite proof after rebase', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'conductor-gate-loop-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function installFixture(name: 'unsatisfied-verdict' | 'satisfied-verdict'): Promise<string> {
    const source = join(FIXTURES, name);
    await cp(source, projectRoot, { recursive: true });
    return join(projectRoot, 'conduct-state.json');
  }

  function staleSuiteVerifier(
    observed: StepName[],
  ): Pick<FullSuiteVerifier, 'ensure' | 'inspect'> {
    return {
      inspect: vi.fn(async () => (
        { status: 'STALE' as const, reason: 'fingerprint_mismatch' } as never
      )),
      ensure: vi.fn(async () => {
        observed.push('test_suite');
        throw new Error('stop after test-suite dispatch');
      }),
    };
  }

  it('re-enters test_suite, rather than build_review, for the rebase kickback verdict fixture', async () => {
    const stateFilePath = await installFixture('unsatisfied-verdict');
    const observed: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        observed.push(step);
        throw new Error(`stop after dispatching ${step}`);
      },
    };
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      resume: true,
      fullSuiteVerifier: staleSuiteVerifier(observed),
    });

    await conductor.run();

    expect(observed).toEqual(['test_suite']);
  });

  it('re-enters test_suite when the persisted verdict says satisfied but inspection is stale', async () => {
    const stateFilePath = await installFixture('satisfied-verdict');
    const observed: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        observed.push(step);
        throw new Error(`stop after dispatching ${step}`);
      },
    };
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      // Start at the preceding BUILD gate so this observes the loop boundary
      // where a restored rebase state reaches an already-done test_suite.
      fromStep: 'wiring_check',
      fullSuiteVerifier: staleSuiteVerifier(observed),
    });

    await conductor.run();

    expect(observed).toEqual(['test_suite']);
  });

  it('advances to build_review after test_suite refreshes the stale proof to CURRENT', async () => {
    const stateFilePath = await installFixture('unsatisfied-verdict');
    const observed: StepName[] = [];
    let current = false;
    const inspect = vi.fn(async () => (current
      ? ({ status: 'CURRENT' as const, evidence: {} as never })
      : ({ status: 'STALE' as const, reason: 'fingerprint_mismatch' } as never)));
    const runner: StepRunner = {
      run: async (step) => {
        observed.push(step);
        if (step === 'build_review') throw new Error('stop after build-review input assembly');
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      resume: true,
      fullSuiteVerifier: {
        inspect,
        ensure: async () => {
          observed.push('test_suite');
          current = true;
          return { status: 'EXECUTED', evidence: {} as never } as never;
        },
      },
    });

    await conductor.run();

    expect(observed).toEqual(['test_suite', 'build_review']);
    await expect(inspect.mock.results.at(-1)?.value).resolves.toMatchObject({ status: 'CURRENT' });
    expect(JSON.parse(await readFile(stateFilePath, 'utf8')) as ConductState).toMatchObject({
      test_suite: 'done',
    });
  });

  it('fast-forwards a CURRENT test-suite proof to build_review without native suite dispatch', async () => {
    const stateFilePath = await installFixture('unsatisfied-verdict');
    const observed: StepName[] = [];
    const inspect = vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never }));
    const ensure = vi.fn(async () => ({ status: 'REUSED' as const, evidence: {} as never }));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: {
        run: async (step) => {
          observed.push(step);
          throw new Error('stop after build-review fast-forward');
        },
      },
      events: new ConductorEventEmitter(),
      resume: true,
      verifyArtifacts: true,
      fullSuiteVerifier: { inspect, ensure },
    });

    await conductor.run();

    expect(observed).toEqual(['build_review']);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('keeps an all-satisfied resume at its existing no-dispatch endpoint', async () => {
    const stateFilePath = await installFixture('satisfied-verdict');
    const state = JSON.parse(await readFile(stateFilePath, 'utf8')) as ConductState;
    for (const step of ALL_STEPS) state[step.name] = 'done';
    await writeFile(stateFilePath, JSON.stringify(state));

    const observed: StepName[] = [];
    const inspect = vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never }));
    const ensure = vi.fn(async () => ({ status: 'REUSED' as const, evidence: {} as never }));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: {
        run: async (step) => {
          observed.push(step);
          return { success: true };
        },
      },
      events: new ConductorEventEmitter(),
      resume: true,
      verifyArtifacts: true,
      fullSuiteVerifier: { inspect, ensure },
    });

    await conductor.run();

    expect(observed).toEqual([]);
    expect(inspect).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('preserves a scheduling skip without evaluating the test-suite predicate', async () => {
    const stateFilePath = await installFixture('satisfied-verdict');
    const state = JSON.parse(await readFile(stateFilePath, 'utf8')) as ConductState;
    // Represents a prior tier/track/bootstrap scheduling decision: it is not
    // completion evidence for the boundary to second-guess.
    state.test_suite = 'skipped';
    await writeFile(stateFilePath, JSON.stringify(state));

    const inspect = vi.fn(async () => {
      throw new Error('skipped test_suite must not inspect');
    });
    const observed: StepName[] = [];
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: {
        run: async (step) => {
          observed.push(step);
          throw new Error('stop after skipped-suite proof');
        },
      },
      events: new ConductorEventEmitter(),
      fromStep: 'wiring_check',
      verifyArtifacts: true,
      fullSuiteVerifier: { inspect, ensure: vi.fn() },
    });

    await conductor.run();

    expect(observed).toEqual(['build_review']);
    expect(inspect).not.toHaveBeenCalled();
    expect((JSON.parse(await readFile(stateFilePath, 'utf8')) as ConductState).test_suite).toBe('skipped');
  });

  it('dispatches test_suite when its tree-attesting predicate throws', async () => {
    const stateFilePath = await installFixture('unsatisfied-verdict');
    const observed: StepName[] = [];
    const inspect = vi.fn(async () => {
      if (inspect.mock.calls.length === 1) throw new Error('inspection unavailable');
      return { status: 'STALE' as const, reason: 'fingerprint_mismatch' } as never;
    });
    const ensure = vi.fn(async () => {
      observed.push('test_suite');
      throw new Error('stop after native suite dispatch');
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: {
        run: async (step) => {
          observed.push(step);
          throw new Error(`unexpected dispatch: ${step}`);
        },
      },
      events: new ConductorEventEmitter(),
      resume: true,
      verifyArtifacts: true,
      fullSuiteVerifier: { inspect, ensure },
    });

    await expect(conductor.run()).resolves.toBeUndefined();

    expect(inspect).toHaveBeenCalledTimes(2);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(observed).toEqual(['test_suite']);
  });

  it('leaves a completed step without the tree-attesting declaration untouched', async () => {
    const stateFilePath = await installFixture('satisfied-verdict');
    const state = JSON.parse(await readFile(stateFilePath, 'utf8')) as ConductState;
    state.test_suite = 'skipped';
    state.non_attesting_gate = 'done';
    await writeFile(stateFilePath, JSON.stringify(state));

    const inspect = vi.fn(async () => {
      throw new Error('non-attesting completion must not inspect');
    });
    const observed: StepName[] = [];
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: {
        run: async (step) => {
          observed.push(step);
          throw new Error('stop after non-attesting fast-forward');
        },
      },
      events: new ConductorEventEmitter(),
      fromStep: 'wiring_check',
      verifyArtifacts: true,
      config: {
        steps: {
          non_attesting_gate: {
            after: 'wiring_check',
            skill: 'skills/test/SKILL.md',
          },
        },
      } as never,
      fullSuiteVerifier: { inspect, ensure: vi.fn() },
    });

    await conductor.run();

    expect(observed).toEqual(['build_review']);
    expect(inspect).not.toHaveBeenCalled();
  });

  it('keeps the unsatisfied-verdict fixture state and gate bytes unchanged until ordinary dispatch', async () => {
      const stateFilePath = await installFixture('unsatisfied-verdict');
      const gatePath = join(projectRoot, '.pipeline', 'gates', 'test_suite.json');
      const backing = createFilesystemConductStateStore(stateFilePath);
      const mutations: string[] = [];
      const stateStore: ConductStateStore<ConductState> = {
        apply: async (mutation) => {
          mutations.push(mutation.intent);
          return backing.apply(mutation);
        },
        applyBatch: async (batch) => {
          mutations.push(batch.name);
          return backing.applyBatch(batch);
        },
        replace: async (replacement) => {
          mutations.push(replacement.intent);
          return backing.replace(replacement);
        },
      };
      let beforeDispatch: { state: string; gate: string; mutations: number } | undefined;
      const inspect = vi.fn(async () => {
        if (!beforeDispatch) {
          beforeDispatch = {
            state: await readFile(stateFilePath, 'utf8'),
            gate: await readFile(gatePath, 'utf8'),
            mutations: mutations.length,
          };
        }
        return { status: 'STALE' as const, reason: 'fingerprint_mismatch' } as never;
      });
      const ensure = vi.fn(async () => {
        expect(beforeDispatch).toEqual({
          state: await readFile(stateFilePath, 'utf8'),
          gate: await readFile(gatePath, 'utf8'),
          mutations: mutations.length,
        });
        throw new Error('stop after observing ordinary dispatch');
      });
      const conductor = new Conductor({
        projectRoot,
        stateFilePath,
        stateStore,
        stepRunner: { run: async () => ({ success: true }) },
        events: new ConductorEventEmitter(),
        resume: true,
        verifyArtifacts: true,
        fullSuiteVerifier: { inspect, ensure },
      });

      await conductor.run();

      expect(inspect).toHaveBeenCalledTimes(2);
      expect(ensure).toHaveBeenCalledTimes(1);
      expect(beforeDispatch).toBeDefined();
  });

  it('keeps the satisfied-verdict stale-inspection fixture byte-identical', async () => {
    const stateFilePath = await installFixture('satisfied-verdict');
    const gatePath = join(projectRoot, '.pipeline', 'gates', 'test_suite.json');
    const before = {
      state: await readFile(stateFilePath, 'utf8'),
      gate: await readFile(gatePath, 'utf8'),
    };

    const completion = await checkStepCompletion(projectRoot, 'test_suite', {
      fullSuiteInspect: async () => (
        { status: 'STALE' as const, reason: 'fingerprint_mismatch' } as never
      ),
    });

    expect(completion.done).toBe(false);
    await expect(readFile(stateFilePath, 'utf8')).resolves.toBe(before.state);
    await expect(readFile(gatePath, 'utf8')).resolves.toBe(before.gate);
  });
});
