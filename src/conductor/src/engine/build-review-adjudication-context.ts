import { BUILD_REVIEW_FINDING_VOCABULARIES } from './build-review-domain.js';
import type { BuildReviewRubricId } from '../types/config.js';
import type { BuildReviewAggregate, BuildReviewRawSourceProjection } from './build-review-aggregate.js';
import { projectBuildReviewAggregateSources } from './build-review-aggregate.js';
import { isCarryEligibleRemediationCase, type RemediationCaseCarryInput } from './remediation-case-reconciler.js';
import type { RemediationCaseEffect, RemediationCaseRecord, RemediationCaseSourceLink, RemediationCaseSuppressionEntry } from './remediation-case-store.js';
import type {
  RemediationCaseDisposition,
  RemediationCaseEscalationOwner,
  RemediationCaseRefutation,
  RemediationCaseSourceOutcome,
} from './remediation-case-artifact.js';

export const BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS = Object.freeze({
  maxCurrentSources: 512,
  maxPolicyCriteria: 64,
  maxAdmittedTaskContracts: 128,
  maxPlanIndexEntries: 1_024,
  maxPriorCases: 128,
  maxSourcesPerCase: 512,
  maxEvidenceLocations: 64,
  maxReferenceBytes: 256,
  maxTextBytes: 8_000,
  maxSerializedBytes: 256 * 1024,
});

const MAX_PRIOR_SOURCE_DIGESTS_PER_CASE = 4;
const MAX_PRIOR_SOURCE_DIGEST_BYTES = 64 * 1024;
const MAX_PRIOR_SOURCE_DIGEST_SUMMARY_BYTES = 1_000;
const MAX_PRIOR_SOURCE_DIGEST_EVIDENCE_LOCATIONS = 8;

/** Bounded finding detail recovered from the branch artifact that raised a source. */
export interface BuildReviewAdjudicationPriorFindingDigest {
  readonly rubric: string;
  readonly concernKind: string;
  readonly summary: string;
  readonly evidenceLocations: readonly string[];
  readonly lapId: string;
}

export interface BuildReviewAdjudicationPriorSource extends RemediationCaseSourceLink {
  /** Optional because a historical branch artifact may have been lost or be unreadable. */
  readonly finding?: BuildReviewAdjudicationPriorFindingDigest;
}

export interface BuildReviewAdjudicationCurrentSource extends BuildReviewRawSourceProjection {
  readonly sourceId: string;
}

export interface BuildReviewAdjudicationPriorCase {
  readonly id: string;
  readonly disposition: RemediationCaseRecord['disposition'];
  readonly priority: RemediationCaseRecord['priority'];
  readonly rationale: string;
  readonly confidence: RemediationCaseRecord['confidence'];
  readonly resolution: RemediationCaseRecord['resolution'];
  readonly sources: readonly BuildReviewAdjudicationPriorSource[];
  readonly effect: RemediationCaseEffect;
  /** Engine-projected evidence that this prior case may carry a later binding. */
  readonly operatorAccepted?: {
    readonly originSourceIds: readonly string[];
    readonly originLapIds: readonly string[];
  };
  readonly refutation?: RemediationCaseRefutation;
  /** The decision owner of a persisted `escalate` stop, exactly as stored. */
  readonly escalation?: RemediationCaseRecord['escalation'];
  /** The blocked consistency verdict a persisted `escalate` stop retains. */
  readonly consistencyStop?: RemediationCaseRecord['consistencyStop'];
  /** The lower severity recorded by a persisted non-blocking advisory case. */
  readonly adjudicatedSeverity?: RemediationCaseRecord['adjudicatedSeverity'];
  /** Prior cases that establish this case as a recurrence. */
  readonly recurrenceOf?: readonly string[];
  /** Prior cases retained as distinct from this case. */
  readonly distinctFrom?: readonly { readonly caseId: string; readonly reason: string }[];
}

/** The active approved-plan contract that decides whether work is admitted. */
export interface BuildReviewAdjudicationPlanContract {
  /** `null` states that no plan is bound — never an omitted field. */
  readonly path: string | null;
  readonly pointers: readonly string[];
  /** Every active plan task's complete body, available for repair admission. */
  readonly admittedTaskContracts?: readonly BuildReviewAdjudicationTaskContract[];
  /** Every active plan task without its full body. */
  readonly index?: readonly BuildReviewAdjudicationPlanIndexEntry[];
}

export interface BuildReviewAdjudicationTaskContract {
  readonly id: string;
  readonly contract: string;
}

export interface BuildReviewAdjudicationPlanIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly dependencies: readonly string[];
}

/** Engine-supplied task-status evidence for the active plan. */
export interface BuildReviewAdjudicationTaskStatus {
  readonly path: string | null;
  readonly tasks: readonly { readonly id: string; readonly status: string }[];
}

