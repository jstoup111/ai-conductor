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

const REWORK_ONLY_SENTENCE =
  'Every task in this remediation round must either remove the refused behavior or rework it ' +
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
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}
