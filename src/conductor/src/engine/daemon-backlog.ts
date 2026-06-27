import { execFile as execFileCb } from 'node:child_process';
import { basename, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { BacklogItem } from './daemon.js';
import { planHasDependencyTree, isStoriesApproved } from './artifacts.js';
import { makeGitRunner, originDefaultBranch, type GitRunner } from './rebase.js';

const execFile = promisify(execFileCb);

/**
 * Reads spec artifacts from a single, authoritative source — the daemon's
 * committed default branch (`main`). The merge of a spec PR is what moves
 * artifacts onto that branch, so reading the branch tree (NOT the working-tree
 * filesystem) is exactly what makes "merged" the build-ready signal (FR-24).
 *
 * `listPlanFiles()` → the `.md` basenames under `.docs/plans` on the base branch.
 * `readFile(relPath)` → the content of a repo-relative path on the base branch,
 *   or `null` when the path is absent from that tree.
 */
export interface BacklogTreeSource {
  listPlanFiles(): Promise<string[]>;
  readFile(relPath: string): Promise<string | null>;
}

/**
 * Production tree source: reads the committed `baseBranch` tree of the repo at
 * `projectRoot` via git. It deliberately never touches the working tree, so
 * uncommitted artifacts (e.g. specs the engineer authored but has not landed)
 * and artifacts that live only on an unmerged `spec/<slug>` branch are invisible
 * — the daemon builds a spec only once its PR is merged onto `baseBranch`.
 */
export function gitTreeSource(projectRoot: string, baseBranch: string): BacklogTreeSource {
  return {
    async listPlanFiles() {
      try {
        const { stdout } = await execFile(
          'git',
          ['ls-tree', '--name-only', `${baseBranch}:.docs/plans`],
          { cwd: projectRoot },
        );
        return stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.endsWith('.md'))
          // `git ls-tree <branch>:.docs/plans` already yields basenames; guard
          // against any stray pathing by reducing to the basename.
          .map((l) => basename(l));
      } catch {
        return []; // no such tree (no `.docs/plans` on base branch) → nothing to do
      }
    },
    async readFile(relPath) {
      try {
        const { stdout } = await execFile('git', ['show', `${baseBranch}:${relPath}`], {
          cwd: projectRoot,
        });
        return stdout;
      } catch {
        return null; // absent from the base-branch tree
      }
    },
  };
}

/**
 * Resolve the git tree-ish ref to use for backlog discovery on a daemon poll tick.
 *
 * The daemon refreshes from origin ONLY between work — when it is idle with no
 * local work left to start (`opts.refresh === true`). While features are in flight
 * (or local queued work remains) it discovers with `refresh:false`, which never
 * fetches, so an in-flight build is never re-based onto specs that merged on origin
 * mid-run. Between fetches the `origin/<default>` remote-tracking ref is stable, so
 * the whole batch captured by the last idle refresh stays discoverable for the
 * concurrent slots without any new network access.
 *
 * Strategy:
 *   1. Discover origin's default branch via `git symbolic-ref refs/remotes/origin/HEAD`
 *      (with a `git remote show origin` fallback). Never hardcode `main`/`master`.
 *   2. If `refresh` — best-effort `git fetch origin <default>` so `origin/<default>`
 *      reflects the latest merged specs.
 *   3. Return `origin/<default>` — `gitTreeSource` reads this ref, so a spec merged on
 *      origin but not pulled locally IS discovered. When `refresh:false`, the ref is
 *      verified to exist first (it normally does, having been fetched at the last idle).
 *
 * Degrades gracefully (NEVER throws):
 *   - No origin remote → `localBase`, no fetch.
 *   - origin/HEAD unset and `remote show` fallback fails → `localBase`.
 *   - Fetch fails (offline / unreachable) → logs and returns `localBase`.
 *   - `refresh:false` and `origin/<default>` not yet present → `localBase`.
 *
 * The `gitOverride` parameter allows tests to inject a fake git runner. The default
 * uses `makeGitRunner(projectRoot)` (the main checkout dir, never a worktree) so a
 * fetch is always safe: no checkout, no reset, no rebase.
 */
