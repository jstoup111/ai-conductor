import type { TestModule } from 'vitest/node';
import type { Reporter } from 'vitest/reporters';

import { collectReporterTestResults, firstReporterError } from './reporter-test-results.js';

const INTENT_RATIONALE =
  'BUILD verification still emits a retired fan-out topology instead of running test_suite serially before build_review.';

export default class HardDeleteWiringCheckReporter implements Reporter {
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
        reason: firstReporterError(test) ?? 'acceptance assertion failed',
      })),
      intentRationale: INTENT_RATIONALE,
    })}\n`);
  }
}
