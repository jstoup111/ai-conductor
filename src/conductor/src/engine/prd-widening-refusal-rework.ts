import type { AcceptedRemediationPlanDisposition } from './remediation-plan-contract.js';
import {
  PRD_AUDIT_REMEDIATION_GATE_SOURCE,
  type CriterionBoundRemediationGap,
} from './remediation-append.js';

/**
 * Engine-supplied evidence for one refused OVER_SCOPE finding, routed to the
 * `/remediate` planner. Every field is taken from the durable decision (and,
 * for NC findings, the original case record) — never from the report's
 * presentation key, which may renumber between laps.
 */
export interface RefusalReworkEvidence {
  /** The finding's current presentation key (e.g. `S2.1` or `NC.2`). */
  readonly key: string;
  /** The immutable id of the recorded `refuse` decision. */
  readonly decisionId: string;
  /** The decision revision at which the refusal was recorded. */
  readonly revision: number;
  /** The operator's recorded refusal rationale. */
  readonly rationale: string;
  /** NC only: the id of the original case the refused offer belongs to. */
  readonly caseId?: string;
  /** NC only: the original offer's source snapshot, for the planner's context. */
  readonly snapshot?: string;
}

/** The required gap id for a refusal rework round; decision id only. */
export function refusalReworkGapId(decisionId: string): string {
  return `refusal-${decisionId}`;
}

/** The disposition a refusal rework round must route through to be admitted. */
const REFUSAL_REWORK_DISPOSITION = 'build';

/**
 * Admission of the `/remediate` planner's output against a set of refuse
 * decisions. A refusal is admitted only when the plan carries a build gap with
 * the refusal's required id AND at least one concrete task; `rejected` names
 * the presentation key of every refusal that did not bind.
 */
export function admitRefusalReworkPlan(
  dispositions: readonly AcceptedRemediationPlanDisposition[],
  refusals: readonly RefusalReworkEvidence[],
): RefusalReworkAdmission {
  const gaps: CriterionBoundRemediationGap[] = [];
  const unboundKeys: string[] = [];

  for (const refusal of refusals) {
    const disposition = dispositions.find((candidate) =>
      candidate.reference.kind === 'refusal' && candidate.reference.id === refusal.decisionId,
    );
    if (
      disposition === undefined ||
      disposition.disposition !== REFUSAL_REWORK_DISPOSITION ||
      disposition.tasks.length === 0
    ) {
      unboundKeys.push(refusal.key);
      continue;
    }
    gaps.push({
      id: refusalReworkGapId(refusal.decisionId),
      disposition: disposition.disposition,
      category: disposition.category,
      rationale: disposition.rationale,
      tasks: disposition.tasks.map((task) => ({ ...task })),
      gateSource: PRD_AUDIT_REMEDIATION_GATE_SOURCE,
      criterion: refusal.key,
      governingClause: `Refused ${refusal.key} (decision ${refusal.decisionId} r${refusal.revision})`,
    });
  }

  if (unboundKeys.length > 0) {
    return { kind: 'rejected', criteria: unboundKeys };
  }
  return { kind: 'admitted', gaps };
}

export type RefusalReworkAdmission =
  | { kind: 'admitted'; gaps: CriterionBoundRemediationGap[] }
  | { kind: 'rejected'; criteria: string[] };

const REWORK_ONLY_SENTENCE =
  'Every task for the refusal-<decisionId> gaps listed below must either remove the refused behavior or rework it ' +
  'to fit within the recorded decision; no new behavior may be introduced.';

/** Render the refusal evidence as the `/remediate` dispatch (`retryReason`) context. */
export function renderRefusalReworkContext(refusals: readonly RefusalReworkEvidence[]): string {
  const blocks: string[] = [REWORK_ONLY_SENTENCE];
  for (const refusal of refusals) {
    const lines = [
      `Refusal ${refusal.key} — decision ${refusal.decisionId} (r${refusal.revision})`,
      `- Required gap id: ${refusalReworkGapId(refusal.decisionId)}`,
      `- Rationale: ${refusal.rationale}`,
    ];
    if (refusal.snapshot !== undefined) {
      lines.push(`- Original offer snapshot: ${refusal.snapshot}`);
    }
    if (refusal.caseId !== undefined) {
      lines.push(`- Original case id: ${refusal.caseId}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}