const ABSENT_PLAN_CONTRACT: BuildReviewAdjudicationPlanContract = Object.freeze({ path: null, pointers: Object.freeze([]), admittedTaskContracts: Object.freeze([]), index: Object.freeze([]) });
const ABSENT_TASK_STATUS: BuildReviewAdjudicationTaskStatus = Object.freeze({ path: null, tasks: Object.freeze([]) });

/** The approved lifecycle boundaries that a policy finding cannot reclaim. */
const RESERVED_LIFECYCLE_OWNERS = Object.freeze({
  buildTaskCompletion: 'build_task_close',
  testRealness: 'build_review:testQuality',
  productCompletion: 'prd_audit',
  manualFunctionality: 'manual_test',
  architectureChoice: 'architecture_review',
  adrConformance: 'architecture_review_as_built',
  planGrowth: 'prd_audit',
});

export interface BuildReviewAdjudicationPolicyContext {
  readonly rubric: string;
  readonly question: string;
  readonly effectivePolicyIdentity: string;
  /** Declared supporting policy resources; no mutable policy body is re-read. */
  readonly criteria: readonly string[];
}

/**
 * The complete input to one post-join remediate judgement.
 *
 * The key set is the skill contract, not an implementation detail:
 * `skills/remediate/SKILL.md` selects its case branch on `mode` + `domain` and
 * then names `currentFindings`, `priorCases`, `planContract`, `taskStatus`,
 * `effectPointers`, and `suppressionHistory`. A context missing any of them routes a real dispatch into
 * the legacy gap-plan branch, whose output the case parser then rejects.
 */
export interface BuildReviewAdjudicationContext {
  readonly version: 'v1';
  readonly mode: 'case-v1' | 'case-v2';
  readonly domain: 'build_review';
  readonly lapId: string;
  readonly snapshotDigest: string;
  readonly currentFindings: readonly BuildReviewAdjudicationCurrentSource[];
  /** Question/criteria/identity for every current source rubric. */
  readonly policyContext: readonly BuildReviewAdjudicationPolicyContext[];
  /** Engine-stamped owners that policy findings may not supersede. */
  readonly lifecycleOwners: typeof RESERVED_LIFECYCLE_OWNERS;
  readonly priorCases: readonly BuildReviewAdjudicationPriorCase[];
  /** Digests omitted solely to preserve the serialized-context ceiling. */
  readonly priorDigestsOmitted: number;
  readonly planContract: BuildReviewAdjudicationPlanContract;
  readonly taskStatus: BuildReviewAdjudicationTaskStatus;
  /** Prior effect state plus durable BUILD-attempt evidence, one line per case. */
  readonly effectPointers: readonly string[];
  /** Non-blocking suppression history; it is intentionally not a source set. */
  readonly suppressionHistory: readonly RemediationCaseSuppressionEntry[];
  /** Per-rubric thresholds are engine facts that bound an advisory downgrade. */
  readonly declaredSeverityThresholds: Readonly<Partial<Record<string, import('./build-review-domain.js').BuildReviewSeverity>>>;
  readonly admittedDispositions: readonly RemediationCaseDisposition[];
}

export interface AssembleBuildReviewAdjudicationContextInput {
  readonly aggregate: BuildReviewAggregate;
  readonly priorCases: readonly RemediationCaseRecord[];
  /** Exact accepted-risk identities only; no summary or rubric-wide matching. */
  readonly operatorResolvedFindingIds?: ReadonlySet<string>;
  /** Exact source identities settled from finalized durable case history. */
  readonly excludedSourceIds?: ReadonlySet<string>;
  /** Current-lap carry authority, resolved by the disposition owner. */
  readonly carryInput?: RemediationCaseCarryInput;
  readonly planContract?: BuildReviewAdjudicationPlanContract;
  readonly taskStatus?: BuildReviewAdjudicationTaskStatus;
  /** Durable work-order attempt evidence; renders into `effectPointers`. */
  readonly attemptedCaseIds?: readonly string[];
  readonly suppressions?: readonly RemediationCaseSuppressionEntry[];
  readonly declaredSeverityThresholds?: Readonly<Partial<Record<string, import('./build-review-domain.js').BuildReviewSeverity>>>;
  /**
   * Branch-artifact findings keyed by the persisted `<rubric>:<findingId>`
   * source identity. The async artifact reader belongs to the coordinator;
   * this pure context boundary owns projection and byte accounting.
   */
  readonly priorFindingDigests?: ReadonlyMap<string, BuildReviewAdjudicationPriorFindingDigest>;
}

export type BuildReviewAdjudicationContextStop =
  | { readonly code: 'invalid-aggregate' }
  | { readonly code: 'missing-scope-evidence'; readonly subject: 'policy-context' | 'admitted-task-contracts' | 'task-status' }
  | { readonly code: 'field-overflow'; readonly subject: 'current-source' | 'prior-case' | 'policy-context' | 'admitted-task-contract' | 'plan-index'; readonly field: string; readonly limit: number; readonly actual: number; readonly caseId?: string }
  | { readonly code: 'unrepresentable-prior-case'; readonly caseId: string; readonly field: string }
  | { readonly code: 'serialized-byte-overflow'; readonly limit: number; readonly actual: number };

