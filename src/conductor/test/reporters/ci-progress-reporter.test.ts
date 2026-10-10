// Covers: task:1
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
});
