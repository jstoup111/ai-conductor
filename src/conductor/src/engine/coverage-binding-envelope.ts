import { createHash } from 'node:crypto';
import { join } from 'node:path';

export interface CoverageBindingDigestClaim {
  readonly criterion: string;
  readonly doneWhen: readonly (readonly string[])[];
}

export interface CoverageBindingAmendmentDigestClaim {
  readonly artifactPath: string;
  readonly amendment: string;
  readonly doneWhen: readonly (readonly string[])[];
}

export type CoverageBindingJudgeVerdict = 'asserts' | 'does-not-assert';

export interface CoverageBindingJudgePayload {
  readonly verdict: CoverageBindingJudgeVerdict;
  readonly missingAssertion?: string;
}

export type CoverageBindingEntryVerdict = CoverageBindingJudgeVerdict | 'not-applicable';
export type CoverageBindingAmendmentVerdict = 'carried' | 'not-carried' | 'no-plan-obligation' | 'unjudged';
export const COVERAGE_BINDING_ENVELOPE_STATUSES = ['disabled', 'done', 'failed', 'invalidated', 'partial', 'refused'] as const;
export type CoverageBindingEnvelopeStatus = (typeof COVERAGE_BINDING_ENVELOPE_STATUSES)[number];
export interface CoverageBindingAdrLayerDisposition {
  readonly disposition: 'not-applicable';
  readonly adrIds: readonly string[];
}
/** Statuses that are valid completion evidence for the coverage-binding gate. */
export const COVERAGE_BINDING_COMPLETION_STATUSES: readonly CoverageBindingEnvelopeStatus[] =
  ['disabled', 'done'];

/**
 * The criterion entry surface remains compatible until the amendment runner
 * starts consuming its own typed entries in Task 9.
 */
export interface CoverageBindingEnvelopeEntry {
  readonly kind?: 'criterion' | 'amendment';
  readonly digest: string;
  readonly criterion: string;
  readonly taskIds: readonly string[];
  readonly doneWhen: readonly (readonly string[])[];
  readonly verdict: CoverageBindingEntryVerdict;
  readonly missingAssertion?: string;
}

export interface CoverageBindingAmendmentEnvelopeEntry {
  readonly kind: 'amendment';
  readonly digest: string;
  readonly artifactPath: string;
  readonly amendment: string;
  readonly taskIds: readonly string[];
  readonly doneWhen: readonly (readonly string[])[];
  readonly verdict: CoverageBindingAmendmentVerdict;
}

export type CoverageBindingAmendmentJudgeVerdict =
  | { readonly verdict: 'carried'; readonly taskIds: readonly string[]; readonly contradictsCompleted?: readonly string[] }
  | { readonly verdict: 'not-carried'; readonly missingObligation: string; readonly contradictsCompleted?: readonly string[] }
  | { readonly verdict: 'no-plan-obligation'; readonly contradictsCompleted?: readonly string[] };

/** Session-fresh, engine-stamped completion evidence for coverage_binding. */
export interface CoverageBindingEnvelope {
  readonly version: 1;
  readonly slug: string;
  readonly runId: string;
  readonly status: CoverageBindingEnvelopeStatus;
  readonly entries: readonly CoverageBindingEnvelopeEntry[];
  /** Present when the ADR-obligation layer was deliberately bypassed. */
  readonly adrLayer?: CoverageBindingAdrLayerDisposition;
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

function parseAdrLayer(value: unknown): CoverageBindingAdrLayerDisposition | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return exactKeys(candidate, ['disposition', 'adrIds']) && candidate.disposition === 'not-applicable' && stringList(candidate.adrIds)
    ? { disposition: 'not-applicable', adrIds: candidate.adrIds }
    : null;
}

