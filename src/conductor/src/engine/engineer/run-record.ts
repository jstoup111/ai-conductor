import { createHash } from 'node:crypto';
import type { Track } from '../../types/steps.js';

export const RUN_RECORD_SCHEMA_VERSION = 1;

/** DECIDE steps in their dependency order. */
export const RUN_STEP_ORDER = [
  'explore',
  'complexity',
  'prd',
  'architecture_diagram',
  'architecture_review',
  'stories',
  'conflict_check',
  'plan',
  'coherence_check',
  'plan_review',
] as const;

export type RunStepId = (typeof RUN_STEP_ORDER)[number];

/** A digest binds accepted status to one precise artifact revision. */
export interface ArtifactDigest {
  readonly path: string;
  readonly sha256: string;
}

export interface AcceptedRunStep {
  readonly state: 'accepted';
  readonly actor: string;
  readonly provider: string;
  readonly at: string;
  readonly artifacts: readonly ArtifactDigest[];
}

export interface DraftRunStep {
  readonly state: 'draft';
}

export type RunStep = AcceptedRunStep | DraftRunStep;

export interface StepNotes {
  readonly decisions: readonly string[];
  readonly openQuestions: readonly string[];
}

export interface OwnerHistoryEntry {
  readonly actor: string;
  readonly at: string;
}

/** The session that last saved this record, including a draft-only save. */
export interface RunCheckpoint {
  readonly actor: string;
  readonly provider: string;
  readonly at: string;
}

export interface AcceptedRunStepSummary extends AcceptedRunStep {
  readonly step: RunStepId;
}

/**
 * The shared read model for every Composer handoff surface.  A run record is
 * sparse because some DECIDE steps are optional, so an absent step is not a
 * pending one; the first recorded draft or reconfirmation is the next step.
 */
export interface RunSummary {
  readonly nextStep: RunStepId | 'delivery';
  readonly acceptedSteps: readonly AcceptedRunStepSummary[];
  readonly lastAcceptedStep?: AcceptedRunStepSummary;
  readonly lastActor?: string;
  readonly lastAt?: string;
  readonly decisions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly drafts: readonly RunStepId[];
}

/** Engine-owned state committed to `.docs/composer-runs/<slug>.json`. */
export interface RunRecord {
  readonly schemaVersion: typeof RUN_RECORD_SCHEMA_VERSION;
  readonly slug: string;
  /** Closed routing choice captured from the Explore track marker. */
  readonly track: Track;
  readonly sourceRef?: string;
  readonly steps: Readonly<Partial<Record<RunStepId, RunStep>>>;
  /**
   * The artifact revision from the most recent acceptance, retained while a
   * step is saved as a draft. Draft steps intentionally carry no acceptance
   * provenance themselves, but a later re-acceptance must still be able to
   * invalidate downstream approvals when the artifact changed.
   */
  readonly lastAcceptedArtifacts?: Readonly<Partial<Record<RunStepId, readonly ArtifactDigest[]>>>;
  readonly needsReconfirm: readonly RunStepId[];
  readonly ownerHistory: readonly OwnerHistoryEntry[];
  readonly notes: Readonly<Partial<Record<RunStepId, StepNotes>>>;
  /** Unlike acceptance, this is updated by every checkpoint, including drafts. */
  readonly lastCheckpoint?: RunCheckpoint;
}