export async function resolveDiscoveryRef(
  projectRoot: string,
  localBase: string,
  log: (msg: string) => void = () => {},
  opts: { refresh?: boolean } = {},
  gitOverride?: GitRunner,
): Promise<string> {
  const refresh = opts.refresh ?? true;
  const git = gitOverride ?? makeGitRunner(projectRoot);

  // Check if origin remote exists — local-only repos skip the fetch entirely.
  const remotes = await git(['remote']);
  if (remotes.exitCode !== 0) return localBase;
  const hasOrigin = remotes.stdout
    .split('\n')
    .map((l) => l.trim())
    .includes('origin');
  if (!hasOrigin) return localBase;

  // Discover default branch name (never hardcode 'main').
  // Mirror resolveBase's two-step: symbolic-ref first, remote show fallback.
  let defaultBranch: string | null = await originDefaultBranch(git);
  if (!defaultBranch) {
    const show = await git(['remote', 'show', 'origin']);
    if (show.exitCode === 0) {
      const m = show.stdout.match(/HEAD branch:\s*(\S+)/);
      if (m && m[1] !== '(unknown)') defaultBranch = m[1];
    }
  }
  if (!defaultBranch) {
    // Discovery failed entirely — degrade to local base; do not assume 'main'.
    return localBase;
  }

  if (!refresh) {
    // Between-work discovery while builds run: NO fetch. Use the last-fetched
    // remote-tracking ref if it exists; otherwise fall back to the local base.
    const verify = await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${defaultBranch}`]);
    return verify.exitCode === 0 ? `origin/${defaultBranch}` : localBase;
  }

  // Idle refresh: best-effort fetch. A failed fetch (offline/unreachable) must NOT
  // crash the poll loop — log it and continue scanning the last-known local ref.
  const fetched = await git(['fetch', 'origin', defaultBranch]);
  if (fetched.exitCode !== 0) {
    log(
      `fetch origin ${defaultBranch} failed (offline?); scanning local ref ${localBase}`,
    );
    return localBase;
  }

  return `origin/${defaultBranch}`;
}

/** Options for discoverBacklog. */
export interface DiscoverBacklogOpts {
  /** Branch whose committed tree is the build-ready source of truth (default 'main'). */
  baseBranch?: string;
  /** Inject a tree source (tests); defaults to the git base-branch reader. */
  treeSource?: BacklogTreeSource;
  /**
   * One-time skip-warning dedup. Every skip here is for a MERGED spec (the tree
   * source reads the committed base branch), so an un-buildable merged spec
   * would otherwise re-log an identical skip on EVERY poll, forever. When these
   * are wired (production: `.daemon/warned/<slug>` markers), the skip is
   * surfaced once per slug and then suppressed until the spec is fixed (after
   * which it becomes eligible, builds, and is marked processed — never
   * re-entering the skip path). Unset (the default, e.g. in tests) → log every
   * scan, preserving prior behavior.
   */
  hasWarned?: (slug: string) => Promise<boolean>;
  markWarned?: (slug: string) => Promise<void>;
}

/**
 * Discover daemon-eligible features (Phase 6 / Phase 9.3 FR-24). The daemon
 * consumes existing, human-authored specs — it never authors them — and builds
 * a feature only once its spec PR is **merged onto the default branch**.
 *
 * Source of truth is `.docs/plans/*.md` **as committed on `baseBranch`** (NOT the
 * working-tree filesystem, and NOT any `.worktrees/` copy). Reading the branch
 * tree is what makes the human merge the build trigger: an engineer-authored spec
 * sitting uncommitted in the working tree, or committed only on an unmerged
 * `spec/<slug>` branch, is intentionally invisible here.
 *
 * Each plan names its stories file via a `**Stories:** <path>` line (repo
 * convention) or shares the plan's stem. A feature is eligible only when BOTH its
 * stories and plan are present on the base branch, the stories are
 * `Status: Accepted` (not DRAFT), and the plan declares a dependency tree. A
 * feature already marked processed (via `isProcessed`) is skipped.
 */
export async function discoverBacklog(
  projectRoot: string,
  isProcessed: (slug: string) => Promise<boolean> = async () => false,
  log: (msg: string) => void = () => {},
  opts: DiscoverBacklogOpts = {},
): Promise<BacklogItem[]> {
  const baseBranch = opts.baseBranch ?? 'main';
  const tree = opts.treeSource ?? gitTreeSource(projectRoot, baseBranch);

  // Surface a merged-but-unbuildable spec ONCE per slug rather than re-logging
  // the identical skip on every poll. When the dedup hooks are unset, fall back
  // to logging every scan (prior behavior).
  const warnOnce = async (slug: string, msg: string): Promise<void> => {
    if (opts.hasWarned && (await opts.hasWarned(slug))) return;
    log(msg);
    await opts.markWarned?.(slug);
  };

  const planFiles = (await tree.listPlanFiles()).filter((f) => f.endsWith('.md'));
  if (planFiles.length === 0) return [];

  const items: BacklogItem[] = [];
  for (const file of [...planFiles].sort()) {
    const slug = basename(file, '.md');
    const planRel = `.docs/plans/${file}`;

    // Read the plan FROM THE BASE-BRANCH TREE. Absent → not merged → skip.
    const planContent = await tree.readFile(planRel);
    if (planContent === null) continue;

    const storiesRel = await resolveStoriesRef(projectRoot, tree, slug, planContent);
    if (!storiesRel) continue; // no stories on the base branch → not eligible

    if (await isProcessed(slug)) continue;

    // Eligibility = APPROVED + well-formed. The daemon pre-seeds the front half
    // (stories/plan = done) and never re-runs their gates, so this is the only
    // place specs are vetted before autonomous build. Reject unapproved or
    // dependency-tree-less plans rather than silently building them.
    const storiesContent = (await tree.readFile(storiesRel)) ?? '';
    if (!isStoriesApproved(storiesContent)) {
      await warnOnce(
        slug,
        `skip ${slug}: merged spec cannot build — stories not approved (need "Status: Accepted", no DRAFT). Fix the spec on the default branch; logged once.`,
      );
      continue;
    }
    if (!planHasDependencyTree(planContent)) {
      await warnOnce(
        slug,
        `skip ${slug}: merged spec cannot build — plan has no dependency tree ("## Task Dependency Graph" or "**Dependencies:**" lines). Fix the spec on the default branch; logged once.`,
      );
      continue;
    }

    // BacklogItem paths are working-tree absolute paths (where materializeSpecs
    // copies from). On the daemon's base-branch checkout these match the merged,
    // committed content vetted above.
    items.push({
      slug,
      storiesPath: join(projectRoot, storiesRel),
      planPath: join(projectRoot, planRel),
    });
  }
  return items;
}

/**
 * Resolve the repo-relative stories path a plan depends on, validating it exists
 * ON THE BASE-BRANCH TREE. Prefers the explicit `**Stories:** <path>` line; falls
 * back to a stories file sharing the plan's stem. Returns null if neither is
 * present on the base branch.
 */
async function resolveStoriesRef(
  projectRoot: string,
  tree: BacklogTreeSource,
  slug: string,
  planContent: string,
): Promise<string | null> {
  const m = planContent.match(/^\s*\*\*Stories:\*\*\s*`?([^\s`]+)`?/im);
  if (m) {
    const ref = toRepoRelative(projectRoot, m[1]);
    if (ref && (await tree.readFile(ref)) !== null) return ref;
  }

  // Fallback: a stories file with the same stem as the plan.
  const candidate = `.docs/stories/${slug}.md`;
  if ((await tree.readFile(candidate)) !== null) return candidate;

  return null;
}

/**
 * Normalize a `**Stories:**` reference to a repo-relative POSIX path suitable for
 * `git show <branch>:<path>`. Absolute paths under projectRoot are made relative;
 * absolute paths outside it are rejected (null). Relative paths pass through.
 */
function toRepoRelative(projectRoot: string, ref: string): string | null {
  let rel = ref;
  if (isAbsolute(ref)) {
    const r = relative(projectRoot, ref);
    if (r.startsWith('..')) return null; // outside the repo → not a base-branch path
    rel = r;
  }
  return rel.split('\\').join('/'); // git tree paths use forward slashes
}
