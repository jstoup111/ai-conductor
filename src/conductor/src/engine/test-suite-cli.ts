import {
  FullSuiteVerifier,
  type FullSuiteInspectionResult,
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
  verifier?: Pick<FullSuiteVerifier, 'inspect' | 'ensure' | 'recordPreservation'>;
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
      'Usage: ai-conductor test-suite\n' +
        'Remove extra arguments and rerun. If verification blocks, return to /tdd or /pipeline before SHIP.',
      true,
    );
    return 1;
  }

  const projectRoot = dependencies.projectRoot ?? process.cwd();
  const verifier = dependencies.verifier ?? new FullSuiteVerifier({ projectRoot });
  // adr-2026-08-28 D4: the drift budget is cumulative against the attested
  // PASS, and the ledger append is what makes it cumulative — so every caller
  // that ACTS on a preservation records it exactly once, through the
  // caller-owned seam. `ensure()` returns REUSED for both CURRENT and
  // PRESERVED_WITHIN_BUDGET and writes nothing, so resolve the inspection
  // here, hand that same result to `ensure()`, and record from it. One
  // inspection only: a second would observe the first one's write and report
  // CURRENT, losing the basis it was called to obtain.
  const inspection: FullSuiteInspectionResult = await verifier.inspect();
  const result = await verifier.ensure(inspection);
  if (inspection.status === 'PRESERVED_WITHIN_BUDGET') {
    await verifier.recordPreservation(inspection);
  }
  if (result.status === 'FAILED') {
    const freshness = result.freshness === undefined
      ? ''
      : ` freshness=${result.freshness.reason}`;
    await print(
      `FAILED: full test suite evidence=${result.reason}${freshness}. ` +
        `${FAILURE_GUIDANCE[result.reason]} ` +
        'Return to /tdd or /pipeline, fix the failure, then rerun ai-conductor test-suite.',
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
