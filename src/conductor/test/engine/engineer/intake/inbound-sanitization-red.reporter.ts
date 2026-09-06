import type { Reporter, TestCase, TestModule } from 'vitest/node';

export default class InboundSanitizationRedReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>, errors: ReadonlyArray<unknown>): void {
    const tests: TestCase[] = [];
    for (const testModule of testModules) tests.push(...testModule.children.allTests());
    const passed = tests.filter((test) => test.result().state === 'passed');
    const failed = tests.filter((test) => test.result().state === 'failed');
    const skipped = tests.filter((test) => test.result().state === 'skipped');
    const evidence = {
      executed: passed.length + failed.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      errors: errors.length,
      failingTests: failed.map((test) => ({
        name: test.name,
        reason: test.result().errors?.[0]?.message?.split('\n')[0] ?? 'acceptance assertion failed',
      })),
      intentRationale:
        'The failures show that raw GitHub issue text still reaches staged intake outcomes or that an issue without a Desired outcome section still creates an outcomes file.',
    };
    process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify(evidence)}\n`);
  }
}
