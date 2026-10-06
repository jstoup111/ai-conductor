import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { adrApprovalStatus, extractAuthoritativeStoryCriteria, parseAdrDecisions } from './artifacts.js';
import type { CoverageBindingAmendmentClaim } from './coverage-binding-inputs.js';
import { parsePlanTaskDoneWhen, parsePlanTaskTitles } from './plan-task-parse.js';
import { citedDecisionStems } from './rebase.js';

/** A complete plan-task projection used to judge joint satisfiability. */
export interface ConflictTaskTableRow {
  readonly id: string;
  readonly title: string;
  readonly doneWhen: readonly string[];
}

export interface CoverageBindingConflictClaim {
  readonly id: string;
  readonly kind: 'criterion' | 'adr-decision';
  readonly text: string;
  readonly taskTable: readonly ConflictTaskTableRow[];
  readonly applicability: 'applicable' | 'not-applicable';
}

export interface AssembleConflictClaimsInput {
  readonly planText: string;
  readonly storiesText: string;
  /** ADR texts are resolved by the caller; base filtering stays fail-closed there. */
  readonly subjectAdrs: readonly { readonly path: string; readonly text: string }[];
  readonly amendmentClaims: readonly CoverageBindingAmendmentClaim[];
}

/**
 * Projects every plan task into the conflict judge's task table.
 *
 * Remediation ids are ordinary plan headings and deliberately remain in this
 * table. Slice membership is not part of this projection: it is operational
 * sequencing metadata rather than an input to a satisfiability judgement.
 */
export function buildConflictTaskTable(planText: string): ConflictTaskTableRow[] {
  const titles = parsePlanTaskTitles(planText);
  const doneWhen = parsePlanTaskDoneWhen(planText);

  return [...titles].map(([id, title]) => ({
    id,
    title,
    doneWhen: doneWhen.get(id) ?? [],
  }));
}

function claimApplicability(taskTable: readonly ConflictTaskTableRow[]): 'applicable' | 'not-applicable' {
  return taskTable.some((task) => task.doneWhen.length > 0) ? 'applicable' : 'not-applicable';
}

function adrStem(path: string): string {
  return basename(path, '.md');
}

/**
 * Remove the amendment blocks D18 owns for this ADR before its decisions are
 * parsed. D21 excludes only those branch amendments; an amendment inherited
 * from the base is part of the approved decision and stays in its claim text,
 * so the judge reads the decision as amended rather than as first written.
 */
function withoutBranchAmendments(
  adrPath: string,
  text: string,
  amendmentClaims: readonly CoverageBindingAmendmentClaim[],
): string {
  return amendmentClaims
    .filter((claim) => claim.artifactPath === adrPath)
    .reduce((remaining, { amendment }) =>
      // Take the block's trailing blank line with it so removal leaves one paragraph break.
      remaining.split(`${amendment}\n\n`).join('').split(amendment).join(''), text);
}

/**
 * Assemble the full-plan satisfiability claims defined by D21.
 *
 * Unlike coverage and amendment claims, a conflict claim never selects a
 * carrier task: every task is part of the proposition the judge receives.
 */
export function assembleConflictClaims({
  planText,
  storiesText,
  subjectAdrs,
  amendmentClaims,
}: AssembleConflictClaimsInput): CoverageBindingConflictClaim[] {
  const taskTable = buildConflictTaskTable(planText);
  const applicability = claimApplicability(taskTable);
  const criteria = extractAuthoritativeStoryCriteria(storiesText);
  const claims: CoverageBindingConflictClaim[] = criteria.length === 0
    ? [{
      id: 'stories#unparseable',
      kind: 'criterion',
      text: '',
      taskTable,
      applicability: 'not-applicable',
    }]
    : criteria.map((text, index) => ({
      id: `stories#criterion-${index + 1}`,
      kind: 'criterion' as const,
      text,
      taskTable,
      applicability,
    }));

  for (const adr of subjectAdrs) {
    const stem = adrStem(adr.path);
    const parsed = parseAdrDecisions(withoutBranchAmendments(adr.path, adr.text, amendmentClaims));
    if (parsed.kind === 'diagnostic') {
      claims.push({
        id: `${stem}#Decision`,
        kind: 'adr-decision',
        text: parsed.detail,
        taskTable,
        applicability: 'not-applicable',
      });
      continue;
    }

    if (parsed.ids.size === 0) {
      claims.push({
        id: `${stem}#Decision`,
        kind: 'adr-decision',
        text: parsed.section,
        taskTable,
        applicability,
      });
      continue;
    }

    for (const id of parsed.ids) {
      const claimPassages = (parsed.passages.get(id) ?? [])
        .map((passage) => passage.trim())
        .filter((passage) => passage.length > 0);
      claims.push({
        id: `${stem}#D${id}`,
        kind: 'adr-decision',
        text: claimPassages.join('\n\n'),
        taskTable,
        applicability,
      });
    }
  }

  return claims;
}

export interface ResolveConflictSubjectAdrsOptions {
  readonly projectRoot: string;
  readonly planText: string;
  readonly decideSetAdrPaths: ReadonlySet<string>;
}

function isConflictSubjectAdrStatus(found: string | null): boolean {
  return found !== null && (
    /^approved\b/i.test(found)
    || /^superseded\s+in\s+part\b/i.test(found)
  );
}

/**
 * Resolves the approved decision records whose decisions constrain a plan.
 *
 * The DECIDE set contributes branch-changed ADRs while plan citations retain
 * unchanged ADRs the plan explicitly relies on. Full supersessions and drafts
 * are deliberately excluded: unlike partial supersessions, they have no
 * remaining decisions for the conflict judge to consider.
 */
export async function resolveConflictSubjectAdrs({
  projectRoot,
  planText,
  decideSetAdrPaths,
}: ResolveConflictSubjectAdrsOptions): Promise<string[]> {
  const candidates = new Set(decideSetAdrPaths);
  for (const stem of citedDecisionStems(planText)) {
    candidates.add(`.docs/decisions/${stem}.md`);
  }

  const subjectAdrs: string[] = [];
  for (const path of candidates) {
    const content = await readFile(join(projectRoot, path), 'utf8').catch(() => null);
    if (content === null) continue;

    if (isConflictSubjectAdrStatus(adrApprovalStatus(content).found)) {
      subjectAdrs.push(path);
    }
  }
  return subjectAdrs;
}
