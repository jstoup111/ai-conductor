import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { StepRunner } from '../../src/engine/conductor.js';

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
});
