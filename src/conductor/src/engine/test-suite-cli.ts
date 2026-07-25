import {
  FullSuiteVerifier,
  type FullSuiteVerifierResult,
} from './full-suite-verifier.js';
import type { FullSuiteFailureReason } from './full-suite-evidence.js';

export type TestSuiteDispatch = { kind: 'run' } | { kind: 'guide' };

const FAILURE_GUIDANCE: Record<FullSuiteFailureReason, string> = {
  missing_config: 'Declare test_suite.command in .ai-conductor/config.yml.',
  invalid_config: 'Fix the test_suite block in .ai-conductor/config.yml.',
  invalid_input: 'Fix the declared test-suite inputs.',
  unlaunchable: 'Make the declared aggregate command launchable.',
  timeout: 'Fix the suite timeout or the command that exceeded it.',
  signal: 'Fix the suite process termination.',
  nonzero_exit: 'Fix the aggregate suite failures.',
  preflight_failed: 'Fix the full-suite preflight failure.',
  internal_error: 'Fix the full-suite verifier failure.',
};

export function detectTestSuiteCommand(argv: string[]): TestSuiteDispatch | null {
  if (argv[2] !== 'test-suite') return null;
  return argv.length === 3 ? { kind: 'run' } : { kind: 'guide' };
}

export interface TestSuiteDispatchDependencies {
  projectRoot?: string;
  verifier?: { ensure: () => Promise<FullSuiteVerifierResult> };
  print?: (message: string) => void;
}

export async function dispatchTestSuiteCommand(
  command: TestSuiteDispatch,
  dependencies: TestSuiteDispatchDependencies = {},
): Promise<number> {
  const print = async (message: string, failed: boolean): Promise<void> => {
    if (dependencies.print !== undefined) {
      dependencies.print(message);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const stream = failed ? process.stderr : process.stdout;
      stream.write(`${message}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  };

  if (command.kind === 'guide') {
    await print(
      'Usage: conduct-ts test-suite\n' +
        'Remove extra arguments and rerun. If verification blocks, return to /tdd or /pipeline before SHIP.',
      true,
    );
    return 1;
  }

  const projectRoot = dependencies.projectRoot ?? process.cwd();
  const verifier = dependencies.verifier ?? new FullSuiteVerifier({ projectRoot });
  const result = await verifier.ensure();
  if (result.status === 'FAILED') {
    const freshness = result.freshness === undefined
      ? ''
      : ` freshness=${result.freshness.reason}`;
    await print(
      `FAILED: full test suite evidence=${result.reason}${freshness}. ` +
        `${FAILURE_GUIDANCE[result.reason]} ` +
        'Return to /tdd or /pipeline, fix the failure, then rerun conduct-ts test-suite.',
      true,
    );
    return 1;
  }

  const evidence = result.evidence;
  const message =
    `${result.status}: full test suite PASS ` +
    `(fingerprint ${evidence.fingerprint}, duration ${evidence.durationMs}ms)`;
  await print(message, false);
  return 0;
}
