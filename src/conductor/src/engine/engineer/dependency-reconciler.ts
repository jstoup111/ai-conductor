// engineer/dependency-reconciler.ts — one pure source of declared issue edges.
//
// Callers may receive dependency declarations from an intake-form field, prose,
// or both. Keeping their normalization here prevents those paths from drifting.

import {
  parseDependencyProse,
  type DependencyEdge,
  type ManualReviewItem,
} from './issue-dep-migration.js';
import { parseSourceRef } from './issue-ref.js';

export interface DeclaredEdgesInput {
  /** Fully-qualified source issue, e.g. `owner/repo#20`. */
  ref: string;
  /** Raw tracker body, deliberately not the sanitized intake projection. */
  body: string;
  /** Values from a structured `Depends on` form field, when the issue has one. */
  formDependsOn?: readonly string[];
}

export interface SelfReferenceManualReviewItem {
  source: string;
  target: string;
  reason: 'self-reference';
  excerpt: string;
}

export type DeclaredEdgeManualReviewItem = ManualReviewItem | SelfReferenceManualReviewItem;

export interface DeclaredEdgesResult {
  edges: DependencyEdge[];
  manualReview: DeclaredEdgeManualReviewItem[];
}

export interface ComparedEdges {
  /** Declared edges whose target is absent from the tracker's blocked_by list. */
  unlinked: DependencyEdge[];
  /** Declared edges whose target is already present in the tracker's blocked_by list. */
  satisfied: DependencyEdge[];
}

/** One open issue, including the raw body needed for declaration parsing. */
export interface DependencyDriftIssue {
  number: number;
  body: string;
}

/** The read-only fields consumed from GitHub's `blocked_by` response. */
export interface DependencyDriftBlocker {
  number: number;
  state: 'open' | 'closed';
  state_reason?: string;
  repository?: string;
  repository_url?: string;
}

/**
 * Deliberately read-only tracker seam for the drift audit. It is narrower than
 * TrackerClient because listing every open issue is only needed by this sweep.
 */
export interface DependencyDriftTracker {
  listOpenIssues(repository: string): Promise<readonly DependencyDriftIssue[]>;
  getBlockedBy(repository: string, number: number): Promise<readonly DependencyDriftBlocker[]>;
}

export interface DependencyDriftStaleFinding {
  source: string;
  target: string;
  kind: 'blocked-by-stale';
}

export interface DependencyDriftCycleFinding {
  members: string[];
}

export interface DependencyDriftContradictionFinding {
  source: string;
  target: string;
  kind: 'reverse-direction';
}

export interface DependencyDriftSweptResult {
  kind: 'swept';
  unlinked: DependencyEdge[];
  stale: DependencyDriftStaleFinding[];
  cycles: DependencyDriftCycleFinding[];
  contradictions: DependencyDriftContradictionFinding[];
  indeterminate: string[];
}

export interface DependencyDriftRepositoryIndeterminateResult {
  kind: 'repository-indeterminate';
  cause: string;
  unlinked: [];
  stale: [];
  cycles: [];
  contradictions: [];
  indeterminate: [];
}

export type DependencyDriftResult =
  | DependencyDriftSweptResult
  | DependencyDriftRepositoryIndeterminateResult;

/**
 * Build the same-repository edge represented by one structured form value.
 * The action currently supplies qualified refs, while accepting `#N` keeps the
 * pure reconciler aligned with the issue-form's user-facing grammar.
 */
