import type { Reporter, TestCase, TestModule } from 'vitest/node';
import type { SerializedError } from '@vitest/utils';

const INTENT_RATIONALE =
  'The failure shows that the engine does not yet route a documented NC.1 no-owner OVER_SCOPE finding into the operator decision lifecycle.';

export default class PrdAuditNoOwnerOverScopeReporter implements Reporter {
  onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    unhandledErrors: ReadonlyArray<SerializedError>,
  ): void {
    const tests: TestCase[] = [];
    for (const testModule of testModules) tests.push(...testModule.children.allTests());

    const passed = tests.filter((test) => test.result().state === 'passed');
    const failed = tests.filter((test) => test.result().state === 'failed');
    const skipped = tests.filter((test) => test.result().state === 'skipped');

    process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify({
      executed: passed.length + failed.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      errors: unhandledErrors.length,
      failingTests: failed.map((test) => ({
        name: test.name,
        reason:
          test.result().errors?.[0]?.message?.split('\n')[0] ??
          'the NC no-owner finding did not complete its decision lifecycle',
      })),
      intentRationale: INTENT_RATIONALE,
    })}\n`);
  }
}
