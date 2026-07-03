import { execFile as execFileCb } from 'node:child_process';
import { basename, isAbsolute, relative } from 'node:path';
import { promisify } from 'node:util';
import type { BacklogItem } from './daemon.js';
import {
  planHasDependencyTree,
  isStoriesApproved,
  parseComplexityTier,
  parseIntakeSourceRef,
  parseTrack,
} from './artifacts.js';
import { makeGitRunner, originDefaultBranch, type GitRunner } from './rebase.js';
import type { OwnerResolution } from './owner-gate/identity.js';
import type { OwnerStamp } from './owner-gate/provenance.js';
import { decideSpecGate, type GateDecision } from './owner-gate/gate.js';

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
 * Fast-forward `projectRoot`'s checkout to origin so newly merged specs become
 * present in the working tree — and therefore in any worktree freshly cut from
 * the default branch. This replaces the old fetch-only discovery ref: instead of
 * reading specs off the `origin/<default>` remote-tracking tree and then copying
 * from a possibly-stale working tree (which diverged whenever local lagged
 * origin), the daemon keeps its local default branch current and builds from it.
 *
 * Called on the daemon's idle poll ONLY (`refresh === true`) — never while
 * features are in flight — so an in-flight build is never advanced mid-run. It
 * also never touches worktree checkouts: those are separate working trees, so a
 * fast-forward of the main checkout cannot disturb a running feature.
 *
 * SAFE by construction — side-effecting but it never clobbers operator state and
 * NEVER throws:
 *   - No origin remote → nothing to do.
 *   - Default branch undiscoverable (no origin/HEAD, `remote show` fails) → skip.
 *   - Root not on the default branch, or working tree dirty → log a warning and
 *     SKIP (a fast-forward is not applicable / could clobber).
 *   - `fetch` fails (offline) or the branches have truly diverged so a
 *     `--ff-only` merge is impossible → log and continue on the local branch.
 *
 * The `gitOverride` parameter allows tests to inject a fake git runner. The
 * default uses `makeGitRunner(projectRoot)` (the main checkout dir, never a
 * worktree).
 */
