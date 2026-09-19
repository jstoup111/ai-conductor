import { createHash } from 'node:crypto';
import { join } from 'node:path';

export interface CoverageBindingDigestClaim {
  readonly criterion: string;
  readonly doneWhen: readonly (readonly string[])[];
}

export type CoverageBindingJudgeVerdict = 'asserts' | 'does-not-assert';

export interface CoverageBindingJudgePayload {
  readonly verdict: CoverageBindingJudgeVerdict;
  readonly missingAssertion?: string;
}

export type CoverageBindingEntryVerdict = CoverageBindingJudgeVerdict | 'not-applicable';
export const COVERAGE_BINDING_ENVELOPE_STATUSES = ['disabled', 'done', 'failed', 'partial', 'refused'] as const;
export type CoverageBindingEnvelopeStatus = (typeof COVERAGE_BINDING_ENVELOPE_STATUSES)[number];
/** Statuses that are valid completion evidence for the coverage-binding gate. */
export const COVERAGE_BINDING_COMPLETION_STATUSES: readonly CoverageBindingEnvelopeStatus[] =
  ['disabled', 'done'];

export interface CoverageBindingEnvelopeEntry {
  readonly digest: string;
  readonly criterion: string;
  readonly taskIds: readonly string[];
  readonly doneWhen: readonly (readonly string[])[];
  readonly verdict: CoverageBindingEntryVerdict;
  readonly missingAssertion?: string;
}

/** Session-fresh, engine-stamped completion evidence for coverage_binding. */
export interface CoverageBindingEnvelope {
  readonly version: 1;
  readonly slug: string;
  readonly runId: string;
  readonly status: CoverageBindingEnvelopeStatus;
  readonly entries: readonly CoverageBindingEnvelopeEntry[];
}

/** Injected so unit tests do not touch the host filesystem. */
export interface CoverageBindingEnvelopeFilesystem {
  readFile(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

const ENVELOPE_VERSION = 1;
const ENVELOPE_DIRECTORY = '.pipeline';
const ENVELOPE_FILENAME = 'coverage-binding.json';

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(text);
}

function doneWhen(value: unknown): value is readonly (readonly string[])[] {
  return Array.isArray(value) && value.every(stringList);
}

function parseEntry(value: unknown): CoverageBindingEnvelopeEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const hasMissingAssertion = candidate.missingAssertion !== undefined;
  const keys = ['digest', 'criterion', 'taskIds', 'doneWhen', 'verdict', ...(hasMissingAssertion ? ['missingAssertion'] : [])];
  if (!exactKeys(candidate, keys) || !text(candidate.digest) || !text(candidate.criterion) ||
    !stringList(candidate.taskIds) || !doneWhen(candidate.doneWhen)) return null;
  if (candidate.verdict === 'asserts' || candidate.verdict === 'not-applicable') {
    return hasMissingAssertion ? null : {
      digest: candidate.digest, criterion: candidate.criterion, taskIds: candidate.taskIds,
      doneWhen: candidate.doneWhen, verdict: candidate.verdict,
    };
  }
  return candidate.verdict === 'does-not-assert' && text(candidate.missingAssertion)
    ? { digest: candidate.digest, criterion: candidate.criterion, taskIds: candidate.taskIds, doneWhen: candidate.doneWhen, verdict: candidate.verdict, missingAssertion: candidate.missingAssertion }
    : null;
}

function parseJudgePayloadValue(value: unknown): { ok: true; value: CoverageBindingJudgePayload } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'payload must be a JSON object' };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.verdict !== 'asserts' && candidate.verdict !== 'does-not-assert') {
    return { ok: false, reason: 'payload verdict must be asserts or does-not-assert' };
  }
  if (candidate.verdict === 'asserts') {
    return exactKeys(candidate, ['verdict'])
      ? { ok: true, value: { verdict: 'asserts' } }
      : { ok: false, reason: 'asserts payload must contain only verdict' };
  }
  if (!exactKeys(candidate, ['verdict', 'missingAssertion']) || !text(candidate.missingAssertion)) {
    return { ok: false, reason: 'does-not-assert payload requires a non-empty missingAssertion' };
  }
  return { ok: true, value: { verdict: 'does-not-assert', missingAssertion: candidate.missingAssertion } };
}

export function parseJudgePayload(payload: string): { ok: true; value: CoverageBindingJudgePayload } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, reason: 'payload is not valid JSON' };
  }
  return parseJudgePayloadValue(parsed);
}

