// engineer/issue-dep-migration.ts — deterministic dependency-edge parser.
//
// Task 22 (FR-10 happy): parse English prose in an issue body into deterministic
// blocked_by edges. Only the three unambiguous, forward-direction, same-repo
// patterns copied from real issue bodies (#217-#229) are recognized here:
//
//   - "Gated on #N"        → kind: 'gated-on'
//   - "Depends on[:] #N"   → kind: 'depends-on'  (also handles "#N / #M / ..." lists)
//   - "Blocked by #N"      → kind: 'blocked-by'
//
// Every recognized pattern means: THIS issue (the one whose body we're
// parsing) is blocked BY the referenced issue — hence `blocked_by: true` on
// every edge this parser yields. Directionality is fixed because all three
// phrases are stated from the blocked issue's point of view; a phrase stated
// from the blocking issue's point of view (e.g. "Blocker for #N") is reverse
// direction and is intentionally NOT matched here — see Task 23 for
// manual-review classification of that and other ambiguous prose (cross-repo
// refs, task-list mentions, etc).
//
// This module only proposes edges from prose; it does not write to any
// platform and does not classify non-matches (that belongs to Task 23/24).

/** One deterministically-parsed dependency edge. */
export interface DependencyEdge {
  /** The issue whose body was parsed (the blocked issue), e.g. "acme/app#230". */
  source: string;
  /** The referenced issue (the blocker), e.g. "acme/app#217". */
  target: string;
  /** Which prose pattern produced this edge. */
  kind: 'gated-on' | 'depends-on' | 'blocked-by';
  /** Always true: every pattern this parser recognizes states "source is blocked by target". */
  blocked_by: true;
}

/** An issue to parse: its own source ref and raw body text. */
export interface DependencyProseInput {
  ref: string;
  body: string;
}

/** Extract the repo prefix (everything before the last `#`) from a source ref, or null. */
function repoPrefixOf(ref: string): string | null {
  const hash = ref.lastIndexOf('#');
  if (hash <= 0) return null;
  return ref.slice(0, hash);
}

const PATTERNS: { re: RegExp; kind: DependencyEdge['kind'] }[] = [
  // "Gated on #217" — bare issue number, same-repo only (no owner/repo prefix
  // immediately before the #, which would signal a cross-repo reference).
  { re: /\bgated on\b\s*:?\s*((?:#\d+(?:\s*\/\s*)?)+)/gi, kind: 'gated-on' },
  // "Depends on: #189 / #190" or "Depends on #189"
  { re: /\bdepends on\b\s*:?\s*((?:#\d+(?:\s*\/\s*)?)+)/gi, kind: 'depends-on' },
  // "Blocked by #226" — but NOT "Blocker for #226" (reverse direction, Task 23).
  { re: /\bblocked by\b\s*:?\s*((?:#\d+(?:\s*\/\s*)?)+)/gi, kind: 'blocked-by' },
];

/** Pull every bare `#N` issue number out of a matched group, in order. */
function extractIssueNumbers(group: string): string[] {
  const nums: string[] = [];
  const re = /#(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(group)) !== null) nums.push(m[1]);
  return nums;
}

/**
 * Parse a single issue's body prose into deterministic blocked_by edges.
 *
 * Recognizes only same-repo, forward-direction, unambiguous patterns. Returns
 * `[]` (never throws) for bodies with no recognized prose, reverse-direction
 * prose ("Blocker for #N"), cross-repo references, or incidental issue-number
 * mentions (e.g. task-list checkboxes) — none of those are deterministic
 * enough to auto-propose here.
 */
export function parseDependencyEdges(input: DependencyProseInput): DependencyEdge[] {
  const { ref, body } = input;
  const repoPrefix = repoPrefixOf(ref);
  if (!repoPrefix || !body) return [];

  const edges: DependencyEdge[] = [];
  for (const { re, kind } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      for (const num of extractIssueNumbers(m[1])) {
        edges.push({
          source: ref,
          target: `${repoPrefix}#${num}`,
          kind,
          blocked_by: true,
        });
      }
    }
  }
  return edges;
}
