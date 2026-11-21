import { executeFullSuite, type ExecuteFullSuiteOptions } from './full-suite-executor.js';
import type { TestSuiteConfig } from '../types/config.js';

/**
 * BUILD's configured pre-check (adr-2026-08-01-engine-owned-scoped-test-invocation D11).
 *
 * `test_suite.pre_check` is a bounded static check BUILD runs before it hands
 * off. It reuses the aggregate command executor but is never aggregate proof:
 * it writes no evidence and never satisfies the `test_suite` gate.
 */
export const BUILD_PRE_CHECK_FAILED_PREFIX = 'test_suite pre-check failed:';

const OUTPUT_TAIL_LINES = 40;

function outputTail(stdout: string, stderr: string): string {
  const lines = `${stdout}\n${stderr}`.split('\n').filter((line) => line.trim() !== '');
  return lines.slice(-OUTPUT_TAIL_LINES).join('\n');
}

/**
 * The BUILD completion miss for a failing pre-check, or `null` when no
 * pre-check is configured or every entry exits zero.
 */
export async function runBuildPreCheck(
  projectRoot: string,
  testSuite: TestSuiteConfig | undefined,
  runner?: ExecuteFullSuiteOptions['runner'],
): Promise<string | null> {
  const preCheck = testSuite?.pre_check;
  if (preCheck === undefined || preCheck.length === 0) return null;
  const result = await executeFullSuite({
    projectRoot,
    testSuite: {
      commands: preCheck,
      working_directory: testSuite?.working_directory,
      timeout_seconds: testSuite?.timeout_seconds,
    },
    ...(runner === undefined ? {} : { runner }),
  });
  if (result.ok) return null;
  return (
    `${BUILD_PRE_CHECK_FAILED_PREFIX} \`${result.command}\` (${result.cwd}) ${result.reason}; output tail:\n` +
    outputTail(result.stdout, result.stderr)
  );
}
