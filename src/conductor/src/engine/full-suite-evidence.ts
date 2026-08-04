import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants as osConstants } from 'node:os';
import { join } from 'node:path';
import {
  FULL_SUITE_FINGERPRINT_CATEGORIES,
  type FullSuiteCategoryFingerprints,
} from './full-suite-fingerprint.js';

export const FULL_SUITE_EVIDENCE_VERSION = 3 as const;
export const FULL_SUITE_EVIDENCE_PATH = '.pipeline/test-suite-evidence.json';
export const FULL_SUITE_DIAGNOSTIC_LIMIT = 16_384;
export const FULL_SUITE_TRUNCATION_MARKER = '\n...[output truncated]...\n';

export type FullSuiteFailureReason =
  | 'missing_config'
  | 'invalid_config'
  | 'invalid_input'
  | 'unlaunchable'
  | 'timeout'
  | 'signal'
  | 'nonzero_exit'
  | 'preflight_failed'
  | 'internal_error';

type FullSuiteNonSignalFailureReason = Exclude<FullSuiteFailureReason, 'signal'>;

export interface FullSuitePassEvidence {
  version: typeof FULL_SUITE_EVIDENCE_VERSION;
  outcome: 'PASS';
  reason: 'exit_zero';
  fingerprint: string;
  categoryFingerprints: FullSuiteCategoryFingerprints;
  provenanceHeadSha: string;
  worktreeClean?: boolean;
  command: string | null;
  workingDirectory: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: 0;
  stdout: string;
  stderr: string;
}

