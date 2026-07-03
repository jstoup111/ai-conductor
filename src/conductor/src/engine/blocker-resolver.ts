// blocker-resolver: resolves whether an issue is blocked by other issues,
// via GitHub's issue-dependencies API, shelled through an injected runner.
//
// Foundational module for dependency-ordered intake and dispatch — every
// consumer (daemon gate + intake) depends on this resolver's verdict.

import { parseSourceRef } from './engineer/issue-ref.js';

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

/** Injected shell-out to `gh`, mirroring the GhRunner DI pattern used elsewhere. */
export type BlockerRunner = (args: string[]) => Promise<{ stdout: string }>;

export interface BlockerResolverDeps {
  run: BlockerRunner;
}

export interface BlockerResolver {
  resolve(sourceRef: string): Promise<BlockerVerdict>;
}

export function createBlockerResolver(deps: BlockerResolverDeps): BlockerResolver {
  // Per-instance memo: scoped to this resolver's lifetime (one scan pass).
  // Never share this map across createBlockerResolver() calls.
  const memo = new Map<string, BlockerVerdict>();

  return {
    async resolve(sourceRef: string): Promise<BlockerVerdict> {
      const cached = memo.get(sourceRef);
      if (cached) {
        return cached;
      }

      const verdict = await resolveUncached(sourceRef, deps);
      memo.set(sourceRef, verdict);
      return verdict;
    },
  };
}

async function resolveUncached(sourceRef: string, deps: BlockerResolverDeps): Promise<BlockerVerdict> {
  const parsed = parseSourceRef(sourceRef);
  if (!parsed) {
    return { kind: 'indeterminate', detail: `unparseable sourceRef: ${sourceRef}` };
  }

  const { repo, number } = parsed;
  const { stdout } = await deps.run(['api', `repos/${repo}/issues/${number}/dependencies/blocked_by`]);

  const blockedBy: unknown = JSON.parse(stdout);
  if (!Array.isArray(blockedBy) || blockedBy.length === 0) {
    return { kind: 'unblocked' };
  }

  const openBlockers: IssueRef[] = [];
  for (const item of blockedBy) {
    const entry = item as { number?: unknown; repository_url?: unknown; state?: unknown };
    if (entry.state === 'closed') continue;

    const repositoryUrl = typeof entry.repository_url === 'string' ? entry.repository_url : '';
    const match = repositoryUrl.match(/repos\/([^/]+\/[^/]+)$/);
    const repo = match ? match[1] : repositoryUrl;
    const number = String(entry.number ?? '');

    openBlockers.push({ repo, number });
  }

  if (openBlockers.length > 0) {
    return { kind: 'blocked', blockers: openBlockers };
  }

  // Every blocker in blocked_by is closed — regardless of close reason
  // (completed, not_planned, etc.) — so this issue is unblocked. A
  // reopened blocker is reflected as `state: 'open'` in the API response
  // and is caught by the openBlockers branch above.
  return { kind: 'unblocked' };
}