/** Derive the one authoritative handoff summary from durable Composer state. */
export function summarizeRun(record: RunRecord, currentDigests?: readonly ArtifactDigest[]): RunSummary {
  const classification = currentDigests === undefined ? undefined : classifyArtifacts(record, currentDigests);
  const invalidSteps = new Set<RunStepId>([
    ...(classification?.draft.flatMap((artifact) => artifact.step === undefined ? [] : [artifact.step]) ?? []),
    ...(classification?.needsReconfirm ?? []),
    ...record.needsReconfirm,
  ]);
  const acceptedSteps = RUN_STEP_ORDER.flatMap((step) => {
    const value = record.steps[step];
    return value?.state === 'accepted' && !invalidSteps.has(step) ? [{ step, ...value }] : [];
  });
  const lastAcceptedStep = acceptedSteps.at(-1);
  const lastActivity = record.lastCheckpoint ?? lastAcceptedStep;
  // An explicit draft/reconfirmation is authoritative even where optional
  // earlier DECIDE steps were not recorded. For an accept-only mid-run record,
  // however, do not pretend it reached delivery merely because no draft exists.
  const explicitNextStep = RUN_STEP_ORDER.find((step) =>
    invalidSteps.has(step) || record.needsReconfirm.includes(step) || record.steps[step]?.state === 'draft',
  );
  // DECIDE records are sparse: PRD and diagram/review steps can be omitted by
  // the selected track or tier.  Once there is no saved draft or invalidated
  // acceptance, continue from the step after the last accepted checkpoint
  // rather than mistaking an omitted optional step for the current one.
  const lastRecordedAcceptance = [...RUN_STEP_ORDER].reverse().find((step) => record.steps[step]?.state === 'accepted');
  const nextRecordedStep = (after: number): RunStepId | 'delivery' =>
    RUN_STEP_ORDER.slice(after + 1).find((step) => !(record.track === 'technical' && step === 'prd')) ?? 'delivery';
  const nextStep = explicitNextStep
    ?? (lastRecordedAcceptance === undefined
      ? nextRecordedStep(-1)
      : nextRecordedStep(RUN_STEP_ORDER.indexOf(lastRecordedAcceptance)));
  return {
    nextStep,
    acceptedSteps,
    ...(lastAcceptedStep ? { lastAcceptedStep } : {}),
    ...(lastActivity ? { lastActor: lastActivity.actor, lastAt: lastActivity.at } : {}),
    decisions: RUN_STEP_ORDER.flatMap((step) => record.notes[step]?.decisions ?? []),
    openQuestions: RUN_STEP_ORDER.flatMap((step) => record.notes[step]?.openQuestions ?? []),
    drafts: RUN_STEP_ORDER.filter((step) => invalidSteps.has(step) || record.steps[step]?.state === 'draft' || record.needsReconfirm.includes(step)),
  };
}

export interface RecordAcceptanceInput {
  readonly step: RunStepId;
  readonly actor: string;
  readonly provider: string;
  readonly at: string;
  readonly artifacts: readonly ArtifactDigest[];
  readonly decisions: readonly string[];
  readonly openQuestions: readonly string[];
}

export interface ClassifiedArtifact extends ArtifactDigest {
  readonly step?: RunStepId;
}

export interface ArtifactClassification {
  readonly accepted: readonly ClassifiedArtifact[];
  readonly draft: readonly ClassifiedArtifact[];
  readonly needsReconfirm: readonly RunStepId[];
}

const RUN_STEP_IDS = new Set<string>(RUN_STEP_ORDER);
const RUN_TRACKS = new Set<Track>(['product', 'technical']);
const SHA256_HEX = /^[a-f0-9]{64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStepId(value: unknown): value is RunStepId {
  return typeof value === 'string' && RUN_STEP_IDS.has(value);
}

function parseTrack(value: unknown): Track {
  if (typeof value !== 'string' || !RUN_TRACKS.has(value as Track)) {
    throw new Error('Run record track must be product or technical');
  }
  return value as Track;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Run record ${field} must be a non-empty string`);
  return value;
}

function parseArtifact(value: unknown): ArtifactDigest {
  if (!isObject(value)) throw new Error('Run record artifact must be an object');
  const path = requiredString(value.path, 'artifact path');
  const sha256 = requiredString(value.sha256, 'artifact sha256');
  if (!SHA256_HEX.test(sha256)) throw new Error('Run record artifact sha256 must be a lowercase SHA-256 hex digest');
  if (Object.keys(value).some((key) => key !== 'path' && key !== 'sha256')) throw new Error('Run record artifact has unknown fields');
  return { path, sha256 };
}

function parseTextList(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Run record ${field} must be an array of strings`);
  }
  return [...value] as readonly string[];
}

