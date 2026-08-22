import type { TestModule } from 'vitest/node';
import type { Reporter } from 'vitest/reporters';
import { collectReporterTestResults, firstReporterError } from './reporter-test-results.js';

const INTENT_RATIONALE =
  'The real conduct-ts command does not yet rewind persisted feature state, so a daemon-style resume cannot dispatch test_suite before build_review without operator repair.';

export default class RewindRecoveryReporter implements Reporter {
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
        reason: test.name.includes('rewinds a halted feature')
          ? 'conduct-ts rewind exited non-zero because the public rewind command is not implemented'
          : firstReporterError(test) ?? 'acceptance assertion failed',
      })),
      intentRationale: INTENT_RATIONALE,
    })}\n`);
  }
}
