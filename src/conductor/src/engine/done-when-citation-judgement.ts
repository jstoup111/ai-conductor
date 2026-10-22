import {
  parseDoneWhenCloseSource,
  parseDoneWhenTestReference,
} from './done-when-test-reference.js';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { currentCommitSha, currentTreeHash } from './project-prelude.js';
import { createRepairObligationStore, type RepairObligation } from './repair-obligations.js';
import { restageExistingRemediationTaskStatuses } from './repair-restage.js';
import { countResolvedTasks } from './task-progress.js';

/** The bounded amount of a cited test supplied to the citation judge. */
export const DONE_WHEN_CITATION_WINDOW_LINES = 80;

export type CitationJudgementVerdict = 'asserts' | 'does-not-assert';

export interface PendingCitation {
  readonly taskId: string;
  /** One-based, matching the check number shown by `conduct task done`. */
  readonly checkIndex: number;
  readonly check: string;
  readonly path: string;
  readonly title: string;
}

export interface CitationJudgementInputCitation extends PendingCitation {
  readonly taskText: string;
  readonly citedFileContent: string;
}

export interface CitationJudgementInput {
  readonly citations: readonly CitationJudgementInputCitation[];
}

export interface CitationJudgementResult {
  readonly taskId: string;
  readonly checkIndex: number;
  readonly verdict: CitationJudgementVerdict;
  readonly reason: string;
}

export type CitationJudgementValidation =
  | { readonly kind: 'valid'; readonly verdicts: readonly CitationJudgementResult[] }
  | { readonly kind: 'invalid'; readonly reason: string };

/**
 * Provider-visible contract. The parser below additionally ensures every
 * pending citation is addressed; JSON Schema cannot express that relation.
 */