function parseStep(value: unknown): RunStep {
  if (!isObject(value)) throw new Error('Run record step must be an object');
  if (value.state === 'draft') {
    if (Object.keys(value).some((key) => key !== 'state')) throw new Error('Run record draft step has unknown fields');
    return { state: 'draft' };
  }
  if (value.state !== 'accepted') throw new Error('Run record step state must be accepted or draft');
  if (Object.keys(value).some((key) => !['state', 'actor', 'provider', 'at', 'artifacts'].includes(key))) {
    throw new Error('Run record accepted step has unknown fields');
  }
  const at = requiredString(value.at, 'step acceptance time');
  if (Number.isNaN(Date.parse(at))) throw new Error('Run record step acceptance time must be a timestamp');
  if (!Array.isArray(value.artifacts)) throw new Error('Run record accepted step artifacts must be an array');
  return {
    state: 'accepted',
    actor: requiredString(value.actor, 'step actor'),
    provider: requiredString(value.provider, 'step provider'),
    at,
    artifacts: value.artifacts.map(parseArtifact),
  };
}

function parseSteps(value: unknown): Readonly<Partial<Record<RunStepId, RunStep>>> {
  if (!isObject(value)) throw new Error('Run record steps must be an object');
  const steps: Partial<Record<RunStepId, RunStep>> = {};
  for (const [step, entry] of Object.entries(value)) {
    if (!isStepId(step)) throw new Error(`Run record has unknown step ${step}`);
    steps[step] = parseStep(entry);
  }
  return steps;
}

function parseLastAcceptedArtifacts(value: unknown): Readonly<Partial<Record<RunStepId, readonly ArtifactDigest[]>>> {
  if (!isObject(value)) throw new Error('Run record lastAcceptedArtifacts must be an object');
  const artifacts: Partial<Record<RunStepId, readonly ArtifactDigest[]>> = {};
  for (const [step, entry] of Object.entries(value)) {
    if (!isStepId(step) || !Array.isArray(entry)) throw new Error('Run record lastAcceptedArtifacts must be keyed by a known step');
    artifacts[step] = entry.map(parseArtifact);
  }
  return artifacts;
}

function parseNotes(value: unknown): Readonly<Partial<Record<RunStepId, StepNotes>>> {
  if (!isObject(value)) throw new Error('Run record notes must be an object');
  const notes: Partial<Record<RunStepId, StepNotes>> = {};
  for (const [step, entry] of Object.entries(value)) {
    if (!isStepId(step) || !isObject(entry) || Object.keys(entry).some((key) => key !== 'decisions' && key !== 'openQuestions')) {
      throw new Error('Run record notes must be keyed by a known step');
    }
    notes[step] = {
      decisions: parseTextList(entry.decisions, 'note decisions'),
      openQuestions: parseTextList(entry.openQuestions, 'note openQuestions'),
    };
  }
  return notes;
}

function parseOwnerHistory(value: unknown): readonly OwnerHistoryEntry[] {
  if (!Array.isArray(value)) throw new Error('Run record ownerHistory must be an array');
  return value.map((entry) => {
    if (!isObject(entry) || Object.keys(entry).some((key) => key !== 'actor' && key !== 'at')) {
      throw new Error('Run record ownerHistory entry must contain actor and at');
    }
    const at = requiredString(entry.at, 'owner history time');
    if (Number.isNaN(Date.parse(at))) throw new Error('Run record owner history time must be a timestamp');
    return { actor: requiredString(entry.actor, 'owner history actor'), at };
  });
}

function parseCheckpoint(value: unknown): RunCheckpoint {
  if (!isObject(value) || Object.keys(value).some((key) => key !== 'actor' && key !== 'provider' && key !== 'at')) {
    throw new Error('Run record lastCheckpoint must contain actor, provider, and at');
  }
  const at = requiredString(value.at, 'last checkpoint time');
  if (Number.isNaN(Date.parse(at))) throw new Error('Run record last checkpoint time must be a timestamp');
  return { actor: requiredString(value.actor, 'last checkpoint actor'), provider: requiredString(value.provider, 'last checkpoint provider'), at };
}

