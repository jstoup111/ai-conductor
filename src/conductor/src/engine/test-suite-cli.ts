import {
  FullSuiteVerifier,
  type FullSuiteVerifierResult,
} from './full-suite-verifier.js';

export type TestSuiteDispatch = { kind: 'run' };

export function detectTestSuiteCommand(argv: string[]): TestSuiteDispatch | null {
  return argv[2] === 'test-suite' ? { kind: 'run' } : null;
}

export interface TestSuiteDispatchDependencies {
  projectRoot?: string;
  verifier?: { ensure: () => Promise<FullSuiteVerifierResult> };
  print?: (message: string) => void;
}

export async function dispatchTestSuiteCommand(
  _command: TestSuiteDispatch,
  dependencies: TestSuiteDispatchDependencies = {},
): Promise<number> {
  const projectRoot = dependencies.projectRoot ?? process.cwd();
  const verifier = dependencies.verifier ?? new FullSuiteVerifier({ projectRoot });
  const result = await verifier.ensure();
  if (result.status !== 'EXECUTED' && result.status !== 'REUSED') return 1;

  const evidence = result.evidence;
  const message =
    `${result.status}: full test suite PASS ` +
    `(fingerprint ${evidence.fingerprint}, duration ${evidence.durationMs}ms)`;
  if (dependencies.print !== undefined) {
    dependencies.print(message);
  } else {
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(`${message}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  return 0;
}