export async function fastForwardRoot(
  projectRoot: string,
  log: (msg: string) => void = () => {},
  gitOverride?: GitRunner,
): Promise<void> {
  const git = gitOverride ?? makeGitRunner(projectRoot);

  // No origin → nothing to fast-forward from (local-only repo).
  const remotes = await git(['remote']);
  if (remotes.exitCode !== 0) return;
  const hasOrigin = remotes.stdout
    .split('\n')
    .map((l) => l.trim())
    .includes('origin');
  if (!hasOrigin) return;

  // Discover the default branch name (never hardcode 'main').
  // Mirror resolveBase's two-step: symbolic-ref first, remote show fallback.
  let defaultBranch: string | null = await originDefaultBranch(git);
  if (!defaultBranch) {
    const show = await git(['remote', 'show', 'origin']);
    if (show.exitCode === 0) {
      const m = show.stdout.match(/HEAD branch:\s*(\S+)/);
      if (m && m[1] !== '(unknown)') defaultBranch = m[1];
    }
  }
  if (!defaultBranch) return; // can't determine the branch → do nothing

  // Only fast-forward when the root is actually ON the default branch: advancing
  // some other checked-out branch is not what we want.
  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const current = head.stdout.trim();
  if (head.exitCode !== 0 || current !== defaultBranch) {
    log(
      `skip fast-forward: root is on '${current || 'unknown'}', not the default branch ` +
        `'${defaultBranch}'. Daemon discovers/builds against the local branch as-is.`,
    );
    return;
  }

  // Refuse to touch a dirty working tree — a `--ff-only` merge could fail or
  // clobber uncommitted/untracked operator changes.
  const status = await git(['status', '--porcelain']);
  if (status.exitCode !== 0 || status.stdout.trim() !== '') {
    log(
      `skip fast-forward: working tree at ${projectRoot} is not clean. Commit/stash ` +
        `changes so the daemon can track origin/${defaultBranch}.`,
    );
    return;
  }

  // Best-effort fetch; offline/unreachable must NOT crash the poll loop.
  const fetched = await git(['fetch', 'origin', defaultBranch]);
  if (fetched.exitCode !== 0) {
    log(
      `fast-forward: fetch origin ${defaultBranch} failed (offline?); continuing on ` +
        `local ${defaultBranch}.`,
    );
    return;
  }

  // Fast-forward only. A non-ff (local has diverged from origin) is left for a
  // human rather than rewriting/merging the daemon's checkout.
  const merged = await git(['merge', '--ff-only', `origin/${defaultBranch}`]);
  if (merged.exitCode !== 0) {
    log(
      `fast-forward: local ${defaultBranch} has diverged from origin/${defaultBranch} ` +
        `(non-fast-forward); continuing on local ${defaultBranch}.`,
    );
  }
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
  /**
   * Owner-gate injectables (all optional → backward compatible). When the four
   * are absent the discovery behaves EXACTLY as before: no gate, no gate logs.
   *
   * - `daemonOwner` — the once-per-pass resolved daemon owner. When `resolved:
   *   true`, each content-eligible spec is put through `decideSpecGate`; when
   *   `resolved: false` the daemon FAIL-CLOSES (D3) — it builds NOTHING and
   *   surfaces a single warn-once "identity unresolved" line per pass. Absent
   *   entirely → the gate is skipped silently (legacy behavior).
   * - `readStamp(slug)` — reads the spec's committed owner stamp; defaults to
   *   "un-owned" when unset.
   * - `readMergeTime(slug)` — the spec's first-appearance time for the un-owned
   *   grandfather branch; defaults to null (indeterminate) when unset.
   * - `cutover` — the configured grandfather cutover instant, or null.
   */
  daemonOwner?: OwnerResolution;
  readStamp?: (slug: string) => Promise<OwnerStamp>;
  readMergeTime?: (slug: string) => Promise<string | null>;
  cutover?: string | null;
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
 *
 * Returns `{ items, waiting }`: `items` are the eligible-to-build features
 * (unchanged shape/behavior). `waiting` is reserved for specs held back by an
 * unresolved dependency gate — always `[]` today; a later task populates it.
 */
export interface WaitingItem {
  slug: string;
  sourceRef?: string;
  /** Placeholder shape; a later task fills in the real verdict payload. */
  verdict: string;
}

export async function discoverBacklog(
  projectRoot: string,
  isProcessed: (slug: string) => Promise<boolean> = async () => false,
  log: (msg: string) => void = () => {},
  opts: DiscoverBacklogOpts = {},
): Promise<{ items: BacklogItem[]; waiting: WaitingItem[] }> {
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

  // Reserved warned-marker keys for the two GLOBAL (non-slug) owner-gate notices.
  // Routing them through `warnOnce` reuses the same `.daemon/warned/` dedup as the
  // per-slug merged-spec skips, so in production they surface ONCE and are then
  // suppressed across poll ticks — instead of re-logging on every scan forever.
  // The `__…__` prefix cannot collide with a real `<date>-<slug>` plan stem. The
  // per-pass local guards below are retained so that when the dedup hooks are
  // unset (tests, legacy), each notice still logs at most once per pass (never
  // per-spec), preserving prior behavior.
  const IDENTITY_UNRESOLVED_WARN_KEY = '__owner-gate-identity-unresolved__';
  const NO_CUTOVER_WARN_KEY = '__owner-gate-no-cutover__';

  // Fail-CLOSED notice (D3 / Story 3): when a `daemonOwner` is supplied but
  // UNRESOLVED (no user-config spec_owner and no gh login), the daemon builds
  // NOTHING — an unidentified daemon must never build another operator's specs.
  // Surface that once, loudly and distinctly, so the operator knows why the
  // backlog is empty and how to fix it. Distinct from the per-slug
  // content/ownership skip lines. An ABSENT `daemonOwner` stays silent (legacy —
  // the gate is simply unwired).
  let identityUnresolvedWarned = false;
  const warnIdentityUnresolvedOnce = async (): Promise<void> => {
    if (identityUnresolvedWarned) return;
    identityUnresolvedWarned = true;
    await warnOnce(
      IDENTITY_UNRESOLVED_WARN_KEY,
      'daemon identity unresolved: no spec_owner in ~/.ai-conductor/config.yml and no ' +
        'gh login — building NOTHING (fail-closed). Set spec_owner in ' +
        '~/.ai-conductor/config.yml or authenticate gh; logged once.',
    );
  };

  // No-cutover notice (Observability NFR): when the gate is ACTIVE (a resolved
  // daemon owner) but NO grandfather `owner_gate_cutover` is configured, every
  // un-owned spec skips as indeterminate. That skip-default is operator-accepted
  // but easy to miss, so surface it once — distinct from the gate-inactive line
  // and the per-slug ownership skips. Does NOT change any build/skip decision.
  // Silent when a cutover IS set or the gate is inactive.
  let gateNoCutoverWarned = false;
  const warnGateNoCutoverOnce = async (): Promise<void> => {
    if (gateNoCutoverWarned) return;
    gateNoCutoverWarned = true;
    await warnOnce(
      NO_CUTOVER_WARN_KEY,
      'owner-gate active but no owner_gate_cutover configured — un-owned specs will be ' +
        'skipped; set owner_gate_cutover to grandfather pre-existing specs.',
    );
  };

  // Fail-CLOSED gate (D3 / Story 3): a supplied-but-UNRESOLVED daemon owner
  // builds NOTHING. This reverses the prior fail-open behavior (build all when
  // identity is unknown) — the exact multi-operator hazard, where a
  // misconfigured/unauthenticated daemon would build every operator's specs. We
  // short-circuit BEFORE the per-spec scan so no content/ownership skip lines are
  // emitted for work that could never build this pass; only the single loud
  // identity-unresolved notice surfaces. An ABSENT `daemonOwner` (gate unwired)
  // is untouched — legacy discovery runs normally.
  if (opts.daemonOwner && !opts.daemonOwner.resolved) {
    await warnIdentityUnresolvedOnce();
    return { items: [], waiting: [] };
  }

  const planFiles = (await tree.listPlanFiles()).filter((f) => f.endsWith('.md'));
  if (planFiles.length === 0) return { items: [], waiting: [] };

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

    // Carry the engineer-assessed complexity tier so the daemon build honors it
    // (Small skips acceptance_specs/retro). The marker is committed at
    // `.docs/complexity/<plan-stem>.md` — the SAME stem as the plan — so it is
    // resolvable here from the base-branch tree. Absent/garbled → undefined, and
    // the daemon falls back to 'M' (legacy behavior, no breakage).
    const tier = parseComplexityTier(await tree.readFile(`.docs/complexity/${slug}.md`));

    // Carry the originating issue ref (if this spec came from github-issues
    // intake) so the daemon can put `Closes owner/repo#N` on the implementation
    // PR. The marker is committed at `.docs/intake/<plan-stem>.md` — the SAME
    // stem as the plan. Absent/garbled → undefined (hand-authored specs unchanged).
    const sourceRef = parseIntakeSourceRef(await tree.readFile(`.docs/intake/${slug}.md`));

    // Owner gate — runs ONLY after every content filter above has passed, so the
    // gate never bypasses eligibility (a content-ineligible spec is already
    // `continue`d before reaching here). The gate is consulted only for a
    // RESOLVED daemon owner. An UNRESOLVED owner never reaches here — it
    // fail-closes (builds nothing) at the top of the scan. An absent
    // `daemonOwner` skips the gate entirely (legacy behavior).
    const daemonOwner = opts.daemonOwner;
    if (daemonOwner?.resolved) {
      // Gate active — flag the operator-accepted skip-default once per pass when
      // no grandfather cutover is set (observability only; no decision change).
      if ((opts.cutover ?? null) === null) await warnGateNoCutoverOnce();
      const stamp = opts.readStamp ? await opts.readStamp(slug) : { present: false as const };
      const mergeTime = opts.readMergeTime ? await opts.readMergeTime(slug) : null;
      const decision = decideSpecGate({
        daemonOwner: { id: daemonOwner.id },
        stamp,
        mergeTime,
        cutover: opts.cutover ?? null,
      });
      if (!decision.build) {
        await warnOnce(slug, ownershipSkipMessage(slug, decision));
        continue;
      }
    }

    // Work track (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location) from `.docs/track/<plug-stem>.md`. Absent → the
    // daemon treats the feature as `product` (back-compat: pre-track specs are
    // PRDs), so `prd`/`prd-audit` still run. Carried only when explicitly set.
    const track = parseTrack(await tree.readFile(`.docs/track/${slug}.md`));

    // A fresh worktree is cut from the (now fast-forwarded) default branch, so the
    // vetted stories/plan physically exist in it already — the item only needs to
    // carry the slug (+ tier + sourceRef + track); no working-tree paths to copy.
    items.push({ slug, tier, ...(sourceRef ? { sourceRef } : {}), ...(track ? { track } : {}) });
  }
  return { items, waiting: [] };
}

