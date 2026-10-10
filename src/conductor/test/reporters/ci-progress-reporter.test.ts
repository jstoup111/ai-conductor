// Covers: task:1, task:2
import type { TestCase, TestModule } from 'vitest/node';
import { describe, expect, it } from 'vitest';
import CiProgressReporter from './ci-progress-reporter.js';

type TestState = 'passed' | 'failed' | 'skipped' | 'pending';

function testCase(fullName: string, state: TestState): TestCase {
  return {
    fullName,
    result: () => ({ state }),
  } as unknown as TestCase;
}

function testModule(
  moduleId: string,
  state: 'passed' | 'failed' | 'skipped',
  duration: number,
  tests: TestCase[] = [],
): TestModule {
  return {
    moduleId,
    state: () => state,
    diagnostic: () => ({ duration }),
    children: { allTests: () => tests },
  } as unknown as TestModule;
}

function reporterWithOutput(): { reporter: CiProgressReporter; output: string[] } {
  const output: string[] = [];
  const reporter = new CiProgressReporter({ write: (line) => output.push(line) });
  reporter.onInit({ config: { root: '/pkg' } } as never);
  return { reporter, output };
}

function manualTimers() {
  const callbacks = new Map<object, () => void>();
  const cleared: object[] = [];
  let unrefCalls = 0;

  return {
    setInterval(callback: () => void): object {
      const handle = { unref: () => unrefCalls++ };
      callbacks.set(handle, callback);
      return handle;
    },
    clearInterval(handle: object): void {
      cleared.push(handle);
      callbacks.delete(handle);
    },
    tick(): void {
      for (const callback of callbacks.values()) callback();
    },
    get cleared(): readonly object[] {
      return cleared;
    },
    get unrefCalls(): number {
      return unrefCalls;
    },
    get handle(): object | undefined {
      return callbacks.keys().next().value as object | undefined;
    },
  };
}

