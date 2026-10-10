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
