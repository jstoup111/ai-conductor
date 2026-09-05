import { splitRow, isSeparatorRow, unquote } from './coherence-parse.js';
import { parsePlanTaskDoneWhen } from './plan-task-parse.js';

export type ArchitectureObligationDisposition = 'task' | 'existing' | 'no-change';

export type ArchitectureObligationViolationReason =
  | 'missing'
  | 'duplicate'
  | 'invented'
  | 'malformed-row'
  | 'invalid-disposition'
  | 'task-required'
  | 'invalid-task-citation'
  | 'unexpected-task'
  | 'task-missing'
  | 'evidence-missing'
  | 'evidence-ungrounded';

export interface ArchitectureObligationViolation {
  readonly decisionId: string;
  readonly reason: ArchitectureObligationViolationReason;
  readonly detail: string;
}

interface ArchitectureObligationMapping {
  readonly decisionId: string;
  readonly disposition: ArchitectureObligationDisposition | null;
  readonly taskIds: readonly string[];
  readonly evidence: string;
}

const SECTION_HEADING = /^##\s+Architecture Obligation Coverage\s*$/i;
const NEXT_LEVEL_TWO_HEADING = /^##\s+/;
const TASK_CITATION = /^task-(.+)$/i;
const EMPTY_TASK_CELL = /^(?:|none|n\/a|—|-)$/i;

