import type { BuildReviewAggregate, BuildReviewRawSourceProjection } from './build-review-aggregate.js';
import { projectBuildReviewAggregateSources } from './build-review-aggregate.js';
import type { RemediationCaseEffect, RemediationCaseRecord, RemediationCaseSourceLink, RemediationCaseSuppressionEntry } from './remediation-case-store.js';
import type { RemediationCaseRefutation } from './remediation-case-artifact.js';

export const BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS = Object.freeze({
  maxCurrentSources: 512,
  maxPolicyCriteria: 64,
  maxAdmittedTaskContracts: 128,
  maxPriorCases: 128,
  maxSourcesPerCase: 512,
  maxEvidenceLocations: 64,
  maxReferenceBytes: 256,
  maxTextBytes: 8_000,
  maxSerializedBytes: 128 * 1024,
});

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
  readonly sources: readonly RemediationCaseSourceLink[];
  readonly effect: RemediationCaseEffect;
  readonly refutation?: RemediationCaseRefutation;
}

/** The active approved-plan contract that decides whether work is admitted. */
export interface BuildReviewAdjudicationPlanContract {
  /** `null` states that no plan is bound — never an omitted field. */
  readonly path: string | null;
  readonly pointers: readonly string[];
  /** Every active plan task's complete body, available for repair admission. */
  readonly admittedTaskContracts?: readonly BuildReviewAdjudicationTaskContract[];
}

export interface BuildReviewAdjudicationTaskContract {
  readonly id: string;
  readonly contract: string;
}

/** Engine-supplied task-status evidence for the active plan. */
export interface BuildReviewAdjudicationTaskStatus {
  readonly path: string | null;
  readonly tasks: readonly { readonly id: string; readonly status: string }[];
}

const ABSENT_PLAN_CONTRACT: BuildReviewAdjudicationPlanContract = Object.freeze({ path: null, pointers: Object.freeze([]), admittedTaskContracts: Object.freeze([]) });
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
  readonly planContract: BuildReviewAdjudicationPlanContract;
  readonly taskStatus: BuildReviewAdjudicationTaskStatus;
  /** Prior effect state plus durable BUILD-attempt evidence, one line per case. */
  readonly effectPointers: readonly string[];
  /** Non-blocking suppression history; it is intentionally not a source set. */
  readonly suppressionHistory: readonly RemediationCaseSuppressionEntry[];
}

export interface AssembleBuildReviewAdjudicationContextInput {
  readonly aggregate: BuildReviewAggregate;
  readonly priorCases: readonly RemediationCaseRecord[];
  /** Exact accepted-risk identities only; no summary or rubric-wide matching. */
  readonly operatorResolvedFindingIds?: ReadonlySet<string>;
  /** Exact source identities settled from finalized durable case history. */
  readonly excludedSourceIds?: ReadonlySet<string>;
  readonly planContract?: BuildReviewAdjudicationPlanContract;
  readonly taskStatus?: BuildReviewAdjudicationTaskStatus;
  /** Durable work-order attempt evidence; renders into `effectPointers`. */
  readonly attemptedCaseIds?: readonly string[];
  readonly suppressions?: readonly RemediationCaseSuppressionEntry[];
}

export type BuildReviewAdjudicationContextStop =
  | { readonly code: 'invalid-aggregate' }
  | { readonly code: 'missing-scope-evidence'; readonly subject: 'policy-context' | 'admitted-task-contracts' | 'task-status' }
  | { readonly code: 'field-overflow'; readonly subject: 'current-source' | 'prior-case' | 'policy-context' | 'admitted-task-contract'; readonly field: string; readonly limit: number; readonly actual: number; readonly caseId?: string }
  | { readonly code: 'unrepresentable-prior-case'; readonly caseId: string; readonly field: string }
  | { readonly code: 'serialized-byte-overflow'; readonly limit: number; readonly actual: number };

export type AssembleBuildReviewAdjudicationContextResult =
  | { readonly ok: true; readonly context: BuildReviewAdjudicationContext }
  | { readonly ok: false; readonly stop: BuildReviewAdjudicationContextStop };

const LIMITS = BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS;
const OUTCOMES = new Set(['acted', 'deferred', 'rejected', 'refuted', 'merged']);

function bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function boundedString(
  value: unknown,
  max: number,
  subject: 'current-source' | 'prior-case' | 'policy-context' | 'admitted-task-contract',
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
    criteria: Object.freeze([...descriptor.declaration.resources]),
  });
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
      contexts.push(custom);
      continue;
    }
    if (rubric !== 'testQuality') return undefined;
    const contractVersion = sources.find((source) => source.rubric === rubric)!.contractVersion;
    contexts.push(Object.freeze({
      rubric,
      question: 'Are the tests for new behavior real?',
      effectivePolicyIdentity: `testQuality:${contractVersion}`,
      criteria: Object.freeze(['test-insensitive']),
    }));
  }
  return contexts;
}

