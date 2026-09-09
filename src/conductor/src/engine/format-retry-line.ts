/**
 * Single-line reason formatter helper for retry log lines.
 * Provides utilities for formatting retry reasons and progress deltas.
 */

/**
 * Collapses multi-line input to single line, trims, and truncates to maxLen.
 * @param reason - The input reason text (can be multi-line)
 * @param maxLen - Maximum length before truncation (default: 120)
 * @returns Single-line formatted reason, or 'no reason recorded' if empty
 */
export function formatRetryReason(reason: string | undefined, maxLen = 120): string {
  if (!reason) {
    return 'no reason recorded';
  }

  // Collapse multi-line to single line (replace newlines and surrounding whitespace with space)
  let collapsed = reason.replace(/\s*[\r\n]+\s*/g, ' ').trim();

  // If collapsed result is empty, return default
  if (!collapsed) {
    return 'no reason recorded';
  }

  // Truncate if necessary
  if (collapsed.length > maxLen) {
    return collapsed.substring(0, maxLen - 1) + '…';
  }

  return collapsed;
}

/**
 * Formats progress delta as compact fragment.
 * @param before - Task count before (undefined means not available)
 * @param after - Task count after (undefined means not available)
 * @returns Compact fragment like '10→15 tasks', or empty string if either arg is undefined
 */
export function formatProgressDelta(before?: number, after?: number): string {
  if (before === undefined || after === undefined) {
    return '';
  }

  return `${before}→${after} tasks`;
}

/**
 * Computes the 1-based display position for build progress.
 * @param resolved - Count of resolved/completed tasks
 * @param total - Total task count
 * @param hasCurrent - Whether there is an in-progress task
 * @returns Display-only 1-based position, clamped to total
 */
export function displayBuildPosition(resolved: number, total: number, hasCurrent: boolean): number {
  return Math.min(resolved + (hasCurrent ? 1 : 0), total);
}

/**
 * Renders the age of the newest observed commit for a progress log line.
 * Returns an empty fragment when no commit timestamp is available.
 */
export function formatCommitAge(lastCommitAt: number | undefined, now: number): string {
  if (lastCommitAt === undefined) return '';

  const elapsedMs = Math.max(0, now - lastCommitAt);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return '<1m ago';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return `${hours}h ${minutes}m ago`;
}
