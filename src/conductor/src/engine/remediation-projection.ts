import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  REMEDIATION_HALT_CATEGORIES,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_TARGET_STEPS,
  readActivePlanText,
  readCurrentPrdAuditVerdict,
  type CompletionContext,
  type RemediationDisposition,
  type RemediationHaltCategory,
} from './artifacts.js';
import { readAsBuiltVerdict } from './as-built-verdict-store.js';
import type { AsBuiltGoverningReference } from './as-built-contract.js';
import { AS_BUILT_PROJECTION_LIMITS, type AsBuiltProjectionLimits } from './as-built-projection.js';
import {
  isEngineStampedAsBuiltFindingId,
  readKickbackLedgerResult,
  readPendingAsBuiltRemediationFindings,
  type KickbackLedgerReadResult,
  type PendingAsBuiltRemediationFinding,
  type PendingAsBuiltRemediationFindingsReadResult,
} from './kickback-ledger.js';
import { parsePlanTaskDoneWhen, parsePlanTaskTitles } from './plan-task-parse.js';
import type { RefusalReworkEvidence } from './prd-widening-refusal-rework.js';
import { slugify } from './worktree.js';

/** Incremented only when the deterministic remediation input contract changes. */
export const REMEDIATION_PROJECTION_VERSION = 1;

export type RemediationProjectionSource =
  | 'validation-group'
  | 'prd-audit'
  | 'as-built'
  | 'build-stall'
  | 'finish-verification';

export type RemediationRequiredReference =
  | {
    readonly kind: 'prd-criterion';
    readonly id: string;
    readonly sourceGate: 'prd_audit';
    readonly ownerTaskId: string;
    readonly summary: string;
  }
  | {
    readonly kind: 'as-built-finding';
    readonly id: string;
    readonly sourceGate: 'architecture_review_as_built';
    readonly reference: AsBuiltGoverningReference;
    readonly summary: string;
  }
  | {
    readonly kind: 'refusal';
    readonly id: string;
    readonly sourceGate: 'refusal-rework';
    readonly revision: number;
    readonly rationale: string;
  };

export interface RemediationProjectionTask {
  readonly id: string;
  readonly title: string;
  readonly doneWhen: readonly string[];
}

export interface RemediationProjectionVocabulary {
  readonly dispositions: readonly RemediationDisposition[];
  readonly haltCategories: readonly RemediationHaltCategory[];
}

/** Read-only evidence from sources which have no typed required-reference set. */
export interface RemediationProjectionEvidence {
  readonly excerpts: readonly {
    readonly key: string;
    readonly path: string;
    readonly content: string;
  }[];
  readonly omittedFiles: readonly {
    readonly key: string;
    readonly path: string;
    readonly digest: string;
  }[];
}

export interface RemediationProjectionPriorLap {
  readonly gate: string;
  readonly laps: number;
}

export interface RemediationProjection {
  readonly version: typeof REMEDIATION_PROJECTION_VERSION;
  readonly source: RemediationProjectionSource;
  /** Typed obligations the plan validator accounts for exactly once. */
  readonly requiredReferences: readonly RemediationRequiredReference[];
  /** Bounded read-only context for build-stall and finish-verification requests. */
  readonly evidence: RemediationProjectionEvidence;
  /** Active-plan context only for tasks which own a required typed reference. */
  readonly tasks: readonly RemediationProjectionTask[];
  /** Read-only history retained for planning context, never fabricated from a verdict. */
  readonly pendingAsBuiltFindings: readonly PendingAsBuiltRemediationFinding[];
  readonly priorLaps: readonly RemediationProjectionPriorLap[];
  /** Durable decisions supplied by the caller's refusal-rework boundary. */
  readonly refusals: readonly RefusalReworkEvidence[];
  readonly vocabulary: RemediationProjectionVocabulary;
}

type RemediationEvidenceLimits = Pick<AsBuiltProjectionLimits, 'perFileHunksBytes' | 'totalDiffBytes'>;

export interface RemediationProjectionRequest {
  readonly source: RemediationProjectionSource;
  /** The engine-recorded active plan path when the caller has already resolved it. */
  readonly activePlanPath?: string;
  readonly featureDesc?: string;
  /** Freshness context for the authoritative PRD-audit verdict reader. */
  readonly attemptRunId?: string;
  readonly config?: CompletionContext['config'];
  readonly git?: CompletionContext['git'];
  readonly refusals?: readonly RefusalReworkEvidence[];
}