export const DONE_WHEN_CITATION_JUDGEMENT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'checkIndex', 'verdict', 'reason'],
        properties: {
          taskId: { type: 'string', pattern: '\\S' },
          // Native schemas accept the structural integer constraint; the
          // parser below owns the positive-index invariant.
          checkIndex: { type: 'integer' },
          verdict: { type: 'string', enum: ['asserts', 'does-not-assert'] },
          reason: { type: 'string', pattern: '\\S' },
        },
      },
    },
  },
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Read pending references from either current array or legacy map status rows. */
export function collectPendingCitations(status: unknown): PendingCitation[] {
  const root = record(status);
  if (!root) return [];
  const tasks = 'tasks' in root ? root.tasks : root;
  const taskMap = record(tasks);
  const rows: readonly (readonly [string | undefined, unknown])[] = Array.isArray(tasks)
    ? tasks.map((row) => [undefined, row] as const)
    : taskMap ? Object.entries(taskMap) : [];
  const pending: PendingCitation[] = [];
  for (const [legacyId, value] of rows) {
    const task = record(value);
    if (!task || !Array.isArray(task.doneWhen)) continue;
    const taskId = typeof task.id === 'string' ? task.id : legacyId;
    if (!taskId) continue;
    for (const [offset, rawClose] of task.doneWhen.entries()) {
      const close = record(rawClose);
      if (!close) continue;
      const source = parseDoneWhenCloseSource(close.source);
      if (!source) {
        if (typeof close.source === 'string') {
          throw new Error(`unknown done-when close source: ${close.source}`);
        }
        continue;
      }
      if (source !== 'pending-judgement') continue;
      if (typeof close.check !== 'string' || typeof close.evidence !== 'string') continue;
      const reference = parseDoneWhenTestReference(close.evidence);
      if (!reference) continue;
      pending.push({
        taskId,
        checkIndex: offset + 1,
        check: close.check,
        path: reference.path,
        title: reference.title,
      });
    }
  }
  return pending;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Return a fixed line window centred on the line that carries the cited title. */
export function citationContentWindow(content: string, title: string): string {
  const lines = content.split(/\r?\n/);
  const target = normalized(title);
  let titleLine = lines.findIndex((line) => normalized(line).includes(target));
  if (titleLine < 0) titleLine = 0;
  const before = Math.floor(DONE_WHEN_CITATION_WINDOW_LINES / 2);
  const start = Math.max(0, Math.min(titleLine - before, Math.max(0, lines.length - DONE_WHEN_CITATION_WINDOW_LINES)));
  return lines.slice(start, start + DONE_WHEN_CITATION_WINDOW_LINES).join('\n');
}

/** Build the read-only, bounded projection handed to the provider. */
export function buildCitationJudgementInput(
  pending: readonly PendingCitation[],
  taskTexts: ReadonlyMap<string, string>,
  citedFiles: ReadonlyMap<string, string | Uint8Array>,
): CitationJudgementInput {
  return {
    citations: pending.map((citation) => {
      const blob = citedFiles.get(citation.path);
      const content = blob === undefined ? '' : typeof blob === 'string' ? blob : Buffer.from(blob).toString('utf8');
      return {
        ...citation,
        taskText: taskTexts.get(citation.taskId) ?? '',
        citedFileContent: citationContentWindow(content, citation.title),
      };
    }),
  };
}

/** Validate a native-schema response before any durable close record changes. */
export function validateCitationJudgementOutput(
  output: unknown,
  pending: readonly PendingCitation[],
): CitationJudgementValidation {
  const root = record(output);
  if (!root || Object.keys(root).some((key) => key !== 'verdicts') || !Array.isArray(root.verdicts)) {
    return { kind: 'invalid', reason: 'citation judgement must be an object with verdicts' };
  }
  const expected = new Set(pending.map(({ taskId, checkIndex }) => `${taskId}\u0000${checkIndex}`));
  const verdicts: CitationJudgementResult[] = [];
  const seen = new Set<string>();
  for (const rawVerdict of root.verdicts) {
    const verdict = record(rawVerdict);
    if (!verdict || Object.keys(verdict).some((key) => !['taskId', 'checkIndex', 'verdict', 'reason'].includes(key)) ||
      typeof verdict.taskId !== 'string' || !verdict.taskId.trim() ||
      !Number.isInteger(verdict.checkIndex) || (verdict.checkIndex as number) < 1 ||
      (verdict.verdict !== 'asserts' && verdict.verdict !== 'does-not-assert') ||
      typeof verdict.reason !== 'string' || !verdict.reason.trim()) {
      return { kind: 'invalid', reason: 'citation judgement has an invalid verdict' };
    }
    const result: CitationJudgementResult = {
      taskId: verdict.taskId,
      checkIndex: verdict.checkIndex as number,
      verdict: verdict.verdict,
      reason: verdict.reason,
    };
    const key = `${result.taskId}\u0000${result.checkIndex}`;
    if (!expected.has(key)) continue;
    if (seen.has(key)) return { kind: 'invalid', reason: `citation judgement has duplicate verdict for ${result.taskId} check ${result.checkIndex}` };
    seen.add(key);
    verdicts.push(result);
  }
  const missing = [...expected].filter((key) => !seen.has(key));
  if (missing.length > 0) return { kind: 'invalid', reason: 'citation judgement omitted a pending citation verdict' };
  return { kind: 'valid', verdicts };
}

/**
 * Persist terminal judge results for precisely the citations that were pending
 * in the status snapshot.  Unknown verdicts are intentionally ignored: the
 * native-output validator accepts them so an otherwise complete batch need
 * not be retried, but they must never rewrite another task's close record.
 */
export async function applyCitationVerdicts(
  projectRoot: string,
  status: unknown,
  verdicts: readonly CitationJudgementResult[],
): Promise<void> {
  const root = record(status);
  if (!root) throw new Error('task-status.json root is not an object');
  const tasks = root.tasks;
  if (!Array.isArray(tasks)) throw new Error('task-status.json does not have a tasks array');

  const pending = new Set(collectPendingCitations(root).map(({ taskId, checkIndex }) => `${taskId}\u0000${checkIndex}`));
  const byKey = new Map(verdicts.map((verdict) => [`${verdict.taskId}\u0000${verdict.checkIndex}`, verdict]));
  for (const rawTask of tasks) {
    const task = record(rawTask);
    if (!task || typeof task.id !== 'string' || !Array.isArray(task.doneWhen)) continue;
    for (const [offset, rawClose] of task.doneWhen.entries()) {
      const close = record(rawClose);
      if (!close) continue;
      const key = `${task.id}\u0000${offset + 1}`;
      const verdict = byKey.get(key);
      if (!pending.has(key) || !verdict || parseDoneWhenCloseSource(close.source) !== 'pending-judgement') continue;
      close.source = 'judged';
      close.reason = verdict.reason;
      close.verdict = verdict.verdict;
    }
  }

  const pipelineDir = join(projectRoot, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });
  const path = join(pipelineDir, 'task-status.json');
  const temp = join(pipelineDir, `.task-status.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(root, null, 2));
    await rename(temp, path);
  } catch (error) {
    throw new Error(`failed to write task-status.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface RefusedCitation extends PendingCitation {
  readonly reason: string;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface CitationRefusalAdmission {
  readonly obligation: RepairObligation;
  readonly taskId: string;
  readonly checks: readonly RefusedCitation[];
  readonly replayed: boolean;
}

/**
 * Turn one judge refusal batch into the durable repair authority which keeps
 * historic Task: trailers from resolving the reopened task.  The admission
 * key is content-addressed, so an interrupted/restarted boundary replays the
 * same obligation and never increments a refusal count twice.
 */
export async function admitCitationRefusals(
  projectRoot: string,
  planPath: string,
  pending: readonly PendingCitation[],
  verdicts: readonly CitationJudgementResult[],
): Promise<CitationRefusalAdmission[]> {
  const byTask = new Map<string, RefusedCitation[]>();
  const citations = new Map(pending.map((citation) => [`${citation.taskId}\u0000${citation.checkIndex}`, citation]));
  for (const verdict of verdicts) {
    if (verdict.verdict !== 'does-not-assert') continue;
    const citation = citations.get(`${verdict.taskId}\u0000${verdict.checkIndex}`);
    if (!citation) continue;
    const refusal = { ...citation, reason: verdict.reason };
    const task = byTask.get(refusal.taskId) ?? [];
    task.push(refusal);
    byTask.set(refusal.taskId, task);
  }
  if (byTask.size === 0) return [];
  const [head, tree, resolvedCount] = await Promise.all([
    currentCommitSha(projectRoot), currentTreeHash(projectRoot), countResolvedTasks(projectRoot),
  ]);
  const repairs = createRepairObligationStore(projectRoot, join(projectRoot, '.pipeline', 'engine-state.json'));
  const admissions: CitationRefusalAdmission[] = [];
  for (const [taskId, unsorted] of byTask) {
    const checks = [...unsorted].sort((a, b) => a.checkIndex - b.checkIndex);
    const finding = checks.map(({ checkIndex, check, path, title }) => ({
      checkIndex, checkDigest: digest(check), reference: `test:${path}::${title}`,
    }));
    const findingId = digest({ taskId, checks: finding });
    const admitted = await repairs.admitOrReplay(`done-when-citation:${findingId}`, {
      id: `done-when-citation-${findingId.slice(0, 16)}`,
      planPath,
      taskIds: [taskId],
      source: {
        findingId,
        authority: 'done-when-citation',
        instruction: formatCitationRefusalRetryHint(taskId, checks),
      },
      baseline: { head: head ?? '', tree: tree ?? '', resolvedTaskIds: [], resolvedCount },
    });
    if (!admitted.ok) throw new Error(`could not admit Done-when citation refusal: ${admitted.message}`);
    if (!admitted.replayed) {
      const counts = await repairs.recordCitationRefusals(finding.map((check) => digest({ taskId, ...check })));
      if (!counts.ok) throw new Error(`could not record Done-when citation refusal: ${counts.message}`);
    }
    const restaged = await restageExistingRemediationTaskStatuses(projectRoot, planPath, new Set([taskId]));
    if (restaged.kind === 'failed') throw new Error(restaged.detail);
    admissions.push({ obligation: admitted.obligation, taskId, checks, replayed: admitted.replayed });
  }
  return admissions;
}

export function formatCitationRefusalRetryHint(taskId: string, checks: readonly RefusedCitation[]): string {
  return `Done-when citation refused: Task ${taskId} must repair its refused test citation(s): ` +
    checks.map((check) => `check ${check.checkIndex} (${check.check}; test:${check.path}::${check.title}; ${check.reason})`).join('; ');
}
