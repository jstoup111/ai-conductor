import type { TestModule } from 'vitest/node';
import type { Reporter } from 'vitest/reporters';

import {
  collectReporterTestResults,
  firstReporterError,
} from './reporter-test-results.js';

const INTENT_RATIONALE =
  'The setup success marker and marker gate are not implemented, so redispatch and triage verification cannot yet prove marker-valid skips or forced setup execution.';

export default class SetupOncePerWorktreeReporter implements Reporter {
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
        reason: firstReporterError(test) ?? 'marker-gated setup acceptance assertion failed',
      })),
      intentRationale: INTENT_RATIONALE,
    })}\n`);
  }
}