export type AssembleBuildReviewAdjudicationContextResult =
  | { readonly ok: true; readonly context: BuildReviewAdjudicationContext }
  | { readonly ok: false; readonly stop: BuildReviewAdjudicationContextStop };

const LIMITS = BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS;
// Keyed by the store's own vocabularies: a value the store learns to persist
// fails to compile here until this boundary represents it too.
const OUTCOMES: Readonly<Record<RemediationCaseSourceOutcome, true>> = Object.freeze({
  acted: true, deferred: true, rejected: true, refuted: true, advisory: true, merged: true, escalate: true, carried: true,
});
const DISPOSITIONS: Readonly<Record<RemediationCaseDisposition, true>> = Object.freeze({
  act: true, defer: true, reject: true, refute: true, advisory: true, escalate: true,
});
const ESCALATION_OWNERS: Readonly<Record<RemediationCaseEscalationOwner, true>> = Object.freeze({
  product: true, plan: true, architecture: true,
});

function bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function boundedString(
  value: unknown,
  max: number,
  subject: 'current-source' | 'prior-case' | 'policy-context' | 'admitted-task-contract' | 'plan-index',
  field: string,
  caseId?: string,
): BuildReviewAdjudicationContextStop | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return subject === 'prior-case'
      ? { code: 'unrepresentable-prior-case', caseId: caseId ?? 'unknown', field }
      : { code: 'invalid-aggregate' };
  }
  const actual = bytes(value);
  return actual > max ? { code: 'field-overflow', subject, field, limit: max, actual, ...(caseId === undefined ? {} : { caseId }) } : undefined;
}

function customPolicyContext(
  aggregate: BuildReviewAggregate,
  rubric: string,
): BuildReviewAdjudicationPolicyContext | undefined {
  const descriptor = aggregate.customResults?.[rubric]?.descriptor;
  if (!descriptor || descriptor.declaration.rubricId !== rubric) return undefined;
  return Object.freeze({
    rubric,
    question: descriptor.declaration.question,
    effectivePolicyIdentity: descriptor.effectivePolicy.bundleDigest,
    criteria: Object.freeze([...(descriptor.criteria ?? descriptor.declaration.resources)]),
  });
}

/** Every shipped built-in rubric; a policy context outside this map is a custom policy. */
const BUILTIN_POLICY_QUESTIONS: Readonly<Record<BuildReviewRubricId, string>> = Object.freeze({
  testQuality: 'Are the tests for new behavior real?',
  security: 'Does the changed code introduce a concrete security defect?',
  implementationQuality: 'Does the changed code introduce a concrete code-quality or domain-modelling defect?',
});
function isBuiltinPolicyRubric(rubric: string): rubric is BuildReviewRubricId {
  return Object.hasOwn(BUILTIN_POLICY_QUESTIONS, rubric);
}
/** Contexts resolved from the aggregate's custom evidence, never from a rubric name. */
const CUSTOM_POLICY_CONTEXTS = new WeakSet<BuildReviewAdjudicationPolicyContext>();
function isCustomPolicyContext(policy: BuildReviewAdjudicationPolicyContext): boolean {
  return CUSTOM_POLICY_CONTEXTS.has(policy);
}

function policyContexts(
  aggregate: BuildReviewAggregate,
  sources: readonly BuildReviewAdjudicationCurrentSource[],
): BuildReviewAdjudicationPolicyContext[] | undefined {
  const rubrics = [...new Set(sources.map((source) => source.rubric))].sort();
  const contexts: BuildReviewAdjudicationPolicyContext[] = [];
  for (const rubric of rubrics) {
    const custom = customPolicyContext(aggregate, rubric);
    if (custom) {
      CUSTOM_POLICY_CONTEXTS.add(custom);
      contexts.push(custom);
      continue;
    }
    if (!isBuiltinPolicyRubric(rubric)) return undefined;
    const contractVersion = sources.find((source) => source.rubric === rubric)!.contractVersion;
    contexts.push(Object.freeze({
      rubric,
      question: BUILTIN_POLICY_QUESTIONS[rubric],
      effectivePolicyIdentity: `${rubric}:${contractVersion}`,
      criteria: Object.freeze([...BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds]),
    }));
  }
  return contexts;
}

