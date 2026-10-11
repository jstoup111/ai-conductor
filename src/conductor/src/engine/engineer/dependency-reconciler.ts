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
import { findBlockerCycles } from '../blocker-resolver.js';
import type { TrackerClient } from '../tracker-client.js';

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

/** The read-only fields consumed from GitHub's `blocked_by` response. */
interface DependencyDriftBlocker {
  number: number;
  state: 'open' | 'closed';
  state_reason?: string;
  repository?: string;
  repository_url?: string;
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

/** Extract every raw issue-form Depends-on reference from its field section. */
export function extractDependsOnFormValues(body: string): string[] {
  const heading = /^###\s+Depends on\s*$/im.exec(body);
  if (!heading) return [];
  const rest = body.slice(heading.index + heading[0].length);
  const nextHeading = rest.search(/^###\s+/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  return section.match(/(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+/g) ?? [];
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
  const source = parseSourceRef(input.ref);
  const taskListTargets = new Set(parsed.manualReview
    .filter((item) => item.reason === 'task-list-phase')
    .flatMap((item) => [...item.excerpt.matchAll(/#(\d+)/g)].map((match) => source ? `${source.repo}#${match[1]}` : '')));
  const candidates = [
    ...[...extractDependsOnFormValues(input.body), ...(input.formDependsOn ?? [])].map((value) => formEdge(input.ref, value)).filter(
      (edge): edge is DependencyEdge => edge !== null,
    ),
    ...parsed.edges.filter((edge) => !taskListTargets.has(edge.target)),
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

/**
 * Read and classify dependency drift without mutating the tracker. Every open
 * issue is read once, then cycle detection runs over that captured graph so a
 * sweep never needs a second `blocked_by` request for a blocker.
 */
export async function sweepDependencyDrift({
  repository,
  tracker,
  cwd = process.cwd(),
}: {
  repository: string;
  tracker: Pick<TrackerClient, 'listOpenIssues' | 'getBlockedBy'>;
  cwd?: string;
}): Promise<DependencyDriftResult> {
  let issues: Awaited<ReturnType<TrackerClient['listOpenIssues']>>;
  try {
    issues = await tracker.listOpenIssues(repository, cwd);
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
      const value = await tracker.getBlockedBy(repository, issue.number, cwd);
      if (!Array.isArray(value)) throw new Error('blocked_by response was not an array');
      blockedBy = value as readonly DependencyDriftBlocker[];
    } catch {
      indeterminate.push(source);
      continue;
    }

    // Completed links still satisfy a body declaration, but they are resolved
    // history rather than drift evidence for contradiction, stale, or cycle checks.
    const actual = new Set(blockedBy.map((blocker) => blockerRef(repository, blocker)));
    const unresolvedActual = new Set(blockedBy
      .filter((blocker) => blocker.state_reason !== 'completed')
      .map((blocker) => blockerRef(repository, blocker)));
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
      if (item.reason === 'reverse-direction' && item.target && unresolvedActual.has(item.target)) {
        contradictions.push({ source, target: item.target, kind: 'reverse-direction' });
      }
    }
  }

  return {
    kind: 'swept',
    unlinked,
    stale,
    cycles: findBlockerCycles(graph).map((members) => ({ members })),
    contradictions,
    indeterminate,
  };
}
