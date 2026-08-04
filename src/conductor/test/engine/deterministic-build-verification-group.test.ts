import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    const suite = deferred<{
      status: 'EXECUTED';
      freshness: { status: 'STALE'; reason: 'missing' };
      evidence: never;
    }>();
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

    suite.resolve({
      status: 'EXECUTED',
      freshness: { status: 'STALE', reason: 'missing' },
      evidence: {} as never,
    });
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
        timeline.push('suite:REUSED:start');
        timeline.push('suite:REUSED:end');
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
      'suite:REUSED:start',
      'suite:REUSED:end',
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
        evidence: failedMember === 'test_suite'
          ? `full-suite verification failed (test_failure): ${diagnostic}\nEvidence: .pipeline/test-suite-evidence.json`
          : diagnostic,
        count: 1,
      }]);
    },
  );

  it('reconciles a passing suite sibling to stale when wiring fails its objective verdict', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-passing-sibling-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({
      plan: 'done',
      build: 'done',
      wiring_check: 'pending',
      test_suite: 'pending',
    }));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(join(projectRoot, '.pipeline', 'wiring-evidence.json'), JSON.stringify({
      schema: 1,
      base: 'base',
      head: 'current-head',
      layer2: { applicable: false },
      waivers: [],
      tasks: [{
        id: 't1',
        contract: 'src/feature.ts#orphanedExport',
        gaps: [{ kind: 'orphan-export', message: 'orphaned export' }],
      }],
    }));

    const stepRunner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'wiring_check') return { success: true };
        if (step === 'build') return { success: false, output: 'stop after BUILD rewind' };
        throw new Error(`unexpected model or SHIP dispatch: ${step}`);
      }),
    };
    const verifier = {
      inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
      ensure: vi.fn(async () => ({ status: 'REUSED' as const, evidence: {} as never })),
    };
    const conductor = new Conductor({
      stateFilePath,
      stepRunner,
      events: new ConductorEventEmitter(),
      projectRoot,
      fromStep: 'wiring_check',
      mode: 'auto',
      verifyArtifacts: true,
      maxRetries: 1,
      config: { validation_concurrency: 2 },
      git: async () => ({ stdout: 'current-head\n' }),
      fullSuiteVerifier: verifier,
      onRecovery: async () => 'quit',
    });

    await conductor.run();
    const state = JSON.parse(await readFile(stateFilePath, 'utf8')) as Record<string, string>;

    expect({
      wiring_check: state.wiring_check,
      test_suite: state.test_suite,
    }).toEqual({
      wiring_check: 'stale',
      test_suite: 'stale',
    });
  });

  it('does not persist a native suite as done when interrupted before its failed objective verdict joins', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-repair-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({
      plan: 'done',
      build: 'done',
      wiring_check: 'pending',
      test_suite: 'pending',
      build_review: 'stale',
      build_verification__wiring_check: 'done',
      build_verification__test_suite: 'done',
    }));

    let sighupHandler: (() => Promise<void>) | undefined;
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'SIGHUP') sighupHandler = handler as () => Promise<void>;
      return process;
    }) as typeof process.on);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const releaseWiring = deferred<void>();
    const events = new ConductorEventEmitter();
    const ensure = vi.fn(async () => ({
      status: 'FAILED' as const,
      reason: 'test_failure' as never,
      message: 'objective suite failure',
    }));
    const conductor = new Conductor({
      stateFilePath,
      stepRunner: {
        run: vi.fn(async (step) => {
          if (step === 'wiring_check') {
            await releaseWiring.promise;
            return { success: true };
          }
          if (step === 'build') return { success: false, output: 'stop after failed join' };
          throw new Error(`unexpected dispatch: ${step}`);
        }),
      },
      events,
      projectRoot,
      fromStep: 'wiring_check',
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
      config: { validation_concurrency: 2 },
      fullSuiteVerifier: {
        inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
        ensure,
      },
      onRecovery: async () => 'quit',
    });

    const run = conductor.run();
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(sighupHandler).toBeDefined());
    const beforeSignal = JSON.parse(await readFile(stateFilePath, 'utf8')) as Record<string, string>;
    await sighupHandler!();
    const persisted = JSON.parse(await readFile(stateFilePath, 'utf8')) as Record<string, string>;
    releaseWiring.resolve();
    await run;

    expect({
      beforeSignalSyntheticDone: beforeSignal.build_verification__test_suite === 'done',
      afterSignalDone: [
        persisted.test_suite,
        persisted.build_verification__test_suite,
      ].includes('done'),
    }).toEqual({
      beforeSignalSyntheticDone: false,
      afterSignalDone: false,
    });
  });

  it('halts a repeated wiring failure after a no-op BUILD re-entry before charging the wiring budget again', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-wiring-noop-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ plan: 'done', build: 'done' }));

    const dispatches: string[] = [];
    const stepRunner: StepRunner = {
      run: vi.fn(async (step) => {
        dispatches.push(step);
        if (step === 'wiring_check') {
          return { success: false, output: 'unchanged wiring diagnostic' };
        }
        if (step === 'build') return { success: true };
        throw new Error(`unexpected review or SHIP dispatch: ${step}`);
      }),
    };
    const events = new ConductorEventEmitter();
    const kickbackCounts: number[] = [];
    let haltReason: string | undefined;
    events.on('kickback', (event) => {
      if (event.type === 'kickback' && event.from === 'wiring_check') {
        kickbackCounts.push(event.count);
      }
    });
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') haltReason = event.reason;
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
      fullSuiteVerifier: {
        inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
        ensure: vi.fn(async () => ({ status: 'REUSED' as const, evidence: {} as never })),
      },
      onRecovery: async () => 'quit',
    });

    await conductor.run();

    const ledger = await readKickbackLedger(projectRoot);
    expect({
      dispatches,
      kickbackCounts,
      wiringBudget: ledger.gates.wiring_check?.count,
      haltReason,
    }).toEqual({
      dispatches: ['wiring_check', 'build', 'wiring_check'],
      kickbackCounts: [1],
      wiringBudget: 1,
      haltReason: expect.stringMatching(/wiring_check kickback-to-build no-op/),
    });
  });

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
      evidence:
        'wiring diagnostic\nfull-suite verification failed (test_failure): suite diagnostic\n' +
        'Evidence: .pipeline/test-suite-evidence.json',
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
        wiring_check: 'stale',
        test_suite: 'stale',
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

  it.each([
    ['locked', false, { status: 'REUSED', evidence: {} as never }],
    [
      'cancelled',
      true,
      {
        status: 'FAILED',
        reason: 'signal',
        message: 'suite execution cancelled after process-tree cleanup',
      },
    ],
  ] as const)(
    'keeps the native suite branch terminal-owned when execution is %s',
    async (_outcome, interrupt, terminalResult) => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-terminal-'));
      dirs.push(projectRoot);
      const stateFilePath = join(projectRoot, 'conduct-state.json');
      await writeFile(stateFilePath, JSON.stringify({ plan: 'done', build: 'done' }));

      const suite = deferred<typeof terminalResult>();
      const starts: string[] = [];
      const review = vi.fn(async () => ({
        success: false,
        output: 'stop after terminal join',
      }));
      const build = vi.fn(async () => ({
        success: false,
        output: 'stop after cancelled suite rewind',
      }));
      let sigintHandler: (() => Promise<void>) | undefined;
      const processOn = vi.spyOn(process, 'on').mockImplementation(((
        event: string,
        handler: (...args: unknown[]) => void,
      ) => {
        if (event === 'SIGINT') sigintHandler = handler as () => Promise<void>;
        return process;
      }) as typeof process.on);
      const processExit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      const verifier = {
        inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
        ensure: vi.fn(() => {
          starts.push('test_suite');
          return suite.promise;
        }),
      };
      const conductor = new Conductor({
        stateFilePath,
        stepRunner: {
          run: vi.fn(async (step) => {
            if (step === 'wiring_check') {
              starts.push(step);
              return { success: true };
            }
            if (step === 'build_review') return review();
            if (step === 'build') return build();
            throw new Error(`unexpected dispatch: ${step}`);
          }),
        },
        events: new ConductorEventEmitter(),
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
      await vi.waitFor(() => expect(sigintHandler).toBeDefined());
      expect(verifier.ensure).toHaveBeenCalledTimes(1);
      expect(review).not.toHaveBeenCalled();
      expect(build).not.toHaveBeenCalled();

      let stateAtInterruption: string | undefined;
      if (interrupt) {
        await sigintHandler!();
        stateAtInterruption = await readFile(stateFilePath, 'utf8');
      }

      suite.resolve(terminalResult);
      await run;

      expect(verifier.ensure).toHaveBeenCalledTimes(1);
      if (interrupt) {
        expect(review).not.toHaveBeenCalled();
        expect(build).not.toHaveBeenCalled();
        expect(await readFile(stateFilePath, 'utf8')).toBe(stateAtInterruption);
      } else {
        expect(review).toHaveBeenCalledTimes(1);
        expect(build).not.toHaveBeenCalled();
      }

      processOn.mockRestore();
      processExit.mockRestore();
    },
  );
});
