import type { ChildId } from '../child-context.js';
import type { RevalidationQueueEntry, RevalidationQueueRecord } from './route-types.js';

export interface MergeQueueGenerationOptions {
  readonly acknowledge?: ChildId;
}

function mergeEntry(previous: RevalidationQueueEntry, next: RevalidationQueueEntry): RevalidationQueueEntry {
  return {
    ...next,
    gates: [...new Set([...previous.gates, ...next.gates])],
  };
}

/** Creates the next durable queue generation from a restack's produced entries. */
export function mergeQueueGeneration(
  current: RevalidationQueueRecord,
  produced: readonly RevalidationQueueEntry[],
  options: MergeQueueGenerationOptions = {},
): RevalidationQueueRecord {
  const entries = new Map<ChildId, RevalidationQueueEntry>();
  for (const entry of [...current.entries, ...produced]) {
    const previous = entries.get(entry.child);
    entries.set(entry.child, previous === undefined ? entry : mergeEntry(previous, entry));
  }
  if (options.acknowledge !== undefined) entries.delete(options.acknowledge);

  return {
    generation: current.generation + 1,
    entries: [...entries.values()].sort((left, right) => left.position - right.position),
    outbox: current.outbox,
  };
}
