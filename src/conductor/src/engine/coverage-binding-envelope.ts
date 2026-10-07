import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parsePlanTaskBodies, resolveCitedPlanTaskIds } from './plan-task-parse.js';

export interface CoverageBindingDigestClaim {
  readonly criterion: string;
  readonly doneWhen: readonly (readonly string[])[];
}

export interface CoverageBindingAmendmentDigestClaim {
  readonly artifactPath: string;
  readonly amendment: string;
  readonly doneWhen: readonly (readonly string[])[];
}

/** A complete plan task table row as presented to a conflict judge. */
export interface CoverageBindingConflictTask {
  readonly id: string;
  readonly title: string;
  readonly doneWhen: readonly string[] | readonly (readonly string[])[];
}

export interface CoverageBindingConflictDigestClaim {
  readonly text: string;
  readonly taskTable: readonly CoverageBindingConflictTask[];
}

export type CoverageBindingJudgeVerdict = 'asserts' | 'does-not-assert';

export interface CoverageBindingJudgePayload {
  readonly verdict: CoverageBindingJudgeVerdict;
  readonly missingAssertion?: string;
}

export type CoverageBindingEntryVerdict = CoverageBindingJudgeVerdict | 'not-applicable';
export type CoverageBindingAmendmentVerdict = 'carried' | 'not-carried' | 'no-plan-obligation' | 'unjudged';
export type CoverageBindingConflictVerdict = 'consistent' | 'conflicts' | 'not-applicable' | 'unjudged';
export const COVERAGE_BINDING_ENVELOPE_STATUSES = ['disabled', 'done', 'failed', 'invalidated', 'partial', 'refused'] as const;
export type CoverageBindingEnvelopeStatus = (typeof COVERAGE_BINDING_ENVELOPE_STATUSES)[number];
export interface CoverageBindingAdrLayerDisposition {
  readonly disposition: 'not-applicable';
  readonly adrIds: readonly string[];
}

/** Engine-computed membership of plan tasks in their declared slices. */
export interface CoverageBindingSliceMembership {
  readonly taskSlices: Readonly<Record<string, number>>;
  readonly titles: readonly string[];
}

/** The recorded feature baseline narrowed to one child, without rewriting it. */
export interface CoverageBindingChildOwnershipProjection {
  readonly taskIds: readonly string[];
  readonly storyIds: readonly string[];
}

/**
 * Provenance retained when a completed envelope is invalidated. It makes the
 * old judgement's eligibility explicit without changing the v1 envelope shape
 * for envelopes written before invalidation provenance existed.
 */
export interface CoverageBindingInvalidationPredecessor {
  readonly status: CoverageBindingEnvelopeStatus;
  readonly recordedDigests: boolean;
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
  readonly missingObligation?: string;
}

interface CoverageBindingConflictEnvelopeEntryBase {
  readonly kind: 'conflict';
  readonly digest: string;
  readonly claimKind: 'criterion' | 'adr-decision';
  readonly claimId: string;
}

export type CoverageBindingConflictEnvelopeEntry =
  | (CoverageBindingConflictEnvelopeEntryBase & {
    readonly verdict: 'conflicts';
    readonly taskIds: readonly string[];
    readonly conflict: string;
  })
  | (CoverageBindingConflictEnvelopeEntryBase & {
    readonly verdict: Exclude<CoverageBindingConflictVerdict, 'conflicts'>;
    readonly taskIds?: never;
    readonly conflict?: never;
  });

export type CoverageBindingAmendmentJudgeVerdict =
  | { readonly verdict: 'carried'; readonly taskIds: readonly string[]; readonly contradictsCompleted?: readonly string[] }
  | { readonly verdict: 'not-carried'; readonly missingObligation: string; readonly contradictsCompleted?: readonly string[] }
  | { readonly verdict: 'no-plan-obligation'; readonly contradictsCompleted?: readonly string[] };

export type CoverageBindingConflictJudgeVerdict =
  | { readonly verdict: 'consistent' }
  | { readonly verdict: 'conflicts'; readonly taskIds: readonly string[]; readonly conflict: string };

