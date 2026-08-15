import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
  FULL_SUITE_FINGERPRINT_CATEGORIES,
  fingerprintFullSuiteInputs,
  type FullSuiteFingerprintCategory,
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
import { worktreeStatus } from './worktree-shared.js';
import type { AggregateTestSuiteConfig, TestSuiteConfig } from '../types/config.js';

export type FullSuiteStaleReason =
  | Exclude<FullSuiteEvidenceUnusableReason, 'io_error'>
  | 'fingerprint_mismatch'
  | 'additional_inputs_changed'
  | 'dependencies_changed'
  | 'environment_changed'
  | 'migrations_changed'
  | 'multiple_categories_changed'
  | 'project_config_changed'
  | 'source_changed'
  | 'test_infrastructure_changed'
  | 'tests_changed';

export interface FullSuiteStaleInspection {
  status: 'STALE';
  reason: FullSuiteStaleReason;
  changedCategories?: FullSuiteFingerprintCategory[];
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
  /** Test seam for bounded lock timing and liveness probes. */
  lock?: FullSuiteLockOptions;
}

export interface FullSuiteLockOptions {
  waitTimeoutMs?: number;
  retryDelayMs?: number;
  maximumRetryDelayMs?: number;
  unownedStaleMs?: number;
  clock?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  processIsLive?: (pid: number) => boolean;
  /**
   * Stronger than signal-0: proves that a live PID is the process instance
   * which wrote this lock. Returning false permits stale-lock recovery;
   * unknown identity must return true and keep the lock occupied.
   */
  processOwnsRecordedLock?: (owner: FullSuiteLockOwner) => boolean | Promise<boolean>;
}

interface FullSuiteVerificationContext {
  testSuite: AggregateTestSuiteConfig;
  fingerprint: FullSuiteFingerprint;
  worktreeClean?: boolean;
}

type FullSuiteInspectionFailure = Extract<FullSuiteInspectionResult, { status: 'FAILED' }> & {
  reason:
    | 'missing_config'
    | 'invalid_config'
    | 'invalid_input'
    | 'preflight_failed'
    | 'internal_error';
};

type ResolvedInspection =
  | {
      inspection: Extract<FullSuiteInspectionResult, { status: 'CURRENT' | 'STALE' }>;
      context: FullSuiteVerificationContext;
    }
  | {
      inspection: FullSuiteInspectionFailure;
      testSuite?: TestSuiteConfig;
    };

interface FullSuiteLockOwner {
  version: 1;
  pid: number;
  token: string;
  acquiredAt: string;
  /** Linux `/proc/<pid>` creation timestamp identity when available. */
  processStartToken?: string;
}

interface FullSuiteLockRecoveryClaim {
  version: 1;
  pid: number;
  token: string;
  claimedAt: string;
}

interface FullSuiteLockHandle {
  release: () => Promise<{ ok: true } | { ok: false; message: string }>;
}

type FullSuiteLockAcquireResult =
  | { ok: true; handle: FullSuiteLockHandle }
  | { ok: false; message: string };

const FULL_SUITE_LOCK_DIRECTORY = 'test-suite.lock';
const FULL_SUITE_LOCK_OWNER = 'owner.json';
const FULL_SUITE_LOCK_RECOVERY_CLAIM = 'recovery.json';
const DEFAULT_LOCK_WAIT_MS = 30_000;
const DEFAULT_LOCK_RETRY_MS = 25;
const DEFAULT_LOCK_MAXIMUM_RETRY_MS = 250;
const DEFAULT_UNOWNED_STALE_MS = 5 * 60_000;

function lockErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'unknown filesystem error';
}

function isLockOwner(value: unknown): value is FullSuiteLockOwner {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 &&
    Number.isInteger(record.pid) &&
    (record.pid as number) > 0 &&
    typeof record.token === 'string' &&
    record.token.length > 0 &&
    typeof record.acquiredAt === 'string' &&
    !Number.isNaN(Date.parse(record.acquiredAt)) &&
    (record.processStartToken === undefined ||
      (typeof record.processStartToken === 'string' && record.processStartToken.length > 0));
}

