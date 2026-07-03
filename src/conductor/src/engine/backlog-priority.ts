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
 * The resolver maintains an in-memory cache (process-local, never persisted to disk) and
 * handles transport failures gracefully:
 * - On `refresh: true`: fetches all linked refs via the reader, updates cache, returns bands
 * - On `refresh: false`: returns cached bands with zero reader calls (cache hit)
 * - On reader throw: clears cache, returns fallback mode, logs exactly one warning per outage
 *
 * @param reader Function that fetches labels for issue references
 * @param log Function for logging resolver actions (including warnings)
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
  // Outage tracking: whether we're currently in a failed state
  let inOutage = false;
  // Warning flag: whether we've warned about the current outage
  let hasWarnedThisOutage = false;

  return {
    async resolve(items: BacklogItem[], options: { refresh: boolean }): Promise<PriorityResolution> {
      const bands = new Map<string, PriorityBand>();

      // Collect all sourceRefs that need resolution
      const sourceRefs = items.filter((item) => item.sourceRef).map((item) => item.sourceRef as string);

      if (options.refresh || sourceRefs.length === 0) {
        // On refresh: true, or if there are sourceRefs to fetch, call the reader
        if (sourceRefs.length > 0) {
          try {
            const readerResult = await reader(sourceRefs);
            // Reader succeeded: reset outage state
            inOutage = false;
            hasWarnedThisOutage = false;
            // Update cache with reader results
            for (const [ref, labels] of readerResult.entries()) {
              if (labels !== 'not-found') {
                cache.set(ref, labels);
              } else {
                cache.delete(ref);
              }
            }
          } catch (error) {
            // Reader threw: set outage state and clear cache
            inOutage = true;
            cache.clear();
            // Warn exactly once per outage
            if (!hasWarnedThisOutage) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              log(`Priority resolution outage (reader failed): ${errorMsg}`);
              hasWarnedThisOutage = true;
            }
            // Return fallback mode immediately
            return { mode: 'fallback' };
          }
        }
      }

      // Build resolution from cache
      for (const item of items) {
        if (!item.sourceRef) {
          // Item has no issue reference
          bands.set(item.slug, 'no-issue');
        } else {
          // Item has a sourceRef - look up in cache
          const labels = cache.get(item.sourceRef);
          if (labels) {
            const priority = parsePriorityLabels(labels);
            bands.set(item.sourceRef, priority || 'unlabeled');
          } else {
            bands.set(item.sourceRef, 'unlabeled');
          }
        }
      }

      return { mode: 'banded', bands };
    },
  };
}

/**
 * Band rank for stable sorting. Lower rank comes first.
 *
 * no-issue: 0 (unlinked items, highest priority)
 * high: 1
 * medium: 2
 * low: 3
 * unlabeled: 4 (lowest priority)
 */
const BAND_RANK: Record<PriorityBand, number> = {
  'no-issue': 0,
  high: 1,
  medium: 2,
  low: 3,
  unlabeled: 4,
};

/**
 * Order backlog items by priority bands in a stable sort.
 *
 * Items are sorted into bands: no-issue → high → medium → low → unlabeled.
 * Within each band, items maintain their input order (stable sort).
 *
 * For 'banded' mode: items are reordered by band and annotated with their band.
 * For 'fallback' and 'off' modes: items are returned in input order.
 *
 * This is a pure function: it does not mutate the input array or items.
 *
 * @param items - Array of backlog items
 * @param res - Priority resolution: either banded (with band map) or fallback/off
 * @returns New array of items ordered by band, with band annotations (for banded mode)
 */
export function orderBacklog(items: BacklogItem[], res: PriorityResolution): BacklogItem[] {
  // For fallback/off modes, return input order
  if (res.mode === 'fallback' || res.mode === 'off') {
    return items;
  }

  // Banded mode: reorder by band with stable sort
  const { bands } = res;

  // Map each item to (originalIndex, item, band)
  const itemsWithBands = items.map((item, index) => {
    let band: PriorityBand;

    if (!item.sourceRef) {
      // No sourceRef → no-issue band
      band = 'no-issue';
    } else {
      // Has sourceRef → look up in bands map
      band = bands.get(item.sourceRef) || 'unlabeled';
    }

    return { originalIndex: index, item, band };
  });

  // Sort by band rank, using original index as tie-breaker for stable sort
  itemsWithBands.sort((a, b) => {
    const rankDiff = BAND_RANK[a.band] - BAND_RANK[b.band];
    if (rankDiff !== 0) {
      return rankDiff;
    }
    // Same band: preserve input order
    return a.originalIndex - b.originalIndex;
  });

  // Return sorted items with band annotation
  return itemsWithBands.map(({ item, band }) => ({
    ...item,
    band,
  }));
}
