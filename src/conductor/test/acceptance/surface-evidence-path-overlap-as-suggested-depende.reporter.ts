import type { TestModule } from 'vitest/node';
import type { Reporter } from 'vitest/reporters';

import { collectReporterTestResults, firstReporterError } from './reporter-test-results.js';

const INTENT_RATIONALE =
  'The failing CLI flow proves an undecided evidence-path overlap is not yet refused before issue creation and cannot yet be completed by an explicit decline.';

export default class IntakeOverlapAcceptanceReporter implements Reporter {
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