export type RemediationProjectionResult =
  | { readonly ok: true; readonly projection: RemediationProjection }
  | {
      readonly ok: false;
      readonly kind: 'preparation-fault';
      readonly fault: {
        readonly source: string;
        readonly detail: string;
        readonly dimension?: string;
        readonly actual?: number;
        readonly limit?: number;
      };
    };

/** Largest observed serialized structured sections in the Task 8 remediation corpus. */
export const REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES = {
  requiredReferencesBytes: 339,
  tasksBytes: 165,
  pendingAsBuiltFindingsBytes: 264,
  priorLapsBytes: 80,
  refusalsBytes: 109,
  totalBytes: 1_089,
} as const;

function roundUpPowerOfTwo(bytes: number): number {
  let rounded = 1;
  while (rounded < bytes) rounded *= 2;
  return rounded;
}

/** Finite engine bounds for required structured input; required values are never truncated. */
export const REMEDIATION_PROJECTION_LIMITS = {
  // Required-reference corpus maximum: 339 B; rounded up to 512 B.
  requiredReferencesBytes: roundUpPowerOfTwo(REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.requiredReferencesBytes),
  // Owning-task corpus maximum: 165 B; rounded up to 256 B.
  tasksBytes: roundUpPowerOfTwo(REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.tasksBytes),
  // Stamped pending as-built finding corpus maximum: 264 B; rounded up to 512 B.
  pendingAsBuiltFindingsBytes: roundUpPowerOfTwo(REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.pendingAsBuiltFindingsBytes),
  // Stamped prior-lap corpus maximum: 80 B; rounded up to 128 B.
  priorLapsBytes: roundUpPowerOfTwo(REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.priorLapsBytes),
  // Refusal corpus maximum: 109 B; rounded up to 128 B.
  refusalsBytes: roundUpPowerOfTwo(REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.refusalsBytes),
  // Complete stamped-contract projection corpus maximum: 1,089 B; rounded up to 2,048 B.
  totalBytes: roundUpPowerOfTwo(REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.totalBytes),
  // Untyped-evidence per-file corpus bound is owned by the as-built projection.
  perFileHunksBytes: AS_BUILT_PROJECTION_LIMITS.perFileHunksBytes,
  // Untyped-evidence total corpus bound is owned by the as-built projection.
  totalDiffBytes: AS_BUILT_PROJECTION_LIMITS.totalDiffBytes,
} as const;

export interface RemediationProjectionLimits extends RemediationEvidenceLimits {
  readonly requiredReferencesBytes: number;
  readonly tasksBytes: number;
  readonly pendingAsBuiltFindingsBytes: number;
  readonly priorLapsBytes: number;
  readonly refusalsBytes: number;
  readonly totalBytes: number;
}

/** Narrow test seam for required durable-state reads. */
export interface RemediationProjectionDependencies {
  readonly readKickbackLedgerResult?: typeof readKickbackLedgerResult;
  readonly readPendingAsBuiltRemediationFindings?: typeof readPendingAsBuiltRemediationFindings;
}

const REMEDIATION_DISPOSITIONS: readonly RemediationDisposition[] = [
  ...REMEDIATION_TARGET_STEPS,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  'halt',
];

function includesPrdAudit(source: RemediationProjectionSource): boolean {
  return source === 'prd-audit' || source === 'validation-group';
}

function includesAsBuilt(source: RemediationProjectionSource): boolean {
  return source === 'as-built' || source === 'validation-group';
}

function preparationFault(
  source: string,
  detail: string,
  fields: Pick<Extract<RemediationProjectionResult, { readonly ok: false }>['fault'], 'dimension' | 'actual' | 'limit'> = {},
): RemediationProjectionResult {
  return { ok: false, kind: 'preparation-fault', fault: { source, detail, ...fields } };
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf-8');
}

function serializedBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