function parseEntry(value: unknown): CoverageBindingEnvelopeEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'amendment') {
    if (!exactKeys(candidate, ['kind', 'digest', 'artifactPath', 'amendment', 'taskIds', 'doneWhen', 'verdict']) ||
      !text(candidate.digest) || !text(candidate.artifactPath) || !text(candidate.amendment) ||
      !stringList(candidate.taskIds) || !doneWhen(candidate.doneWhen) ||
      !(['carried', 'not-carried', 'no-plan-obligation', 'unjudged'] as const).includes(candidate.verdict as CoverageBindingAmendmentVerdict)) {
      return null;
    }
    return {
      kind: 'amendment', digest: candidate.digest, artifactPath: candidate.artifactPath,
      amendment: candidate.amendment, taskIds: candidate.taskIds, doneWhen: candidate.doneWhen,
      verdict: candidate.verdict as CoverageBindingAmendmentVerdict,
    } as unknown as CoverageBindingEnvelopeEntry;
  }
  const hasMissingAssertion = candidate.missingAssertion !== undefined;
  const hasKind = candidate.kind !== undefined;
  const keys = ['digest', 'criterion', 'taskIds', 'doneWhen', 'verdict', ...(hasKind ? ['kind'] : []), ...(hasMissingAssertion ? ['missingAssertion'] : [])];
  if (!exactKeys(candidate, keys) || !text(candidate.digest) || !text(candidate.criterion) ||
    !stringList(candidate.taskIds) || !doneWhen(candidate.doneWhen) || (hasKind && candidate.kind !== 'criterion')) return null;
  if (candidate.verdict === 'asserts' || candidate.verdict === 'not-applicable') {
    return hasMissingAssertion ? null : {
      kind: 'criterion', digest: candidate.digest, criterion: candidate.criterion, taskIds: candidate.taskIds,
      doneWhen: candidate.doneWhen, verdict: candidate.verdict,
    };
  }
  return candidate.verdict === 'does-not-assert' && text(candidate.missingAssertion)
    ? { kind: 'criterion', digest: candidate.digest, criterion: candidate.criterion, taskIds: candidate.taskIds, doneWhen: candidate.doneWhen, verdict: candidate.verdict, missingAssertion: candidate.missingAssertion }
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

function parseAmendmentJudgePayloadValue(
  value: unknown,
  issuedTaskIds: ReadonlySet<string>,
  issuedCompletedTaskIds: ReadonlySet<string>,
): { ok: true; value: CoverageBindingAmendmentJudgeVerdict } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'amendment payload must be a JSON object' };
  }
  const candidate = value as Record<string, unknown>;
  const contradictions = candidate.contradictsCompleted;
  if (contradictions !== undefined && (!stringList(contradictions) || contradictions.some((taskId) => !issuedCompletedTaskIds.has(taskId)))) {
    const foreign = Array.isArray(contradictions) ? contradictions.find((taskId) => typeof taskId === 'string' && !issuedCompletedTaskIds.has(taskId)) : undefined;
    return { ok: false, reason: `contradictsCompleted must contain only issued completed task ids${foreign ? `; foreign task id ${foreign}` : ''}` };
  }
  const optionalContradictions = contradictions === undefined ? {} : { contradictsCompleted: contradictions };
  if (candidate.verdict === 'carried') {
    if (!exactKeys(candidate, ['verdict', 'taskIds', ...(contradictions === undefined ? [] : ['contradictsCompleted'])]) ||
      !stringList(candidate.taskIds) || candidate.taskIds.length === 0 || candidate.taskIds.some((taskId) => !issuedTaskIds.has(taskId))) {
      const foreign = Array.isArray(candidate.taskIds) ? candidate.taskIds.find((taskId) => typeof taskId === 'string' && !issuedTaskIds.has(taskId)) : undefined;
      return { ok: false, reason: `carried payload requires non-empty issued taskIds${foreign ? `; foreign task id ${foreign}` : ''}` };
    }
    return { ok: true, value: { verdict: 'carried', taskIds: candidate.taskIds, ...optionalContradictions } };
  }
  if (candidate.verdict === 'not-carried') {
    if (!exactKeys(candidate, ['verdict', 'missingObligation', ...(contradictions === undefined ? [] : ['contradictsCompleted'])]) || !text(candidate.missingObligation)) {
      return { ok: false, reason: 'not-carried payload requires a non-empty missingObligation' };
    }
    return { ok: true, value: { verdict: 'not-carried', missingObligation: candidate.missingObligation, ...optionalContradictions } };
  }
  if (candidate.verdict === 'no-plan-obligation' && exactKeys(candidate, ['verdict', ...(contradictions === undefined ? [] : ['contradictsCompleted'])])) {
    return { ok: true, value: { verdict: 'no-plan-obligation', ...optionalContradictions } };
  }
  return { ok: false, reason: 'amendment payload verdict must be carried, not-carried, or no-plan-obligation with only its permitted fields' };
}

