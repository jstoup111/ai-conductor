import type { BacklogItem } from './daemon.js';
import type { OrderingSource } from './ordering-source.js';

/**
 * Priority band type for issue classification in daemon backlog scheduling.
 *
 * - 'no-issue': No actual issue (placeholder)
 * - 'high': High priority (execution first)
 * - 'medium': Medium priority (standard execution)
 * - 'low': Low priority (deferred)
 * - 'unlabeled': Issue has no priority label (default behavior)
 */
export type PriorityBand = 'no-issue' | 'critical' | 'high' | 'medium' | 'low' | 'unlabeled';

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
export function parsePriorityLabels(
  labels: string[],
): 'critical' | 'high' | 'medium' | 'low' | undefined {
  const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 };
  let maxRank = 0;
  let maxPriority: 'critical' | 'high' | 'medium' | 'low' | undefined = undefined;

  for (const label of labels) {
    // Match labels with the exact pattern 'priority: <band>'
    // Requires exactly one space after the colon, case-sensitive
    const match = label.match(/^priority: (critical|high|medium|low)$/);
    if (match) {
      const band = match[1] as 'critical' | 'high' | 'medium' | 'low';
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
 * Extract the size label from a list of issue labels.
 *
 * Parses labels matching the pattern 'size: <size>' where <size> is one of:
 * 'S', 'M', 'L'.
 *
 * When multiple size labels are present, the largest wins: L > M > S
 *
 * @param labels - Array of issue label strings
 * @returns The largest size found, or undefined if no valid size labels exist
 */
export function parseSizeLabel(labels: string[]): 'S' | 'M' | 'L' | undefined {
  const sizeRank = { L: 3, M: 2, S: 1 };
  let maxRank = 0;
  let maxSize: 'S' | 'M' | 'L' | undefined = undefined;

  for (const label of labels) {
    if (typeof label !== 'string') {
      continue;
    }
    // Match labels with the exact pattern 'size: <size>'
    // Requires exactly one space after the colon, case-sensitive
    const match = label.match(/^size: (S|M|L)$/);
    if (match) {
      const size = match[1] as 'S' | 'M' | 'L';
      const rank = sizeRank[size];
      if (rank > maxRank) {
        maxRank = rank;
        maxSize = size;
      }
    }
  }

  return maxSize;
}

/**
 * Creates a stateful priority resolver that caches issue labels between daemon scans.
 *
 * The resolver maintains an in-memory cache (process-local, never persisted to disk) and
 * handles transport failures gracefully:
 * - On `refresh: true`: fetches all linked refs via the ordering source, updates cache, returns bands
 * - On `refresh: false`: primes unseen linked refs, then returns cached bands
 * - On reader throw: clears cache, returns fallback mode, logs exactly one warning per outage
 * - Fallback persists across `refresh: false` resolves until a successful refresh resets the
 *   outage state — a non-refresh resolve during an outage never pseudo-bands the empty cache
 *
 * @param source Backend-neutral ordering source for issue facts
 * @param log Function for logging resolver actions (including warnings)
 * @returns Resolver object with a `resolve` method
 */
export function createPriorityResolver(
  source: OrderingSource,
  log: (msg: string) => void,
): {
  resolve(items: BacklogItem[], options: { refresh: boolean }): Promise<PriorityResolution>;
} {
  // In-memory cache: ref -> resolved priority band.
  const cache = new Map<string, PriorityBand>();
  // Refs for which the reader has returned a result, including not-found.
  // This is separate from the labels cache because a missing issue must not
  // trigger a network read on every local discovery pass.
  const attemptedRefs = new Set<string>();
  // Outage tracking: whether we're currently in a failed state
  let inOutage = false;
  // Warning flag: whether we've warned about the current outage
  let hasWarnedThisOutage = false;

  return {
    async resolve(items: BacklogItem[], options: { refresh: boolean }): Promise<PriorityResolution> {
      const bands = new Map<string, PriorityBand>();

      // Collect all sourceRefs that need resolution
      const sourceRefs = items.filter((item) => item.sourceRef).map((item) => item.sourceRef as string);

      const unattemptedRefs = [...new Set(sourceRefs)].filter((ref) => !attemptedRefs.has(ref));
      const refsToRead = options.refresh ? [...new Set(sourceRefs)] : unattemptedRefs;

      if ((options.refresh || !inOutage) && refsToRead.length > 0) {
        // Refreshes retain their full-read behavior. Local scans prime only
        // references this process has never resolved.
        try {
          const readerResult = await source.readFacts(refsToRead);
          // Reader succeeded: reset outage state
          inOutage = false;
          hasWarnedThisOutage = false;
          // Update cache with reader results
          for (const [ref, facts] of readerResult.entries()) {
            attemptedRefs.add(ref);
            if (typeof facts === 'object') {
              cache.set(ref, facts.priority ?? 'unlabeled');
              continue;
            }
            switch (facts) {
              case 'not-found':
              case 'unavailable':
                cache.delete(ref);
                continue;
            }
            const exhaustive: never = facts;
            void exhaustive;
          }
        } catch (error) {
          // Reader threw: set outage state and clear cache
          inOutage = true;
          cache.clear();
          attemptedRefs.clear();
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

      // During an active outage every resolve degrades to fallback — including
      // refresh:false polls, which would otherwise pseudo-band the cleared cache
      // and invert the priority contract. A successful refresh above has already
      // reset the flag, so recovery resumes banding naturally. No logging here:
      // the once-per-outage warning at the catch site stays the only warn site.
      if (inOutage) {
        return { mode: 'fallback' };
      }

      // Build resolution from cache
      for (const item of items) {
        if (!item.sourceRef) {
          // Item has no issue reference
          bands.set(item.slug, 'no-issue');
        } else {
          // Item has a sourceRef - look up in cache
          bands.set(item.sourceRef, cache.get(item.sourceRef) ?? 'unlabeled');
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
 * critical: 1 (complete breakage / very severe degradation)
 * high: 2
 * medium: 3
 * low: 4
 * unlabeled: 5 (lowest priority)
 */
export const PRIORITY_BAND_RANK: Record<PriorityBand, number> = {
  'no-issue': 0,
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  unlabeled: 5,
};

/**
 * Order backlog items by priority bands in a stable sort.
 *
 * Items are sorted into bands: no-issue → critical → high → medium → low → unlabeled.
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
  // For fallback/off modes, return input order with resolution mode marker
  if (res.mode === 'fallback' || res.mode === 'off') {
    return items.map((item) => ({
      ...item,
      resolutionMode: res.mode,
    }));
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
    const rankDiff = PRIORITY_BAND_RANK[a.band] - PRIORITY_BAND_RANK[b.band];
    if (rankDiff !== 0) {
      return rankDiff;
    }
    // Same band: preserve input order
    return a.originalIndex - b.originalIndex;
  });

  // Return sorted items with band annotation and resolution mode
  return itemsWithBands.map(({ item, band }) => ({
    ...item,
    band,
    resolutionMode: 'banded',
  }));
}
