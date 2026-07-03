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
  /**
   * Optional lifecycle status of the source issue. Accepted but intentionally
   * unused by parsing: a closed issue's body is parsed identically to an open
   * one — the dependency graph must stay complete, and satisfaction (whether
   * a closed target actually unblocks its source) is checked at gate time,
   * not here.
   */
  sourceStatus?: 'open' | 'closed';
}

/** Why a piece of prose could not be auto-converted into a `DependencyEdge`. */
export type ManualReviewReason = 'reverse-direction' | 'cross-repo' | 'task-list-phase';

/** One piece of prose flagged for a human to classify by hand. */
export interface ManualReviewItem {
  /** The issue whose body produced this flag. */
  source: string;
  /** The referenced issue, if one was identified; null for non-referential flags (e.g. task-list phases). */
  target: string | null;
  reason: ManualReviewReason;
  /** The matched text, for human review context. */
  excerpt: string;
}

/** Result of parsing one issue body: deterministic edges plus manual-review flags. */
export interface DependencyProseResult {
  edges: DependencyEdge[];
  manualReview: ManualReviewItem[];
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

// --- Task 23: manual-review classification -------------------------------

// "Blocker for #226" / "Blocks #226" — stated from the BLOCKING issue's point
// of view, i.e. reverse direction relative to every pattern above. Never
// auto-converted: flipping source/target here would require re-deriving the
// edge from the *other* issue's identity, which this parser doesn't have.
const REVERSE_DIRECTION_RE = /\bblocker for\b\s*:?\s*#(\d+)|\bblocks\b\s*:?\s*#(\d+)/gi;

// "owner/repo#N" — cross-repo reference. Requires repo context/permissions to
// resolve and write a link, so it's always manual.
const CROSS_REPO_RE = /\b([\w.-]+\/[\w.-]+)#(\d+)\b/g;

// "- [ ] Phase ..." — task-list line naming a phase. These are organizational
// metadata (a checklist of work phases inside one issue), not dependencies on
// other issues, so they're flagged with no target rather than turned into an
// edge.
const TASK_LIST_PHASE_RE = /^-\s*\[[ xX]\]\s*(Phase\b.*)$/gm;

/**
 * Parse a single issue's body prose into deterministic `blocked_by` edges
 * (see `parseDependencyEdges`) AND flag prose that is dependency-shaped but
 * too ambiguous to auto-convert, for human review:
 *
 *   - reverse-direction phrasing ("Blocker for #N", "Blocks #N")
 *   - cross-repo references ("owner/repo#N")
 *   - task-list phase lines ("- [ ] Phase X ...")
 *
 * Lifecycle status of the source issue (open/closed) never affects parsing —
 * the graph must stay complete regardless of status; satisfaction is a
 * gate-time concern, not a parse-time one.
 */
export function parseDependencyProse(input: DependencyProseInput): DependencyProseResult {
  const { ref, body } = input;
  const edges = parseDependencyEdges(input);
  const manualReview: ManualReviewItem[] = [];
  if (!body) return { edges, manualReview };

  const repoPrefix = repoPrefixOf(ref);

  REVERSE_DIRECTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REVERSE_DIRECTION_RE.exec(body)) !== null) {
    const num = m[1] ?? m[2];
    manualReview.push({
      source: ref,
      target: repoPrefix ? `${repoPrefix}#${num}` : null,
      reason: 'reverse-direction',
      excerpt: m[0],
    });
  }

  CROSS_REPO_RE.lastIndex = 0;
  while ((m = CROSS_REPO_RE.exec(body)) !== null) {
    manualReview.push({
      source: ref,
      target: `${m[1]}#${m[2]}`,
      reason: 'cross-repo',
      excerpt: m[0],
    });
  }

  TASK_LIST_PHASE_RE.lastIndex = 0;
  while ((m = TASK_LIST_PHASE_RE.exec(body)) !== null) {
    manualReview.push({
      source: ref,
      target: null,
      reason: 'task-list-phase',
      excerpt: m[1].trim(),
    });
  }

  return { edges, manualReview };
}
