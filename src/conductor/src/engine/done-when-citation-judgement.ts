import {
  parseDoneWhenCloseSource,
  parseDoneWhenTestReference,
} from './done-when-test-reference.js';

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
  const rows: readonly (readonly [string | undefined, unknown])[] = Array.isArray(tasks)
    ? tasks.map((row) => [undefined, row] as const)
    : record(tasks) ? Object.entries(tasks) : [];
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
      checkIndex: verdict.checkIndex,
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
