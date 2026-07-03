/**
 * Priority band type for issue classification in daemon backlog scheduling.
 *
 * - 'no-issue': No actual issue (placeholder)
 * - 'high': High priority (execution first)
 * - 'medium': Medium priority (standard execution)
 * - 'low': Low priority (deferred)
 * - 'unlabeled': Issue has no priority label (default behavior)
 */
export type PriorityBand = 'no-issue' | 'high' | 'medium' | 'low' | 'unlabeled';

/**
 * Extract the highest priority band from a list of issue labels.
 *
 * Parses labels matching the pattern 'priority: <band>' where <band> is one of:
 * 'high', 'medium', 'low'.
 *
 * When multiple priority labels are present, the highest rank wins:
 * high > medium > low
 *
 * @param labels - Array of issue label strings
 * @returns The highest priority band found, or undefined if no valid priority labels exist
 */
export function parsePriorityLabels(labels: string[]): 'high' | 'medium' | 'low' | undefined {
  const priorityRank = { high: 3, medium: 2, low: 1 };
  let maxRank = 0;
  let maxPriority: 'high' | 'medium' | 'low' | undefined = undefined;

  for (const label of labels) {
    // Match labels with the exact pattern 'priority: <band>'
    const match = label.match(/^priority:\s*(high|medium|low)$/);
    if (match) {
      const band = match[1] as 'high' | 'medium' | 'low';
      const rank = priorityRank[band];
      if (rank > maxRank) {
        maxRank = rank;
        maxPriority = band;
      }
    }
  }

  return maxPriority;
}
