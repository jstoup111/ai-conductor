import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adrApprovalStatus } from './artifacts.js';
import { parsePlanTaskDoneWhen, parsePlanTaskTitles } from './plan-task-parse.js';
import { citedDecisionStems } from './rebase.js';

/** A complete plan-task projection used to judge joint satisfiability. */
export interface ConflictTaskTableRow {
  readonly id: string;
  readonly title: string;
  readonly doneWhen: readonly string[];
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
