import { readFile, unlink, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listCommitsWithTrailers, canonicalTaskId } from './autoheal.js';

/**
 * Count of distinct plan task-ids that are "resolved" — i.e. either already
 * `completed`/`skipped` in `.pipeline/task-status.json` (gate-authority /
 * `conduct task done` marked), OR carried by a `Task:` trailer on a commit
 * on the current branch. Returns 0 when the status file is absent or
 * unparseable — callers treat "no data" as "no progress" which is the safe
 * default.
 *
 * #757/#773 Task 15: this used to be sourced (indirectly, via task-status.json
 * completion) from the per-task evidence-ledger derivation engine
 * (`deriveCompletion`/`applyDerivedCompletion`), which feature #773 deleted
 * (Task 11) — that engine was never re-wired into the live build loop, so the
 * resolved-count silently stalled at whatever task-status.json already had.
 * The count now reads `Task:`-trailered commits directly (telemetry only,
 * non-gating) so it advances even when nothing has explicitly flipped a row's
 * status.
 *
 * Used by the build-step stall circuit breaker: if the count doesn't move
 * between two consecutive retries, the retries aren't actually producing
 * work and we auto-hand-off to interactive mode rather than burning the
 * rest of the budget.
 */
export async function countResolvedTasks(projectRoot: string): Promise<number> {
  const statusPath = join(projectRoot, '.pipeline/task-status.json');
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf-8');
  } catch {
    return 0;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }

  const tasks = normalizeTasks(parsed);
  if (tasks.length === 0) return 0;

  const resolved = new Set<string>();
  for (const t of tasks) {
    if ((t.status === 'completed' || t.status === 'skipped') && t.id !== undefined) {
      resolved.add(t.id);
    }
  }

  // Union in plan task-ids carried by `Task:` trailers on the branch. Best
  // effort: non-git directories or git failures degrade to no additional
  // ids (fail-soft), matching countResolvedTasks's overall "no data means no
  // progress" default.
  const trailerIds = await distinctTaskTrailerIds(projectRoot);
  const planIds = new Set(tasks.map((t) => t.id).filter((id): id is string => id !== undefined));
  for (const id of trailerIds) {
    const canonical = canonicalTaskId(id);
    const match = planIds.has(id)
      ? id
      : [...planIds].find((p) => canonicalTaskId(p) === canonical);
    if (match !== undefined) resolved.add(match);
  }

  return resolved.size;
}

/**
 * Shared union fold: plan task-ids that are "resolved" — either already
 * `completed`/`skipped` in `.pipeline/task-status.json`, OR carried by a
 * `Task:` trailer on a commit on the current branch (matched against
 * `planIds` directly or via `canonicalTaskId` alias, e.g. plan id `2`
 * matches trailer `Task: T2`). Trailer read is fail-soft: a git error (non-repo
 * dir, no commits, etc.) degrades to no additional ids, never throws.
 *
 * This is the exact fold `countResolvedTasks` computes internally; extracted
 * here so other callers (the build completion predicate) can consume the
 * same definition instead of re-deriving it.
 */
export async function resolveTaskIds(projectRoot: string, planIds: string[]): Promise<Set<string>> {
  const statusPath = join(projectRoot, '.pipeline/task-status.json');
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf-8');
  } catch {
    raw = '';
  }

  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }

  const tasks = normalizeTasks(parsed);

  const resolved = new Set<string>();
  for (const t of tasks) {
    if ((t.status === 'completed' || t.status === 'skipped') && t.id !== undefined) {
      resolved.add(t.id);
    }
  }

  const trailerIds = await distinctTaskTrailerIds(projectRoot);
  const planIdSet = new Set(planIds);
  for (const id of trailerIds) {
    const canonical = canonicalTaskId(id);
    const match = planIdSet.has(id)
      ? id
      : [...planIdSet].find((p) => canonicalTaskId(p) === canonical);
    if (match !== undefined) resolved.add(match);
  }

  return resolved;
}

/**
 * Distinct raw `Task:` trailer values across commits on the current branch
 * (per `listCommitsWithTrailers`'s merge-base-relative range). Fails soft to
 * an empty set on any git error (non-repo dir, no commits, etc.) — trailer
 * sourcing is a best-effort addition, never a hard requirement.
 */
async function distinctTaskTrailerIds(projectRoot: string): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const commits = await listCommitsWithTrailers(projectRoot);
    for (const commit of commits) {
      for (const value of commit.trailers['Task'] ?? []) {
        ids.add(value);
      }
    }
  } catch {
    // fail-soft — no trailer data available
  }
  return ids;
}

/** A task row after tolerating both the new array shape and the legacy
 * id-keyed map shape. `id` and `title` are best-effort — absent/malformed
 * fields degrade to `undefined` rather than throwing. */
export interface NormalizedTask {
  id?: string;
  title?: string;
  status?: string;
}

/**
 * Tolerant parse shared by `countResolvedTasks` and the build-progress
 * watcher's `readSnapshot`: accepts the new `{tasks: [...]}` array shape and
 * the legacy id-keyed map shape (with or without a `tasks` wrapper key).
 * Never throws — malformed input normalizes to an empty array.
 */