/**
 * Compose the distinct owner-gate skip line for a gated-out spec (FR-11). These
 * are deliberately worded apart from the content-skip lines ("… cannot build —
 * stories not approved / no dependency tree") and the gate-inactive line, so an
 * operator can tell an ownership skip from an eligibility skip in the logs.
 */
function ownershipSkipMessage(slug: string, decision: GateDecision): string {
  if (decision.build) return ''; // never called on a build decision
  if (decision.reason === 'other-owner') {
    return (
      `skip ${slug}: owner-gate — spec is owned by another operator ` +
      `('${decision.other}'), not this daemon; logged once.`
    );
  }
  // Un-owned merged spec (D5 / Story 6): surface it LOUDLY and actionably, never
  // a silent stall. The message states it is un-owned AND how to fix it — add an
  // `Owner:` marker on the default branch — so legacy/pre-hardening work does not
  // vanish into a black hole. Deduped once per slug by the caller's warnOnce.
  const why =
    decision.reason === 'unowned-post-cutover'
      ? 'un-owned and merged on/after the grandfather cutover'
      : 'un-owned with an indeterminate merge time';
  return (
    `skip ${slug}: owner-gate — spec is ${why}. To build it, add an ` +
    `'Owner:' marker to the spec on the default branch (or grandfather it via ` +
    `owner_gate_cutover); logged once.`
  );
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