function validateAdmissionScope(
  policyContext: readonly BuildReviewAdjudicationPolicyContext[],
  planContract: BuildReviewAdjudicationPlanContract,
  taskStatus: BuildReviewAdjudicationTaskStatus,
): BuildReviewAdjudicationContextStop | undefined {
  // Implementation-quality repairs have the same admission boundary as
  // custom-policy repairs: neither may grow the approved plan from a review
  // finding.  The source rubric is engine-owned, so this cannot be bypassed
  // by a provider choosing the older case-v1 envelope.
  const requiresAdmission = policyContext.some((policy) =>
    isCustomPolicyContext(policy) || policy.rubric === 'implementationQuality',
  );
  if (!requiresAdmission) return undefined;
  if (planContract.path === null || !Array.isArray(planContract.admittedTaskContracts)) {
    return { code: 'missing-scope-evidence', subject: 'admitted-task-contracts' };
  }
  if (taskStatus.path === null) return { code: 'missing-scope-evidence', subject: 'task-status' };
  if (planContract.admittedTaskContracts.length > LIMITS.maxAdmittedTaskContracts) {
    return { code: 'field-overflow', subject: 'admitted-task-contract', field: 'admittedTaskContracts', limit: LIMITS.maxAdmittedTaskContracts, actual: planContract.admittedTaskContracts.length };
  }
  const contractIds = new Set<string>();
  for (const task of planContract.admittedTaskContracts) {
    const id = boundedString(task?.id, LIMITS.maxReferenceBytes, 'admitted-task-contract', 'id');
    if (id) return id;
    const contract = boundedString(task?.contract, LIMITS.maxTextBytes, 'admitted-task-contract', 'contract');
    if (contract) return contract;
    if (contractIds.has(task.id)) return { code: 'missing-scope-evidence', subject: 'admitted-task-contracts' };
    contractIds.add(task.id);
  }
  const statuses = new Set(taskStatus.tasks.map((task) => task.id));
  if ([...contractIds].some((id) => !statuses.has(id))) {
    return { code: 'missing-scope-evidence', subject: 'task-status' };
  }
  for (const policy of policyContext) {
    const question = boundedString(policy.question, LIMITS.maxTextBytes, 'policy-context', 'question');
    if (question) return question;
    const identity = boundedString(policy.effectivePolicyIdentity, LIMITS.maxReferenceBytes, 'policy-context', 'effectivePolicyIdentity');
    if (identity) return identity;
    if (policy.criteria.length > LIMITS.maxPolicyCriteria) {
      return { code: 'field-overflow', subject: 'policy-context', field: 'criteria', limit: LIMITS.maxPolicyCriteria, actual: policy.criteria.length };
    }
    // A captured policy body is text, not a reference.  It is delivered whole
    // or the lap stops before dispatch; the judge never sees an excerpt.
    for (const criterion of policy.criteria) {
      const criterionStop = boundedString(criterion, LIMITS.maxReferenceBytes, 'policy-context', 'criteria[]');
      if (criterionStop) return criterionStop;
    }
  }
  return undefined;
}

function validatePlanIndex(planContract: BuildReviewAdjudicationPlanContract): BuildReviewAdjudicationContextStop | undefined {
  const index = planContract.path === null ? [] : planContract.index ?? [];
  if (index.length > LIMITS.maxPlanIndexEntries) {
    return { code: 'field-overflow', subject: 'plan-index', field: 'index', limit: LIMITS.maxPlanIndexEntries, actual: index.length };
  }
  for (const entry of index) {
    const id = boundedString(entry?.id, LIMITS.maxReferenceBytes, 'plan-index', 'id');
    if (id) return id;
    const title = boundedString(entry?.title, LIMITS.maxTextBytes, 'plan-index', 'title');
    if (title) return title;
    if (!Array.isArray(entry?.dependencies)) return { code: 'invalid-aggregate' };
    for (const dependency of entry.dependencies) {
      const dependencyStop = boundedString(dependency, LIMITS.maxReferenceBytes, 'plan-index', 'dependencies[]');
      if (dependencyStop) return dependencyStop;
    }
  }
  return undefined;
}

function validateCurrent(source: BuildReviewRawSourceProjection): BuildReviewAdjudicationContextStop | undefined {
  const fields: readonly [string, unknown, number][] = [
    ['rubric', source.rubric, LIMITS.maxReferenceBytes],
    ['findingId', source.findingId, LIMITS.maxReferenceBytes],
    ['contractVersion', source.contractVersion, LIMITS.maxReferenceBytes],
    ['concernKind', source.concernKind, LIMITS.maxReferenceBytes],
    ['summary', source.summary, LIMITS.maxTextBytes],
  ];
  for (const [field, value, limit] of fields) {
    const stop = boundedString(value, limit, 'current-source', field);
    if (stop) return stop;
  }
  if (!Array.isArray(source.evidenceLocations) || source.evidenceLocations.length > LIMITS.maxEvidenceLocations) {
    return { code: 'field-overflow', subject: 'current-source', field: 'evidenceLocations', limit: LIMITS.maxEvidenceLocations, actual: Array.isArray(source.evidenceLocations) ? source.evidenceLocations.length : Number.POSITIVE_INFINITY };
  }
  for (const location of source.evidenceLocations) {
    const stop = boundedString(location, LIMITS.maxReferenceBytes, 'current-source', 'evidenceLocations[]');
    if (stop) return stop;
  }
  return undefined;
}