export function normalizeTasks(parsed: unknown): NormalizedTask[] {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const container = 'tasks' in (parsed as Record<string, unknown>)
    ? (parsed as Record<string, unknown>).tasks
    : parsed;

  const titleOf = (t: Record<string, unknown>): string | undefined => {
    if (typeof t.title === 'string') return t.title;
    if (typeof t.name === 'string') return t.name;
    return undefined;
  };
  const statusOf = (t: Record<string, unknown>): string | undefined =>
    typeof t.status === 'string' ? t.status : undefined;

  if (Array.isArray(container)) {
    return container
      .filter((t) => typeof t === 'object' && t !== null)
      .map((t) => {
        const row = t as Record<string, unknown>;
        return {
          id: row.id !== undefined && row.id !== null ? String(row.id) : undefined,
          title: titleOf(row),
          status: statusOf(row),
        };
      });
  }
  if (container && typeof container === 'object') {
    return Object.entries(container as Record<string, unknown>).map(([id, v]) => {
      const row = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
      return {
        id,
        title: titleOf(row),
        status: statusOf(row),
      };
    });
  }
  return [];
}

/**
 * Marker file path used by skills (chiefly `/pipeline`) to explicitly signal
 * that the step can't make autonomous progress and needs human judgement. The
 * conductor reads this after each build attempt; if present, it treats the
 * attempt as a stall regardless of task-count deltas, emits
 * `build_stall`, and hands off to interactive mode.
 *
 * Shape-B counterpart of the progress-stall circuit breaker — skills opt in
 * when they KNOW they can't continue without input; the conductor catches
 * unconscious stalls via task-count deltas either way.
 */
export const HALT_MARKER_RELATIVE = '.pipeline/halt-user-input-required';

export function haltMarkerPath(projectRoot: string): string {
  return join(projectRoot, HALT_MARKER_RELATIVE);
}

export async function haltMarkerExists(projectRoot: string): Promise<boolean> {
  try {
    await readFile(haltMarkerPath(projectRoot), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the content of the halt marker file exactly as written. Returns null
 * if the file doesn't exist (ENOENT or any other error). Returns the raw
 * string content (possibly empty) if the file exists.
 *
 * Used by skills to retrieve the reason or context for a stall from the
 * halt marker body.
 */
export async function readHaltMarkerContent(projectRoot: string): Promise<string | null> {
  try {
    return await readFile(haltMarkerPath(projectRoot), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Clear the halt marker once the conductor has acknowledged it (handed off
 * to interactive mode). Silent on missing file — idempotent.
 */
export async function clearHaltMarker(projectRoot: string): Promise<void> {
  await unlink(haltMarkerPath(projectRoot)).catch(() => {
    // Marker absent — nothing to clear.
  });
}

/**
 * Write the build stall question (the reason for the halt) to an evidence file
 * at `.pipeline/build-stall-question.md`. If content is null, empty, or
 * whitespace-only, writes a placeholder line instead. Creates the `.pipeline`
 * directory if needed (mkdir -p semantics).
 *
 * Returns the exact string written (either the content or the placeholder),
 * for reuse by callers (e.g. to include in the HALT marker body).
 *
 * Used by the build-stall logic to persist the question asked during halt
 * for debugging and audit purposes.
 */
export async function writeStallQuestionEvidence(
  projectRoot: string,
  content: string | null,
): Promise<string> {
  const placeholder = '(agent wrote no reason into halt-user-input-required)';

  // Determine the effective text: use placeholder if content is null, empty, or whitespace-only
  const effectiveText =
    content === null || (typeof content === 'string' && content.trim() === '')
      ? placeholder
      : content;

  // Create .pipeline directory if needed
  const pipelineDir = join(projectRoot, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });

  // Write to .pipeline/build-stall-question.md
  const evidencePath = join(pipelineDir, 'build-stall-question.md');
  await writeFile(evidencePath, effectiveText, 'utf-8');

  return effectiveText;
}

/**
 * Write a fail-safe HALT marker for a degraded remediation exit. Combines
 * the stall question with a detail about what went wrong (threw, malformed
 * JSON, stale file, dispositions dropped, or budget exhausted). Always
 * writes to `.pipeline/HALT` with the question on the first non-empty line,
 * then the detail. Used when planRemediation fails or returns a degraded outcome.
 *
 * Creates the `.pipeline` directory if needed (mkdir -p semantics).
 */
export async function writeStallHalt(
  projectRoot: string,
  question: string | null,
  detail: string,
): Promise<void> {
  const pipelineDir = join(projectRoot, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });

  const effectiveQuestion =
    question === null || (typeof question === 'string' && question.trim() === '')
      ? '(agent wrote no reason into halt-user-input-required)'
      : question;

  const haltContent = [effectiveQuestion, detail].filter(Boolean).join('\n\n');

  const haltPath = join(pipelineDir, 'HALT');
  await writeFile(haltPath, haltContent + '\n', 'utf-8');
}
