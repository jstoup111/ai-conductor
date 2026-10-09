import { asBuiltFindingDetail, asBuiltOutcome, readAsBuiltVerdict } from './as-built-verdict-store.js';
import type { AsBuiltGoverningReference } from './as-built-contract.js';

/**
 * Authored `Governing clause` cells carry inline markdown. The clause grammar is
 * anchored on a bare identifier, so a habitually backticked stem
 * (`` `adr-x` + Decision 4 ``) failed the match before any ADR lookup ran, and
 * every real-world REMEDIABLE finding became a needs-human HALT on substance the
 * bounded remediation route could have closed. Emphasis carries no meaning in
 * this cell; strip it before matching. `_` is left intact because it is a legal
 * character in a task id.
 */
export type AsBuiltGoverningClauseResolution =
  | { kind: 'adr'; clause: string; reference: AsBuiltGoverningReference }
  | { kind: 'plan-task'; clause: string; parentTask: string; reference: AsBuiltGoverningReference };

function renderAsBuiltGoverningReference(reference: AsBuiltGoverningReference): string {
  return reference.kind === 'adr-decision'
    ? `${reference.stem} decision ${reference.decision}`
    : `Task ${reference.taskId}`;
}

export function typedAsBuiltResolution(reference: AsBuiltGoverningReference): AsBuiltGoverningClauseResolution {
  const clause = renderAsBuiltGoverningReference(reference);
  return reference.kind === 'adr-decision'
    ? { kind: 'adr', clause, reference }
    : { kind: 'plan-task', clause, parentTask: reference.taskId, reference };
}

export function renderAsBuiltBlockedFindingDetail(findings: readonly import('./as-built-contract.js').AsBuiltFinding[] | undefined): string {
  return findings && findings.length > 0 ? `\n\nBlocking findings:\n${asBuiltFindingDetail(findings)}` : '';
}

export async function readAsBuiltRoutingOutcome(projectRoot: string): Promise<{
  kind: 'approved' | 'plan-gap-delivered' | 'plan-gap-undelivered' | 'blocked-remediable' | 'blocked-design' | 'invalid';
  findings?: readonly import('./as-built-contract.js').AsBuiltFinding[];
}> {
  const stored = await readAsBuiltVerdict(projectRoot);
  if (stored.kind !== 'present') return { kind: 'invalid' };
  const kind = asBuiltOutcome(stored.value.verdict);
  return {
    kind,
    ...(stored.value.verdict.verdict === 'BLOCKED' ? { findings: stored.value.verdict.findings } : {}),
  };
}
