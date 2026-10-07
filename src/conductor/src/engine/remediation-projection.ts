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
import {
  readKickbackLedgerResult,
  readPendingAsBuiltRemediationFindings,
  type PendingAsBuiltRemediationFinding,
} from './kickback-ledger.js';
import { parsePlanTaskDoneWhen, parsePlanTaskTitles } from './plan-task-parse.js';
import type { RefusalReworkEvidence } from './prd-widening-refusal-rework.js';

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

export interface RemediationProjectionPriorLap {
  readonly gate: string;
  readonly laps: number;
}

export interface RemediationProjection {
  readonly version: typeof REMEDIATION_PROJECTION_VERSION;
  readonly source: RemediationProjectionSource;
  /** Typed obligations the plan validator accounts for exactly once. */
  readonly requiredReferences: readonly RemediationRequiredReference[];
  /** Active-plan context only for tasks which own a required typed reference. */
  readonly tasks: readonly RemediationProjectionTask[];
  /** Read-only history retained for planning context, never fabricated from a verdict. */
  readonly pendingAsBuiltFindings: readonly PendingAsBuiltRemediationFinding[];
  readonly priorLaps: readonly RemediationProjectionPriorLap[];
  /** Durable decisions supplied by the caller's refusal-rework boundary. */
  readonly refusals: readonly RefusalReworkEvidence[];
  readonly vocabulary: RemediationProjectionVocabulary;
}

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
  | { readonly ok: false; readonly fault: { readonly source: string; readonly detail: string } };

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

function sourceFault(source: string, detail: string): RemediationProjectionResult {
  return { ok: false, fault: { source, detail } };
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
): Promise<RemediationProjectionResult> {
  const requiredReferences: RemediationRequiredReference[] = [];
  const ownerTaskIds = new Set<string>();

  if (includesPrdAudit(request.source)) {
    const current = await readCurrentPrdAuditVerdict(worktree, {
      attemptRunId: request.attemptRunId,
      config: request.config,
      git: request.git,
    });
    if (current.kind !== 'present') return sourceFault('prd-audit verdict', current.reason);
    for (const judgment of current.value.judgment.criterionJudgments) {
      if (judgment.grade !== 'FIXABLE') continue;
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
    const current = await readAsBuiltVerdict(worktree);
    if (current.kind !== 'present') {
      return sourceFault('as-built verdict', current.kind === 'absent'
        ? 'architecture-review-as-built typed verdict is missing'
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

  const [pending, ledger, taskContext] = await Promise.all([
    readPendingAsBuiltRemediationFindings(worktree),
    readKickbackLedgerResult(worktree),
    projectActiveTasks(worktree, request, ownerTaskIds),
  ]);
  if (pending.kind === 'unreadable') return sourceFault('kickback ledger', pending.reason);
  if (ledger.kind === 'unreadable') return sourceFault('kickback ledger', ledger.reason);
  if (!taskContext.ok) return sourceFault('active plan', taskContext.detail);

  return {
    ok: true,
    projection: {
      version: REMEDIATION_PROJECTION_VERSION,
      source: request.source,
      requiredReferences,
      tasks: taskContext.tasks,
      pendingAsBuiltFindings: pending.findings,
      priorLaps: ledger.kind === 'ok' ? projectPriorLaps(ledger.ledger.gates) : [],
      refusals,
      vocabulary: {
        dispositions: REMEDIATION_DISPOSITIONS,
        haltCategories: REMEDIATION_HALT_CATEGORIES,
      },
    },
  };
}
