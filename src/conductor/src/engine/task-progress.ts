import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Count of tasks that are either `completed` or `skipped` (i.e. resolved and
 * not pending further work) in `.pipeline/task-status.json`. Returns 0 when
 * the file is absent or unparseable — callers treat "no data" as "no
 * progress" which is the safe default.
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
  return countFromParsed(parsed);
}

function countFromParsed(parsed: unknown): number {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0;
  const container = 'tasks' in (parsed as Record<string, unknown>)
    ? (parsed as Record<string, unknown>).tasks
    : parsed;

  const isResolved = (status: unknown): boolean =>
    typeof status === 'string' && (status === 'completed' || status === 'skipped');

  if (Array.isArray(container)) {
    return container.filter(
      (t) => typeof t === 'object' && t !== null && isResolved((t as Record<string, unknown>).status),
    ).length;
  }
  if (container && typeof container === 'object') {
    let n = 0;
    for (const v of Object.values(container as Record<string, unknown>)) {
      if (v && typeof v === 'object' && isResolved((v as Record<string, unknown>).status)) n++;
    }
    return n;
  }
  return 0;
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
 * Clear the halt marker once the conductor has acknowledged it (handed off
 * to interactive mode). Silent on missing file — idempotent.
 */
export async function clearHaltMarker(projectRoot: string): Promise<void> {
  await unlink(haltMarkerPath(projectRoot)).catch(() => {
    // Marker absent — nothing to clear.
  });
}