/** Session-fresh, engine-stamped completion evidence for coverage_binding. */
export interface CoverageBindingEnvelope {
  readonly version: 1;
  readonly slug: string;
  readonly runId: string;
  readonly status: CoverageBindingEnvelopeStatus;
  readonly entries: readonly CoverageBindingEnvelopeEntry[];
  /** Present only on envelopes invalidated after provenance tracking began. */
  readonly predecessor?: CoverageBindingInvalidationPredecessor;
  /** Present when the ADR-obligation layer was deliberately bypassed. */
  readonly adrLayer?: CoverageBindingAdrLayerDisposition;
  /** Present when the plan declared a slice manifest. */
  readonly sliceMembership?: CoverageBindingSliceMembership;
  /** Present when a sliced, stack-eligible plan assigns stories to children. */
  readonly storyOwnership?: Readonly<Record<string, number>>;
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

function slicePositions(value: unknown): value is Readonly<Record<string, number>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([taskId, position]) => text(taskId) && Number.isSafeInteger(position) && position > 0);
}

function parseSliceMembership(value: unknown): CoverageBindingSliceMembership | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return exactKeys(candidate, ['taskSlices', 'titles']) && slicePositions(candidate.taskSlices) && stringList(candidate.titles)
    ? { taskSlices: candidate.taskSlices, titles: candidate.titles }
    : null;
}

function parsePredecessor(value: unknown): CoverageBindingInvalidationPredecessor | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return exactKeys(candidate, ['status', 'recordedDigests']) &&
    (COVERAGE_BINDING_ENVELOPE_STATUSES as readonly unknown[]).includes(candidate.status) &&
    typeof candidate.recordedDigests === 'boolean'
    ? { status: candidate.status as CoverageBindingEnvelopeStatus, recordedDigests: candidate.recordedDigests }
    : null;
}

