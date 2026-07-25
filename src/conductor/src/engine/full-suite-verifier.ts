import { loadConfig } from './config.js';
import {
  FULL_SUITE_EVIDENCE_VERSION,
  readFullSuiteEvidence,
  sanitizeFullSuiteDiagnosticOutput,
  writeFullSuiteEvidence,
  type FullSuiteEvidenceUnusableReason,
  type FullSuiteFailEvidence,
  type FullSuiteFailureReason,
  type FullSuitePassEvidence,
} from './full-suite-evidence.js';
import {
  fingerprintFullSuiteInputs,
  type FullSuiteFingerprint,
  type FullSuiteFingerprintOptions,
  type FullSuiteFingerprintResult,
} from './full-suite-fingerprint.js';
import {
  executeFullSuite,
  type ExecuteFullSuiteOptions,
  type FullSuiteExecutionFailure,
  type FullSuiteExecutionResult,
} from './full-suite-executor.js';
import type { TestSuiteConfig } from '../types/config.js';

export type FullSuiteStaleReason =
  | Exclude<FullSuiteEvidenceUnusableReason, 'io_error'>
  | 'fingerprint_mismatch';

export interface FullSuiteStaleInspection {
  status: 'STALE';
  reason: FullSuiteStaleReason;
}

export type FullSuiteVerifierResult =
  | {
      status: 'EXECUTED';
      freshness: FullSuiteStaleInspection;
      evidence: FullSuitePassEvidence;
    }
  | { status: 'REUSED'; evidence: FullSuitePassEvidence }
  | {
      status: 'FAILED';
      reason: FullSuiteFailureReason;
      message: string;
      freshness?: FullSuiteStaleInspection;
      evidence?: FullSuiteFailEvidence;
    };

export type FullSuiteInspectionResult =
  | { status: 'CURRENT'; evidence: FullSuitePassEvidence }
  | FullSuiteStaleInspection
  | { status: 'FAILED'; reason: FullSuiteFailureReason; message: string };

export interface FullSuiteVerifierOptions {
  projectRoot: string;
  environment?: NodeJS.ProcessEnv;
  fingerprint?: (
    options: FullSuiteFingerprintOptions,
  ) => Promise<FullSuiteFingerprintResult>;
  execute?: (options: ExecuteFullSuiteOptions) => Promise<FullSuiteExecutionResult>;
  /** Test seam; production callers use the centralized evidence reader. */
  readEvidence?: typeof readFullSuiteEvidence;
  /** Test seam; production callers use the centralized atomic evidence writer. */
  writeEvidence?: typeof writeFullSuiteEvidence;
}

interface FullSuiteVerificationContext {
  testSuite: TestSuiteConfig;
  fingerprint: FullSuiteFingerprint;
}

type ResolvedInspection =
  | {
      inspection: Extract<FullSuiteInspectionResult, { status: 'CURRENT' | 'STALE' }>;
      context: FullSuiteVerificationContext;
    }
  | { inspection: Extract<FullSuiteInspectionResult, { status: 'FAILED' }> };

export class FullSuiteVerifier {
  constructor(private readonly options: FullSuiteVerifierOptions) {}

  async inspect(): Promise<FullSuiteInspectionResult> {
    return (await this.resolveInspection()).inspection;
  }

  async ensure(): Promise<FullSuiteVerifierResult> {
    const {
      projectRoot,
      environment = process.env,
      execute = executeFullSuite,
      readEvidence = readFullSuiteEvidence,
      writeEvidence = writeFullSuiteEvidence,
    } = this.options;

    try {
      const resolved = await this.resolveInspection();
      if (!('context' in resolved)) {
        return resolved.inspection;
      }
      if (resolved.inspection.status === 'CURRENT') {
        return { status: 'REUSED', evidence: resolved.inspection.evidence };
      }

      const { testSuite, fingerprint } = resolved.context;
      const freshness = resolved.inspection;
      const secretValues = declaredEnvironmentValues(testSuite, environment);
      const execution = await execute({ projectRoot, testSuite, environment });
      if (!execution.ok) {
        const evidence = buildFailEvidence(fingerprint, execution);
        try {
          await writeEvidence(projectRoot, evidence, secretValues);
        } catch {
          return {
            status: 'FAILED',
            reason: 'internal_error',
            message: 'Unable to persist full-suite FAIL evidence',
            freshness,
          };
        }
        let persisted;
        try {
          persisted = await readEvidence(projectRoot);
        } catch {
          return {
            status: 'FAILED',
            reason: 'internal_error',
            message: 'Unable to read persisted full-suite FAIL evidence',
            freshness,
          };
        }
        if (
          persisted.usable ||
          persisted.reason !== 'not_pass' ||
          persisted.evidence === undefined
        ) {
          return {
            status: 'FAILED',
            reason: 'internal_error',
            message: 'Persisted FAIL evidence is unavailable',
            freshness,
          };
        }
        return {
          status: 'FAILED',
          reason: execution.reason,
          message: sanitizeFullSuiteDiagnosticOutput(
            execution.stderr || execution.stdout || 'Full test suite failed',
            secretValues,
          ),
          freshness,
          evidence: persisted.evidence,
        };
      }

      const evidence: FullSuitePassEvidence = {
        version: FULL_SUITE_EVIDENCE_VERSION,
        outcome: 'PASS',
        reason: 'exit_zero',
        fingerprint: fingerprint.digest,
        provenanceHeadSha: fingerprint.headSha,
        command: execution.command,
        workingDirectory: execution.cwd,
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
        durationMs: execution.durationMs,
        exitCode: execution.exitCode,
        stdout: execution.stdout,
        stderr: execution.stderr,
      };
      try {
        await writeEvidence(projectRoot, evidence, secretValues);
      } catch {
        return {
          status: 'FAILED',
          reason: 'internal_error',
          message: 'Unable to persist full-suite PASS evidence',
          freshness,
        };
      }
      let persisted;
      try {
        persisted = await readEvidence(projectRoot);
      } catch {
        return {
          status: 'FAILED',
          reason: 'internal_error',
          message: 'Unable to read persisted full-suite PASS evidence',
          freshness,
        };
      }
      if (!persisted.usable) {
        return {
          status: 'FAILED',
          reason: 'internal_error',
          message: `Persisted PASS evidence is unavailable: ${persisted.reason}`,
          freshness,
        };
      }
      return { status: 'EXECUTED', freshness, evidence: persisted.evidence };
    } catch {
      return {
        status: 'FAILED',
        reason: 'internal_error',
        message: 'Full-suite verification failed',
      };
    }
  }

