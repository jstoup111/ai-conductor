import type { BuildReviewFinding } from './build-review-domain.js';

/** Renders concise plan locations for completeness findings that name a plan task. */
export function planContractPointers(
  findings: readonly BuildReviewFinding[],
  plan: string,
  planPath: string,
): readonly string[] {
  return findings.flatMap((finding) => {
    if (finding.anchor.rubric !== 'completeness') return [];

    const { planTask, missingOutcome } = finding.anchor;
    const taskHeader = new RegExp(`^### Task ${escapeRegExp(planTask)}:`, 'm');
    if (!taskHeader.test(plan)) return [];

    return [`plan contract: ${planPath} — Task ${planTask} (anchor: ${missingOutcome})`];
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