function parseEntry(value: unknown): CoverageBindingEnvelopeEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'conflict') {
    const hasConflictDetails = candidate.taskIds !== undefined || candidate.conflict !== undefined;
    if (!text(candidate.digest) || !text(candidate.claimId) ||
      !(['criterion', 'adr-decision'] as const).includes(candidate.claimKind as 'criterion' | 'adr-decision') ||
      !(['consistent', 'conflicts', 'not-applicable', 'unjudged'] as const).includes(candidate.verdict as CoverageBindingConflictVerdict)) {
      return null;
    }
    if (candidate.verdict === 'conflicts') {
      if (!exactKeys(candidate, ['kind', 'digest', 'claimKind', 'claimId', 'verdict', 'taskIds', 'conflict']) ||
        !stringList(candidate.taskIds) || candidate.taskIds.length === 0 || !text(candidate.conflict)) return null;
      return {
        kind: 'conflict', digest: candidate.digest, claimKind: candidate.claimKind as 'criterion' | 'adr-decision',
        claimId: candidate.claimId, verdict: 'conflicts', taskIds: candidate.taskIds, conflict: candidate.conflict,
      } as unknown as CoverageBindingEnvelopeEntry;
    }
    if (hasConflictDetails || !exactKeys(candidate, ['kind', 'digest', 'claimKind', 'claimId', 'verdict'])) return null;
    return {
      kind: 'conflict', digest: candidate.digest, claimKind: candidate.claimKind as 'criterion' | 'adr-decision',
      claimId: candidate.claimId, verdict: candidate.verdict as Exclude<CoverageBindingConflictVerdict, 'conflicts'>,
    } as unknown as CoverageBindingEnvelopeEntry;
  }
  if (candidate.kind === 'amendment') {
    const hasMissingObligation = candidate.missingObligation !== undefined;
    if (!exactKeys(candidate, ['kind', 'digest', 'artifactPath', 'amendment', 'taskIds', 'doneWhen', 'verdict', ...(hasMissingObligation ? ['missingObligation'] : [])]) ||
      !text(candidate.digest) || !text(candidate.artifactPath) || !text(candidate.amendment) ||
      !stringList(candidate.taskIds) || !doneWhen(candidate.doneWhen) ||
      !(['carried', 'not-carried', 'no-plan-obligation', 'unjudged'] as const).includes(candidate.verdict as CoverageBindingAmendmentVerdict)) {
      return null;
    }
    if (candidate.verdict === 'not-carried' ? !text(candidate.missingObligation) : hasMissingObligation) return null;
    return {
      kind: 'amendment', digest: candidate.digest, artifactPath: candidate.artifactPath,
      amendment: candidate.amendment, taskIds: candidate.taskIds, doneWhen: candidate.doneWhen,
      verdict: candidate.verdict as CoverageBindingAmendmentVerdict,
      ...(candidate.verdict === 'not-carried' ? { missingObligation: candidate.missingObligation as string } : {}),
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

/** Two issued ids may name one digest; their verdicts must then agree. */
function agreesWithRecorded(recorded: unknown, verdict: unknown): boolean {
  return recorded === undefined || JSON.stringify(recorded) === JSON.stringify(verdict);
}

/**
 * Judges occasionally append a verdict for an id that was never issued (e.g. c9
 * after c1-c8). Such a surplus entry carries no judgement for any issued claim,
 * so it is ignored once every issued id is answered; while any issued id is
 * unanswered, the unknown id is reported as the likely mislabel.
 */
function closeIssuedIds(
  label: string,
  issuedIds: ReadonlyMap<string, string>,
  answered: ReadonlySet<string>,
  unknownIds: readonly string[],
): { ok: true; ignoredIds?: readonly string[] } | { ok: false; reason: string } {
  for (const [id, digest] of issuedIds) {
    if (answered.has(id)) continue;
    return unknownIds.length > 0
      ? { ok: false, reason: `${label} has unknown claim id ${unknownIds[0]}` }
      : { ok: false, reason: `${label} is missing issued claim id ${id} (${digest})` };
  }
  return unknownIds.length > 0 ? { ok: true, ignoredIds: unknownIds } : { ok: true };
}

/**
 * Issues the short opaque ids a judge batch echoes back in place of claim
 * digests. LLM judges cannot reliably copy 64-hex digests, so the engine keeps
 * the id-to-digest mapping and resolves verdicts to digests before validation.
 */
export function issueJudgeClaimIds(
  digests: readonly string[],
  kind: 'criterion' | 'amendment',
): ReadonlyMap<string, string> {
  const prefix = kind === 'criterion' ? 'c' : 'a';
  return new Map(digests.map((digest, index) => [`${prefix}${index + 1}`, digest]));
}

/** Parses a criterion batch keyed by issued claim id and returns its verdicts keyed by digest. */
export function parseJudgeBatchPayload(
  payload: string,
  issuedIds: ReadonlyMap<string, string>,
): { ok: true; verdicts: ReadonlyMap<string, CoverageBindingJudgePayload>; ignoredIds?: readonly string[] } | { ok: false; reason: string } {
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

  const answered = new Set<string>();
  const unknownIds: string[] = [];
  const verdicts = new Map<string, CoverageBindingJudgePayload>();
  for (const entry of batch.verdicts) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: 'batch verdict entry must be a JSON object' };
    }
    const candidate = entry as Record<string, unknown>;
    if (!text(candidate.id)) {
      return { ok: false, reason: 'batch verdict entry requires a non-empty claim id' };
    }
    const digest = issuedIds.get(candidate.id);
    if (digest === undefined) {
      unknownIds.push(candidate.id);
      continue;
    }
    if (answered.has(candidate.id)) {
      return { ok: false, reason: `batch verdict repeats claim id ${candidate.id}` };
    }
    const { id, ...judgePayload } = candidate;
    const parsedEntry = parseJudgePayloadValue(judgePayload);
    if (!parsedEntry.ok) {
      return { ok: false, reason: `batch verdict for claim id ${id as string}: ${parsedEntry.reason}` };
    }
    if (!agreesWithRecorded(verdicts.get(digest), parsedEntry.value)) {
      return { ok: false, reason: `batch verdict for claim id ${id as string} conflicts with another verdict for digest ${digest}` };
    }
    answered.add(candidate.id);
    verdicts.set(digest, parsedEntry.value);
  }

  const closed = closeIssuedIds('batch verdict', issuedIds, answered, unknownIds);
  return closed.ok ? { ...closed, verdicts } : closed;
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

/**
 * Parses one complete amendment batch keyed by issued claim id, returns its
 * verdicts keyed by digest, and rejects every verdict if any member is unsafe.
 */