/** Parse the sole supported run-record schema, failing closed on unknown state. */
export function parseRunRecord(serialized: string): RunRecord {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Run record is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(value)) throw new Error('Run record must be an object');
  if (value.schemaVersion !== RUN_RECORD_SCHEMA_VERSION) throw new Error(`Unsupported run record schemaVersion ${String(value.schemaVersion)}`);
  if (Object.keys(value).some((key) => !['schemaVersion', 'slug', 'track', 'sourceRef', 'steps', 'lastAcceptedArtifacts', 'needsReconfirm', 'ownerHistory', 'notes', 'lastCheckpoint'].includes(key))) {
    throw new Error('Run record has unknown fields');
  }
  if (value.sourceRef !== undefined && typeof value.sourceRef !== 'string') throw new Error('Run record sourceRef must be a string');
  const needsReconfirm = parseTextList(value.needsReconfirm, 'needsReconfirm');
  if (needsReconfirm.some((step) => !isStepId(step))) throw new Error('Run record needsReconfirm must name known steps');
  return {
    schemaVersion: RUN_RECORD_SCHEMA_VERSION,
    slug: requiredString(value.slug, 'slug'),
    track: parseTrack(value.track),
    ...(value.sourceRef === undefined ? {} : { sourceRef: value.sourceRef }),
    steps: parseSteps(value.steps),
    ...(value.lastAcceptedArtifacts === undefined ? {} : { lastAcceptedArtifacts: parseLastAcceptedArtifacts(value.lastAcceptedArtifacts) }),
    needsReconfirm: [...new Set(needsReconfirm)] as readonly RunStepId[],
    ownerHistory: parseOwnerHistory(value.ownerHistory),
    notes: parseNotes(value.notes),
    ...(value.lastCheckpoint === undefined ? {} : { lastCheckpoint: parseCheckpoint(value.lastCheckpoint) }),
  };
}

