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
  planStem,
} from './artifacts.js';
import { makeGitRunner, originDefaultBranch, type GitRunner } from './rebase.js';
import type { OwnerResolution } from './owner-gate/identity.js';
import type { OwnerStamp } from './owner-gate/provenance.js';
import { decideSpecGate, type GateDecision } from './owner-gate/gate.js';
import type { BlockerResolver, BlockerVerdict } from './blocker-resolver.js';
import { announceWaitingForRoot } from './daemon-waiting-announce.js';
import { listShippedRecords, parseShippedRecord, specHash } from './shipped-record.js';

const execFile = promisify(execFileCb);

/**
 * Reads spec artifacts from a single, authoritative source — the daemon's
 * committed default branch (`main`). The merge of a spec PR is what moves
 * artifacts onto that branch, so reading the branch tree (NOT the working-tree
 * filesystem) is exactly what makes "merged" the build-ready signal (FR-24).
 *
 * `listPlanFiles()` → the `.md` basenames under `.docs/plans` on the base branch.
 * `listShippedFiles()` → the `.md` basenames under `.docs/shipped` on the base
 *   branch, using the identical base-branch-only semantics as `listPlanFiles`
 *   (see `listShippedRecords` in `shipped-record.ts`, Story 3/4).
 * `readFile(relPath)` → the content of a repo-relative path on the base branch,
 *   or `null` when the path is absent from that tree.
 */
