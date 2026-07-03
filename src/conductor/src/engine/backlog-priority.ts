import type { BacklogItem } from './daemon.js';

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
 * Resolution mode for priority-driven backlog ordering.
 *
 * - 'banded': Order items by priority bands; requires band assignments for sourceRefs
 * - 'fallback': Return input order (no reordering, no annotations)
 * - 'off': Return input order (no reordering, no annotations)
 */
export type PriorityResolution =
  | { mode: 'banded'; bands: Map<string, PriorityBand> }
  | { mode: 'fallback' }
  | { mode: 'off' };

/**
 * Function that fetches labels for issue references.
 * Takes an array of sourceRef strings (e.g., 'owner/repo#N') and returns
 * a map of ref to labels or 'not-found' if the issue doesn't exist.
 */
export type IssueLabelReader = (refs: string[]) => Promise<Map<string, string[] | 'not-found'>>;

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
    // Requires exactly one space after the colon, case-sensitive
    const match = label.match(/^priority: (high|medium|low)$/);
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

/**
 * Creates a stateful priority resolver that caches issue labels between daemon scans.
 *
 * The resolver maintains an in-memory cache (process-local, never persisted to disk).
 * - On `refresh: true`: fetches all linked refs via the reader, updates cache, returns bands
 * - On `refresh: false`: returns cached bands with zero reader calls (cache hit)
 *
 * @param reader Function that fetches labels for issue references
 * @param log Function for logging resolver actions
 * @returns Resolver object with a `resolve` method
 */
export function createPriorityResolver(
  reader: IssueLabelReader,
  log: (msg: string) => void,
): {
  resolve(items: BacklogItem[], options: { refresh: boolean }): Promise<PriorityResolution>;
} {
  // In-memory cache: ref -> labels
  const cache = new Map<string, string[]>();

  return {
    async resolve(items: BacklogItem[], options: { refresh: boolean }): Promise<PriorityResolution> {
      const result = new Map<string, PriorityBand>();

      // Collect all sourceRefs that need resolution
      const sourceRefs = items.filter((item) => item.sourceRef).map((item) => item.sourceRef as string);

      if (options.refresh || sourceRefs.length === 0) {
        // On refresh: true, or if there are sourceRefs to fetch, call the reader
        if (sourceRefs.length > 0) {
          const readerResult = await reader(sourceRefs);
          // Update cache with reader results
          for (const [ref, labels] of readerResult.entries()) {
            if (labels !== 'not-found') {
              cache.set(ref, labels);
            } else {
              cache.delete(ref);
            }
          }
        }
      }

      // Build resolution from cache
      for (const item of items) {
        if (!item.sourceRef) {
          // Item has no issue reference
          result.set(item.slug, 'no-issue');
        } else {
          // Item has a sourceRef - look up in cache
          const labels = cache.get(item.sourceRef);
          if (labels) {
            const priority = parsePriorityLabels(labels);
            result.set(item.sourceRef, priority || 'unlabeled');
          } else {
            result.set(item.sourceRef, 'unlabeled');
          }
        }
      }

      return result;
    },
  };
}