  private async resolveInspection(): Promise<ResolvedInspection> {
    const {
      projectRoot,
      environment = process.env,
      fingerprint = fingerprintFullSuiteInputs,
      readEvidence = readFullSuiteEvidence,
    } = this.options;

    try {
      const config = await loadConfig(projectRoot);
      if (!config.ok) {
        return {
          inspection: {
            status: 'FAILED',
            reason: config.error.type === 'missing' ? 'missing_config' : 'invalid_config',
            message: config.error.message,
          },
        };
      }
      if (config.config.test_suite === undefined) {
        return {
          inspection: {
            status: 'FAILED',
            reason: 'missing_config',
            message: 'Project config must declare test_suite',
          },
        };
      }
      const testSuite = config.config.test_suite;
      const fingerprintResult = await fingerprint({
        projectRoot,
        testSuite,
        environmentValues: environment,
      });
      if (!fingerprintResult.ok) {
        return {
          inspection: {
            status: 'FAILED',
            reason: fingerprintResult.reason.code === 'invalid_input'
              ? 'invalid_input'
              : 'preflight_failed',
            message: fingerprintResult.reason.message,
          },
        };
      }

      const context = { testSuite, fingerprint: fingerprintResult.fingerprint };
      const persisted = await readEvidence(projectRoot);
      if (!persisted.usable) {
        if (persisted.reason === 'io_error') {
          return {
            inspection: {
              status: 'FAILED',
              reason: 'internal_error',
              message: 'Unable to read full-suite evidence',
            },
          };
        }
        return {
          inspection: { status: 'STALE', reason: persisted.reason },
          context,
        };
      }
      if (persisted.evidence.fingerprint !== fingerprintResult.fingerprint.digest) {
        return {
          inspection: { status: 'STALE', reason: 'fingerprint_mismatch' },
          context,
        };
      }
      return {
        inspection: { status: 'CURRENT', evidence: persisted.evidence },
        context,
      };
    } catch {
      return {
        inspection: {
          status: 'FAILED',
          reason: 'internal_error',
          message: 'Full-suite verification failed',
        },
      };
    }
  }
}

function buildFailEvidence(
  fingerprint: FullSuiteFingerprint,
  execution: FullSuiteExecutionFailure,
): FullSuiteFailEvidence {
  const common = {
    version: FULL_SUITE_EVIDENCE_VERSION,
    outcome: 'FAIL' as const,
    fingerprint: fingerprint.digest,
    provenanceHeadSha: fingerprint.headSha,
    command: execution.command,
    workingDirectory: execution.cwd,
    startedAt: execution.startedAt,
    endedAt: execution.endedAt,
    durationMs: execution.durationMs,
    stdout: execution.stdout,
    stderr: execution.stderr,
  };
  if (execution.reason === 'signal') {
    return {
      ...common,
      reason: execution.reason,
      exitCode: execution.exitCode,
      signal: execution.signal,
    };
  }
  return {
    ...common,
    reason: execution.reason,
    exitCode: execution.exitCode,
    signal: execution.signal,
  };
}

function declaredEnvironmentValues(
  testSuite: TestSuiteConfig,
  environment: NodeJS.ProcessEnv,
): string[] {
  return (testSuite.environment ?? [])
    .map((name) => environment[name])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}