export function parseAmendmentBatchPayload(
  payload: string,
  issuedIds: ReadonlyMap<string, string>,
  issuedTaskIds: readonly string[],
  issuedCompletedTaskIds: readonly string[],
): { ok: true; verdicts: ReadonlyMap<string, CoverageBindingAmendmentJudgeVerdict>; ignoredIds?: readonly string[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, reason: 'amendment batch payload is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !exactKeys(parsed as Record<string, unknown>, ['verdicts']) || !Array.isArray((parsed as Record<string, unknown>).verdicts)) {
    return { ok: false, reason: 'amendment batch payload must contain only a verdicts array' };
  }
  const answered = new Set<string>();
  const unknownIds: string[] = [];
  const verdicts = new Map<string, CoverageBindingAmendmentJudgeVerdict>();
  for (const entry of (parsed as { verdicts: unknown[] }).verdicts) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return { ok: false, reason: 'amendment batch verdict entry must be a JSON object' };
    const candidate = entry as Record<string, unknown>;
    if (!text(candidate.id)) return { ok: false, reason: 'amendment batch verdict entry requires a non-empty claim id' };
    const digest = issuedIds.get(candidate.id);
    if (digest === undefined) { unknownIds.push(candidate.id); continue; }
    if (answered.has(candidate.id)) return { ok: false, reason: `amendment batch verdict repeats claim id ${candidate.id}` };
    const { id, ...verdictPayload } = candidate;
    const verdict = parseAmendmentJudgePayloadValue(verdictPayload, new Set(issuedTaskIds), new Set(issuedCompletedTaskIds));
    if (!verdict.ok) return { ok: false, reason: `amendment batch verdict for claim id ${id as string}: ${verdict.reason}` };
    if (!agreesWithRecorded(verdicts.get(digest), verdict.value)) return { ok: false, reason: `amendment batch verdict for claim id ${id as string} conflicts with another verdict for digest ${digest}` };
    answered.add(candidate.id);
    verdicts.set(digest, verdict.value);
  }
  const closed = closeIssuedIds('amendment batch verdict', issuedIds, answered, unknownIds);
  return closed.ok ? { ...closed, verdicts } : closed;
}

function parseConflictJudgePayloadValue(
  value: unknown,
  planTaskIds: ReadonlySet<string>,
): { ok: true; value: CoverageBindingConflictJudgeVerdict } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'conflict payload must be a JSON object' };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.verdict === 'consistent') {
    return exactKeys(candidate, ['verdict'])
      ? { ok: true, value: { verdict: 'consistent' } }
      : { ok: false, reason: 'consistent payload must contain only verdict' };
  }
  if (candidate.verdict !== 'conflicts') {
    return { ok: false, reason: 'conflict payload verdict must be consistent or conflicts' };
  }
  if (!exactKeys(candidate, ['verdict', 'taskIds', 'conflict']) ||
    !stringList(candidate.taskIds) || candidate.taskIds.length === 0 || !text(candidate.conflict)) {
    return { ok: false, reason: 'conflicts payload requires non-empty taskIds and conflict' };
  }
  const resolution = resolveCitedPlanTaskIds(candidate.taskIds, planTaskIds);
  if (resolution.kind !== 'resolved') {
    return { ok: false, reason: 'conflicts payload taskIds must resolve against the plan' };
  }
  return { ok: true, value: { verdict: 'conflicts', taskIds: resolution.ids, conflict: candidate.conflict } };
}

/**
 * Parses one complete conflict batch keyed by issued claim id, returning
 * verdicts keyed by digest. Any malformed member rejects the whole batch.
 */
export function parseConflictBatchPayload(
  payload: string,
  issuedIds: ReadonlyMap<string, string>,
  planText: string,
): { ok: true; verdicts: ReadonlyMap<string, CoverageBindingConflictJudgeVerdict>; ignoredIds?: readonly string[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, reason: 'conflict batch payload is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
    !exactKeys(parsed as Record<string, unknown>, ['verdicts']) || !Array.isArray((parsed as Record<string, unknown>).verdicts)) {
    return { ok: false, reason: 'conflict batch payload must contain only a verdicts array' };
  }

  const planTaskIds = new Set(parsePlanTaskBodies(planText).keys());
  const answered = new Set<string>();
  const unknownIds: string[] = [];
  const verdicts = new Map<string, CoverageBindingConflictJudgeVerdict>();
  for (const entry of (parsed as { verdicts: unknown[] }).verdicts) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return { ok: false, reason: 'conflict batch verdict entry must be a JSON object' };
    const candidate = entry as Record<string, unknown>;
    if (!text(candidate.id)) return { ok: false, reason: 'conflict batch verdict entry requires a non-empty claim id' };
    const digest = issuedIds.get(candidate.id);
    if (digest === undefined) { unknownIds.push(candidate.id); continue; }
    if (answered.has(candidate.id)) return { ok: false, reason: `conflict batch verdict repeats claim id ${candidate.id}` };
    const { id, ...verdictPayload } = candidate;
    const verdict = parseConflictJudgePayloadValue(verdictPayload, planTaskIds);
    if (!verdict.ok) return { ok: false, reason: `conflict batch verdict for claim id ${id as string}: ${verdict.reason}` };
    if (!agreesWithRecorded(verdicts.get(digest), verdict.value)) return { ok: false, reason: `conflict batch verdict for claim id ${id as string} conflicts with another verdict for digest ${digest}` };
    answered.add(candidate.id);
    verdicts.set(digest, verdict.value);
  }
  const closed = closeIssuedIds('conflict batch verdict', issuedIds, answered, unknownIds);
  return closed.ok ? { ...closed, verdicts } : closed;
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