export function parseJudgeBatchPayload(
  payload: string,
  issuedDigests: readonly string[],
): { ok: true; verdicts: ReadonlyMap<string, CoverageBindingJudgePayload> } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, reason: 'batch payload is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'batch payload must be a JSON object with a verdicts array' };
  }
  const batch = parsed as Record<string, unknown>;
  if (!exactKeys(batch, ['verdicts'])) {
    return { ok: false, reason: 'batch payload must contain only verdicts' };
  }
  if (!Array.isArray(batch.verdicts)) {
    return { ok: false, reason: 'batch payload verdicts must be an array' };
  }

  const issued = new Set(issuedDigests);
  const verdicts = new Map<string, CoverageBindingJudgePayload>();
  for (const entry of batch.verdicts) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: 'batch verdict entry must be a JSON object' };
    }
    const candidate = entry as Record<string, unknown>;
    if (!text(candidate.digest)) {
      return { ok: false, reason: 'batch verdict entry requires a non-empty digest' };
    }
    if (!issued.has(candidate.digest)) {
      return { ok: false, reason: `batch verdict has foreign digest ${candidate.digest}` };
    }
    if (verdicts.has(candidate.digest)) {
      return { ok: false, reason: `batch verdict repeats digest ${candidate.digest}` };
    }
    const { digest, ...judgePayload } = candidate;
    const parsedEntry = parseJudgePayloadValue(judgePayload);
    if (!parsedEntry.ok) {
      return { ok: false, reason: `batch verdict for digest ${digest}: ${parsedEntry.reason}` };
    }
    verdicts.set(digest, parsedEntry.value);
  }

  for (const digest of issued) {
    if (!verdicts.has(digest)) {
      return { ok: false, reason: `batch verdict is missing issued digest ${digest}` };
    }
  }
  return { ok: true, verdicts };
}

/** Identity is intentionally limited to the text the fresh judge receives. */
export function claimDigest(claim: CoverageBindingDigestClaim): string {
  const canonical = JSON.stringify({
    criterion: normalized(claim.criterion),
    doneWhen: claim.doneWhen.map((checks) => checks.map(normalized)),
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function coverageBindingEnvelopePath(projectRoot: string): string {
  return join(projectRoot, ENVELOPE_DIRECTORY, ENVELOPE_FILENAME);
}

export function parseCoverageBindingEnvelope(value: unknown): CoverageBindingEnvelope | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!exactKeys(candidate, ['version', 'slug', 'runId', 'status', 'entries']) || candidate.version !== ENVELOPE_VERSION ||
    !text(candidate.slug) || !text(candidate.runId) || !Array.isArray(candidate.entries) ||
    !(COVERAGE_BINDING_ENVELOPE_STATUSES as readonly unknown[]).includes(candidate.status)) {
    return null;
  }
  const entries = candidate.entries.map(parseEntry);
  return entries.some((entry) => entry === null)
    ? null
    : {
      version: ENVELOPE_VERSION,
      slug: candidate.slug,
      runId: candidate.runId,
      status: candidate.status as CoverageBindingEnvelopeStatus,
      entries: entries as CoverageBindingEnvelopeEntry[],
    };
}

/** Writes a complete replacement through a sibling temp file, never in place. */
export async function writeCoverageBindingEnvelope(
  projectRoot: string,
  envelope: CoverageBindingEnvelope,
  fs: CoverageBindingEnvelopeFilesystem,
): Promise<void> {
  if (!parseCoverageBindingEnvelope(envelope)) {
    throw new Error('coverage-binding envelope: invalid envelope');
  }
  const path = coverageBindingEnvelopePath(projectRoot);
  await fs.mkdir(join(projectRoot, ENVELOPE_DIRECTORY));
  await fs.writeFile(`${path}.tmp`, JSON.stringify(envelope));
  await fs.rename(`${path}.tmp`, path);
}

/** Missing, torn, and foreign envelopes must never become cache evidence. */
export async function readCoverageBindingEnvelope(
  projectRoot: string,
  fs: CoverageBindingEnvelopeFilesystem,
): Promise<CoverageBindingEnvelope | null> {
  try {
    return parseCoverageBindingEnvelope(JSON.parse(await fs.readFile(coverageBindingEnvelopePath(projectRoot))));
  } catch {
    return null;
  }
}