function validateEffect(caseRecord: RemediationCaseRecord): BuildReviewAdjudicationContextStop | undefined {
  const effect = caseRecord.effect;
  if (caseRecord.disposition === 'reject' || caseRecord.disposition === 'escalate' || caseRecord.disposition === 'advisory' || caseRecord.disposition === 'refute' && effect.kind === 'none') {
    return effect.kind === 'none' ? undefined : { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'effect' };
  }
  const expectedKind = caseRecord.disposition === 'act' ? 'action' : 'deferral';
  if (effect.kind !== expectedKind || !('status' in effect)) return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'effect' };
  const effectId = boundedString(effect.id, LIMITS.maxReferenceBytes, 'prior-case', 'effect.id', caseRecord.id);
  if (effectId) return effectId;
  if (!['reserved', 'applied', 'failed'].includes(effect.status)) return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'effect.status' };
  if (effect.status === 'applied') {
    const reference = effect.kind === 'action' ? effect.workOrderId : effect.issueUrl;
    return boundedString(reference, effect.kind === 'action' ? LIMITS.maxReferenceBytes : LIMITS.maxTextBytes, 'prior-case', effect.kind === 'action' ? 'effect.workOrderId' : 'effect.issueUrl', caseRecord.id);
  }
  if (effect.status === 'failed') return boundedString(effect.diagnostic, LIMITS.maxTextBytes, 'prior-case', 'effect.diagnostic', caseRecord.id);
  return undefined;
}

/** Mirrors the store's pairing: stop evidence exists only on, and always on, an `escalate` case. */
function validateDecisionStop(caseRecord: RemediationCaseRecord): BuildReviewAdjudicationContextStop | undefined {
  const { escalation, consistencyStop } = caseRecord;
  const unrepresentable = (field: string): BuildReviewAdjudicationContextStop => ({ code: 'unrepresentable-prior-case', caseId: caseRecord.id, field });
  if (caseRecord.disposition !== 'escalate') {
    return escalation === undefined && consistencyStop === undefined ? undefined : unrepresentable('decision-stop');
  }
  if (escalation === undefined && consistencyStop === undefined) return unrepresentable('decision-stop');
  if (escalation !== undefined && !Object.hasOwn(ESCALATION_OWNERS, escalation.owner)) return unrepresentable('escalation.owner');
  if (consistencyStop === undefined) return undefined;
  if (!Array.isArray(consistencyStop.sourceIds) || consistencyStop.sourceIds.length === 0) return unrepresentable('consistencyStop.sourceIds');
  if (consistencyStop.sourceIds.length > LIMITS.maxSourcesPerCase) {
    return { code: 'field-overflow', subject: 'prior-case', field: 'consistencyStop.sourceIds', limit: LIMITS.maxSourcesPerCase, actual: consistencyStop.sourceIds.length, caseId: caseRecord.id };
  }
  for (const sourceId of consistencyStop.sourceIds) {
    const stop = boundedString(sourceId, LIMITS.maxReferenceBytes, 'prior-case', 'consistencyStop.sourceIds[]', caseRecord.id);
    if (stop) return stop;
  }
  return boundedString(consistencyStop.rationale, LIMITS.maxTextBytes, 'prior-case', 'consistencyStop.rationale', caseRecord.id);
}

function validatePriorCase(caseRecord: RemediationCaseRecord): BuildReviewAdjudicationContextStop | undefined {
  for (const [field, value, limit] of [
    ['id', caseRecord.id, LIMITS.maxReferenceBytes],
    ['rationale', caseRecord.rationale, LIMITS.maxTextBytes],
  ] as const) {
    const stop = boundedString(value, limit, 'prior-case', field, caseRecord.id);
    if (stop) return stop;
  }
  if (caseRecord.domain !== 'build_review' || !Object.hasOwn(DISPOSITIONS, caseRecord.disposition) ||
    !['critical', 'high', 'medium', 'low'].includes(caseRecord.priority) ||
    !['high', 'medium', 'low'].includes(caseRecord.confidence) || !['open', 'resolved'].includes(caseRecord.resolution)) {
    return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'case' };
  }
  if (caseRecord.disposition === 'advisory' &&
    !['critical', 'major', 'minor', 'nit'].includes(caseRecord.adjudicatedSeverity ?? '')) {
    return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'adjudicatedSeverity' };
  }
  if (!Array.isArray(caseRecord.sources) || caseRecord.sources.length === 0 || caseRecord.sources.length > LIMITS.maxSourcesPerCase) {
    return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'sources' };
  }
  const sourceIds = new Set<string>();
  for (const source of caseRecord.sources) {
    const sourceId = boundedString(source.sourceId, LIMITS.maxReferenceBytes, 'prior-case', 'sources[].sourceId', caseRecord.id);
    if (sourceId) return sourceId;
    if (!Object.hasOwn(OUTCOMES, source.outcome) || Number.isNaN(Date.parse(source.recordedAt)) || sourceIds.has(source.sourceId)) {
      return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'sources' };
    }
    sourceIds.add(source.sourceId);
  }
  return validateEffect(caseRecord) ?? validateDecisionStop(caseRecord);
}