/** Identity includes the claim text and every task the conflict judge sees. */
export function conflictClaimDigest(claim: CoverageBindingConflictDigestClaim): string {
  const taskTable = JSON.stringify(claim.taskTable.map((task) => ({
    id: normalized(task.id),
    title: normalized(task.title),
    doneWhen: task.doneWhen.map((check) => typeof check === 'string' ? normalized(check) : check.map(normalized)),
  })));
  const canonical = JSON.stringify({
    text: normalized(claim.text),
    taskTableDigest: `sha256:${createHash('sha256').update(taskTable).digest('hex')}`,
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function coverageBindingEnvelopePath(projectRoot: string): string {
  return join(projectRoot, ENVELOPE_DIRECTORY, ENVELOPE_FILENAME);
}

/**
 * Select one child's recorded tasks and stories from the feature-scoped
 * baseline. This intentionally has no filesystem dependency and does not
 * modify the envelope it reads.
 */
export function projectChildOwnership(
  envelope: CoverageBindingEnvelope,
  position: number,
): CoverageBindingChildOwnershipProjection {
  return {
    taskIds: Object.entries(envelope.sliceMembership?.taskSlices ?? {})
      .filter(([, taskPosition]) => taskPosition === position)
      .map(([taskId]) => taskId),
    storyIds: Object.entries(envelope.storyOwnership ?? {})
      .filter(([, storyPosition]) => storyPosition === position)
      .map(([storyId]) => storyId),
  };
}

export function parseCoverageBindingEnvelope(value: unknown): CoverageBindingEnvelope | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const hasAdrLayer = candidate.adrLayer !== undefined;
  const hasPredecessor = candidate.predecessor !== undefined;
  const hasSliceMembership = candidate.sliceMembership !== undefined;
  const hasStoryOwnership = candidate.storyOwnership !== undefined;
  if (!exactKeys(candidate, ['version', 'slug', 'runId', 'status', 'entries', ...(hasAdrLayer ? ['adrLayer'] : []), ...(hasPredecessor ? ['predecessor'] : []), ...(hasSliceMembership ? ['sliceMembership'] : []), ...(hasStoryOwnership ? ['storyOwnership'] : [])]) || candidate.version !== ENVELOPE_VERSION ||
    !text(candidate.slug) || !text(candidate.runId) || !Array.isArray(candidate.entries) ||
    !(COVERAGE_BINDING_ENVELOPE_STATUSES as readonly unknown[]).includes(candidate.status)) {
    return null;
  }
  const entries = candidate.entries.map(parseEntry);
  const adrLayer = hasAdrLayer ? parseAdrLayer(candidate.adrLayer) : undefined;
  const predecessor = hasPredecessor ? parsePredecessor(candidate.predecessor) : undefined;
  const sliceMembership = hasSliceMembership ? parseSliceMembership(candidate.sliceMembership) : undefined;
  const storyOwnership = hasStoryOwnership && slicePositions(candidate.storyOwnership) ? candidate.storyOwnership : undefined;
  return entries.some((entry) => entry === null) || adrLayer === null || predecessor === null || sliceMembership === null ||
    (hasStoryOwnership && storyOwnership === undefined)
    ? null
    : {
      version: ENVELOPE_VERSION,
      slug: candidate.slug,
      runId: candidate.runId,
      status: candidate.status as CoverageBindingEnvelopeStatus,
      entries: entries as CoverageBindingEnvelopeEntry[],
      ...(adrLayer === undefined ? {} : { adrLayer }),
      ...(predecessor === undefined ? {} : { predecessor }),
      ...(sliceMembership === undefined ? {} : { sliceMembership }),
      ...(storyOwnership === undefined ? {} : { storyOwnership }),
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