export function formatArchitectureDecisionId(adrId: string, decisionId: string): string {
  return `${adrId}#D${decisionId}`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function linesOutsideFences(text: string): string[] {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (match) {
      const marker = match[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence === null) lines.push(line);
  }
  return lines;
}

function parseMappings(
  planText: string,
): { mappings: ArchitectureObligationMapping[]; violations: ArchitectureObligationViolation[] } {
  const lines = linesOutsideFences(planText);
  const sectionStart = lines.findIndex((line) => SECTION_HEADING.test(line.trim()));
  if (sectionStart === -1) return { mappings: [], violations: [] };

  const sectionLines: string[] = [];
  for (const line of lines.slice(sectionStart + 1)) {
    if (NEXT_LEVEL_TWO_HEADING.test(line)) break;
    sectionLines.push(line);
  }

  const mappings: ArchitectureObligationMapping[] = [];
  const violations: ArchitectureObligationViolation[] = [];
  let sawHeader = false;
  let sawSeparator = false;
  let dataRow = 0;

  for (const line of sectionLines) {
    const cells = splitRow(line);
    if (cells === null) continue;
    if (!sawHeader) {
      sawHeader = true;
      continue;
    }
    if (!sawSeparator) {
      if (isSeparatorRow(cells)) sawSeparator = true;
      continue;
    }

    dataRow += 1;
    const decisionId = cells[0]?.trim() || `row-${dataRow}`;
    if (cells.length !== 4) {
      violations.push({
        decisionId,
        reason: 'malformed-row',
        detail: `architecture obligation row ${dataRow} has ${cells.length} cells; expected 4`,
      });
      continue;
    }

    const dispositionText = cells[1].trim().toLowerCase();
    const disposition: ArchitectureObligationDisposition | null =
      dispositionText === 'task' || dispositionText === 'existing' || dispositionText === 'no-change'
        ? dispositionText
        : null;
    const taskCell = cells[2].trim();
    const taskCitations = EMPTY_TASK_CELL.test(taskCell)
      ? []
      : taskCell.split(',').map((citation) => citation.trim()).filter(Boolean);
    const invalidTaskCitation = taskCitations.find((citation) => !TASK_CITATION.test(citation));
    const taskIds = taskCitations.map((citation) => citation.match(TASK_CITATION)?.[1].trim() ?? citation);
    const evidence = unquote(cells[3]);

    mappings.push({ decisionId, disposition, taskIds, evidence });
    if (disposition === null) {
      violations.push({
        decisionId,
        reason: 'invalid-disposition',
        detail: `architecture obligation ${decisionId} uses unknown disposition "${cells[1].trim()}"`,
      });
    }
    if (disposition === 'task' && taskIds.length === 0) {
      violations.push({
        decisionId,
        reason: 'task-required',
        detail: `architecture obligation ${decisionId} is dispositioned task but cites no task`,
      });
    }
    if (invalidTaskCitation) {
      violations.push({
        decisionId,
        reason: 'invalid-task-citation',
        detail: `architecture obligation ${decisionId} uses invalid task citation "${invalidTaskCitation}"; expected task-<id>`,
      });
    }
    if ((disposition === 'existing' || disposition === 'no-change') && taskIds.length > 0) {
      violations.push({
        decisionId,
        reason: 'unexpected-task',
        detail: `architecture obligation ${decisionId} is dispositioned ${disposition} but cites a task`,
      });
    }
    if (!normalizeWhitespace(evidence)) {
      violations.push({
        decisionId,
        reason: 'evidence-missing',
        detail: `architecture obligation ${decisionId} has no evidence`,
      });
    }
  }

  return { mappings, violations };
}

/**
 * Validate the plan's architecture-decision bookkeeping at the DECIDE land seam.
 * The engine proves completeness, real task ids, and exact Done-when grounding;
 * coherence-check remains responsible for judging whether that evidence actually
 * satisfies the decision.
 */
export function validateArchitectureObligationCoverage(
  planText: string,
  requiredDecisionIds: ReadonlySet<string>,
): readonly ArchitectureObligationViolation[] {
  const { mappings, violations: parseViolations } = parseMappings(planText);
  if (requiredDecisionIds.size === 0 && mappings.length === 0) return parseViolations;

  const violations = [...parseViolations];
  const doneWhen = parsePlanTaskDoneWhen(planText);
  const mappingsByDecision = new Map<string, ArchitectureObligationMapping[]>();
  for (const mapping of mappings) {
    const matches = mappingsByDecision.get(mapping.decisionId) ?? [];
    matches.push(mapping);
    mappingsByDecision.set(mapping.decisionId, matches);
  }

  for (const decisionId of requiredDecisionIds) {
    const matches = mappingsByDecision.get(decisionId) ?? [];
    if (matches.length === 0) {
      violations.push({
        decisionId,
        reason: 'missing',
        detail: `architecture decision ${decisionId} has no coverage row`,
      });
    } else if (matches.length > 1) {
      violations.push({
        decisionId,
        reason: 'duplicate',
        detail: `architecture decision ${decisionId} has ${matches.length} coverage rows`,
      });
    }
  }

  for (const mapping of mappings) {
    if (!requiredDecisionIds.has(mapping.decisionId)) {
      violations.push({
        decisionId: mapping.decisionId,
        reason: 'invented',
        detail: `architecture obligation row cites unknown decision ${mapping.decisionId}`,
      });
      continue;
    }
    if (mapping.disposition !== 'task' || mapping.taskIds.length === 0) continue;

    const missingTask = mapping.taskIds.find((taskId) => !doneWhen.has(taskId));
    if (missingTask) {
      violations.push({
        decisionId: mapping.decisionId,
        reason: 'task-missing',
        detail: `architecture decision ${mapping.decisionId} cites task ${missingTask}, which has no Done-when block`,
      });
      continue;
    }

    const evidence = normalizeWhitespace(mapping.evidence);
    if (!evidence) continue;
    const grounded = mapping.taskIds.some((taskId) =>
      (doneWhen.get(taskId) ?? []).some((check) => normalizeWhitespace(check).includes(evidence)),
    );
    if (!grounded) {
      violations.push({
        decisionId: mapping.decisionId,
        reason: 'evidence-ungrounded',
        detail: `architecture decision ${mapping.decisionId} evidence is absent from every cited task's Done-when block`,
      });
    }
  }

  return violations;
}
