import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FULL_SUITE_EVIDENCE_VERSION = 1 as const;
export const FULL_SUITE_EVIDENCE_PATH = '.pipeline/test-suite-evidence.json';
export const FULL_SUITE_DIAGNOSTIC_LIMIT = 16_384;
export const FULL_SUITE_TRUNCATION_MARKER = '\n...[output truncated]...\n';

export type FullSuiteFailureReason =
  | 'missing_config'
  | 'invalid_config'
  | 'invalid_input'
  | 'unlaunchable'
  | 'timeout'
  | 'nonzero_exit'
  | 'preflight_failed'
  | 'internal_error';

export interface FullSuitePassEvidence {
  version: typeof FULL_SUITE_EVIDENCE_VERSION;
  outcome: 'PASS';
  reason: 'exit_zero';
  fingerprint: string;
  provenanceHeadSha: string;
  command: string;
  workingDirectory: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: 0;
  stdout: string;
  stderr: string;
}

export interface FullSuiteFailEvidence {
  version: typeof FULL_SUITE_EVIDENCE_VERSION;
  outcome: 'FAIL';
  reason: FullSuiteFailureReason;
  fingerprint: string | null;
  provenanceHeadSha: string | null;
  command: string | null;
  workingDirectory: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

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

const FAILURE_REASONS = new Set<FullSuiteFailureReason>([
  'missing_config',
  'invalid_config',
  'invalid_input',
  'unlaunchable',
  'timeout',
  'nonzero_exit',
  'preflight_failed',
  'internal_error',
]);

function normalizedSecrets(secretValues: readonly string[]): string[] {
  return [...new Set(secretValues.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length,
  );
}

export function sanitizeFullSuiteDiagnosticOutput(
  output: string,
  secretValues: readonly string[] = [],
): string {
  const redacted = normalizedSecrets(secretValues).reduce(
    (value, secret) => value.replaceAll(secret, '[REDACTED]'),
    output,
  );
  if (redacted.length <= FULL_SUITE_DIAGNOSTIC_LIMIT) return redacted;

  const retainedLength = FULL_SUITE_DIAGNOSTIC_LIMIT - FULL_SUITE_TRUNCATION_MARKER.length;
  const headLength = Math.ceil(retainedLength / 2);
  const tailLength = retainedLength - headLength;
  return `${redacted.slice(0, headLength)}${FULL_SUITE_TRUNCATION_MARKER}${redacted.slice(-tailLength)}`;
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
    value.stdout.length <= FULL_SUITE_DIAGNOSTIC_LIMIT &&
    typeof value.stderr === 'string' &&
    value.stderr.length <= FULL_SUITE_DIAGNOSTIC_LIMIT
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isPassEvidence(
  value: Record<string, unknown>,
): value is Record<string, unknown> & FullSuitePassEvidence {
  return (
    value.version === FULL_SUITE_EVIDENCE_VERSION &&
    value.outcome === 'PASS' &&
    value.reason === 'exit_zero' &&
    isNonEmptyString(value.fingerprint) &&
    isNonEmptyString(value.provenanceHeadSha) &&
    isNonEmptyString(value.command) &&
    isNonEmptyString(value.workingDirectory) &&
    value.exitCode === 0 &&
    hasValidCommonFields(value)
  );
}

function isFailEvidence(
  value: Record<string, unknown>,
): value is Record<string, unknown> & FullSuiteFailEvidence {
  return (
    value.version === FULL_SUITE_EVIDENCE_VERSION &&
    value.outcome === 'FAIL' &&
    typeof value.reason === 'string' &&
    FAILURE_REASONS.has(value.reason as FullSuiteFailureReason) &&
    isNullableNonEmptyString(value.fingerprint) &&
    isNullableNonEmptyString(value.provenanceHeadSha) &&
    isNullableNonEmptyString(value.command) &&
    isNullableNonEmptyString(value.workingDirectory) &&
    (value.exitCode === null ||
      (Number.isInteger(value.exitCode) && value.exitCode !== 0)) &&
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
    const persisted: FullSuiteEvidence = {
      ...evidence,
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
  const directory = join(projectRoot, '.pipeline');
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { usable: false, reason: 'missing' }
      : { usable: false, reason: 'io_error' };
  }
  if (
    entries.some(
      (entry) => entry.startsWith('.test-suite-evidence.') && entry.endsWith('.tmp'),
    )
  ) {
    return { usable: false, reason: 'incomplete_write' };
  }

  let parsed: unknown;
  try {
    const serialized = await readFile(
      join(projectRoot, FULL_SUITE_EVIDENCE_PATH),
      'utf8',
    );
    parsed = JSON.parse(serialized);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { usable: false, reason: 'missing' };
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