/** Parses one complete amendment batch and rejects every verdict if any member is unsafe. */
export function parseAmendmentBatchPayload(
  payload: string,
  issuedDigests: readonly string[],
  issuedTaskIds: readonly string[],
  issuedCompletedTaskIds: readonly string[],
): { ok: true; verdicts: ReadonlyMap<string, CoverageBindingAmendmentJudgeVerdict> } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, reason: 'amendment batch payload is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !exactKeys(parsed as Record<string, unknown>, ['verdicts']) || !Array.isArray((parsed as Record<string, unknown>).verdicts)) {
    return { ok: false, reason: 'amendment batch payload must contain only a verdicts array' };
  }
  const issued = new Set(issuedDigests);
  const verdicts = new Map<string, CoverageBindingAmendmentJudgeVerdict>();
  for (const entry of (parsed as { verdicts: unknown[] }).verdicts) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return { ok: false, reason: 'amendment batch verdict entry must be a JSON object' };
    const candidate = entry as Record<string, unknown>;
    if (!text(candidate.digest)) return { ok: false, reason: 'amendment batch verdict entry requires a non-empty digest' };
    if (!issued.has(candidate.digest)) return { ok: false, reason: `amendment batch verdict has foreign digest ${candidate.digest}` };
    if (verdicts.has(candidate.digest)) return { ok: false, reason: `amendment batch verdict repeats digest ${candidate.digest}` };
    const { digest, ...verdictPayload } = candidate;
    const verdict = parseAmendmentJudgePayloadValue(verdictPayload, new Set(issuedTaskIds), new Set(issuedCompletedTaskIds));
    if (!verdict.ok) return { ok: false, reason: `amendment batch verdict for digest ${digest}: ${verdict.reason}` };
    verdicts.set(digest, verdict.value);
  }
  for (const digest of issued) if (!verdicts.has(digest)) return { ok: false, reason: `amendment batch verdict is missing issued digest ${digest}` };
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

/** Identity includes the DECIDE source, exact amendment, and plan obligations. */
export function amendmentClaimDigest(claim: CoverageBindingAmendmentDigestClaim): string {
  const canonical = JSON.stringify({
    artifactPath: claim.artifactPath,
    amendment: claim.amendment,
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
  const hasAdrLayer = candidate.adrLayer !== undefined;
  if (!exactKeys(candidate, ['version', 'slug', 'runId', 'status', 'entries', ...(hasAdrLayer ? ['adrLayer'] : [])]) || candidate.version !== ENVELOPE_VERSION ||
    !text(candidate.slug) || !text(candidate.runId) || !Array.isArray(candidate.entries) ||
    !(COVERAGE_BINDING_ENVELOPE_STATUSES as readonly unknown[]).includes(candidate.status)) {
    return null;
  }
  const entries = candidate.entries.map(parseEntry);
  const adrLayer = hasAdrLayer ? parseAdrLayer(candidate.adrLayer) : undefined;
  return entries.some((entry) => entry === null) || adrLayer === null
    ? null
    : {
      version: ENVELOPE_VERSION,
      slug: candidate.slug,
      runId: candidate.runId,
      status: candidate.status as CoverageBindingEnvelopeStatus,
      entries: entries as CoverageBindingEnvelopeEntry[],
      ...(adrLayer === undefined ? {} : { adrLayer }),
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

/**
 * Sidecar naming the HEAD a coverage run judged. The envelope's exact-key
 * contract stays closed, so the stamp lives beside it (the same shape the
 * prd_audit / as-built sidecars use) and is bound to the envelope by runId.
 */
export const COVERAGE_BINDING_CODE_STAMP = `${ENVELOPE_DIRECTORY}/coverage-binding-code-stamp.json`;

/** Written by the production runner together with every envelope it writes. */
export async function writeCoverageBindingCodeStamp(
  projectRoot: string,
  stamp: { runId: string; codeStamp: string },
  fs: CoverageBindingEnvelopeFilesystem,
): Promise<void> {
  const path = join(projectRoot, COVERAGE_BINDING_CODE_STAMP);
  await fs.mkdir(join(projectRoot, ENVELOPE_DIRECTORY));
  await fs.writeFile(`${path}.tmp`, JSON.stringify(stamp));
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
