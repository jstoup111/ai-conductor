import type { Reporter, TestCase, TestModule } from 'vitest/node';
import type { SerializedError } from '@vitest/utils';

const INTENT_RATIONALE =
  'The real halt path does not yet commit and push a branch-readable halt record, so a separate clone cannot read the operator pickup artifact.';

export default class HaltRecordPickupReporter implements Reporter {
  // vitest 4 replaced `onFinished(files, errors)` with
  // `onTestRunEnd(testModules, unhandledErrors, reason)` and moved the task
  // tree behind `module.children`, so the hand-rolled recursive walk is gone:
  // `allTests()` already yields every test case transitively. State also moved
  // from `task.result?.state` / `task.mode` to a single `test.result().state`,
  // where `skipped` covers both skip and todo.
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
          'the branch-readable halt record is not implemented',
      })),
      intentRationale: INTENT_RATIONALE,
    })}\n`);
  }
}
