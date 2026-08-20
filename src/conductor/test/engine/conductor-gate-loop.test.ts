import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { FullSuiteVerifier } from '../../src/engine/full-suite-verifier.js';
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
});
