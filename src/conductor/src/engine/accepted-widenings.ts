import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const ACCEPTED_WIDENINGS_PATH = '.pipeline/accepted-widenings.json';

export interface OverScopeDecision { criterion: string; summary: string; decision: 'accept' | 'refuse'; rationale: string; operator: string; decidedAt: string }
interface OverScopeDecisionsFile { version: 1; decisions: OverScopeDecision[] }

function isOverScopeDecision(value: unknown): value is OverScopeDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.criterion === 'string' && entry.criterion.trim().length > 0 && typeof entry.summary === 'string' && entry.summary.trim().length > 0 && (entry.decision === 'accept' || entry.decision === 'refuse') && typeof entry.rationale === 'string' && entry.rationale.trim().length > 0 && typeof entry.operator === 'string' && entry.operator.trim().length > 0 && typeof entry.decidedAt === 'string' && entry.decidedAt.trim().length > 0;
}

/** Non-conforming (including the retired `entries` schema) deliberately reads as absent. */
export async function readOverScopeDecisions(projectRoot: string): Promise<{ decisions: OverScopeDecision[] }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(projectRoot, ACCEPTED_WIDENINGS_PATH), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && (parsed as { version?: unknown }).version === 1 && Array.isArray((parsed as { decisions?: unknown }).decisions) && (parsed as { decisions: unknown[] }).decisions.every(isOverScopeDecision)) return { decisions: (parsed as OverScopeDecisionsFile).decisions };
  } catch { /* absent/corrupt state is never a decision */ }
  return { decisions: [] };
}

export type OverScopeDecisionInput = Omit<OverScopeDecision, 'decidedAt'> & { decidedAt?: string };
export interface RecordOverScopeDecisionsResult { recorded: OverScopeDecision[]; failure?: 'write-failed' | 'missing-operator' }

function isNoOwnerCriterion(criterion: string): boolean {
  return /^NC\.\d+$/i.test(criterion);
}

/**
 * NC ordinals are lap-local and evidence summaries re-anchor their `file:line`
 * spans on every re-grade, so neither is stable identity on its own. Comparing
 * with the anchors collapsed lets a decision survive a re-graded lap.
 */
export function normalizeOverScopeSummary(summary: string): string {
  return summary.replace(/:\d+(?:-\d+)?\b/g, ':L').replace(/\s+/g, ' ').trim();
}

const SUMMARY_EQUIVALENCE_THRESHOLD = 0.8;

