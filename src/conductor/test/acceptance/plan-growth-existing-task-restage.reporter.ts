import type { TestModule } from 'vitest/node';
import type { Reporter } from 'vitest/reporters';
import { collectReporterTestResults, firstReporterError } from './reporter-test-results.js';

const INTENT_RATIONALE =
  'Historical completion evidence still suppresses an explicitly reopened owner, so the real remediation route cannot dispatch the current repair to BUILD.';

export default class ExistingTaskRestageReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>, errors: ReadonlyArray<unknown>): void {
    const { failed, passed, skipped } = collectReporterTestResults(testModules);
    process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify({
      executed: passed.length + failed.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      errors: errors.length,
      failingTests: failed.map((test) => ({
        name: test.name,
        reason: firstReporterError(test) ?? 'the existing-task remediation route did not dispatch BUILD',
      })),
      intentRationale: INTENT_RATIONALE,
    })}\n`);
  }
}