function parseLockOwner(serialized: string | null): FullSuiteLockOwner | null {
  if (serialized === null) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isLockOwner(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function defaultProcessIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

interface ProcessStartIdentity {
  startedAt: number;
  token: string;
}

type ProcessStartIdentityProbe =
  | { status: 'FOUND'; identity: ProcessStartIdentity }
  | { status: 'MISSING' }
  | { status: 'UNKNOWN' };

async function processStartIdentity(pid: number): Promise<ProcessStartIdentityProbe> {
  try {
    // `/proc` is deliberately an optional strengthening probe. Platforms
    // without it retain signal-0's conservative occupied result.
    const processStat = await stat(`/proc/${pid}`, { bigint: true });
    return {
      status: 'FOUND',
      identity: {
        startedAt: Number(processStat.ctimeNs / 1_000_000n),
        token: processStat.ctimeNs.toString(),
      },
    };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { status: 'MISSING' }
      : { status: 'UNKNOWN' };
  }
}

async function defaultProcessOwnsRecordedLock(owner: FullSuiteLockOwner): Promise<boolean> {
  const observed = await processStartIdentity(owner.pid);
  if (observed.status === 'MISSING') {
    // An owner which vanished after signal-0 cannot still own the lock.
    return false;
  }
  if (observed.status === 'UNKNOWN') return true;
  const { identity: observedIdentity } = observed;
  if (owner.processStartToken !== undefined) {
    return observedIdentity.token === owner.processStartToken;
  }
  // Legacy owner records lack an instance token. A process born after the
  // lock was acquired is nevertheless a conclusive PID-reuse mismatch.
  return observedIdentity.startedAt <= Date.parse(owner.acquiredAt);
}

async function readLockOwner(lockPath: string): Promise<string | null> {
  try {
    return await readFile(join(lockPath, FULL_SUITE_LOCK_OWNER), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function removeOwnedRecoveryClaim(
  lockPath: string,
  expectedClaim: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const claimPath = join(lockPath, FULL_SUITE_LOCK_RECOVERY_CLAIM);
  let currentClaim: string;
  try {
    currentClaim = await readFile(claimPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true };
    return {
      ok: false,
      message: `Unable to verify full-suite recovery claim: ${lockErrorMessage(error)}`,
    };
  }
  if (currentClaim !== expectedClaim) {
    return {
      ok: false,
      message: 'Full-suite recovery claim ownership changed',
    };
  }
  try {
    await rm(claimPath);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: `Unable to release full-suite recovery claim: ${lockErrorMessage(error)}`,
    };
  }
}

async function quarantineClaimedStaleLock(
  lockPath: string,
  expectedOwner: string | null,
  clock: () => number,
): Promise<
  | { status: 'RECOVERED' }
  | { status: 'OCCUPIED' }
  | { status: 'FAILED'; message: string }
> {
  const claim: FullSuiteLockRecoveryClaim = {
    version: 1,
    pid: process.pid,
    token: randomUUID(),
    claimedAt: new Date(clock()).toISOString(),
  };
  const serializedClaim = `${JSON.stringify(claim)}\n`;
  try {
    await writeFile(
      join(lockPath, FULL_SUITE_LOCK_RECOVERY_CLAIM),
      serializedClaim,
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { status: 'RECOVERED' };
    if (code === 'EEXIST') return { status: 'OCCUPIED' };
    return {
      status: 'FAILED',
      message: `Unable to claim stale full-suite lock recovery: ${lockErrorMessage(error)}`,
    };
  }

  let currentOwner: string | null;
  let currentClaim: string;
  try {
    [currentOwner, currentClaim] = await Promise.all([
      readLockOwner(lockPath),
      readFile(join(lockPath, FULL_SUITE_LOCK_RECOVERY_CLAIM), 'utf8'),
    ]);
  } catch (error) {
    const released = await removeOwnedRecoveryClaim(lockPath, serializedClaim);
    const detail =
      `Unable to revalidate stale full-suite lock ownership: ${lockErrorMessage(error)}`;
    return {
      status: 'FAILED',
      message: released.ok ? detail : `${detail}; ${released.message}`,
    };
  }
  if (currentOwner !== expectedOwner || currentClaim !== serializedClaim) {
    const released = await removeOwnedRecoveryClaim(lockPath, serializedClaim);
    return {
      status: 'FAILED',
      message: released.ok
        ? 'Full-suite lock ownership changed during stale recovery'
        : released.message,
    };
  }

  const quarantine = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
  try {
    await rename(lockPath, quarantine);
  } catch (error) {
    const released = await removeOwnedRecoveryClaim(lockPath, serializedClaim);
    const detail =
      `Unable to quarantine stale full-suite lock: ${lockErrorMessage(error)}`;
    return {
      status: 'FAILED',
      message: released.ok ? detail : `${detail}; ${released.message}`,
    };
  }
  let quarantinedOwner: string | null;
  let quarantinedClaim: string;
  try {
    [quarantinedOwner, quarantinedClaim] = await Promise.all([
      readLockOwner(quarantine),
      readFile(join(quarantine, FULL_SUITE_LOCK_RECOVERY_CLAIM), 'utf8'),
    ]);
  } catch (error) {
    return {
      status: 'FAILED',
      message: `Unable to verify stale full-suite lock ownership: ${lockErrorMessage(error)}`,
    };
  }
  if (
    quarantinedOwner !== expectedOwner ||
    quarantinedClaim !== serializedClaim
  ) {
    return {
      status: 'FAILED',
      message: 'Full-suite lock ownership changed during stale recovery',
    };
  }
  try {
    await rm(quarantine, { recursive: true });
  } catch (error) {
    return {
      status: 'FAILED',
      message: `Unable to remove stale full-suite lock: ${lockErrorMessage(error)}`,
    };
  }
  return { status: 'RECOVERED' };
}

async function recoverLockIfProvablyStale(
  lockPath: string,
  options: Required<Pick<FullSuiteLockOptions, 'clock' | 'processIsLive' | 'processOwnsRecordedLock'>> & {
    unownedStaleMs: number;
  },
): Promise<
  | { status: 'RECOVERED' }
  | { status: 'OCCUPIED' }
  | { status: 'FAILED'; message: string }
> {
  let serialized: string | null;
  try {
    serialized = await readLockOwner(lockPath);
  } catch (error) {
    return {
      status: 'FAILED',
      message: `Unable to read full-suite lock ownership: ${lockErrorMessage(error)}`,
    };
  }
  const owner = parseLockOwner(serialized);
  if (owner !== null) {
    let ownerIsLive: boolean;
    try {
      ownerIsLive = options.processIsLive(owner.pid);
    } catch (error) {
      return {
        status: 'FAILED',
        message: `Unable to verify full-suite lock owner liveness: ${lockErrorMessage(error)}`,
      };
    }
    if (ownerIsLive) {
      let ownsRecordedLock: boolean;
      try {
        ownsRecordedLock = await options.processOwnsRecordedLock(owner);
      } catch (error) {
        return {
          status: 'FAILED',
          message: `Unable to verify full-suite lock owner identity: ${lockErrorMessage(error)}`,
        };
      }
      if (ownsRecordedLock) return { status: 'OCCUPIED' };
    }
  } else {
    let ageMs: number;
    try {
      ageMs = options.clock() - (await stat(lockPath)).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { status: 'RECOVERED' };
      }
      return {
        status: 'FAILED',
        message: `Unable to inspect full-suite lock ownership: ${lockErrorMessage(error)}`,
      };
    }
    if (ageMs < options.unownedStaleMs) return { status: 'OCCUPIED' };
  }
  return quarantineClaimedStaleLock(lockPath, serialized, options.clock);
}

async function releaseFullSuiteLock(
  lockPath: string,
  token: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let serialized: string | null;
  try {
    serialized = await readLockOwner(lockPath);
  } catch (error) {
    return {
      ok: false,
      message: `Unable to read owned full-suite lock: ${lockErrorMessage(error)}`,
    };
  }
  if (parseLockOwner(serialized)?.token !== token) {
    return { ok: false, message: 'Full-suite lock ownership was lost before release' };
  }
  const releasedPath = `${lockPath}.release.${process.pid}.${token}`;
  try {
    await rename(lockPath, releasedPath);
    if (parseLockOwner(await readLockOwner(releasedPath))?.token !== token) {
      return { ok: false, message: 'Full-suite lock ownership changed during release' };
    }
    await rm(releasedPath, { recursive: true });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: `Unable to release owned full-suite lock: ${lockErrorMessage(error)}`,
    };
  }
}

async function acquireFullSuiteLock(
  projectRoot: string,
  supplied: FullSuiteLockOptions = {},
): Promise<FullSuiteLockAcquireResult> {
  const waitTimeoutMs = supplied.waitTimeoutMs ?? DEFAULT_LOCK_WAIT_MS;
  const maximumRetryDelayMs = supplied.maximumRetryDelayMs ??
    DEFAULT_LOCK_MAXIMUM_RETRY_MS;
  const unownedStaleMs = supplied.unownedStaleMs ?? DEFAULT_UNOWNED_STALE_MS;
  const clock = supplied.clock ?? Date.now;
  const wait = supplied.wait ?? delay;
  const processIsLive = supplied.processIsLive ?? defaultProcessIsLive;
  const processOwnsRecordedLock = supplied.processOwnsRecordedLock ?? defaultProcessOwnsRecordedLock;
  const pipelinePath = join(projectRoot, '.pipeline');
  const lockPath = join(pipelinePath, FULL_SUITE_LOCK_DIRECTORY);
  const startedAt = clock();
  let retryDelayMs = supplied.retryDelayMs ?? DEFAULT_LOCK_RETRY_MS;
  try {
    await mkdir(pipelinePath, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      message: `Unable to create full-suite lock directory: ${lockErrorMessage(error)}`,
    };
  }

  while (true) {
    const token = randomUUID();
    try {
      await mkdir(lockPath);
      const ownerProcessIdentity = await processStartIdentity(process.pid);
      const owner: FullSuiteLockOwner = {
        version: 1,
        pid: process.pid,
        token,
        acquiredAt: new Date(clock()).toISOString(),
        ...(ownerProcessIdentity.status !== 'FOUND'
          ? {}
          : { processStartToken: ownerProcessIdentity.identity.token }),
      };
      try {
        await writeFile(
          join(lockPath, FULL_SUITE_LOCK_OWNER),
          `${JSON.stringify(owner)}\n`,
          { encoding: 'utf8', flag: 'wx' },
        );
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        return {
          ok: false,
          message: `Unable to record full-suite lock ownership: ${lockErrorMessage(error)}`,
        };
      }
      return {
        ok: true,
        handle: { release: () => releaseFullSuiteLock(lockPath, token) },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        return {
          ok: false,
          message: `Unable to acquire full-suite verification lock: ${lockErrorMessage(error)}`,
        };
      }
    }

    const recovery = await recoverLockIfProvablyStale(lockPath, {
      clock,
      processIsLive,
      processOwnsRecordedLock,
      unownedStaleMs,
    });
    if (recovery.status === 'FAILED') return { ok: false, message: recovery.message };
    if (recovery.status === 'RECOVERED') continue;

    const elapsedMs = clock() - startedAt;
    if (elapsedMs >= waitTimeoutMs) {
      return {
        ok: false,
        message: `Unable to acquire full-suite verification lock within ${waitTimeoutMs}ms`,
      };
    }
    const remainingMs = waitTimeoutMs - elapsedMs;
    try {
      await wait(Math.min(retryDelayMs, remainingMs));
    } catch (error) {
      return {
        ok: false,
        message: `Interrupted while waiting for full-suite verification lock: ${lockErrorMessage(error)}`,
      };
    }
    retryDelayMs = Math.min(retryDelayMs * 2, maximumRetryDelayMs);
  }
}

export class FullSuiteVerifier {
  constructor(private readonly options: FullSuiteVerifierOptions) {}

  async inspect(): Promise<FullSuiteInspectionResult> {
    return (await this.resolveInspection()).inspection;
  }

  async ensure(): Promise<FullSuiteVerifierResult> {
    const acquired = await acquireFullSuiteLock(
      this.options.projectRoot,
      this.options.lock,
    );
    if (!acquired.ok) {
      return {
        status: 'FAILED',
        reason: 'internal_error',
        message: acquired.message,
      };
    }
    const result = await this.ensureLocked();
    const released = await acquired.handle.release();
    if (!released.ok) {
      return {
        status: 'FAILED',
        reason: 'internal_error',
        message: released.message,
        ...('freshness' in result ? { freshness: result.freshness } : {}),
      };
    }
    return result;
  }

  private async ensureLocked(): Promise<FullSuiteVerifierResult> {
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
        const failure = resolved.inspection;
        if (failure.reason === 'internal_error') return failure;
        const secretValues = resolved.testSuite === undefined
          ? []
          : declaredEnvironmentValues(resolved.testSuite, environment);
        const message = sanitizeFullSuiteDiagnosticOutput(failure.message, secretValues);
        const evidence = buildPreflightFailEvidence(
          failure.reason,
          message,
          resolved.testSuite,
        );
        try {
          await writeEvidence(projectRoot, evidence, secretValues);
        } catch {
          return {
            status: 'FAILED',
            reason: 'internal_error',
            message: 'Unable to persist full-suite preflight FAIL evidence',
          };
        }
        let persisted;
        try {
          persisted = await readEvidence(projectRoot);
        } catch {
          return {
            status: 'FAILED',
            reason: 'internal_error',
            message: 'Unable to read persisted full-suite preflight FAIL evidence',
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
            message: 'Persisted preflight FAIL evidence is unavailable',
          };
        }
        return { ...failure, message, evidence: persisted.evidence };
      }
      if (resolved.inspection.status === 'CURRENT') {
        return { status: 'REUSED', evidence: resolved.inspection.evidence };
      }

      const { testSuite, fingerprint, worktreeClean } = resolved.context;
      const freshness = resolved.inspection;
      const secretValues = declaredEnvironmentValues(testSuite, environment);
      const execution = await execute({ projectRoot, testSuite, environment });
      if (!execution.ok) {
        const evidence = buildFailEvidence(fingerprint, execution, worktreeClean);
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
        const sanitizedDiagnostic = sanitizeFullSuiteDiagnosticOutput(
          execution.stderr || execution.stdout,
          secretValues,
        );
        return {
          status: 'FAILED',
          reason: execution.reason,
          message: sanitizedDiagnostic || 'Full test suite failed',
          freshness,
          evidence: persisted.evidence,
        };
      }

      const evidence: FullSuitePassEvidence = {
        version: FULL_SUITE_EVIDENCE_VERSION,
        outcome: 'PASS',
        reason: 'exit_zero',
        fingerprint: fingerprint.digest,
        categoryFingerprints: fingerprint.categoryFingerprints,
        provenanceHeadSha: fingerprint.headSha,
        ...(worktreeClean === undefined ? {} : { worktreeClean }),
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
      if (testSuite.command === undefined) {
        return {
          inspection: {
            status: 'FAILED',
            reason: 'invalid_config',
            message: 'Project config must declare test_suite.command for aggregate verification',
          },
          testSuite,
        };
      }
      const aggregateTestSuite: AggregateTestSuiteConfig = testSuite as AggregateTestSuiteConfig;
      const fingerprintResult = await fingerprint({
        projectRoot,
        testSuite: aggregateTestSuite,
        environmentValues: environment,
      });
      if (!fingerprintResult.ok) {
        const secretValues = declaredEnvironmentValues(aggregateTestSuite, environment);
        return {
          inspection: {
            status: 'FAILED',
            reason: fingerprintResult.reason.code === 'invalid_input'
              ? 'invalid_input'
              : 'preflight_failed',
            message: sanitizeFullSuiteDiagnosticOutput(
              fingerprintResult.reason.message,
              secretValues,
            ),
          },
          testSuite: aggregateTestSuite,
        };
      }

      const context = {
        testSuite: aggregateTestSuite,
        fingerprint: fingerprintResult.fingerprint,
        worktreeClean: await fingerprintTimeWorktreeCleanliness(projectRoot),
      };
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
          inspection: changedFingerprintInspection(
            persisted.evidence,
            fingerprintResult.fingerprint,
          ),
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
  worktreeClean: boolean | undefined,
): FullSuiteFailEvidence {
  const common = {
    version: FULL_SUITE_EVIDENCE_VERSION,
    outcome: 'FAIL' as const,
    fingerprint: fingerprint.digest,
    provenanceHeadSha: fingerprint.headSha,
    ...(worktreeClean === undefined ? {} : { worktreeClean }),
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

async function fingerprintTimeWorktreeCleanliness(
  projectRoot: string,
): Promise<boolean | undefined> {
  try {
    return (await worktreeStatus(projectRoot)).length === 0;
  } catch {
    return undefined;
  }
}

function buildPreflightFailEvidence(
  reason: Exclude<FullSuiteInspectionFailure['reason'], 'internal_error'>,
  message: string,
  testSuite?: TestSuiteConfig,
): FullSuiteFailEvidence {
  const timestamp = new Date().toISOString();
  return {
    version: FULL_SUITE_EVIDENCE_VERSION,
    outcome: 'FAIL',
    reason,
    fingerprint: null,
    provenanceHeadSha: null,
    command: testSuite?.command ?? null,
    workingDirectory: null,
    startedAt: timestamp,
    endedAt: timestamp,
    durationMs: 0,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: message,
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

const CATEGORY_STALE_REASONS: Record<
  FullSuiteFingerprintCategory,
  FullSuiteStaleReason
> = {
  additional_inputs: 'additional_inputs_changed',
  dependencies: 'dependencies_changed',
  environment: 'environment_changed',
  migrations: 'migrations_changed',
  project_config: 'project_config_changed',
  source: 'source_changed',
  test_infrastructure: 'test_infrastructure_changed',
  tests: 'tests_changed',
};

function changedFingerprintInspection(
  persisted: FullSuitePassEvidence,
  current: FullSuiteFingerprint,
): FullSuiteStaleInspection {
  const changedCategories = FULL_SUITE_FINGERPRINT_CATEGORIES.filter(
    (category) =>
      persisted.categoryFingerprints[category] !==
      current.categoryFingerprints[category],
  );
  if (changedCategories.length === 1) {
    return {
      status: 'STALE',
      reason: CATEGORY_STALE_REASONS[changedCategories[0]],
    };
  }
  if (changedCategories.length > 1) {
    return {
      status: 'STALE',
      reason: 'multiple_categories_changed',
      changedCategories,
    };
  }
  return { status: 'STALE', reason: 'fingerprint_mismatch' };
}
