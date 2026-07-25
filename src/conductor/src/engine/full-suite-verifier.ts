import { loadConfig } from './config.js';
import {
  FULL_SUITE_EVIDENCE_VERSION,
  readFullSuiteEvidence,
  sanitizeFullSuiteDiagnosticOutput,
  writeFullSuiteEvidence,
  type FullSuiteFailureReason,
  type FullSuitePassEvidence,
} from './full-suite-evidence.js';
import {
  fingerprintFullSuiteInputs,
  type FullSuiteFingerprintOptions,
  type FullSuiteFingerprintResult,
} from './full-suite-fingerprint.js';
import {
  executeFullSuite,
  type ExecuteFullSuiteOptions,
  type FullSuiteExecutionResult,
} from './full-suite-executor.js';
import type { TestSuiteConfig } from '../types/config.js';

export type FullSuiteVerifierResult =
  | { status: 'EXECUTED'; evidence: FullSuitePassEvidence }
  | { status: 'FAILED'; reason: FullSuiteFailureReason; message: string };

export interface FullSuiteVerifierOptions {
  projectRoot: string;
  environment?: NodeJS.ProcessEnv;
  fingerprint?: (
    options: FullSuiteFingerprintOptions,
  ) => Promise<FullSuiteFingerprintResult>;
  execute?: (options: ExecuteFullSuiteOptions) => Promise<FullSuiteExecutionResult>;
}

export class FullSuiteVerifier {
  constructor(private readonly options: FullSuiteVerifierOptions) {}

  async ensure(): Promise<FullSuiteVerifierResult> {
    const {
      projectRoot,
      environment = process.env,
      fingerprint = fingerprintFullSuiteInputs,
      execute = executeFullSuite,
    } = this.options;

    try {
      const config = await loadConfig(projectRoot);
      if (!config.ok) {
        return {
          status: 'FAILED',
          reason: config.error.type === 'missing' ? 'missing_config' : 'invalid_config',
          message: config.error.message,
        };
      }
      if (config.config.test_suite === undefined) {
        return {
          status: 'FAILED',
          reason: 'missing_config',
          message: 'Project config must declare test_suite',
        };
      }
      const testSuite = config.config.test_suite;
      const secretValues = declaredEnvironmentValues(testSuite, environment);
      const fingerprintResult = await fingerprint({
        projectRoot,
        testSuite,
        environmentValues: environment,
      });
      if (!fingerprintResult.ok) {
        return {
          status: 'FAILED',
          reason: fingerprintResult.reason.code === 'invalid_input'
            ? 'invalid_input'
            : 'preflight_failed',
          message: fingerprintResult.reason.message,
        };
      }

      const execution = await execute({ projectRoot, testSuite, environment });
      if (!execution.ok) {
        return {
          status: 'FAILED',
          reason: execution.reason,
          message: sanitizeFullSuiteDiagnosticOutput(
            execution.stderr || execution.stdout || 'Full test suite failed',
            secretValues,
          ),
        };
      }

      const evidence: FullSuitePassEvidence = {
        version: FULL_SUITE_EVIDENCE_VERSION,
        outcome: 'PASS',
        reason: 'exit_zero',
        fingerprint: fingerprintResult.fingerprint.digest,
        provenanceHeadSha: fingerprintResult.fingerprint.headSha,
        command: execution.command,
        workingDirectory: execution.cwd,
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
        durationMs: execution.durationMs,
        exitCode: execution.exitCode,
        stdout: execution.stdout,
        stderr: execution.stderr,
      };
      await writeFullSuiteEvidence(
        projectRoot,
        evidence,
        secretValues,
      );
      const persisted = await readFullSuiteEvidence(projectRoot);
      if (!persisted.usable) {
        return {
          status: 'FAILED',
          reason: 'internal_error',
          message: `Persisted PASS evidence is unavailable: ${persisted.reason}`,
        };
      }
      return { status: 'EXECUTED', evidence: persisted.evidence };
    } catch {
      return {
        status: 'FAILED',
        reason: 'internal_error',
        message: 'Full-suite verification failed',
      };
    }
  }
}

function declaredEnvironmentValues(
  testSuite: TestSuiteConfig,
  environment: NodeJS.ProcessEnv,
): string[] {
  return (testSuite.environment ?? [])
    .map((name) => environment[name])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}
