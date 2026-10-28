import { MAX_CHILD_ID, type ChildId } from '../child-context.js';
import { MAX_ROUTE_ROUNDS, type RoundId } from './route-types.js';

/** A round can pin every child except its host. */
export const MAX_REJECTED_PINS_PER_ROUND = MAX_CHILD_ID - 1;

function root(slug: string): string {
  return `refs/conductor/${slug}`;
}

function rejectedPinNumber(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > MAX_REJECTED_PINS_PER_ROUND) {
    throw new RangeError(`rejected routing pin must be between 1 and ${MAX_REJECTED_PINS_PER_ROUND}`);
  }
  return n;
}

export function routeRecordRefFor(slug: string, roundId: RoundId): string {
  return `${root(slug)}/routes/${roundId}`;
}

export function rejectedPinRefFor(slug: string, roundId: RoundId, n: number): string {
  return `${root(slug)}/rejected/${roundId}/${rejectedPinNumber(n)}`;
}

export function repairMarkerRefFor(slug: string): string {
  return `${root(slug)}/repairing`;
}

export function revalidationQueueRefFor(slug: string): string {
  return `${root(slug)}/revalidate`;
}

export function redRefFor(slug: string, child: ChildId): string {
  return `${root(slug)}/red/c${child}`;
}

/** The immutable tree recorded when a child region closes. */
export function closureRefFor(slug: string, child: ChildId): string {
  return `${root(slug)}/closed/c${child}`;
}

/**
 * Every routing ref that can belong to a feature. This intentionally remains
 * a finite enumeration: teardown must never discover a namespace by prefix.
 */
export function routingTeardownRefNames(slug: string): readonly string[] {
  const refs = [repairMarkerRefFor(slug), revalidationQueueRefFor(slug)];
  for (let child = 1; child <= MAX_CHILD_ID; child += 1) {
    refs.push(redRefFor(slug, child as ChildId));
  }
  for (let sequence = 1; sequence <= MAX_ROUTE_ROUNDS; sequence += 1) {
    const roundId = `r${sequence}` as RoundId;
    refs.push(routeRecordRefFor(slug, roundId));
    for (let pin = 1; pin <= MAX_REJECTED_PINS_PER_ROUND; pin += 1) {
      refs.push(rejectedPinRefFor(slug, roundId, pin));
    }
  }
  return refs;
}
