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

// --- Task 24: writer (GET-before-POST, additive-only) ---------------------

/** Shell runner for the `gh` CLI. Mirrors the other engineer adapters' GhRunner shape. */
export type GhRunner = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;

/** Parse `owner/repo#N` into its repo-slug + issue-number parts, or null if malformed. */
function parseRef(ref: string): { repo: string; number: string } | null {
  const hash = ref.lastIndexOf('#');
  if (hash <= 0 || hash === ref.length - 1) return null;
  const repo = ref.slice(0, hash);
  const number = ref.slice(hash + 1);
  if (!/^\d+$/.test(number)) return null;
  return { repo, number };
}

/** Parse a GitHub API `repository_url` (e.g. `https://api.github.com/repos/acme/app`) into `owner/repo`. */
function repoFromRepositoryUrl(repositoryUrl: string): string | null {
  const m = repositoryUrl.match(/\/repos\/([^/]+\/[^/]+)$/);
  return m ? m[1] : null;
}

/** One raw `blocked_by` entry as returned by the GitHub dependencies API. */
interface RawBlockedByEntry {
  number: number;
  repository_url: string;
}

/** Per-edge outcome of {@link createDependencyLinks}. */
export interface DependencyLinkResult {
  edge: DependencyEdge;
  /** 'created' — a new link was written. 'already-present' — GET found it, no write.
   *  'dry-run' — dryRun mode; would-create but no write was attempted. */
  status: 'created' | 'already-present' | 'dry-run';
}

/** Dependencies for {@link createDependencyLinks}. */
export interface CreateDependencyLinksDeps {
  gh: GhRunner;
  cwd: string;
  /**
   * When true, GET-checks existing links and reports what WOULD be created,
   * but issues no POST calls at all. Used for the operator confirmation
   * proposal (declining = never call this without dryRun:false).
   */
  dryRun?: boolean;
  log?: (msg: string) => void;
}

/**
 * GET the existing `blocked_by` links for one source issue, returning them as
 * a Set of `owner/repo#N` target refs for cheap membership checks.
 */
async function fetchExistingBlockedBy(
  sourceRepo: string,
  sourceNumber: string,
  gh: GhRunner,
  cwd: string,
): Promise<Set<string>> {
  const { stdout } = await gh(['api', `repos/${sourceRepo}/issues/${sourceNumber}/dependencies/blocked_by`], {
    cwd,
  });
  let raw: RawBlockedByEntry[] = [];
  try {
    raw = JSON.parse(stdout || '[]') as RawBlockedByEntry[];
  } catch {
    raw = [];
  }
  const existing = new Set<string>();
  for (const entry of raw) {
    const repo = repoFromRepositoryUrl(entry.repository_url);
    if (repo) existing.add(`${repo}#${entry.number}`);
  }
  return existing;
}

/**
 * Write proposed dependency edges to GitHub via a GET-before-POST, additive-only
 * pattern (FR-11 happy / FR-10 confirm-negative):
 *
 *   1. GET the existing `blocked_by` links for each distinct source issue
 *      (one GET per source, not per edge).
 *   2. For each proposed edge, skip it if it's already present — never
 *      re-issue, edit, or otherwise touch an existing link.
 *   3. Only missing edges get a POST — and only ever `POST .../dependencies/blocked_by`.
 *      No edit/close/label/delete call is ever issued by this module.
 *
 * `dryRun: true` performs the GET-checks (so the operator can be shown what
 * WOULD happen) but issues zero POST calls — this is the writer half of the
 * confirm gate; the confirmation prompt itself lives in the CLI layer.
 *
 * Safe to re-run: edges already linked report `already-present` and are
 * never mutated, so calling this twice with the same edges has no additional
 * side effects on the graph.
 */
export async function createDependencyLinks(
  edges: DependencyEdge[],
  deps: CreateDependencyLinksDeps,
): Promise<DependencyLinkResult[]> {
  const { gh, cwd, dryRun = false } = deps;
  const log = deps.log ?? (() => {});
  const results: DependencyLinkResult[] = [];
  const existingBySource = new Map<string, Set<string>>();

  for (const edge of edges) {
    const source = parseRef(edge.source);
    const target = parseRef(edge.target);
    if (!source || !target) {
      log(`createDependencyLinks: skipping unparseable edge ${edge.source} -> ${edge.target}`);
      continue;
    }

    let existing = existingBySource.get(edge.source);
    if (!existing) {
      existing = await fetchExistingBlockedBy(source.repo, source.number, gh, cwd);
      existingBySource.set(edge.source, existing);
    }

    if (existing.has(edge.target)) {
      results.push({ edge, status: 'already-present' });
      continue;
    }

    if (dryRun) {
      results.push({ edge, status: 'dry-run' });
      continue;
    }

    await gh(
      [
        'api',
        '--method',
        'POST',
        `repos/${source.repo}/issues/${source.number}/dependencies/blocked_by`,
        '-f',
        `owner=${target.repo.split('/')[0]}`,
        '-f',
        `repo=${target.repo.split('/')[1]}`,
        '-f',
        `issue_number=${target.number}`,
      ],
      { cwd },
    );
    existing.add(edge.target);
    results.push({ edge, status: 'created' });
  }

  return results;
}
