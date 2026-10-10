import { join } from 'node:path';

export type CoverageBindingJudgeVerdict = 'asserts' | 'does-not-assert';

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
