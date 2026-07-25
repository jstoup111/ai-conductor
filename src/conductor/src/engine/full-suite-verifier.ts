import { loadConfig } from './config.js';
import {
  FULL_SUITE_EVIDENCE_VERSION,
  readFullSuiteEvidence,
  sanitizeFullSuiteDiagnosticOutput,
  writeFullSuiteEvidence,
  type FullSuiteEvidenceUnusableReason,
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
  type FullSuiteExecutionResult,
} from './full-suite-executor.js';
import type { TestSuiteConfig } from '../types/config.js';

export type FullSuiteVerifierResult =
  | { status: 'EXECUTED'; evidence: FullSuitePassEvidence }
  | { status: 'REUSED'; evidence: FullSuitePassEvidence }
  | { status: 'FAILED'; reason: FullSuiteFailureReason; message: string };

export type FullSuiteInspectionResult =
  | { status: 'CURRENT'; evidence: FullSuitePassEvidence }
  | {
      status: 'STALE';
      reason: FullSuiteEvidenceUnusableReason | 'fingerprint_mismatch';
    }
  | { status: 'FAILED'; reason: FullSuiteFailureReason; message: string };

export interface FullSuiteVerifierOptions {
  projectRoot: string;
  environment?: NodeJS.ProcessEnv;
  fingerprint?: (
    options: FullSuiteFingerprintOptions,
  ) => Promise<FullSuiteFingerprintResult>;
  execute?: (options: ExecuteFullSuiteOptions) => Promise<FullSuiteExecutionResult>;
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
      const secretValues = declaredEnvironmentValues(testSuite, environment);
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
      await writeFullSuiteEvidence(projectRoot, evidence, secretValues);
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

  private async resolveInspection(): Promise<ResolvedInspection> {
    const {
      projectRoot,
      environment = process.env,
      fingerprint = fingerprintFullSuiteInputs,
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
      const persisted = await readFullSuiteEvidence(projectRoot);
      if (!persisted.usable) {
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

function declaredEnvironmentValues(
  testSuite: TestSuiteConfig,
  environment: NodeJS.ProcessEnv,
): string[] {
  return (testSuite.environment ?? [])
    .map((name) => environment[name])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}