function projectionLimitFault(
  projection: RemediationProjection,
  source: RemediationProjectionSource,
  limits: RemediationProjectionLimits,
): RemediationProjectionResult | undefined {
  const dimensions: readonly { readonly dimension: string; readonly actual: number; readonly limit: number }[] = [
    { dimension: 'required-references', actual: serializedBytes(projection.requiredReferences), limit: limits.requiredReferencesBytes },
    { dimension: 'tasks', actual: serializedBytes(projection.tasks), limit: limits.tasksBytes },
    { dimension: 'pending-as-built-findings', actual: serializedBytes(projection.pendingAsBuiltFindings), limit: limits.pendingAsBuiltFindingsBytes },
    { dimension: 'prior-laps', actual: serializedBytes(projection.priorLaps), limit: limits.priorLapsBytes },
    { dimension: 'refusals', actual: serializedBytes(projection.refusals), limit: limits.refusalsBytes },
    { dimension: 'total', actual: serializedBytes(projection), limit: limits.totalBytes },
  ];
  const overflow = dimensions.find(({ actual, limit }) => actual > limit);
  return overflow === undefined
    ? undefined
    : preparationFault(source, `${overflow.dimension} exceeds its required structured-input limit`, overflow);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function verdictFault(source: string, detail: string): RemediationProjectionResult {
  const normalized = detail.toLowerCase().includes('version')
    ? `unsupported typed verdict version: ${detail}`
    : detail;
  return preparationFault(source, normalized);
}

async function safelyReadLedger(
  read: () => Promise<KickbackLedgerReadResult>,
): Promise<KickbackLedgerReadResult> {
  try {
    return await read();
  } catch (error) {
    return { kind: 'unreadable', reason: `kickback ledger is unreadable: ${errorDetail(error)}` };
  }
}

async function safelyReadPendingFindings(
  read: () => Promise<PendingAsBuiltRemediationFindingsReadResult>,
): Promise<PendingAsBuiltRemediationFindingsReadResult> {
  try {
    return await read();
  } catch (error) {
    return { kind: 'unreadable', reason: `kickback ledger is unreadable: ${errorDetail(error)}` };
  }
}

function untypedEvidenceSource(
  worktree: string,
  request: RemediationProjectionRequest,
): { readonly key: string; readonly path: string } | undefined {
  if (request.source === 'build-stall') {
    const slug = slugify(request.featureDesc ?? basename(worktree));
    return { key: `stall:${slug}`, path: '.pipeline/build-stall-question.md' };
  }
  if (request.source === 'finish-verification') {
    return { key: 'test:test-failures', path: '.pipeline/test-failures.md' };
  }
  return undefined;
}

async function projectUntypedEvidence(
  worktree: string,
  request: RemediationProjectionRequest,
  limits: RemediationEvidenceLimits,
): Promise<RemediationProjectionEvidence> {
  const source = untypedEvidenceSource(worktree, request);
  if (source === undefined) return { excerpts: [], omittedFiles: [] };

  let content: string;
  try {
    content = await readFile(join(worktree, source.path), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { excerpts: [], omittedFiles: [] };
    throw error;
  }

  const bytes = utf8Bytes(content);
  if (bytes > limits.perFileHunksBytes || bytes > limits.totalDiffBytes) {
    return {
      excerpts: [],
      omittedFiles: [{
        ...source,
        digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      }],
    };
  }
  return { excerpts: [{ ...source, content }], omittedFiles: [] };
}

function projectPriorLaps(gates: Readonly<Record<string, { readonly laps?: number }>>): readonly RemediationProjectionPriorLap[] {
  return Object.entries(gates)
    .map(([gate, entry]) => ({ gate, laps: entry.laps ?? 0 }))
    .sort((left, right) => left.gate.localeCompare(right.gate));
}

async function projectActiveTasks(
  worktree: string,
  request: RemediationProjectionRequest,
  ownerTaskIds: ReadonlySet<string>,
): Promise<{ readonly ok: true; readonly tasks: readonly RemediationProjectionTask[] } | { readonly ok: false; readonly detail: string }> {
  if (ownerTaskIds.size === 0) return { ok: true, tasks: [] };

  const plan = await readActivePlanText(worktree, request.activePlanPath, request.featureDesc);
  if (plan === undefined) return { ok: false, detail: 'active plan is unavailable' };

  const titles = parsePlanTaskTitles(plan);
  const doneWhen = parsePlanTaskDoneWhen(plan);
  const tasks: RemediationProjectionTask[] = [];
  for (const id of [...ownerTaskIds].sort((left, right) => left.localeCompare(right))) {
    const title = titles.get(id);
    if (title === undefined) return { ok: false, detail: `active plan does not declare owning task ${id}` };
    tasks.push({ id, title, doneWhen: doneWhen.get(id) ?? [] });
  }
  return { ok: true, tasks };
}

/**
 * Build the read-only, engine-owned input for one remediation planning attempt.
 * Typed verdicts remain authoritative; their derived Markdown reports are never
 * read here.
 */
export async function buildRemediationProjection(
  worktree: string,
  request: RemediationProjectionRequest,
  limitOverrides: Partial<RemediationProjectionLimits> = {},
  dependencies: RemediationProjectionDependencies = {},
): Promise<RemediationProjectionResult> {
  const requiredReferences: RemediationRequiredReference[] = [];
  const ownerTaskIds = new Set<string>();

  if (includesPrdAudit(request.source)) {
    let current: Awaited<ReturnType<typeof readCurrentPrdAuditVerdict>>;
    try {
      current = await readCurrentPrdAuditVerdict(worktree, {
        attemptRunId: request.attemptRunId,
        config: request.config,
        git: request.git,
      });
    } catch (error) {
      return preparationFault('prd-audit verdict', `typed verdict is unreadable: ${errorDetail(error)}`);
    }
    if (current.kind !== 'present') return verdictFault('prd-audit verdict', current.reason);
    for (const judgment of current.value.judgment.criterionJudgments) {
      if (judgment.grade !== 'FIXABLE') continue;
      if (judgment.ownerTaskId === undefined) continue;
      requiredReferences.push({
        kind: 'prd-criterion',
        id: judgment.criterionId,
        sourceGate: 'prd_audit',
        ownerTaskId: judgment.ownerTaskId,
        summary: judgment.evidence,
      });
      ownerTaskIds.add(judgment.ownerTaskId);
    }
  }

  if (includesAsBuilt(request.source)) {
    let current: Awaited<ReturnType<typeof readAsBuiltVerdict>>;
    try {
      current = await readAsBuiltVerdict(worktree);
    } catch (error) {
      return preparationFault('as-built verdict', `typed verdict is unreadable: ${errorDetail(error)}`);
    }
    if (current.kind !== 'present') {
      return verdictFault('as-built verdict', current.kind === 'absent'
        ? 'architecture-review-as-built typed verdict is missing'
        : current.kind === 'prior-version'
          ? `architecture-review-as-built typed verdict uses prior contract version ${current.version}`
          : current.reason);
    }
    if (current.value.verdict.verdict === 'BLOCKED') {
      for (const finding of current.value.verdict.findings) {
        if (finding.class !== 'REMEDIABLE') continue;
        requiredReferences.push({
          kind: 'as-built-finding',
          id: finding.id,
          sourceGate: 'architecture_review_as_built',
          reference: finding.reference,
          summary: finding.summary,
        });
        if (finding.reference.kind === 'plan-task') ownerTaskIds.add(finding.reference.taskId);
      }
    }
  }

  const refusals = request.refusals ?? [];
  for (const refusal of refusals) {
    requiredReferences.push({
      kind: 'refusal',
      id: refusal.decisionId,
      sourceGate: 'refusal-rework',
      revision: refusal.revision,
      rationale: refusal.rationale,
    });
  }

  const limits: RemediationProjectionLimits = { ...REMEDIATION_PROJECTION_LIMITS, ...limitOverrides };
  const readPending = dependencies.readPendingAsBuiltRemediationFindings ?? readPendingAsBuiltRemediationFindings;
  const readLedger = dependencies.readKickbackLedgerResult ?? readKickbackLedgerResult;
  const [pending, ledger, taskContext, evidence] = await Promise.all([
    safelyReadPendingFindings(() => readPending(worktree)),
    safelyReadLedger(() => readLedger(worktree)),
    projectActiveTasks(worktree, request, ownerTaskIds),
    projectUntypedEvidence(worktree, request, limits),
  ]);
  if (pending.kind === 'unreadable') return preparationFault('kickback ledger', pending.reason);
  if (ledger.kind === 'unreadable') return preparationFault('kickback ledger', ledger.reason);
  if (!taskContext.ok) return preparationFault('active plan', taskContext.detail);

  const projection: RemediationProjection = {
    version: REMEDIATION_PROJECTION_VERSION,
    source: request.source,
    requiredReferences,
    evidence,
    tasks: taskContext.tasks,
    // Pre-v2 provider ids remain in the ledger for historical shipment
    // records, but are not planning context or remediation obligations.
    pendingAsBuiltFindings: pending.findings.filter((finding) =>
      isEngineStampedAsBuiltFindingId(finding.finding),
    ),
    priorLaps: ledger.kind === 'ok' ? projectPriorLaps(ledger.ledger.gates) : [],
    refusals,
    vocabulary: {
      dispositions: REMEDIATION_DISPOSITIONS,
      haltCategories: REMEDIATION_HALT_CATEGORIES,
    },
  };
  const fault = projectionLimitFault(projection, request.source, limits);
  if (fault !== undefined) return fault;
  return {
    ok: true,
    projection,
  };
}