interface FullSuiteFailEvidenceBase {
  version: typeof FULL_SUITE_EVIDENCE_VERSION;
  outcome: 'FAIL';
  fingerprint: string | null;
  provenanceHeadSha: string | null;
  worktreeClean?: boolean;
  command: string | null;
  workingDirectory: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export type FullSuiteFailEvidence = FullSuiteFailEvidenceBase &
  (
    | {
        reason: 'signal';
        exitCode: null;
        signal: NodeJS.Signals;
      }
    | {
        reason: FullSuiteNonSignalFailureReason;
        exitCode: number | null;
        signal: null;
      }
  );

export type FullSuiteEvidence = FullSuitePassEvidence | FullSuiteFailEvidence;

export type FullSuiteEvidenceUnusableReason =
  | 'missing'
  | 'corrupt'
  | 'unsupported_version'
  | 'incomplete_write'
  | 'not_pass'
  | 'io_error';

export type FullSuiteEvidenceReadResult =
  | { usable: true; evidence: FullSuitePassEvidence }
  | {
      usable: false;
      reason: FullSuiteEvidenceUnusableReason;
      evidence?: FullSuiteFailEvidence;
    };

function isIncompleteEvidenceWrite(entry: string): boolean {
  return entry.startsWith('.test-suite-evidence.') && entry.endsWith('.tmp');
}

const FAILURE_REASONS = new Set<FullSuiteFailureReason>([
  'missing_config',
  'invalid_config',
  'invalid_input',
  'unlaunchable',
  'timeout',
  'signal',
  'nonzero_exit',
  'preflight_failed',
  'internal_error',
]);
const VALID_SIGNALS = new Set<string>(Object.keys(osConstants.signals));

function normalizedSecrets(secretValues: readonly string[]): string[] {
  return [...new Set(secretValues.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length,
  );
}

function removeSecretsToFixedPoint(output: string, secrets: readonly string[]): string {
  let sanitized = output;
  while (true) {
    const previousLength = sanitized.length;
    for (const secret of secrets) sanitized = sanitized.replaceAll(secret, '');
    if (sanitized.length === previousLength) return sanitized;
  }
}

function utf8Prefix(buffer: Buffer, maximumBytes: number): string {
  let end = Math.min(maximumBytes, buffer.length);
  while (end > 0 && end < buffer.length && (buffer[end]! & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString('utf8');
}

function utf8Suffix(buffer: Buffer, maximumBytes: number): string {
  let start = Math.max(0, buffer.length - maximumBytes);
  while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start++;
  return buffer.subarray(start).toString('utf8');
}

export function sanitizeFullSuiteDiagnosticOutput(
  output: string,
  secretValues: readonly string[] = [],
): string {
  const secrets = normalizedSecrets(secretValues);
  const redacted = removeSecretsToFixedPoint(output, secrets);
  const redactedBytes = Buffer.from(redacted, 'utf8');
  let bounded = redacted;
  if (redactedBytes.length > FULL_SUITE_DIAGNOSTIC_LIMIT) {
    const retainedBytes =
      FULL_SUITE_DIAGNOSTIC_LIMIT -
      Buffer.byteLength(FULL_SUITE_TRUNCATION_MARKER, 'utf8');
    const headBytes = Math.ceil(retainedBytes / 2);
    const tailBytes = retainedBytes - headBytes;
    bounded = `${utf8Prefix(redactedBytes, headBytes)}${FULL_SUITE_TRUNCATION_MARKER}${utf8Suffix(redactedBytes, tailBytes)}`;
  }

  return removeSecretsToFixedPoint(bounded, secrets);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function hasValidCommonFields(value: Record<string, unknown>): boolean {
  return (
    isIsoTimestamp(value.startedAt) &&
    isIsoTimestamp(value.endedAt) &&
    Date.parse(value.endedAt) >= Date.parse(value.startedAt) &&
    typeof value.durationMs === 'number' &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0 &&
    typeof value.stdout === 'string' &&
    Buffer.byteLength(value.stdout, 'utf8') <= FULL_SUITE_DIAGNOSTIC_LIMIT &&
    typeof value.stderr === 'string' &&
    Buffer.byteLength(value.stderr, 'utf8') <= FULL_SUITE_DIAGNOSTIC_LIMIT
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isNullableBoundedNonEmptyString(value: unknown): value is string | null {
  return value === null || (
    isNonEmptyString(value) &&
    Buffer.byteLength(value, 'utf8') <= FULL_SUITE_DIAGNOSTIC_LIMIT
  );
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isCategoryFingerprints(value: unknown): value is FullSuiteCategoryFingerprints {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === FULL_SUITE_FINGERPRINT_CATEGORIES.length &&
    FULL_SUITE_FINGERPRINT_CATEGORIES.every((category) =>
      isNonEmptyString(value[category]));
}

function isPassEvidence(
  value: Record<string, unknown>,
): value is Record<string, unknown> & FullSuitePassEvidence {
  return (
    value.version === FULL_SUITE_EVIDENCE_VERSION &&
    value.outcome === 'PASS' &&
    value.reason === 'exit_zero' &&
    isNonEmptyString(value.fingerprint) &&
    isCategoryFingerprints(value.categoryFingerprints) &&
    isNonEmptyString(value.provenanceHeadSha) &&
    isOptionalBoolean(value.worktreeClean) &&
    isNullableBoundedNonEmptyString(value.command) &&
    isNullableBoundedNonEmptyString(value.workingDirectory) &&
    value.exitCode === 0 &&
    hasValidCommonFields(value)
  );
}

function isFailEvidence(
  value: Record<string, unknown>,
): value is Record<string, unknown> & FullSuiteFailEvidence {
  const reason = value.reason;
  const hasValidTermination = reason === 'signal'
    ? value.exitCode === null &&
      typeof value.signal === 'string' &&
      VALID_SIGNALS.has(value.signal)
    : value.signal === null &&
      (value.exitCode === null ||
        (Number.isInteger(value.exitCode) && value.exitCode !== 0));
  return (
    value.version === FULL_SUITE_EVIDENCE_VERSION &&
    value.outcome === 'FAIL' &&
    typeof reason === 'string' &&
    FAILURE_REASONS.has(reason as FullSuiteFailureReason) &&
    isNullableNonEmptyString(value.fingerprint) &&
    isNullableNonEmptyString(value.provenanceHeadSha) &&
    isOptionalBoolean(value.worktreeClean) &&
    isNullableBoundedNonEmptyString(value.command) &&
    isNullableBoundedNonEmptyString(value.workingDirectory) &&
    hasValidTermination &&
    hasValidCommonFields(value)
  );
}

export async function writeFullSuiteEvidence(
  projectRoot: string,
  evidence: FullSuiteEvidence,
  secretValues: readonly string[] = [],
): Promise<void> {
  const directory = join(projectRoot, '.pipeline');
  const destination = join(projectRoot, FULL_SUITE_EVIDENCE_PATH);
  const temporary = join(
    directory,
    `.test-suite-evidence.${process.pid}.${randomUUID()}.tmp`,
  );
  await mkdir(directory, { recursive: true });
  try {
    const command = evidence.command === null
      ? null
      : sanitizeFullSuiteDiagnosticOutput(evidence.command, secretValues) || null;
    const workingDirectory = evidence.workingDirectory === null
      ? null
      : sanitizeFullSuiteDiagnosticOutput(evidence.workingDirectory, secretValues) || null;
    const persisted: FullSuiteEvidence = {
      ...evidence,
      command,
      workingDirectory,
      stdout: sanitizeFullSuiteDiagnosticOutput(evidence.stdout, secretValues),
      stderr: sanitizeFullSuiteDiagnosticOutput(evidence.stderr, secretValues),
    };
    await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readFullSuiteEvidence(
  projectRoot: string,
): Promise<FullSuiteEvidenceReadResult> {
  let parsed: unknown;
  try {
    const serialized = await readFile(
      join(projectRoot, FULL_SUITE_EVIDENCE_PATH),
      'utf8',
    );
    parsed = JSON.parse(serialized);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      let entries: string[];
      try {
        entries = await readdir(join(projectRoot, '.pipeline'));
      } catch (directoryError) {
        return (directoryError as NodeJS.ErrnoException).code === 'ENOENT'
          ? { usable: false, reason: 'missing' }
          : { usable: false, reason: 'io_error' };
      }
      return {
        usable: false,
        reason: entries.some(isIncompleteEvidenceWrite)
          ? 'incomplete_write'
          : 'missing',
      };
    }
    if (error instanceof SyntaxError) return { usable: false, reason: 'corrupt' };
    return { usable: false, reason: 'io_error' };
  }

  if (!isRecord(parsed)) return { usable: false, reason: 'corrupt' };
  if (
    typeof parsed.version === 'number' &&
    parsed.version !== FULL_SUITE_EVIDENCE_VERSION
  ) {
    return { usable: false, reason: 'unsupported_version' };
  }
  if (isPassEvidence(parsed)) return { usable: true, evidence: parsed };
  if (isFailEvidence(parsed)) {
    return { usable: false, reason: 'not_pass', evidence: parsed };
  }
  return { usable: false, reason: 'corrupt' };
}