function freezeRefutation(refutation: RemediationCaseRefutation): RemediationCaseRefutation {
  return Object.freeze({
    claim: refutation.claim,
    assertions: Object.freeze(refutation.assertions.map((assertion) => Object.freeze({
      assertion: assertion.assertion,
      verdict: assertion.verdict,
      evidence: Object.freeze(assertion.evidence.map((evidence) => Object.freeze({ ...evidence }))),
    }))),
  });
}

/** One compact durable pointer per prior case; no prose, no tree re-audit. */
function effectPointerFor(caseRecord: RemediationCaseRecord, attempted: ReadonlySet<string>): string | undefined {
  const effect = caseRecord.effect;
  if (effect.kind === 'none') return undefined;
  const reference = effect.status === 'applied'
    ? effect.kind === 'action' ? ` (work order ${effect.workOrderId})` : ` (issue ${effect.issueUrl})`
    : effect.status === 'failed' ? ` (${effect.diagnostic})` : '';
  const attempt = attempted.has(caseRecord.id) ? '; BUILD attempted' : '';
  return `case ${caseRecord.id}: ${effect.kind} effect ${effect.id} ${effect.status}${reference}${attempt}`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let length = 0;
  let result = '';
  for (const character of value) {
    const characterBytes = bytes(character);
    if (length + characterBytes > maxBytes) break;
    result += character;
    length += characterBytes;
  }
  return result;
}

function freezePriorFindingDigest(
  digest: BuildReviewAdjudicationPriorFindingDigest | undefined,
): BuildReviewAdjudicationPriorFindingDigest | undefined {
  if (digest === undefined ||
    typeof digest.rubric !== 'string' || digest.rubric.length === 0 || bytes(digest.rubric) > LIMITS.maxReferenceBytes ||
    typeof digest.concernKind !== 'string' || digest.concernKind.length === 0 || bytes(digest.concernKind) > LIMITS.maxReferenceBytes ||
    typeof digest.summary !== 'string' || digest.summary.length === 0 ||
    typeof digest.lapId !== 'string' || digest.lapId.length === 0 || bytes(digest.lapId) > LIMITS.maxReferenceBytes ||
    !Array.isArray(digest.evidenceLocations)) return undefined;
  const evidenceLocations = digest.evidenceLocations
    .filter((location): location is string => typeof location === 'string' && location.length > 0 && bytes(location) <= LIMITS.maxReferenceBytes)
    .slice(0, MAX_PRIOR_SOURCE_DIGEST_EVIDENCE_LOCATIONS);
  return Object.freeze({
    rubric: digest.rubric,
    concernKind: digest.concernKind,
    summary: truncateUtf8(digest.summary, MAX_PRIOR_SOURCE_DIGEST_SUMMARY_BYTES),
    evidenceLocations: Object.freeze(evidenceLocations),
    lapId: digest.lapId,
  });
}

function priorDigestKey(caseId: string, sourceId: string): string {
  return `${caseId}\u0000${sourceId}`;
}

function comparePriorSources(left: RemediationCaseSourceLink, right: RemediationCaseSourceLink): number {
  return Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
    left.sourceId.localeCompare(right.sourceId);
}

function freezePriorCase(
  caseRecord: RemediationCaseRecord,
  carryInput: RemediationCaseCarryInput | undefined,
  includedDigestKeys: ReadonlySet<string>,
  priorFindingDigests: ReadonlyMap<string, BuildReviewAdjudicationPriorFindingDigest> | undefined,
): BuildReviewAdjudicationPriorCase {
  const sources = [...caseRecord.sources].sort(comparePriorSources).map((source) => {
    const digest = includedDigestKeys.has(priorDigestKey(caseRecord.id, source.sourceId))
      ? freezePriorFindingDigest(priorFindingDigests?.get(source.sourceId))
      : undefined;
    return Object.freeze({ ...source, ...(digest === undefined ? {} : { finding: digest }) });
  });
  const origins = caseRecord.operatorAcceptance?.origins ?? [];
  const operatorAccepted = carryInput !== undefined && isCarryEligibleRemediationCase(caseRecord, carryInput)
    ? Object.freeze({
      originSourceIds: Object.freeze(origins.map((origin) => origin.sourceId)),
      originLapIds: Object.freeze(origins.map((origin) => origin.lapId)),
    })
    : undefined;
  return Object.freeze({
    id: caseRecord.id,
    disposition: caseRecord.disposition,
    priority: caseRecord.priority,
    rationale: caseRecord.rationale,
    confidence: caseRecord.confidence,
    resolution: caseRecord.resolution,
    sources: Object.freeze(sources),
    effect: Object.freeze({ ...caseRecord.effect }) as RemediationCaseEffect,
    ...(operatorAccepted === undefined ? {} : { operatorAccepted }),
    ...(caseRecord.disposition === 'refute' ? { refutation: freezeRefutation(caseRecord.refutation!) } : {}),
    ...(caseRecord.escalation === undefined ? {} : { escalation: Object.freeze({ owner: caseRecord.escalation.owner }) }),
    ...(caseRecord.consistencyStop === undefined ? {} : {
      consistencyStop: Object.freeze({
        sourceIds: Object.freeze([...caseRecord.consistencyStop.sourceIds]),
        rationale: caseRecord.consistencyStop.rationale,
      }),
    }),
    ...(caseRecord.disposition === 'advisory' ? { adjudicatedSeverity: caseRecord.adjudicatedSeverity! } : {}),
    ...(caseRecord.recurrenceOf === undefined ? {} : { recurrenceOf: Object.freeze([...caseRecord.recurrenceOf]) }),
    ...(caseRecord.distinctFrom === undefined ? {} : {
      distinctFrom: Object.freeze(caseRecord.distinctFrom.map((relationship) => Object.freeze({ ...relationship }))),
    }),
  });
}