export interface BacklogTreeSource {
  listPlanFiles(): Promise<string[]>;
  listShippedFiles(): Promise<string[]>;
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
    async listShippedFiles() {
      try {
        const { stdout } = await execFile(
          'git',
          ['ls-tree', '--name-only', `${baseBranch}:.docs/shipped`],
          { cwd: projectRoot },
        );
        return stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.endsWith('.md'))
          .map((l) => basename(l));
      } catch {
        return []; // no such tree (no `.docs/shipped` on base branch) → nothing to do
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
  /**
   * Dependency-gate resolver injectable. Mirrors the owner-gate injectables
   * above: an ABSENT resolver skips the dependency gate entirely (legacy
   * behavior — every content/owner-eligible spec dispatches unaffected,
   * exactly as before this feature existed). When supplied, exactly one
   * instance is used per `discoverBacklog()` call (per scan pass) — the
   * production wiring is responsible for constructing a fresh
   * `createBlockerResolver({ run: createGhBlockerRunner() })` on every poll
   * rather than caching one across polls, so memo/cycle-detection state never
   * leaks stale verdicts between scans.
   */
  resolver?: BlockerResolver;
  /**
   * Content-aware shipped-work dedup (Story 3/Task 4). When a candidate's
   * stem matches a shipped record committed on the base branch, the local
   * `isProcessed` cache is out of sync with reality — the spec already
   * shipped, but no local marker recorded it (e.g. the marker was never
   * written, or the daemon's local state was reset). `repairProcessed` lets
   * the caller repair that cache (write the missing marker) so the candidate
   * is fast-path-skipped by `isProcessed` on every subsequent poll instead of
   * being re-evaluated via shipped-record lookup every time. Optional — when
   * unset, the dedup skip still happens but no repair is attempted. Errors
   * thrown by `repairProcessed` are caught and logged; they never prevent the
   * skip (correctness of the skip never depends on the repair succeeding).
   */
  repairProcessed?: (slug: string, record: ReturnType<typeof parseShippedRecord>) => Promise<void>;
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
  verdict: BlockerVerdict;
}

/**
 * An owner-gate skip surfaced to the operator (FR-7/FR-11). Distinct from
 * `WaitingItem` (dependency gate): `GatedItem` covers specs (and repo-scoped
 * conditions) held back by the OWNERSHIP gate, not the dependency gate.
 *
 * - `kind: 'spec'` — a single merged spec skipped by the owner gate, carrying
 *   the reason (`other-owner` | `unowned-post-cutover` | `unowned-indeterminate`),
 *   the other operator's id when known (`other-owner` only), and an
 *   operator-actionable remedy hint.
 * - `kind: 'repo'` — a repo-scoped (non-slug) owner-gate condition: either the
 *   daemon's own identity is unresolved (fail-closed, nothing scanned this
 *   pass) or the gate is active with no grandfather cutover configured.
 *
 * Populated by later tasks in this plan; `discoverBacklog` returns `gated: []`
 * unconditionally until then (this task only introduces the type + shape).
 */
export interface GatedSpecItem {
  kind: 'spec';
  slug: string;
  reason: 'other-owner' | 'unowned-post-cutover' | 'unowned-indeterminate';
  otherOwner?: string;
  remedy: string;
  // Task 21: the spec's originating `Source-Ref: owner/repo#N` intake marker,
  // when present — carried through so the gate write-back orchestrator
  // (gate-writeback.ts) can announce on the originating issue, exactly the
  // same `sourceRef` already resolved above for the dependency-gate loop.
  sourceRef?: string;
}
export interface GatedRepoItem {
  kind: 'repo';
  warning: 'identity-unresolved' | 'no-cutover';
  remedy: string;
}
export type GatedItem = GatedSpecItem | GatedRepoItem;

export async function discoverBacklog(
  projectRoot: string,
  isProcessed: (slug: string) => Promise<boolean> = async () => false,
  log: (msg: string) => void = () => {},
  opts: DiscoverBacklogOpts = {},
): Promise<{ items: BacklogItem[]; waiting: WaitingItem[]; gated: GatedItem[] }> {
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
  let identityUnresolvedGatedPushed = false;
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
  // Repo-scoped GATED entry companion (Task 5, S3 HP-1/NP-3): distinct from the
  // log line above. Pushed at most ONCE per pass, and only when an actual
  // un-owned spec is skipped for lack of a cutover — never merely because the
  // gate is active with no cutover set (a pass where every spec is owned, or
  // grandfathered, must NOT surface a false alarm).
  let noCutoverGatedPushed = false;
  const warnGateNoCutoverOnce = async (): Promise<void> => {
    if (gateNoCutoverWarned) return;
    gateNoCutoverWarned = true;
    await warnOnce(
      NO_CUTOVER_WARN_KEY,
      'owner-gate active but no owner_gate_cutover configured — un-owned specs will be ' +
        'skipped; set owner_gate_cutover to grandfather pre-existing specs.',
    );
  };

  const planFiles = (await tree.listPlanFiles()).filter((f) => f.endsWith('.md'));
  if (planFiles.length === 0) return { items: [], waiting: [], gated: [] };

  // Shipped-record dedup (Story 3/Task 4): read every committed shipped
  // record from the base-branch tree ONCE per discovery run (not once per
  // candidate — `listShippedRecords` already batches this via a single
  // `listShippedFiles()` call), then match each candidate by stem below.
  const shippedRecords = await listShippedRecords(tree);

  const items: BacklogItem[] = [];
  // slug -> raw (unparseable) Source-Ref text, for specs whose intake marker
  // is present but malformed (see the dependency-gate loop below).
  const malformedSourceRefs = new Map<string, string>();
  // Owner-gate skips surfaced to the operator (FR-7/FR-11/S1 HP-1). Populated
  // alongside the existing warnOnce log line below — never in place of it.
  const gatedItems: GatedItem[] = [];
  for (const file of [...planFiles].sort()) {
    const slug = planStem(file);
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

    // Shipped-work dedup (Story 3/Task 4): a content-eligible candidate whose
    // stem matches a shipped record already committed on the base branch has
    // already merged its implementation — never re-dispatch or re-kick it,
    // even if the local `isProcessed` cache missed it (a stale/reset cache).
    // Runs AFTER content filters (so a shipped spec is never mis-logged as
    // "identity unresolved" or "owner gated") and BEFORE the owner gate (so a
    // shipped spec with an unresolved identity or foreign owner stamp is still
    // reported as shipped, not as an owner-gate skip).
    const shippedMatch = shippedRecords.find((r) => r.stem === slug);
    if (shippedMatch) {
      try {
        await opts.repairProcessed?.(slug, shippedMatch.record);
      } catch (err) {
        // Repair is best-effort only — correctness of the skip never depends
        // on the local cache marker actually being written. Log and move on.
        log(
          `shipped dedup: ${slug} already shipped (base-branch record found) but repairing ` +
            `the local processed-cache failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      await warnOnce(
        slug,
        `skip ${slug}: shipped dedup — implementation already merged (base-branch shipped record found); not re-dispatching.`,
      );
      continue;
    }

    // Content-hash dedup (Story 4/Task 6): catches a RENAMED spec — same plan
    // + stories content as a shipped record, but under a different stem, so
    // the stem-match above misses it. Computed AFTER the stem-match dedup
    // (cheaper, so it runs first) and still BEFORE the owner gate (a renamed
    // shipped spec is reported as shipped, not as owner-gated). The candidate
    // digest is compared against every shipped record's `spec_hash`; a match
    // means the implementation already shipped under the OLD stem, so the
    // cache is repaired under the candidate's (NEW) slug, not the old one.
    const candidateDigest = specHash(
      Buffer.from(planContent, 'utf-8'),
      Buffer.from(storiesContent, 'utf-8'),
    ).digest;
    const hashMatch = shippedRecords.find(
      (r) => !('malformed' in r.record) && r.record.specHash === candidateDigest,
    );
    if (hashMatch) {
      try {
        await opts.repairProcessed?.(slug, hashMatch.record);
      } catch (err) {
        log(
          `shipped dedup: ${slug} matches shipped content under '${hashMatch.stem}' but ` +
            `repairing the local processed-cache failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      await warnOnce(
        slug,
        `skip ${slug}: shipped dedup — shipped under '${hashMatch.stem}', candidate ` +
          `'${slug}' matches by content (spec_hash); not re-dispatching.`,
      );
      continue;
    }

    // Fail-CLOSED gate (D3 / Story 3): a supplied-but-UNRESOLVED daemon owner
    // builds NOTHING. This reverses the prior fail-open behavior (build all when
    // identity is unknown) — the exact multi-operator hazard, where a
    // misconfigured/unauthenticated daemon would build every operator's specs.
    // Runs AFTER both shipped-dedup checks above (Story 3/Task 5): a candidate
    // whose implementation already merged (by stem or by content-hash) is
    // reported as shipped even when this daemon's identity is unresolved — dedup
    // takes precedence over identity, so an already-shipped spec is never
    // mis-logged as "identity unresolved". Only a content-eligible, NOT-yet-
    // shipped candidate reaches this fail-closed check. An ABSENT `daemonOwner`
    // (gate unwired) is untouched — legacy discovery runs normally.
    if (opts.daemonOwner && !opts.daemonOwner.resolved) {
      await warnIdentityUnresolvedOnce();
      // Fail-closed (D3/Story 3 NP-1): don't just log — surface a repo-scoped
      // GATED entry too, so the dashboard/status can show WHY the backlog came
      // back empty instead of looking silently idle. Pushed once per pass
      // (guarded by `identityUnresolvedGatedPushed`), regardless of how many
      // candidates hit this fail-closed branch.
      if (!identityUnresolvedGatedPushed) {
        identityUnresolvedGatedPushed = true;
        gatedItems.push({
          kind: 'repo',
          warning: 'identity-unresolved',
          remedy:
            'Set spec_owner in ~/.ai-conductor/config.yml or authenticate gh.',
        });
      }
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
    // stem as the plan. Absent → undefined (hand-authored specs unchanged). A
    // marker that IS present but carries an unparseable ref is distinct from
    // absence (FR-7): it must fail closed to `waiting` as `indeterminate`
    // rather than silently dispatching like a spec with no marker at all, so
    // it is tracked separately in `malformedSourceRefs` below.
    const intakeMarker = await tree.readFile(`.docs/intake/${slug}.md`);
    const sourceRef = parseIntakeSourceRef(intakeMarker);
    const rawSourceRefLine = intakeMarker?.match(/^\s*Source-Ref:\s*(\S+)/im)?.[1];
    if (rawSourceRefLine && !sourceRef) {
      malformedSourceRefs.set(slug, rawSourceRefLine);
    }

    // Owner gate — runs ONLY after every content filter above has passed, so the
    // gate never bypasses eligibility (a content-ineligible spec is already
    // `continue`d before reaching here). The gate is consulted only for a
    // RESOLVED daemon owner. An UNRESOLVED owner never reaches here — it
    // fail-closes (builds nothing) earlier in this iteration, AFTER the
    // shipped-dedup checks. An absent `daemonOwner` skips the gate entirely
    // (legacy behavior).
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
        if (decision.reason === 'other-owner') {
          gatedItems.push({
            kind: 'spec',
            slug,
            reason: 'other-owner',
            otherOwner: decision.other,
            remedy: `declare an Owner: ${daemonOwner.id} or the daemon's own owner for this spec`,
            sourceRef,
          });
        } else {
          gatedItems.push({
            kind: 'spec',
            slug,
            reason: decision.reason,
            remedy: gateRemedy(decision),
            sourceRef,
          });
        }
        if (
          decision.reason === 'unowned-indeterminate' &&
          (opts.cutover ?? null) === null &&
          !noCutoverGatedPushed
        ) {
          // The gate is active, no cutover is configured, and an un-owned spec
          // was just skipped as a direct result — surface the repo-scoped
          // GATED entry ONCE per pass (Task 5, S3 HP-1), alongside (not in
          // place of) the existing `warnGateNoCutoverOnce` log line.
          noCutoverGatedPushed = true;
          gatedItems.push({
            kind: 'repo',
            warning: 'no-cutover',
            remedy: 'Set owner_gate_cutover in ~/.ai-conductor/config.yml to grandfather pre-existing un-owned specs.',
          });
        }
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

  // Dependency gate — the final gauntlet step, run AFTER content eligibility and
  // the owner gate so it never bypasses either. An ABSENT resolver (legacy /
  // not-yet-wired) skips the gate silently — identical to the owner-gate's
  // absent-`daemonOwner` behavior above. Specs with no (or no parseable)
  // Source-Ref never reach a supplied resolver either — they are
  // content-eligible, non-intake specs and dispatch unaffected, preserving
  // today's behavior for hand-authored work.
  if (!opts.resolver) {
    return { items, waiting: [], gated: gatedItems };
  }
  const resolver = opts.resolver;
  const gated: BacklogItem[] = [];
  const waiting: WaitingItem[] = [];
  for (const item of items) {
    if (!item.sourceRef) {
      const rawRef = malformedSourceRefs.get(item.slug);
      if (rawRef !== undefined) {
        // Marker present but unparseable — fail closed as indeterminate
        // rather than dispatching as if there were no marker at all.
        waiting.push({ slug: item.slug, verdict: { kind: 'indeterminate', detail: `unparseable Source-Ref: ${rawRef}` } });
        continue;
      }
      gated.push(item);
      continue;
    }
    let verdict: BlockerVerdict;
    try {
      verdict = await resolver.resolve(item.sourceRef);
    } catch (err: unknown) {
      // The resolver contract never throws in production (blocker-resolver.ts
      // already converts platform failures to `indeterminate`), but a fail-
      // closed fallback here keeps a broken/injected resolver from crashing the
      // scan loop or silently dispatching an unverified spec.
      const detail = err instanceof Error ? err.message : String(err);
      verdict = { kind: 'indeterminate', detail };
    }
    if (verdict.kind === 'unblocked') {
      gated.push(item);
    } else {
      waiting.push({ slug: item.slug, sourceRef: item.sourceRef, verdict });
    }
  }

  announceWaitingForRoot(projectRoot, log, waiting);
  return { items: gated, waiting, gated: gatedItems };
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
 * Derive the operator-actionable remedy hint for an un-owned gated spec
 * (S1 HP-2/HP-3, S2 HP-2 content). Pure function — no I/O, mirrors the
 * `ownershipSkipMessage` "why"/remedy split so the two stay in lockstep.
 * Never called for `other-owner` (that reason has its own bespoke remedy at
 * the call site, naming the daemon's own owner id).
 */
function gateRemedy(decision: GateDecision): string {
  if (decision.build) return ''; // never called on a build decision
  if (decision.reason === 'other-owner') return ''; // handled at the call site
  return decision.reason === 'unowned-post-cutover'
    ? "add an 'Owner:' marker to the spec on the default branch"
    : "add an 'Owner:' marker to the spec on the default branch, or set " +
        'owner_gate_cutover to grandfather it';
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