function formEdge(ref: string, value: string): DependencyEdge | null {
  const source = parseSourceRef(ref);
  if (!source) return null;

  const bare = value.trim().match(/^#(\d+)$/);
  const target = bare ? { repo: source.repo, number: bare[1] } : parseSourceRef(value.trim());
  if (!target || target.repo !== source.repo) return null;

  return {
    source: ref,
    target: `${target.repo}#${target.number}`,
    kind: 'depends-on',
    blocked_by: true,
  };
}

/**
 * Return every unambiguous, same-repository dependency declared for an issue.
 *
 * Form and prose declarations are unioned, targets are deduplicated, and a
 * source referring to itself is deliberately withheld for human review. Parser
 * ambiguity flags are preserved verbatim so no caller has to reclassify prose.
 */
export function declaredEdges(input: DeclaredEdgesInput): DeclaredEdgesResult {
  const parsed = parseDependencyProse({ ref: input.ref, body: input.body });
  const candidates = [
    ...(input.formDependsOn ?? []).map((value) => formEdge(input.ref, value)).filter(
      (edge): edge is DependencyEdge => edge !== null,
    ),
    ...parsed.edges,
  ];
  const edges: DependencyEdge[] = [];
  const manualReview: DeclaredEdgeManualReviewItem[] = [...parsed.manualReview];
  const seenTargets = new Set<string>();

  for (const edge of candidates) {
    if (edge.target === input.ref) {
      manualReview.push({
        source: input.ref,
        target: edge.target,
        reason: 'self-reference',
        excerpt: edge.target,
      });
      continue;
    }
    if (!seenTargets.has(edge.target)) {
      seenTargets.add(edge.target);
      edges.push(edge);
    }
  }

  return { edges, manualReview };
}

/**
 * Partition declared edges by whether their target is already linked in the
 * tracker's `blocked_by` relation. Actual-only links are intentionally ignored:
 * callers decide separately whether those links are stale.
 */
export function compareEdges(
  declared: readonly DependencyEdge[],
  actualBlockedBy: Iterable<string>,
): ComparedEdges {
  const actualTargets = new Set(actualBlockedBy);
  const unlinked: DependencyEdge[] = [];
  const satisfied: DependencyEdge[] = [];

  for (const edge of declared) {
    (actualTargets.has(edge.target) ? satisfied : unlinked).push(edge);
  }

  return { unlinked, satisfied };
}

function blockerRef(repository: string, blocker: DependencyDriftBlocker): string {
  const fromUrl = blocker.repository_url?.match(/\/repos\/([^/]+\/[^/]+)$/)?.[1];
  return `${blocker.repository ?? fromUrl ?? repository}#${blocker.number}`;
}

/** Return each directed cycle once, using its sorted members as its identity. */
function findCycles(graph: ReadonlyMap<string, readonly string[]>): DependencyDriftCycleFinding[] {
  const cycles: DependencyDriftCycleFinding[] = [];
  const seenCycles = new Set<string>();
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  const visit = (source: string): void => {
    visited.add(source);
    active.add(source);
    stack.push(source);

    for (const target of graph.get(source) ?? []) {
      if (!graph.has(target)) continue;
      if (active.has(target)) {
        const members = stack.slice(stack.indexOf(target));
        const identity = [...members].sort().join('|');
        if (!seenCycles.has(identity)) {
          seenCycles.add(identity);
          cycles.push({ members });
        }
      } else if (!visited.has(target)) {
        visit(target);
      }
    }

    stack.pop();
    active.delete(source);
  };

  for (const source of graph.keys()) {
    if (!visited.has(source)) visit(source);
  }
  return cycles;
}

/**
 * Read and classify dependency drift without mutating the tracker. Every open
 * issue is read once, then cycle detection runs over that captured graph so a
 * sweep never needs a second `blocked_by` request for a blocker.
 */
export async function sweepDependencyDrift({
  repository,
  tracker,
}: {
  repository: string;
  tracker: DependencyDriftTracker;
}): Promise<DependencyDriftResult> {
  let issues: readonly DependencyDriftIssue[];
  try {
    issues = await tracker.listOpenIssues(repository);
  } catch (error: unknown) {
    return {
      kind: 'repository-indeterminate',
      cause: error instanceof Error ? error.message : String(error),
      unlinked: [], stale: [], cycles: [], contradictions: [], indeterminate: [],
    };
  }

  const unlinked: DependencyEdge[] = [];
  const stale: DependencyDriftStaleFinding[] = [];
  const contradictions: DependencyDriftContradictionFinding[] = [];
  const indeterminate: string[] = [];
  const graph = new Map<string, string[]>();

  for (const issue of issues) {
    const source = `${repository}#${issue.number}`;
    let blockedBy: readonly DependencyDriftBlocker[];
    try {
      blockedBy = await tracker.getBlockedBy(repository, issue.number);
    } catch {
      indeterminate.push(source);
      continue;
    }

    const actual = new Set(blockedBy.map((blocker) => blockerRef(repository, blocker)));
    const declared = declaredEdges({ ref: source, body: issue.body });
    unlinked.push(...compareEdges(declared.edges, actual).unlinked);

    for (const blocker of blockedBy) {
      const target = blockerRef(repository, blocker);
      if (blocker.state_reason === 'not_planned') {
        stale.push({ source, target, kind: 'blocked-by-stale' });
      }
      if (blocker.state === 'open') {
        const targets = graph.get(source) ?? [];
        targets.push(target);
        graph.set(source, targets);
      }
    }
    if (!graph.has(source)) graph.set(source, []);

    for (const item of declared.manualReview) {
      if (item.reason === 'reverse-direction' && item.target && actual.has(item.target)) {
        contradictions.push({ source, target: item.target, kind: 'reverse-direction' });
      }
    }
  }

  return {
    kind: 'swept',
    unlinked,
    stale,
    cycles: findCycles(graph),
    contradictions,
    indeterminate,
  };
}
