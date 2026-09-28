import {
  parseCoherenceArtifact,
  parsePlanCoverageCriterionRows,
  type CriterionCoherenceRow,
} from './coherence-parse.js';
import {
  parsePlanTaskBodies,
  parsePlanTaskDoneWhen,
  resolveCitedPlanTaskIds,
} from './plan-task-parse.js';
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

export interface CoverageBindingAmendmentClaim {
  readonly kind: 'amendment';
  readonly artifactPath: string;
  readonly amendment: string;
  readonly taskIds: readonly string[];
  readonly doneWhen: readonly (readonly string[])[];
}

export interface AssembleAmendmentClaimsInput {
  readonly planText: string;
  /** Resolved DECIDE artifacts other than the plan itself. */
  readonly decideArtifacts: readonly { readonly path: string; readonly text: string }[];
}

const AMENDMENT_HEADER = /^> \*\*Amended \d{4}-\d{2}-\d{2} by #\d+:\*\*/;

function isAmendmentSource(path: string): boolean {
  return path.startsWith('.docs/specs/') ||
    /^\.docs\/decisions\/(?:architecture-review-|adr-)/.test(path);
}

function amendmentBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!AMENDMENT_HEADER.test(lines[index]!)) continue;
    const block = [lines[index]!];
    while (index + 1 < lines.length && lines[index + 1]!.startsWith('>')) {
      index += 1;
      block.push(lines[index]!);
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}

/**
 * Assemble amendment claims from the resolved DECIDE set. Unlike criterion
 * claims, every plan task is the possible carrier because an amendment is not
 * pre-cited by a coherence row. The runner later asks the amendment judge to
 * identify the matching obligation (or declare that none is needed).
 */
export function assembleAmendmentClaims(
  { planText, decideArtifacts }: AssembleAmendmentClaimsInput,
): CoverageBindingAmendmentClaim[] {
  const taskDoneWhen = parsePlanTaskDoneWhen(planText);
  const taskIds = [...parsePlanTaskBodies(planText).keys()];
  const doneWhen = taskIds.map((id) => taskDoneWhen.get(id) ?? []);

  return decideArtifacts.filter(({ path }) => isAmendmentSource(path)).flatMap(({ path, text }) => amendmentBlocks(text).map((amendment) => ({
    kind: 'amendment' as const,
    artifactPath: path,
    amendment,
    taskIds,
    doneWhen,
  })));
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
  const planTaskIds = new Set(parsePlanTaskBodies(input.planText).keys());

  return carrierRows(input).map((row) => {
    const resolution = resolveCitedPlanTaskIds(row.citedIds, planTaskIds);
    if (resolution.kind !== 'resolved') {
      return {
        criterion: row.criterion,
        taskIds: [],
        doneWhen: [],
        quote: row.quote,
        applicability: 'not-applicable' as const,
      };
    }
    const taskIds = resolution.ids;
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
