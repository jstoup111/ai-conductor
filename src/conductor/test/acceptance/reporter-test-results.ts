import type { TestCase, TestModule } from 'vitest/node';

export interface ReporterTestResults {
  failed: TestCase[];
  passed: TestCase[];
  skipped: TestCase[];
}

export function collectReporterTestResults(
  testModules: ReadonlyArray<TestModule>,
): ReporterTestResults {
  const tests = testModules.flatMap((testModule) => [
    ...testModule.children.allTests(),
  ]);

  return {
    failed: tests.filter((test) => test.result().state === 'failed'),
    passed: tests.filter((test) => test.result().state === 'passed'),
    skipped: tests.filter((test) =>
      test.result().state === 'skipped'
      || test.options.mode === 'skip'
      || test.options.mode === 'todo'),
  };
}

export function firstReporterError(test: TestCase): string | undefined {
  const result = test.result();
  return result.state === 'failed'
    ? result.errors[0]?.message?.split('\n')[0]
    : undefined;
}
