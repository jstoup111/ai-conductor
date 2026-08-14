import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { checkGate } from '../../src/engine/gates.js';
import { bumpKickbackGate } from '../../src/engine/kickback-ledger.js';
import { readTestSuiteRemediations } from '../../src/engine/test-suite-remediation.js';

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

  it('accepts reconciled stale BUILD prerequisites at build review', () => {
    expect(checkGate('build_review', {
      wiring_check: 'stale',
      test_suite: 'stale',
    })).toEqual({ passed: true });
  });

  it('preserves the deterministic kickback cap at two unchanged attempts', () => {
    const initial = bumpKickbackGate(undefined, {
      treeHash: 'unchanged-tree',
      resolvedCount: 1,
      reason: 'first failure',
    });
    const second = bumpKickbackGate(initial.entry, {
      treeHash: 'unchanged-tree',
      resolvedCount: 1,
      reason: 'second failure',
    });
    const exhausted = bumpKickbackGate(second.entry, {
      treeHash: 'unchanged-tree',
      resolvedCount: 1,
      reason: 'third failure',
    });

    expect({
      first: [initial.entry.count, initial.exhausted],
      second: [second.entry.count, second.exhausted],
      exhausted: [exhausted.entry.count, exhausted.exhausted],
    }).toEqual({
      first: [1, false],
      second: [2, false],
      exhausted: [2, true],
    });
  });

  it('runs the native suite before review while retired wiring stays undispatched', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-group-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ build: 'done' }));

    const suite = deferred<{
      status: 'EXECUTED';
      freshness: { status: 'STALE'; reason: 'missing' };
      evidence: never;
    }>();
    const starts: string[] = [];
    const review = vi.fn(async () => ({ success: false, output: 'stop after assertion boundary' }));
    const stepRunner = {
      run: vi.fn((step) => {
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
    await vi.waitFor(() => expect(starts).toEqual(['test_suite']));
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

    await run;

    expect(completions).toEqual([['wiring_check', 'test_suite']]);
    expect(review).toHaveBeenCalledTimes(1);
    expect(stepRunner.run).not.toHaveBeenCalledWith('wiring_check', expect.any(Object));
    expect(verifier.ensure).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(stateFilePath, 'utf8'))).toMatchObject({
      wiring_check: 'done',
      test_suite: 'done',
    });
  });

  it('runs the suite before review when it is the only active BUILD verifier', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-cap-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ build: 'done' }));

    const timeline: string[] = [];
    const stepRunner = {
      run: vi.fn(async (step) => {
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
      'suite:REUSED:start',
      'suite:REUSED:end',
      'review:start',
    ]);
  });

  it('rewinds BUILD once when the suite fails and never dispatches review or SHIP validation', async () => {
    const diagnostic = 'test/obsolete.test.ts failed after base advance';
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-failure-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ plan: 'done', build: 'done' }));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(join(projectRoot, '.pipeline', 'events.jsonl'), `${JSON.stringify({
      type: 'rebase_changed',
      allChangedPaths: ['test/obsolete.test.ts'],
      ts: new Date(Date.now() - 1_000).toISOString(),
    })}\n`);

      const dispatches: string[] = [];
      const stepRunner = {
        run: vi.fn(async (step) => {
          dispatches.push(step);
          if (step === 'build') return { success: false, output: 'stop after BUILD rewind' };
          throw new Error(`unexpected model or SHIP dispatch: ${step}`);
        }),
      };
      const verifier = {
        inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
        ensure: vi.fn(async () => ({
          status: 'FAILED' as const,
          reason: 'test_failure' as never,
          message: diagnostic,
        })),
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

      expect(dispatches).toEqual(['build']);
      expect(verifier.ensure).toHaveBeenCalledTimes(1);
      expect(kickbacks).toEqual([{
        type: 'kickback',
        from: 'test_suite',
        to: 'build',
        evidence: `full-suite verification failed (test_failure): ${diagnostic}\nEvidence: .pipeline/test-suite-evidence.json`,
        count: 1,
      }]);
      await expect(readTestSuiteRemediations(projectRoot)).resolves.toEqual([
        expect.objectContaining({ gate: 'test_suite', diagnostic }),
      ]);
  });

  it('records the observing gate for both native suite and non-suite deterministic failures through Conductor', async () => {
    const recorded: string[] = [];
    const record = vi.spyOn(Conductor.prototype as unknown as {
      recordDeterministicGateRepair: (gate: string) => Promise<undefined>;
    }, 'recordDeterministicGateRepair').mockImplementation(async (gate) => {
      recorded.push(gate);
      return undefined;
    });

    async function runFailure(kind: 'test_suite' | 'wiring_check'): Promise<void> {
      const projectRoot = await mkdtemp(join(tmpdir(), `build-verification-${kind}-identity-`));
      dirs.push(projectRoot);
      const stateFilePath = join(projectRoot, 'conduct-state.json');
      await writeFile(stateFilePath, JSON.stringify({ plan: 'done', build: 'done' }));
      const conductor = new Conductor({
        stateFilePath,
        stepRunner: {
          run: vi.fn(async (step) => step === 'build'
            ? { success: false, output: 'stop after deterministic rewind' }
            : Promise.reject(new Error(`unexpected dispatch: ${step}`))),
        },
        events: new ConductorEventEmitter(),
        projectRoot,
        fromStep: 'wiring_check',
        mode: 'auto',
        maxRetries: 1,
        config: { validation_concurrency: 2 },
        fullSuiteVerifier: {
          inspect: vi.fn(async () => ({ status: 'CURRENT' as const, evidence: {} as never })),
          ensure: vi.fn(async () => kind === 'test_suite'
            ? { status: 'FAILED' as const, reason: 'test_failure' as never, message: 'suite failed' }
            : { status: 'REUSED' as const, evidence: {} as never }),
        },
        onRecovery: async () => 'quit',
      });
      if (kind === 'wiring_check') {
        vi.spyOn(conductor as unknown as { runWiringCheckStep: () => Promise<{ success: boolean; output: string }> }, 'runWiringCheckStep')
          .mockResolvedValue({ success: false, output: 'wiring deterministic failure' });
      }
      await conductor.run();
    }

    await runFailure('test_suite');
    await runFailure('wiring_check');

    expect(recorded).toEqual(['test_suite', 'wiring_check']);
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

  it('fails closed on an indeterminate native suite result', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'build-verification-indeterminate-'));
    dirs.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ plan: 'done', build: 'done' }));

    const starts: string[] = [];
    const dispatches: string[] = [];
    const review = vi.fn(async () => ({ success: true }));
    const stepRunner = {
      run: vi.fn((step) => {
        dispatches.push(step);
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
    await vi.waitFor(() => expect(starts).toEqual(['suite']));
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
      dispatches: ['build'],
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
    const firstEnsure = vi.fn(() => suite.promise);
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
        ensure: firstEnsure,
      },
      onRecovery: async () => 'quit',
    });

    const interruptedRun = interrupted.run();
    await vi.waitFor(() => expect(sigintHandler).toBeDefined());
    await vi.waitFor(() => expect(firstEnsure).toHaveBeenCalledTimes(1));
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
    expect(firstDispatches.filter((step) => step === 'wiring_check')).toHaveLength(0);
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
      await vi.waitFor(() => expect(starts).toEqual(['test_suite']));
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