/**
 * Creates one complete deterministic projection. The caller receives every
 * current unresolved source and every prior case, or a typed stop—never a
 * silently truncated provider prompt.
 */
/**
 * The adjudication source identity, in one place.
 *
 * The judge is handed these ids and returns them verbatim, and the coordinator
 * validates its judgement against the set it builds itself. When the two sides
 * derived that identity independently they drifted — the context stamped
 * `<rubric>:<findingId>` while the coordinator passed the bare `findingId`, so
 * every contract-following judgement failed closed as `unknown-source` and no
 * lap could ever settle. Both sides call this now.
 *
 * The rubric prefix is load-bearing for post-join adjudication: two rubrics may
 * legitimately raise the same `findingId`, and a bare id cannot tell them apart.
 */
export function buildReviewAdjudicationSourceId(
  source: Pick<BuildReviewRawSourceProjection, 'rubric' | 'findingId'>,
): string {
  return `${source.rubric}:${source.findingId}`;
}

/**
 * Operator-facing description of a context stop. The halt reason is the only
 * place an operator sees why a lap stopped, so it carries the offending
 * subject, field, and bound rather than the bare code.
 */
export function describeBuildReviewAdjudicationContextStop(stop: BuildReviewAdjudicationContextStop): string {
  switch (stop.code) {
    case 'invalid-aggregate':
      return stop.code;
    case 'missing-scope-evidence':
      return `${stop.code} (${stop.subject})`;
    case 'field-overflow':
      return `${stop.code} (${stop.subject}${stop.caseId === undefined ? '' : ` ${stop.caseId}`}.${stop.field}: ${stop.actual} > ${stop.limit})`;
    case 'unrepresentable-prior-case':
      return `${stop.code} (${stop.caseId}.${stop.field})`;
    case 'serialized-byte-overflow':
      return `${stop.code} (${stop.actual} > ${stop.limit} bytes)`;
  }
}

