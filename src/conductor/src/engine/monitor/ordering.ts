import { PRIORITY_BAND_RANK, type PriorityBand, type PriorityResolution } from '../backlog-priority.js';
import type { BacklogItem } from '../daemon.js';
import type { ProjectHalt } from './halt-inventory.js';

/** A live monitor halt enriched with the priority and deferral inputs for one pass. */
export interface OrderableMonitorHalt extends ProjectHalt {
  sourceRef?: string;
  deferred: boolean;
}

/** The priority resolver shared with normal daemon backlog ordering. */
export interface MonitorPriorityResolver {
  resolve(items: BacklogItem[], options: { refresh: boolean }): Promise<PriorityResolution>;
}

/** A monitor halt annotated with the priority attribution used to order it. */
export type OrderedMonitorHalt = OrderableMonitorHalt & (
  | { band: PriorityBand; orderingBasis: 'priority-band' }
  | { band: 'unresolved'; orderingBasis: 'fallback' }
);

function priorityBandFor(
  halt: OrderableMonitorHalt,
  resolution: Extract<PriorityResolution, { mode: 'banded' }>,
): PriorityBand {
  if (halt.sourceRef === undefined) return 'no-issue';
  return resolution.bands.get(halt.sourceRef) ?? 'unlabeled';
}

/**
 * Order one derived monitor queue without adding a second priority-fetch path.
 *
 * Deferral is the outer partition: unseen work always comes before work the
 * operator deferred. Priority ranking only orders items within that partition;
 * an outage retains the same partitioning and original order within each part.
 */
export async function orderMonitorQueue(
  halts: readonly OrderableMonitorHalt[],
  priorityResolver: MonitorPriorityResolver,
): Promise<OrderedMonitorHalt[]> {
  const backlog: BacklogItem[] = halts.map((halt) => ({
    slug: halt.slug,
    ...(halt.sourceRef === undefined ? {} : { sourceRef: halt.sourceRef }),
  }));
  const resolution = await priorityResolver.resolve(backlog, { refresh: false });
  const annotated: Array<{
    halt: OrderableMonitorHalt;
    originalIndex: number;
  }> = halts.map((halt, index) => ({
    halt,
    originalIndex: index,
  }));

  annotated.sort((left, right) => {
    const deferralDifference = Number(left.halt.deferred) - Number(right.halt.deferred);
    if (deferralDifference !== 0) return deferralDifference;
    if (resolution.mode === 'banded') {
      const rankDifference =
        PRIORITY_BAND_RANK[priorityBandFor(left.halt, resolution)] -
        PRIORITY_BAND_RANK[priorityBandFor(right.halt, resolution)];
      if (rankDifference !== 0) return rankDifference;
    }
    return left.originalIndex - right.originalIndex;
  });

  if (resolution.mode === 'banded') {
    return annotated.map(({ halt }) => ({
      ...halt,
      band: priorityBandFor(halt, resolution),
      orderingBasis: 'priority-band',
    }));
  }

  return annotated.map(({ halt }) => ({
    ...halt,
    band: 'unresolved',
    orderingBasis: 'fallback',
  }));
}
