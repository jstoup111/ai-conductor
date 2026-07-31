import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('deterministic BUILD verification group', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('starts both native checks before release, joins in declaration order, and only then reviews', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-group-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ build: 'done' }));

    const wiring = deferred<{ success: true }>();
    const suite = deferred<{ status: 'REUSED'; evidence: never }>();
    const starts: string[] = [];
    const review = vi.fn(async () => ({ success: false, output: 'stop after assertion boundary' }));
    const stepRunner: StepRunner = {
      run: vi.fn((step) => {
        if (step === 'wiring_check') {
          starts.push(step);
          return wiring.promise;
        }
        if (step === 'build_review') return review();
        throw new Error(`unexpected step dispatch: ${step}`);
      }),
    };
    const verifier = {
      inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
      ensure: vi.fn(async () => {
        starts.push('test_suite');
        return suite.promise;
      }),
    };
    const events = new ConductorEventEmitter();
    const completions: string[][] = [];
    events.on('parallel_completed', (event) => {
      if (event.type === 'parallel_completed') completions.push(event.branches);
    });
    const conductor = new Conductor({
      stateFilePath,
      stepRunner,
      events,
      projectRoot,
      fromStep: 'wiring_check',
      mode: 'auto',
      maxRetries: 1,
      config: { validation_concurrency: 2 },
      fullSuiteVerifier: verifier,
      onRecovery: async () => 'quit',
    });

    const run = conductor.run();
    await vi.waitFor(() => expect(starts).toEqual(['wiring_check', 'test_suite']));
    expect(review).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(stateFilePath, 'utf8'))).not.toMatchObject({
      wiring_check: 'done',
      test_suite: 'done',
    });

    suite.resolve({ status: 'REUSED', evidence: {} as never });
    await Promise.resolve();
    expect(review).not.toHaveBeenCalled();

    wiring.resolve({ success: true });
    await run;

    expect(completions).toEqual([['wiring_check', 'test_suite']]);
    expect(review).toHaveBeenCalledTimes(1);
    expect(stepRunner.run).toHaveBeenCalledWith('wiring_check', expect.any(Object));
    expect(verifier.ensure).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(stateFilePath, 'utf8'))).toMatchObject({
      wiring_check: 'done',
      test_suite: 'done',
    });
  });

  it('uses the shared concurrency cap to run native checks in declared order', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-cap-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ build: 'done' }));

    const timeline: string[] = [];
    const stepRunner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'wiring_check') {
          timeline.push('wiring:start');
          timeline.push('wiring:end');
          return { success: true };
        }
        if (step === 'build_review') {
          timeline.push('review:start');
          return { success: false, output: 'stop after assertion boundary' };
        }
        throw new Error(`unexpected step dispatch: ${step}`);
      }),
    };
    const verifier = {
      inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
      ensure: vi.fn(async () => {
        timeline.push('suite:start');
        timeline.push('suite:end');
        return { status: 'REUSED' as const, evidence: {} as never };
      }),
    };
    const conductor = new Conductor({
      stateFilePath,
      stepRunner,
      events: new ConductorEventEmitter(),
      projectRoot,
      fromStep: 'wiring_check',
      mode: 'auto',
      maxRetries: 1,
      config: { validation_concurrency: 1 },
      fullSuiteVerifier: verifier,
      onRecovery: async () => 'quit',
    });

    await conductor.run();

    expect(timeline).toEqual([
      'wiring:start',
      'wiring:end',
      'suite:start',
      'suite:end',
      'review:start',
    ]);
  });

  it.each([
    ['wiring_check', false, true, 'wiring diagnostic'],
    ['test_suite', true, false, 'suite diagnostic'],
  ] as const)(
    'rewinds BUILD once when %s fails and never dispatches review or SHIP validation',
    async (failedMember, wiringPasses, suitePasses, diagnostic) => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-failure-'));
      dirs.push(projectRoot);
      const stateFilePath = join(projectRoot, 'conduct-state.json');
      await writeFile(stateFilePath, JSON.stringify({ plan: 'done', build: 'done' }));

      const dispatches: string[] = [];
      const stepRunner: StepRunner = {
        run: vi.fn(async (step) => {
          dispatches.push(step);
          if (step === 'wiring_check') {
            return wiringPasses
              ? { success: true }
              : { success: false, output: diagnostic };
          }
          if (step === 'build') return { success: false, output: 'stop after BUILD rewind' };
          throw new Error(`unexpected model or SHIP dispatch: ${step}`);
        }),
      };
      const verifier = {
        inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
        ensure: vi.fn(async () => (
          suitePasses
            ? { status: 'REUSED' as const, evidence: {} as never }
            : { status: 'FAILED' as const, reason: 'test_failure' as never, message: diagnostic }
        )),
      };
      const events = new ConductorEventEmitter();
      const kickbacks: Array<{ from: string; to: string; evidence?: string }> = [];
      events.on('kickback', (event) => {
        if (event.type === 'kickback') kickbacks.push(event);
      });
      const conductor = new Conductor({
        stateFilePath,
        stepRunner,
        events,
        projectRoot,
        fromStep: 'wiring_check',
        mode: 'auto',
        maxRetries: 1,
        config: { validation_concurrency: 2 },
        fullSuiteVerifier: verifier,
        onRecovery: async () => 'quit',
      });

      await conductor.run();

      expect(dispatches).toEqual(['wiring_check', 'build']);
      expect(verifier.ensure).toHaveBeenCalledTimes(1);
      expect(kickbacks).toEqual([{
        type: 'kickback',
        from: failedMember,
        to: 'build',
        evidence: diagnostic,
        count: 1,
      }]);
    },
  );

  it('joins reversed dual failures into one ordered BUILD rewind and charges both gate budgets', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-dual-failure-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ plan: 'done', build: 'done' }));

    const wiring = deferred<{ success: false; output: string }>();
    const suite = deferred<{ status: 'FAILED'; reason: never; message: string }>();
    const starts: string[] = [];
    const dispatches: string[] = [];
    const stepRunner: StepRunner = {
      run: vi.fn((step) => {
        dispatches.push(step);
        if (step === 'wiring_check') {
          starts.push('wiring');
          return wiring.promise;
        }
        if (step === 'build') return Promise.resolve({ success: false, output: 'stop after rewind' });
        throw new Error(`unexpected model or SHIP dispatch: ${step}`);
      }),
    };
    const verifier = {
      inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
      ensure: vi.fn(() => {
        starts.push('suite');
        return suite.promise;
      }),
    };
    const events = new ConductorEventEmitter();
    const kickbacks: Array<{ from: string; to: string; evidence?: string; count: number }> = [];
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });
    const conductor = new Conductor({
      stateFilePath,
      stepRunner,
      events,
      projectRoot,
      fromStep: 'wiring_check',
      mode: 'auto',
      maxRetries: 1,
      config: { validation_concurrency: 2 },
      fullSuiteVerifier: verifier,
      onRecovery: async () => 'quit',
    });

    const run = conductor.run();
    await vi.waitFor(() => expect(starts).toEqual(['wiring', 'suite']));
    suite.resolve({ status: 'FAILED', reason: 'test_failure' as never, message: 'suite diagnostic' });
    await Promise.resolve();
    wiring.resolve({ success: false, output: 'wiring diagnostic' });
    await run;

    expect(dispatches).toEqual(['wiring_check', 'build']);
    expect(kickbacks).toEqual([{
      type: 'kickback',
      from: 'wiring_check',
      to: 'build',
      evidence: 'wiring diagnostic\nsuite diagnostic',
      count: 1,
    }]);
    const ledger = await readKickbackLedger(projectRoot);
    expect({
      wiring: ledger.gates.wiring_check?.count,
      suite: ledger.gates.test_suite?.count,
    }).toEqual({ wiring: 1, suite: 1 });
  });

  it('fails closed on an indeterminate native suite result after wiring settles', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-indeterminate-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ plan: 'done', build: 'done' }));

    const wiring = deferred<{ success: true }>();
    const starts: string[] = [];
    const dispatches: string[] = [];
    const review = vi.fn(async () => ({ success: true }));
    const stepRunner: StepRunner = {
      run: vi.fn((step) => {
        dispatches.push(step);
        if (step === 'wiring_check') {
          starts.push('wiring');
          return wiring.promise;
        }
        if (step === 'build_review') return review();
        if (step === 'build') return Promise.resolve({ success: false, output: 'stop after rewind' });
        throw new Error(`unexpected model or SHIP dispatch: ${step}`);
      }),
    };
    const verifier = {
      inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
      ensure: vi.fn(async () => {
        starts.push('suite');
        return {
          status: 'INDETERMINATE',
          message: 'suite verifier returned no verdict',
        } as never;
      }),
    };
    const events = new ConductorEventEmitter();
    const completions: string[][] = [];
    const kickbacks: Array<{ from: string; to: string; evidence?: string }> = [];
    events.on('parallel_completed', (event) => {
      if (event.type === 'parallel_completed') completions.push(event.branches);
    });
    events.on('kickback', (event) => {
      if (event.type === 'kickback') kickbacks.push(event);
    });
    const conductor = new Conductor({
      stateFilePath,
      stepRunner,
      events,
      projectRoot,
      fromStep: 'wiring_check',
      mode: 'auto',
      maxRetries: 1,
      config: { validation_concurrency: 2 },
      fullSuiteVerifier: verifier,
      onRecovery: async () => 'quit',
    });

    const run = conductor.run();
    await vi.waitFor(() => expect(starts).toEqual(['wiring', 'suite']));
    wiring.resolve({ success: true });
    await run;
    const state = JSON.parse(await readFile(stateFilePath, 'utf8')) as Record<string, string>;

    expect({
      dispatches,
      reviewCalls: review.mock.calls.length,
      completions,
      kickbacks,
      gates: {
        wiring_check: state.wiring_check,
        test_suite: state.test_suite,
        build_review: state.build_review,
      },
    }).toEqual({
      dispatches: ['wiring_check', 'build'],
      reviewCalls: 0,
      completions: [],
      kickbacks: [{
        type: 'kickback',
        from: 'test_suite',
        to: 'build',
        evidence: 'suite verifier returned no verdict',
        count: 1,
      }],
      gates: {
        wiring_check: 'pending',
        test_suite: 'pending',
        build_review: undefined,
      },
    });
  });

  it('persists a settled native sibling across interruption and retries only the absent sibling on resume', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-interruption-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    const completedBeforeVerification = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      prd: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      coherence_check: 'done',
      acceptance_specs: 'done',
      build: 'done',
    };
    await writeFile(stateFilePath, JSON.stringify(completedBeforeVerification));

    const suite = deferred<{ status: 'REUSED'; evidence: never }>();
    const firstDispatches: string[] = [];
    let sigintHandler: (() => Promise<void>) | undefined;
    const processOn = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      if (event === 'SIGINT') sigintHandler = handler as () => Promise<void>;
      return process;
    }) as typeof process.on);
    const processExit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const interrupted = new Conductor({
      stateFilePath,
      stepRunner: {
        run: vi.fn(async (step) => {
          firstDispatches.push(step);
          if (step === 'wiring_check') return { success: true };
          if (step === 'build_review') {
            return { success: false, output: 'stop after cleanup boundary' };
          }
          throw new Error(`unexpected dispatch: ${step}`);
        }),
      },
      events: new ConductorEventEmitter(),
      projectRoot,
      fromStep: 'wiring_check',
      mode: 'auto',
      maxRetries: 1,
      config: { validation_concurrency: 2 },
      fullSuiteVerifier: {
        inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
        ensure: vi.fn(() => suite.promise),
      },
      onRecovery: async () => 'quit',
    });

    const interruptedRun = interrupted.run();
    await vi.waitFor(() => expect(sigintHandler).toBeDefined());
    await vi.waitFor(() => expect(firstDispatches).toEqual(['wiring_check']));
    await new Promise((resolve) => setImmediate(resolve));
    await sigintHandler!();

    const interruptedState = JSON.parse(await readFile(stateFilePath, 'utf8'));
    expect(interruptedState).toMatchObject({
      wiring_check: 'done',
      build_verification__wiring_check: 'done',
    });
    expect(interruptedState).not.toHaveProperty('test_suite', 'done');
    expect(interruptedState).not.toHaveProperty(
      'build_verification__test_suite',
      'done',
    );

    // Let the simulated interrupted process drain before cleanup, then restore
    // the exact snapshot that would have survived a real process exit.
    suite.resolve({ status: 'REUSED', evidence: {} as never });
    await interruptedRun;
    await writeFile(stateFilePath, JSON.stringify(interruptedState));
    processOn.mockRestore();
    processExit.mockRestore();

    const resumedDispatches: string[] = [];
    const resumedVerifier = {
      inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
      ensure: vi.fn(async () => ({ status: 'REUSED' as const, evidence: {} as never })),
    };
    const resumed = new Conductor({
      stateFilePath,
      stepRunner: {
        run: vi.fn(async (step) => {
          resumedDispatches.push(step);
          if (step === 'build_review') {
            return { success: false, output: 'stop after resume assertion boundary' };
          }
          throw new Error(`unexpected redispatch: ${step}`);
        }),
      },
      events: new ConductorEventEmitter(),
      projectRoot,
      resume: true,
      mode: 'auto',
      maxRetries: 1,
      config: { validation_concurrency: 2 },
      fullSuiteVerifier: resumedVerifier,
      onRecovery: async () => 'quit',
    });

    await resumed.run();

    expect(resumedVerifier.ensure).toHaveBeenCalledTimes(1);
    expect(resumedDispatches).toEqual(['build_review']);
    expect(firstDispatches.filter((step) => step === 'wiring_check')).toHaveLength(1);
    expect(JSON.parse(await readFile(stateFilePath, 'utf8'))).toMatchObject({
      wiring_check: 'done',
      test_suite: 'done',
    });
  });
});