/** Serialize durable state as JSON; owner provenance remains in its separate intake marker. */
export function serializeRunRecord(record: RunRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** Compute the canonical digest used to bind acceptance to artifact content. */
export function digestArtifact(path: string, bytes: Uint8Array): ArtifactDigest {
  if (path.length === 0) throw new Error('Artifact path must be non-empty');
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function sameArtifacts(left: readonly ArtifactDigest[], right: readonly ArtifactDigest[]): boolean {
  return left.length === right.length && left.every((artifact, index) =>
    artifact.path === right[index]?.path && artifact.sha256 === right[index]?.sha256,
  );
}

function laterAcceptedSteps(record: RunRecord, step: RunStepId): RunStepId[] {
  const start = RUN_STEP_ORDER.indexOf(step);
  return RUN_STEP_ORDER.slice(start + 1).filter((candidate) => record.steps[candidate]?.state === 'accepted');
}

/** Record one explicit operator acceptance without mutating the prior durable state. */
export function recordAcceptance(record: RunRecord, input: RecordAcceptanceInput): RunRecord {
  const previous = record.steps[input.step];
  const lastAccepted = record.lastAcceptedArtifacts?.[input.step]
    ?? (previous?.state === 'accepted' ? previous.artifacts : undefined);
  const changed = lastAccepted !== undefined && !sameArtifacts(lastAccepted, input.artifacts);
  const needsReconfirm = new Set(record.needsReconfirm);
  needsReconfirm.delete(input.step);
  if (changed) for (const later of laterAcceptedSteps(record, input.step)) needsReconfirm.add(later);

  return {
    ...record,
    steps: {
      ...record.steps,
      [input.step]: {
        state: 'accepted',
        actor: input.actor,
        provider: input.provider,
        at: input.at,
        artifacts: input.artifacts.map((artifact) => ({ ...artifact })),
      },
    },
    lastAcceptedArtifacts: {
      ...record.lastAcceptedArtifacts,
      [input.step]: input.artifacts.map((artifact) => ({ ...artifact })),
    },
    needsReconfirm: RUN_STEP_ORDER.filter((step) => needsReconfirm.has(step)),
    notes: {
      ...record.notes,
      [input.step]: {
        decisions: [...input.decisions],
        openQuestions: [...input.openQuestions],
      },
    },
    lastCheckpoint: { actor: input.actor, provider: input.provider, at: input.at },
  };
}

/**
 * Save a step as draft without retaining actor or accepted artifacts on that
 * draft step. The last accepted revision remains in the record for a later
 * explicit acceptance comparison.
 */
export function recordDraft(record: RunRecord, step: RunStepId): RunRecord {
  return {
    ...record,
    steps: { ...record.steps, [step]: { state: 'draft' } },
  };
}

/** Maps each DECIDE-owned artifact family to the checkpoint that accepts it. */
export function stepForArtifactPath(path: string): RunStepId | undefined {
  if (path.startsWith('.docs/track/')) return 'explore';
  if (path.startsWith('.docs/complexity/')) return 'complexity';
  if (path.startsWith('.docs/specs/')) return 'prd';
  if (path.startsWith('.docs/architecture/')) return 'architecture_diagram';
  if (path.startsWith('.docs/decisions/architecture-review-')) return 'architecture_review';
  if (path.startsWith('.docs/decisions/adr-')) return 'architecture_review';
  if (path.startsWith('.docs/stories/')) return 'stories';
  if (path.startsWith('.docs/conflicts/')) return 'conflict_check';
  if (path.startsWith('.docs/plans/')) return 'plan';
  if (path.startsWith('.docs/coherence/')) return 'coherence_check';
  if (path.startsWith('.docs/coherence-waivers/')) return 'coherence_check';
  if (path.startsWith('.docs/plan-review/')) return 'plan_review';
  return undefined;
}

function acceptedArtifacts(record: RunRecord): readonly (ArtifactDigest & { readonly step: RunStepId })[] {
  return RUN_STEP_ORDER.flatMap((step) => {
    const recordStep = record.steps[step];
    return recordStep?.state === 'accepted'
      ? recordStep.artifacts.map((artifact) => ({ ...artifact, step }))
      : [];
  });
}

/**
 * Classify the current change-set against recorded acceptance. A changed accepted
 * step invalidates all later accepted steps until they are explicitly reconfirmed.
 */
export function classifyArtifacts(record: RunRecord, currentDigests: readonly ArtifactDigest[]): ArtifactClassification {
  const acceptedByDigest = acceptedArtifacts(record);
  const acceptedByPath = new Map<string, RunStepId>();
  for (const artifact of acceptedByDigest) acceptedByPath.set(artifact.path, artifact.step);
  const currentPaths = new Set(currentDigests.map((artifact) => artifact.path));
  const draft: ClassifiedArtifact[] = [];
  const draftSteps = new Set<RunStepId>();

  for (const artifact of acceptedByDigest) {
    if (!currentPaths.has(artifact.path)) {
      draft.push(artifact);
      draftSteps.add(artifact.step);
    }
  }

  const matched: (ArtifactDigest & { readonly step: RunStepId })[] = [];
  for (const artifact of currentDigests) {
    const accepted = acceptedByDigest.find((candidate) => candidate.path === artifact.path && candidate.sha256 === artifact.sha256);
    if (accepted !== undefined) {
      matched.push(accepted);
      continue;
    }
    const step = acceptedByPath.get(artifact.path) ?? stepForArtifactPath(artifact.path);
    draft.push({ ...artifact, ...(step === undefined ? {} : { step }) });
    if (step !== undefined) draftSteps.add(step);
  }

  const needsReconfirm = new Set(record.needsReconfirm);
  for (const step of draftSteps) for (const later of laterAcceptedSteps(record, step)) needsReconfirm.add(later);
  for (const step of draftSteps) needsReconfirm.delete(step);

  const orderedNeedsReconfirm = RUN_STEP_ORDER.filter((step) => needsReconfirm.has(step));
  const reconfirmSet = new Set(orderedNeedsReconfirm);
  return {
    accepted: matched.filter((artifact) => !draftSteps.has(artifact.step) && !reconfirmSet.has(artifact.step)),
    draft,
    needsReconfirm: orderedNeedsReconfirm,
  };
}