function summaryTokens(summary: string): Set<string> {
  return new Set(
    normalizeOverScopeSummary(summary)
      .toLowerCase()
      .replace(/[`*"'()\[\]{};,.]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 0),
  );
}

/**
 * The evidence summary is LLM-authored prose that re-grades reword freely (a
 * fourth halt on one feature rewrote the same finding four ways, and one lap
 * appended decision history into the summary itself — #2145), so exact
 * equality drops recorded decisions. Equivalence is exact normalized match,
 * or a token-overlap coefficient (shared over the smaller token set) at
 * 0.8+: the smaller-set denominator keeps a summary equivalent to itself
 * plus appended history, while a genuinely different finding fails closed.
 */
export function overScopeSummariesEquivalent(a: string, b: string): boolean {
  if (normalizeOverScopeSummary(a) === normalizeOverScopeSummary(b)) return true;
  const tokensA = summaryTokens(a);
  const tokensB = summaryTokens(b);
  if (!tokensA.size || !tokensB.size) return false;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  return shared / Math.min(tokensA.size, tokensB.size) >= SUMMARY_EQUIVALENCE_THRESHOLD;
}

/** NC decisions bind their evidence summary; regular criterion decisions remain criterion-keyed. */
function decisionMatchesFinding(
  decision: Pick<OverScopeDecision, 'criterion' | 'summary'>,
  criterion: string,
  summary: string,
): boolean {
  if (!isNoOwnerCriterion(criterion)) return decision.criterion === criterion;
  return isNoOwnerCriterion(decision.criterion)
    && overScopeSummariesEquivalent(decision.summary, summary);
}

/** Append new decisions atomically; repeated decisions are inert and the last decision is authoritative. */
export async function recordOverScopeDecisions(projectRoot: string, inputs: readonly OverScopeDecisionInput[]): Promise<RecordOverScopeDecisionsResult> {
  if (inputs.some((entry) => !entry.operator.trim())) return { recorded: [], failure: 'missing-operator' };
  const current = await readOverScopeDecisions(projectRoot);
  const recorded: OverScopeDecision[] = [];
  for (const input of inputs) {
    const entry: OverScopeDecision = { criterion: input.criterion.trim(), summary: input.summary.trim(), decision: input.decision, rationale: input.rationale.trim(), operator: input.operator.trim(), decidedAt: input.decidedAt ?? new Date().toISOString() };
    if (!isOverScopeDecision(entry)) continue;
    const effective = [...current.decisions, ...recorded]
      .filter((decision) => decisionMatchesFinding(decision, entry.criterion, entry.summary))
      .at(-1);
    if (effective?.decision === entry.decision) continue;
    recorded.push(entry);
  }
  if (!recorded.length) return { recorded };
  const path = join(projectRoot, ACCEPTED_WIDENINGS_PATH); const temporary = `${path}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, JSON.stringify({ version: 1, decisions: [...current.decisions, ...recorded] }, null, 2), 'utf8');
    await rename(temporary, path);
    return { recorded };
  } catch {
    await rm(temporary, { force: true }).catch(() => {});
    return { recorded: [], failure: 'write-failed' };
  }
}

export type IntentRelation = 'within' | 'outside-harmless' | 'outside-visible';
export type OverScopeCriterionClassification = 'not-blocking' | 'blocking-undecided' | 'blocking-refused' | 'accepted';

/** The one definition used by routing and completion; decisions are last-write-wins. */
export function classifyOverScopeCriterion(criterion: string, relations: ReadonlyMap<string, IntentRelation>, decisions: readonly OverScopeDecision[]): OverScopeCriterionClassification;
export function classifyOverScopeCriterion(criterion: string, summary: string, relations: ReadonlyMap<string, IntentRelation>, decisions: readonly OverScopeDecision[]): OverScopeCriterionClassification;
export function classifyOverScopeCriterion(
  criterion: string,
  summaryOrRelations: string | ReadonlyMap<string, IntentRelation>,
  relationsOrDecisions: ReadonlyMap<string, IntentRelation> | readonly OverScopeDecision[],
  decisions: readonly OverScopeDecision[] = [],
): OverScopeCriterionClassification {
  const summary = typeof summaryOrRelations === 'string' ? summaryOrRelations : '';
  const relations = typeof summaryOrRelations === 'string'
    ? relationsOrDecisions as ReadonlyMap<string, IntentRelation>
    : summaryOrRelations;
  const applicableDecisions = typeof summaryOrRelations === 'string'
    ? decisions
    : relationsOrDecisions as readonly OverScopeDecision[];
  if (relations.get(criterion) !== 'outside-visible') return 'not-blocking';
  const decision = applicableDecisions
    .filter((entry) => decisionMatchesFinding(entry, criterion, summary))
    .at(-1)?.decision;
  return decision === 'accept' ? 'accepted' : decision === 'refuse' ? 'blocking-refused' : 'blocking-undecided';
}

export interface OverScopeRenderableFinding { criterion: string; summary: string; relation: IntentRelation }
export function renderOverScopeDecisionBlock(undecided: readonly OverScopeRenderableFinding[], refused: readonly OverScopeRenderableFinding[] = [], defects: readonly { kind: string; criterion?: string; message?: string }[] = []): string {
  const parts: string[] = [];
  if (undecided.length) {
    parts.push(`Blocking criteria awaiting a decision: ${undecided.map((f) => f.criterion).join(', ')}.`);
    parts.push('Edit each `decision` to `accept` or `refuse` with a `rationale`, then clear this halt.');
    parts.push(`\`\`\`json over-scope-decisions\n${JSON.stringify(undecided.map((f) => ({ criterion: f.criterion, summary: f.summary, relation: f.relation, decision: 'pending' })), null, 2)}\n\`\`\``);
  }
  if (refused.length) parts.push(`Refused — rework required: ${refused.map((f) => f.criterion).join(', ')}.`);
  if (defects.length) parts.push(`Unreadable scope decisions: ${defects.map((d) => d.message ? `${d.kind} (${d.message})` : d.criterion ? `${d.kind} (${d.criterion})` : d.kind).join(', ')}.`);
  return parts.join('\n\n');
}

export type OverScopeDecisionDefectKind = 'malformed-block' | 'unknown-criterion' | 'missing-rationale' | 'invalid-decision';
export interface OverScopeDecisionDefect { kind: OverScopeDecisionDefectKind; criterion?: string }
export type ParsedOverScopeDecisions = { kind: 'absent' } | { kind: 'parsed'; decisions: Array<Pick<OverScopeDecision, 'criterion' | 'summary' | 'decision' | 'rationale'>>; defects: OverScopeDecisionDefect[] };

/** Parse each operator-authored entry independently: one bad entry never discards valid siblings. */
export function parseClearedOverScopeDecisions(
  body: string,
  blockingFindings: ReadonlyMap<string, string> | ReadonlySet<string>,
): ParsedOverScopeDecisions {
  const match = body.match(/```json\s+over-scope-decisions\s*\n([\s\S]*?)\n```/i);
  if (!match) return { kind: 'absent' };
  let entries: unknown;
  try { entries = JSON.parse(match[1]!); } catch { return { kind: 'parsed', decisions: [], defects: [{ kind: 'malformed-block' }] }; }
  if (!Array.isArray(entries)) return { kind: 'parsed', decisions: [], defects: [{ kind: 'malformed-block' }] };
  const decisions: Array<Pick<OverScopeDecision, 'criterion' | 'summary' | 'decision' | 'rationale'>> = []; const defects: OverScopeDecisionDefect[] = [];
  for (const raw of entries) {
    const entry = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const criterion = typeof entry.criterion === 'string' ? entry.criterion.trim() : undefined;
    const authoredSummary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
    // NC ordinals are lap-local, so a re-graded lap may renumber the same
    // finding out from under a recorded decision. Rebind by evidence summary
    // (anchors normalized) when it identifies exactly one current NC finding.
    let bound = criterion;
    if (criterion && isNoOwnerCriterion(criterion) && authoredSummary && 'get' in blockingFindings) {
      const currentEvidence = blockingFindings.get(criterion);
      const summaryDrifted = currentEvidence !== undefined
        && !overScopeSummariesEquivalent(currentEvidence, authoredSummary);
      if (!blockingFindings.has(criterion) || summaryDrifted) {
        const rebound = [...blockingFindings.entries()].filter(([id, evidence]) =>
          isNoOwnerCriterion(id) && overScopeSummariesEquivalent(evidence, authoredSummary));
        if (rebound.length === 1) bound = rebound[0]![0];
        else if (summaryDrifted) bound = criterion; // fall through to the strict check's defect
      }
    }
    if (!bound || !blockingFindings.has(bound)) { defects.push({ kind: 'unknown-criterion', ...(criterion ? { criterion } : {}) }); continue; }
    if (entry.decision === 'pending' || entry.decision === undefined) continue;
    if (entry.decision !== 'accept' && entry.decision !== 'refuse') { defects.push({ kind: 'invalid-decision', criterion: bound }); continue; }
    if (typeof entry.rationale !== 'string' || !entry.rationale.trim()) { defects.push({ kind: 'missing-rationale', criterion: bound }); continue; }
    if (!authoredSummary) { defects.push({ kind: 'invalid-decision', criterion: bound }); continue; }
    const currentSummary = 'get' in blockingFindings ? blockingFindings.get(bound) : undefined;
    if (isNoOwnerCriterion(bound) && currentSummary !== undefined
      && !overScopeSummariesEquivalent(currentSummary, authoredSummary)) {
      defects.push({ kind: 'invalid-decision', criterion: bound });
      continue;
    }
    // Record under the current lap's id and summary so the stored decision
    // matches this lap's report verbatim.
    decisions.push({ criterion: bound, summary: currentSummary ?? authoredSummary, decision: entry.decision, rationale: entry.rationale.trim() });
  }
  return { kind: 'parsed', decisions, defects };
}

export function prdAuditTableCells(line: string): string[] { return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()); }
/** Criterion → declared intent relation, for OVER_SCOPE rows of a prd-audit Verdict Table. */
export function overScopeRelations(reportText: string): Map<string, IntentRelation> {
  const lines = reportText.split('\n');
  const headerIndex = lines.findIndex((line) => /^\s*\|/.test(line) && (() => { const header = prdAuditTableCells(line).map((cell) => cell.toLowerCase()); return header.includes('criterion') && header.includes('grade'); })());
  if (headerIndex === -1) return new Map();
  const header = prdAuditTableCells(lines[headerIndex]!).map((cell) => cell.toLowerCase()); const criterionIndex = header.indexOf('criterion'); const gradeIndex = header.indexOf('grade'); const relationIndex = header.findIndex((cell) => cell === 'intent relation' || cell === 'intentrelation');
  if (relationIndex === -1) return new Map();
  const relations = new Map<string, IntentRelation>();
  for (const line of lines.slice(headerIndex + 1)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = prdAuditTableCells(line); if (cells.every((cell) => /^:?-{3,}:?$/.test(cell)) || cells[gradeIndex]?.toUpperCase() !== 'OVER_SCOPE') continue;
    const criterion = cells[criterionIndex]?.trim().toUpperCase(); const relation = cells[relationIndex]?.trim().toLowerCase();
    if (criterion && (relation === 'within' || relation === 'outside-harmless' || relation === 'outside-visible')) relations.set(criterion, relation);
  }
  const noOwnerSectionIndex = lines.findIndex((line) => /^\s*##\s+Findings without an owning criterion\s*$/i.test(line));
  const noOwnerHeaderIndex = noOwnerSectionIndex === -1 ? -1 : lines.findIndex((line, index) => index > noOwnerSectionIndex && /^\s*\|/.test(line) && (() => { const header = prdAuditTableCells(line).map((cell) => cell.toLowerCase()); return header.includes('finding') && header.includes('grade'); })());
  if (noOwnerHeaderIndex === -1) return relations;
  const noOwnerHeader = prdAuditTableCells(lines[noOwnerHeaderIndex]!).map((cell) => cell.toLowerCase()); const findingIndex = noOwnerHeader.indexOf('finding'); const noOwnerGradeIndex = noOwnerHeader.indexOf('grade'); const noOwnerRelationIndex = noOwnerHeader.findIndex((cell) => cell === 'intent relation' || cell === 'intentrelation');
  if (noOwnerRelationIndex === -1) return relations;
  for (const line of lines.slice(noOwnerHeaderIndex + 1)) {
    if (/^\s*##\s/.test(line)) break;
    if (!/^\s*\|/.test(line)) continue;
    const cells = prdAuditTableCells(line); if (cells.every((cell) => /^:?-{3,}:?$/.test(cell)) || cells[noOwnerGradeIndex]?.toUpperCase() !== 'OVER_SCOPE') continue;
    const finding = cells[findingIndex]?.trim().toUpperCase(); const relation = cells[noOwnerRelationIndex]?.trim().toLowerCase();
    if (finding && /^NC\.\d+$/.test(finding) && (relation === 'within' || relation === 'outside-harmless' || relation === 'outside-visible')) relations.set(finding, relation);
  }
  return relations;
}