export function assembleBuildReviewAdjudicationContext(
  input: AssembleBuildReviewAdjudicationContextInput,
): AssembleBuildReviewAdjudicationContextResult {
  const rawSources = projectBuildReviewAggregateSources(input.aggregate);
  if (!rawSources) return { ok: false, stop: { code: 'invalid-aggregate' } };
  const unresolvedSources = rawSources.filter((source) =>
    !input.operatorResolvedFindingIds?.has(source.findingId) &&
    !input.excludedSourceIds?.has(buildReviewAdjudicationSourceId(source)),
  );
  if (unresolvedSources.length > LIMITS.maxCurrentSources) {
    return { ok: false, stop: { code: 'field-overflow', subject: 'current-source', field: 'currentFindings', limit: LIMITS.maxCurrentSources, actual: unresolvedSources.length } };
  }
  const currentFindings: BuildReviewAdjudicationCurrentSource[] = [];
  for (const source of unresolvedSources) {
    const stop = validateCurrent(source);
    if (stop) return { ok: false, stop };
    currentFindings.push(Object.freeze({ ...source, sourceId: buildReviewAdjudicationSourceId(source) }));
  }
  currentFindings.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const policyContext = policyContexts(input.aggregate, currentFindings);
  if (!policyContext) return { ok: false, stop: { code: 'missing-scope-evidence', subject: 'policy-context' } };

  if (input.priorCases.length > LIMITS.maxPriorCases) {
    return { ok: false, stop: { code: 'field-overflow', subject: 'prior-case', field: 'priorCases', limit: LIMITS.maxPriorCases, actual: input.priorCases.length } };
  }
  const caseIds = new Set<string>();
  for (const caseRecord of input.priorCases) {
    const stop = validatePriorCase(caseRecord);
    if (stop) return { ok: false, stop };
    if (caseIds.has(caseRecord.id)) return { ok: false, stop: { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'duplicate-id' } };
    caseIds.add(caseRecord.id);
  }

  const attempted = new Set(input.attemptedCaseIds ?? []);
  const planContract = input.planContract ?? ABSENT_PLAN_CONTRACT;
  const taskStatus = input.taskStatus ?? ABSENT_TASK_STATUS;
  const scopeStop = validateAdmissionScope(policyContext, planContract, taskStatus);
  if (scopeStop) return { ok: false, stop: scopeStop };
  const indexStop = validatePlanIndex(planContract);
  if (indexStop) return { ok: false, stop: indexStop };
  const mode = policyContext.some((policy) =>
    isCustomPolicyContext(policy) || policy.rubric === 'implementationQuality',
  ) ? 'case-v2' as const : 'case-v1' as const;
  const freezePriorCases = (includedDigestKeys: ReadonlySet<string>): readonly BuildReviewAdjudicationPriorCase[] =>
    Object.freeze(input.priorCases
      .map((caseRecord) => freezePriorCase(caseRecord, input.carryInput, includedDigestKeys, input.priorFindingDigests))
      .sort((left, right) => left.id.localeCompare(right.id)));
  const contextFor = (
    priorCases: readonly BuildReviewAdjudicationPriorCase[],
    priorDigestsOmitted: number,
  ): BuildReviewAdjudicationContext => Object.freeze({
    version: 'v1', mode, domain: 'build_review',
    lapId: input.aggregate.lapId, snapshotDigest: input.aggregate.snapshotDigest,
    currentFindings: Object.freeze(currentFindings),
    policyContext: Object.freeze(policyContext),
    lifecycleOwners: RESERVED_LIFECYCLE_OWNERS,
    priorCases,
    priorDigestsOmitted,
    planContract: Object.freeze({
      path: planContract.path,
      pointers: Object.freeze([...planContract.pointers]),
      admittedTaskContracts: Object.freeze(planContract.path === null ? [] : [...(planContract.admittedTaskContracts ?? [])].map((task) => Object.freeze({ ...task }))),
      index: Object.freeze(planContract.path === null ? [] : [...(planContract.index ?? [])].map((entry) => Object.freeze({
        ...entry,
        dependencies: Object.freeze([...entry.dependencies]),
      }))),
    }),
    taskStatus: Object.freeze({
      path: taskStatus.path,
      tasks: Object.freeze(taskStatus.tasks.map((task) => Object.freeze({ ...task }))),
    }),
    effectPointers: Object.freeze(priorCases.flatMap((priorCase) => {
      const source = input.priorCases.find((record) => record.id === priorCase.id)!;
      const pointer = effectPointerFor(source, attempted);
      return pointer === undefined ? [] : [pointer];
    })),
    suppressionHistory: Object.freeze([...(input.suppressions ?? [])]
      .sort((left, right) => left.findingId.localeCompare(right.findingId))
      .map((entry) => Object.freeze({ ...entry }))),
    declaredSeverityThresholds: Object.freeze({ ...(input.declaredSeverityThresholds ?? {}) }),
    admittedDispositions: Object.freeze<RemediationCaseDisposition[]>([
      'act', 'defer', 'reject', 'refute', ...(Object.values(input.declaredSeverityThresholds ?? {}).some((threshold) => threshold !== 'nit') ? ['advisory' as const] : []),
      ...(mode === 'case-v2' ? ['escalate' as const] : []),
    ]),
  });
  const digestCandidates = input.priorCases.flatMap((caseRecord) => [...caseRecord.sources]
    .sort(comparePriorSources)
    .slice(-MAX_PRIOR_SOURCE_DIGESTS_PER_CASE)
    .flatMap((source) => freezePriorFindingDigest(input.priorFindingDigests?.get(source.sourceId)) === undefined
      ? []
      : [{ key: priorDigestKey(caseRecord.id, source.sourceId), recordedAt: source.recordedAt, sourceId: source.sourceId, caseId: caseRecord.id }]))
    .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
      left.sourceId.localeCompare(right.sourceId) || left.caseId.localeCompare(right.caseId));
  // Account for the widest omission counter before admitting a byte of a
  // digest. Otherwise removing the final digest can itself add digits to the
  // counter and overflow a context that looked as though it had headroom.
  const base = contextFor(freezePriorCases(new Set()), digestCandidates.length);
  const baseBytes = bytes(JSON.stringify(base));
  if (baseBytes > LIMITS.maxSerializedBytes) {
    return { ok: false, stop: { code: 'serialized-byte-overflow', limit: LIMITS.maxSerializedBytes, actual: baseBytes } };
  }
  const digestBudget = Math.min(MAX_PRIOR_SOURCE_DIGEST_BYTES, LIMITS.maxSerializedBytes - baseBytes);
  const includedDigestKeys = new Set(digestCandidates.map((candidate) => candidate.key));
  let priorDigestsOmitted = 0;
  let context = contextFor(freezePriorCases(includedDigestKeys), priorDigestsOmitted);
  while (bytes(JSON.stringify(context)) - baseBytes > digestBudget && digestCandidates.length > priorDigestsOmitted) {
    includedDigestKeys.delete(digestCandidates[priorDigestsOmitted]!.key);
    priorDigestsOmitted += 1;
    context = contextFor(freezePriorCases(includedDigestKeys), priorDigestsOmitted);
  }
  const actual = bytes(JSON.stringify(context));
  if (actual > LIMITS.maxSerializedBytes) {
    return { ok: false, stop: { code: 'serialized-byte-overflow', limit: LIMITS.maxSerializedBytes, actual } };
  }
  return { ok: true, context };
}
