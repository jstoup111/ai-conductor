import {
  parseCoherenceArtifact,
  parsePlanCoverageCriterionRows,
  type CriterionCoherenceRow,
} from './coherence-parse.js';
import { parsePlanTaskDoneWhen } from './plan-task-parse.js';
import type { ComplexityTier } from '../types/steps.js';

/** The only plan-derived material that may be sent to the coverage-binding judge. */
export interface CoverageBindingClaim {
  criterion: string;
  taskIds: string[];
  doneWhen: string[][];
  quote: string;
  applicability: 'applicable' | 'not-applicable';
}

export interface AssembleCoverageBindingClaimsInput {
  tier: ComplexityTier;
  coherenceText: string | null;
  planText: string;
}

/** Coherence rows cite `task-<id>` while plan headings store their bare task id. */
function taskIdFromCitation(citedId: string): string {
  return citedId.trim().replace(/^task-/i, '');
}

function carrierRows({ tier, coherenceText, planText }: AssembleCoverageBindingClaimsInput): CriterionCoherenceRow[] {
  if (tier === 'S') return parsePlanCoverageCriterionRows(planText);

  const parsed = parseCoherenceArtifact(coherenceText);
  return parsed.ok ? parsed.rows.filter((row): row is CriterionCoherenceRow => row.rowClass === 'criterion') : [];
}

/**
 * Assemble the closed input projection for coverage binding (ADR D4/D8).
 *
 * The selected carrier supplies only the criterion, task citations, and quote.
 * Plan-local completion checks are joined by task id; legacy tasks without a
 * `Done when` block are deliberately represented as not applicable rather
 * than being treated as a judgeable empty assertion.
 */
export function assembleCoverageBindingClaims(
  input: AssembleCoverageBindingClaimsInput,
): CoverageBindingClaim[] {
  const taskDoneWhen = parsePlanTaskDoneWhen(input.planText);

  return carrierRows(input).map((row) => {
    const taskIds = row.citedIds.map(taskIdFromCitation);
    const checks = taskIds.map((id) => taskDoneWhen.get(id));
    const hasMissingDoneWhen = checks.some((taskChecks) => taskChecks === undefined);

    return {
      criterion: row.criterion,
      taskIds,
      doneWhen: hasMissingDoneWhen ? [] : checks as string[][],
      quote: row.quote,
      applicability: hasMissingDoneWhen ? 'not-applicable' : 'applicable',
    };
  });
}