function validateCustomScope(
  policyContext: readonly BuildReviewAdjudicationPolicyContext[],
  planContract: BuildReviewAdjudicationPlanContract,
  taskStatus: BuildReviewAdjudicationTaskStatus,
): BuildReviewAdjudicationContextStop | undefined {
  const custom = policyContext.some((policy) => policy.rubric !== 'testQuality');
  if (!custom) return undefined;
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
    for (const criterion of policy.criteria) {
      const criterionStop = boundedString(criterion, LIMITS.maxReferenceBytes, 'policy-context', 'criteria[]');
      if (criterionStop) return criterionStop;
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
  if (caseRecord.disposition === 'reject' || caseRecord.disposition === 'refute' && effect.kind === 'none') {
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

function validatePriorCase(caseRecord: RemediationCaseRecord): BuildReviewAdjudicationContextStop | undefined {
  for (const [field, value, limit] of [
    ['id', caseRecord.id, LIMITS.maxReferenceBytes],
    ['rationale', caseRecord.rationale, LIMITS.maxTextBytes],
  ] as const) {
    const stop = boundedString(value, limit, 'prior-case', field, caseRecord.id);
    if (stop) return stop;
  }
  if (caseRecord.domain !== 'build_review' || !['act', 'defer', 'reject', 'refute'].includes(caseRecord.disposition) ||
    !['critical', 'high', 'medium', 'low'].includes(caseRecord.priority) ||
    !['high', 'medium', 'low'].includes(caseRecord.confidence) || !['open', 'resolved'].includes(caseRecord.resolution)) {
    return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'case' };
  }
  if (!Array.isArray(caseRecord.sources) || caseRecord.sources.length === 0 || caseRecord.sources.length > LIMITS.maxSourcesPerCase) {
    return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'sources' };
  }
  const sourceIds = new Set<string>();
  for (const source of caseRecord.sources) {
    const sourceId = boundedString(source.sourceId, LIMITS.maxReferenceBytes, 'prior-case', 'sources[].sourceId', caseRecord.id);
    if (sourceId) return sourceId;
    if (!OUTCOMES.has(source.outcome) || Number.isNaN(Date.parse(source.recordedAt)) || sourceIds.has(source.sourceId)) {
      return { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'sources' };
    }
    sourceIds.add(source.sourceId);
  }
  return validateEffect(caseRecord);
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

function freezePriorCase(caseRecord: RemediationCaseRecord): BuildReviewAdjudicationPriorCase {
  const sources = [...caseRecord.sources].sort((left, right) =>
    `${left.recordedAt}\u0000${left.sourceId}`.localeCompare(`${right.recordedAt}\u0000${right.sourceId}`),
  ).map((source) => Object.freeze({ ...source }));
  return Object.freeze({
    id: caseRecord.id,
    disposition: caseRecord.disposition,
    priority: caseRecord.priority,
    rationale: caseRecord.rationale,
    confidence: caseRecord.confidence,
    resolution: caseRecord.resolution,
    sources: Object.freeze(sources),
    effect: Object.freeze({ ...caseRecord.effect }) as RemediationCaseEffect,
    ...(caseRecord.disposition === 'refute' ? { refutation: freezeRefutation(caseRecord.refutation!) } : {}),
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
  const priorCases: BuildReviewAdjudicationPriorCase[] = [];
  for (const caseRecord of input.priorCases) {
    const stop = validatePriorCase(caseRecord);
    if (stop) return { ok: false, stop };
    if (caseIds.has(caseRecord.id)) return { ok: false, stop: { code: 'unrepresentable-prior-case', caseId: caseRecord.id, field: 'duplicate-id' } };
    caseIds.add(caseRecord.id);
    priorCases.push(freezePriorCase(caseRecord));
  }
  priorCases.sort((left, right) => left.id.localeCompare(right.id));

  const attempted = new Set(input.attemptedCaseIds ?? []);
  const planContract = input.planContract ?? ABSENT_PLAN_CONTRACT;
  const taskStatus = input.taskStatus ?? ABSENT_TASK_STATUS;
  const scopeStop = validateCustomScope(policyContext, planContract, taskStatus);
  if (scopeStop) return { ok: false, stop: scopeStop };
  const mode = policyContext.some((policy) => policy.rubric !== 'testQuality') ? 'case-v2' as const : 'case-v1' as const;
  const context: BuildReviewAdjudicationContext = Object.freeze({
    version: 'v1', mode, domain: 'build_review',
    lapId: input.aggregate.lapId, snapshotDigest: input.aggregate.snapshotDigest,
    currentFindings: Object.freeze(currentFindings),
    policyContext: Object.freeze(policyContext),
    lifecycleOwners: RESERVED_LIFECYCLE_OWNERS,
    priorCases: Object.freeze(priorCases),
    planContract: Object.freeze({
      path: planContract.path,
      pointers: Object.freeze([...planContract.pointers]),
      admittedTaskContracts: Object.freeze([...(planContract.admittedTaskContracts ?? [])].map((task) => Object.freeze({ ...task }))),
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
  });
  const actual = bytes(JSON.stringify(context));
  if (actual > LIMITS.maxSerializedBytes) {
    return { ok: false, stop: { code: 'serialized-byte-overflow', limit: LIMITS.maxSerializedBytes, actual } };
  }
  return { ok: true, context };
}
