// blocker-resolver: resolves whether an issue is blocked by other issues,
// via GitHub's issue-dependencies API, shelled through an injected runner.
//
// Foundational module for dependency-ordered intake and dispatch — every
// consumer (daemon gate + intake) depends on this resolver's verdict.

import { parseSourceRef } from './engineer/issue-ref.js';
import type { GhRunner } from './tracker-client.js';
import type { OrderingSource } from './ordering-source.js';

/** A reference to a single GitHub issue, as returned by `parseSourceRef`. */
export interface IssueRef {
  repo: string;
  number: string;
}

/** Closed verdict union — every call site must handle all four kinds. */
export type BlockerVerdict =
  | { kind: 'unblocked' }
  | { kind: 'blocked'; blockers: IssueRef[] }
  | { kind: 'indeterminate'; detail: string }
  | { kind: 'cycle'; members: IssueRef[] };

/**
 * Injected shell-out to `gh`. Uses the canonical `GhRunner` seam from
 * `tracker-client.ts` — every real production runner requires a `cwd`, so
 * this resolver forwards one on every invocation (see `BlockerResolverDeps.cwd`).
 */
export type BlockerRunner = GhRunner;

export interface BlockerResolverDeps {
  source: OrderingSource;
}

export interface BlockerResolver {
  resolve(sourceRef: string): Promise<BlockerVerdict>;
}

/** Format an IssueRef back into `repo#number` for memo keys / comparisons. */
function refKey(ref: IssueRef): string {
  return `${ref.repo}#${ref.number}`;
}

export function createBlockerResolver(deps: BlockerResolverDeps): BlockerResolver {
  // Per-instance memo: scoped to this resolver's lifetime (one scan pass).
  // Never share this map across createBlockerResolver() calls.
  const memo = new Map<string, BlockerVerdict>();

  async function resolveOne(sourceRef: string): Promise<BlockerVerdict> {
    const cached = memo.get(sourceRef);
    if (cached) {
      return cached;
    }

    const verdict = await resolveUncached(sourceRef, deps);
    memo.set(sourceRef, verdict);
    return verdict;
  }

  /**
   * Walk the open-blocker chain starting from `startKey`, looking for a path
   * back to `startKey` itself (a cycle). `visiting` guards against revisiting
   * a node within the same walk (also prevents infinite loops on longer
   * cycles that don't involve the start node — Task 8 handles those).
   */
  async function findCycleMembers(
    startKey: string,
    currentRef: IssueRef,
    visiting: Set<string>,
  ): Promise<IssueRef[] | null> {
    const currentKey = refKey(currentRef);
    if (visiting.has(currentKey)) {
      return null; // already walked this node in this path — not a new cycle discovery
    }
    visiting.add(currentKey);

    const verdict = await resolveOne(`${currentRef.repo}#${currentRef.number}`);
    if (verdict.kind !== 'blocked') {
      return null;
    }

    for (const blocker of verdict.blockers) {
      const blockerKey = refKey(blocker);
      if (blockerKey === startKey) {
        return [currentRef, blocker];
      }
      const nested = await findCycleMembers(startKey, blocker, visiting);
      if (nested) {
        return [currentRef, ...nested];
      }
    }

    return null;
  }

  return {
    async resolve(sourceRef: string): Promise<BlockerVerdict> {
      const verdict = await resolveOne(sourceRef);
      if (verdict.kind !== 'blocked') {
        return verdict;
      }

      const parsed = parseSourceRef(sourceRef);
      if (!parsed) {
        return verdict;
      }
      const startRef: IssueRef = { repo: parsed.repo, number: parsed.number };
      const startKey = refKey(startRef);

      for (const blocker of verdict.blockers) {
        if (refKey(blocker) === startKey) {
          return memoizeCycle(sourceRef, [startRef, blocker]);
        }
        const chain = await findCycleMembers(startKey, blocker, new Set([startKey]));
        if (chain) {
          return memoizeCycle(sourceRef, [startRef, ...chain]);
        }
      }

      return verdict;
    },
  };

  /**
   * Record a discovered cycle in the memo under every participating member's
   * canonical key — not just the ref that triggered discovery — so a later
   * direct `resolve()` call on any other member returns the cycle verdict
   * instead of a stale pre-cycle-detection 'blocked' entry.
   */
  function memoizeCycle(sourceRef: string, rawMembers: IssueRef[]): BlockerVerdict {
    const seen = new Set<string>();
    const members = rawMembers.filter((m) => {
      const key = refKey(m);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const cycleVerdict: BlockerVerdict = { kind: 'cycle', members };
    memo.set(sourceRef, cycleVerdict);
    for (const member of members) {
      memo.set(refKey(member), cycleVerdict);
    }
    return cycleVerdict;
  }
}

async function resolveUncached(sourceRef: string, deps: BlockerResolverDeps): Promise<BlockerVerdict> {
  const outcome = await deps.source.readBlockers(sourceRef);

  if (Array.isArray(outcome)) {
    if (outcome.length === 0) {
      return { kind: 'unblocked' };
    }
    return {
      kind: 'blocked',
      blockers: outcome.flatMap((blocker) => {
        const parsed = parseSourceRef(blocker);
        return parsed ? [{ repo: parsed.repo, number: parsed.number }] : [];
      }),
    };
  }
  if (typeof outcome === 'object') {
    return { kind: 'indeterminate', detail: outcome.indeterminate };
  }

  switch (outcome) {
    case 'unavailable':
      return { kind: 'indeterminate', detail: `no ordering adapter for jira reference ${sourceRef}` };
    case 'not-found':
      return { kind: 'indeterminate', detail: `issue not found: ${sourceRef}` };
  }
}
