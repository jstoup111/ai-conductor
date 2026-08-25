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

/** Append new decisions atomically; repeated decisions are inert and the last decision is authoritative. */
export async function recordOverScopeDecisions(projectRoot: string, inputs: readonly OverScopeDecisionInput[]): Promise<RecordOverScopeDecisionsResult> {
  if (inputs.some((entry) => !entry.operator.trim())) return { recorded: [], failure: 'missing-operator' };
  const current = await readOverScopeDecisions(projectRoot);
  const recorded: OverScopeDecision[] = [];
  for (const input of inputs) {
    const entry: OverScopeDecision = { criterion: input.criterion.trim(), summary: input.summary.trim(), decision: input.decision, rationale: input.rationale.trim(), operator: input.operator.trim(), decidedAt: input.decidedAt ?? new Date().toISOString() };
    if (!isOverScopeDecision(entry)) continue;
    const effective = [...current.decisions, ...recorded].filter((d) => d.criterion === entry.criterion).at(-1);
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
export function classifyOverScopeCriterion(criterion: string, relations: ReadonlyMap<string, IntentRelation>, decisions: readonly OverScopeDecision[]): OverScopeCriterionClassification {
  if (relations.get(criterion) !== 'outside-visible') return 'not-blocking';
  const decision = decisions.filter((entry) => entry.criterion === criterion).at(-1)?.decision;
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
export function parseClearedOverScopeDecisions(body: string, blockingCriteria: ReadonlySet<string>): ParsedOverScopeDecisions {
  const match = body.match(/```json\s+over-scope-decisions\s*\n([\s\S]*?)\n```/i);
  if (!match) return { kind: 'absent' };
  let entries: unknown;
  try { entries = JSON.parse(match[1]!); } catch { return { kind: 'parsed', decisions: [], defects: [{ kind: 'malformed-block' }] }; }
  if (!Array.isArray(entries)) return { kind: 'parsed', decisions: [], defects: [{ kind: 'malformed-block' }] };
  const decisions: Array<Pick<OverScopeDecision, 'criterion' | 'summary' | 'decision' | 'rationale'>> = []; const defects: OverScopeDecisionDefect[] = [];
  for (const raw of entries) {
    const entry = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const criterion = typeof entry.criterion === 'string' ? entry.criterion.trim() : undefined;
    if (!criterion || !blockingCriteria.has(criterion)) { defects.push({ kind: 'unknown-criterion', ...(criterion ? { criterion } : {}) }); continue; }
    if (entry.decision === 'pending' || entry.decision === undefined) continue;
    if (entry.decision !== 'accept' && entry.decision !== 'refuse') { defects.push({ kind: 'invalid-decision', criterion }); continue; }
    if (typeof entry.rationale !== 'string' || !entry.rationale.trim()) { defects.push({ kind: 'missing-rationale', criterion }); continue; }
    if (typeof entry.summary !== 'string' || !entry.summary.trim()) { defects.push({ kind: 'invalid-decision', criterion }); continue; }
    decisions.push({ criterion, summary: entry.summary.trim(), decision: entry.decision, rationale: entry.rationale.trim() });
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
  return relations;
}