describe('CiProgressReporter', () => {
  it('writes a start line once when a module is queued before it starts', () => {
    const { reporter, output } = reporterWithOutput();
    const module = testModule('/pkg/test/a.test.ts', 'passed', 0);

    reporter.onTestModuleQueued(module);
    reporter.onTestModuleStart(module);

    expect(output).toEqual(['[ci-progress] start test/a.test.ts\n']);
  });

  it('writes passed done lines for passed and skipped modules', () => {
    const { reporter, output } = reporterWithOutput();
    const passed = testModule('/pkg/test/a.test.ts', 'passed', 1234);
    const skipped = testModule('/pkg/test/b.test.ts', 'skipped', 0, [
      testCase('skipped test', 'skipped'),
    ]);

    reporter.onTestModuleEnd(passed);
    reporter.onTestModuleEnd(skipped);

    expect(output).toEqual([
      '[ci-progress] start test/a.test.ts\n',
      '[ci-progress] done test/a.test.ts passed 1.2s\n',
      '[ci-progress] start test/b.test.ts\n',
      '[ci-progress] done test/b.test.ts passed 0.0s\n',
    ]);
  });

  it('writes failed test lines in test order after a failed module', () => {
    const { reporter, output } = reporterWithOutput();
    const module = testModule('/pkg/test/a.test.ts', 'failed', 1234, [
      testCase('first failure', 'failed'),
      testCase('passes', 'passed'),
      testCase('second failure', 'failed'),
    ]);

    reporter.onTestModuleEnd(module);

    expect(output).toEqual([
      '[ci-progress] start test/a.test.ts\n',
      '[ci-progress] done test/a.test.ts failed 1.2s\n',
      '[ci-progress] failed test: first failure\n',
      '[ci-progress] failed test: second failure\n',
    ]);
  });

  it('writes start and failed done lines for an import-failed module', () => {
    const { reporter, output } = reporterWithOutput();
    const module = testModule('/pkg/test/import-failure.test.ts', 'failed', 0);

    reporter.onTestModuleStart(module);
    reporter.onTestModuleEnd(module);

    expect(output).toEqual([
      '[ci-progress] start test/import-failure.test.ts\n',
      '[ci-progress] done test/import-failure.test.ts failed 0.0s\n',
    ]);
  });

  it('starts each record on a new line after a completed test, but not a pending test', () => {
    const { reporter, output } = reporterWithOutput();
    const module = testModule('/pkg/test/a.test.ts', 'passed', 0);

    reporter.onTestCaseResult(testCase('passes', 'passed'));
    reporter.onTestModuleQueued(module);
    reporter.onTestCaseResult(testCase('pending', 'pending'));
    reporter.onTestModuleEnd(module);

    expect(output).toEqual([
      '\n',
      '[ci-progress] start test/a.test.ts\n',
      '[ci-progress] done test/a.test.ts passed 0.0s\n',
    ]);
  });

  it('reports a running module as stalled at 90 seconds and then every 90 seconds', () => {
    let now = 0;
    const timers = manualTimers();
    const output: string[] = [];
    const reporter = new CiProgressReporter({
      write: (line) => output.push(line),
      now: () => now,
      setInterval: timers.setInterval as never,
      clearInterval: timers.clearInterval as never,
    });
    reporter.onInit({ config: { root: '/pkg' } } as never);
    reporter.onTestRunStart([]);
    reporter.onTestModuleStart(testModule('/pkg/test/a.test.ts', 'passed', 0));

    now = 75_000;
    timers.tick();
    expect(output).toEqual(['[ci-progress] start test/a.test.ts\n']);

    for (now = 90_000; now <= 180_000; now += 15_000) timers.tick();

    expect(output).toEqual([
      '[ci-progress] start test/a.test.ts\n',
      '[ci-progress] stalled test/a.test.ts no progress for 90s\n',
      '[ci-progress] stalled test/a.test.ts no progress for 180s\n',
    ]);
  });

  it('resets the watchdog when a test case reports progress', () => {
    let now = 0;
    const timers = manualTimers();
    const output: string[] = [];
    const module = testModule('/pkg/test/a.test.ts', 'passed', 0);
    const reporter = new CiProgressReporter({
      write: (line) => output.push(line),
      now: () => now,
      setInterval: timers.setInterval as never,
      clearInterval: timers.clearInterval as never,
    });
    reporter.onInit({ config: { root: '/pkg' } } as never);
    reporter.onTestRunStart([]);
    reporter.onTestModuleStart(module);

    for (now = 60_000; now <= 300_000; now += 60_000) {
      reporter.onTestCaseResult({ ...testCase('passes', 'passed'), module } as TestCase);
      timers.tick();
    }

    expect(output).toEqual(['[ci-progress] start test/a.test.ts\n']);
  });

  it('stops watching a completed module and clears the run watchdog', () => {
    let now = 0;
    const timers = manualTimers();
    const output: string[] = [];
    const module = testModule('/pkg/test/a.test.ts', 'passed', 0);
    const reporter = new CiProgressReporter({
      write: (line) => output.push(line),
      now: () => now,
      setInterval: timers.setInterval as never,
      clearInterval: timers.clearInterval as never,
    });
    reporter.onInit({ config: { root: '/pkg' } } as never);
    reporter.onTestRunStart([]);
    const handle = timers.handle;
    reporter.onTestModuleStart(module);
    now = 90_000;
    timers.tick();
    reporter.onTestModuleEnd(module);
    now = 105_000;
    timers.tick();
    reporter.onTestRunEnd([], [], 'passed');
    now = 180_000;
    timers.tick();

    expect({ output, cleared: timers.cleared, unrefCalls: timers.unrefCalls }).toEqual({
      output: [
        '[ci-progress] start test/a.test.ts\n',
        '[ci-progress] stalled test/a.test.ts no progress for 90s\n',
        '[ci-progress] done test/a.test.ts passed 0.0s\n',
      ],
      cleared: [handle],
      unrefCalls: 1,
    });
  });
});
