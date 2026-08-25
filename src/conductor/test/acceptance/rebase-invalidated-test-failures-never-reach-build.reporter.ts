import type { TestModule } from 'vitest/node';
import type { Reporter } from 'vitest/reporters';
import { collectReporterTestResults, firstReporterError } from './reporter-test-results.js';

const RATIONALE =
  'The failing assertions exercise missing durable base-advance attribution, gate-agnostic repair recording, and grading provenance required by #1535.';

export default class AcceptanceRedReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>, errors: ReadonlyArray<unknown>): void {
    const { failed, passed, skipped } = collectReporterTestResults(testModules);
    const failingTests = failed.map((test) => ({
      name: test.name,
      reason: firstReporterError(test) ?? 'acceptance assertion failed',
    }));
    process.stdout.write(`ACCEPTANCE_RED_EVIDENCE: ${JSON.stringify({
      executed: passed.length + failed.length,
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      errors: errors.length,
      failingTests,
      intentRationale: RATIONALE,
    })}\n`);
  }
}
