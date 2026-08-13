import { execa } from 'execa';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import type { StepName } from '../types/index.js';
import { writeVerdict, type GateVerdict } from './gate-verdicts.js';
import { writeHaltMarker } from './halt-marker.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import { withEngineCommitEnv } from './engine-commit-env.js';
import { saveStepStatus } from './state.js';
import {
  classifyGateInvalidation,
  featureTestPaths,
  partitionDelta,
  GATE_SURFACE,
  isRuntimeSourcePath,
  isTestPath,
} from './gate-invalidation.js';
import type { ProviderAttributionMetadata } from './provider-execution.js';
import {
  PROTECTED_ARTIFACT_SEAL_PATH,
  verifyProtectedArtifactSeal,
} from './protected-artifact-seal.js';

// ── Engine-native `rebase` loopGate (Phase 9.0) ──────────────────────────────
//
// Pure, testable helpers that rebase a daemon worktree branch onto the latest
// discovered base and classify the outcome. The conductor consumes these
// natively (no Claude dispatch) when the gate loop reaches the `rebase` step.
//
// Design keystone (ADR-001 / FR-4): the gate verdict is SATISFIED iff the
// branch is already current with the base. A genuinely stale branch must never
// report satisfied — that is the critical correctness property.

/** Minimal git runner — injected so the helpers are unit-testable without a repo. */
export interface GitRunner {
  (args: string[], opts?: { input?: string }): Promise<GitResult>;
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Result of checking whether merging the base into HEAD would conflict. */
export type ProspectiveMergeResult = 'clean' | 'conflicting' | 'indeterminate';

/**
 * Classify Git's prospective merge result without modifying the worktree.
 *
 * `merge-tree --write-tree` uses exit 0 for a clean merge and 1 for conflicts;
 * every other exit is an operational failure whose mergeability is unknown.
 */
async function classifyProspectiveMerge(
  git: GitRunner,
  baseRef: string,
): Promise<ProspectiveMergeResult> {
  try {
    const { exitCode } = await git(['merge-tree', '--write-tree', '--quiet', baseRef, 'HEAD']);
    if (exitCode === 0) return 'clean';
    if (exitCode === 1) return 'conflicting';
    return 'indeterminate';
  } catch {
    return 'indeterminate';
  }
}

/** A real git runner rooted at `cwd`, never throwing on non-zero exit. */
export function makeGitRunner(cwd: string): GitRunner {
  return async (args: string[], opts?: { input?: string }): Promise<GitResult> => {
    try {
      // Engine bookkeeping marker (#505 Task 8): any `git commit` this runner
      // spawns is engine-authored (rebase mechanics, quarantine, etc.), never
      // dispatched implementation work — mark it so the commit-msg gate
      // exempts it from the Task: trailer requirement.
      const isCommit = args[0] === 'commit';
      const r = await execa('git', args, {
        cwd,
        reject: false,
        ...(isCommit ? { env: withEngineCommitEnv() } : {}),
        ...(opts?.input !== undefined ? { input: opts.input } : {}),
      });
      // Tolerate odd/mocked results (no object, no exitCode) → treat as failure.
      if (!r || typeof r !== 'object') {
        return { exitCode: 1, stdout: '', stderr: '' };
      }
      return {
        exitCode: typeof r.exitCode === 'number' ? r.exitCode : 1,
        stdout: typeof r.stdout === 'string' ? r.stdout : '',
        stderr: typeof r.stderr === 'string' ? r.stderr : '',
      };
    } catch {
      return { exitCode: 1, stdout: '', stderr: '' };
    }
  };
}

// ── Base discovery (FR-2 / FR-3) ─────────────────────────────────────────────

/**
 * A resolved rebase base: the ref to rebase onto and whether it came from a
 * fetched origin (remote) or a local fallback. `remote` bases were
 * `git fetch`ed; `local` bases were not (no origin, or fetch failed).
 */
export interface ResolvedBase {
  /** The ref to rebase onto, e.g. `origin/main` or `main`. */
  ref: string;
  /** Where the base came from — origin's discovered default, or the local branch. */
  kind: 'remote' | 'local';
  /** The bare branch name (without `origin/`), e.g. `main` / `trunk`. */
  branch: string;
  /**
   * Why a `local` base was chosen, when it was chosen as a FALLBACK rather than
   * because the repository genuinely has no origin.
   *
   * The distinction is load-bearing for the mergeable-skip policy. `no-origin`
   * means the local branch IS the truth — nothing it could be stale against.
   * `discovery-failed` / `fetch-failed` mean an origin exists and we simply
   * could not read it, so the local branch may be arbitrarily far behind the
   * base this branch will actually be merged into. Undefined for a `remote`
   * base.
   */
  degraded?: 'no-origin' | 'discovery-failed' | 'fetch-failed';
}

/** True when this base cannot be trusted to represent what the branch merges into. */
export function isDegradedBase(base: ResolvedBase): boolean {
  return base.degraded === 'discovery-failed' || base.degraded === 'fetch-failed';
}

/**
 * origin's default branch NAME (no `origin/` prefix) from
 * `git symbolic-ref refs/remotes/origin/HEAD`, e.g. `main` / `trunk`, or null
 * if there is no origin/HEAD. Shared by `resolveBase` (the rebase ref) and the
 * conductor's local-base discovery so the parse lives in one place.
 */
export async function originDefaultBranch(git: GitRunner): Promise<string | null> {
  const head = await git(['symbolic-ref', 'refs/remotes/origin/HEAD']);
  if (head.exitCode === 0 && head.stdout.trim()) {
    // e.g. "refs/remotes/origin/main" → "main"
    const m = head.stdout.trim().match(/^refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Discover the base to rebase onto:
 *   - origin's default branch via `git symbolic-ref refs/remotes/origin/HEAD`,
 *     fetched, → `origin/<default>` (kind 'remote');
 *   - if there is no origin, or discovery/fetch fails → the LOCAL `localBase`
 *     branch (kind 'local'), with no hardcoded 'main'.
 *
 * Extracted core seam (build-review-grades-plan-vs-diff-against-a-stale-o,
 * Task 1): shared by `resolveBase` (the rebase gate) and, in Task 2, the
 * ls-remote freshness probe (`resolveFreshBase`) — both need "discover
 * default branch, fetch it, degrade to local on any failure" without
 * duplicating the discover+fetch logic.
 */
export async function resolveBaseCore(
  git: GitRunner,
  localBase: string,
): Promise<ResolvedBase> {
  // Is there an `origin` remote at all?
  const remotes = await git(['remote']);
  const hasOrigin = remotes.exitCode === 0 &&
    remotes.stdout.split('\n').map((l) => l.trim()).includes('origin');
  if (!hasOrigin) {
    return { ref: localBase, kind: 'local', branch: localBase, degraded: 'no-origin' };
  }

  // Discover the default branch name from origin/HEAD (never hardcode main).
  let defaultBranch: string | null = await originDefaultBranch(git);
  if (!defaultBranch) {
    // Fall back to `git remote show origin` ("HEAD branch: <name>").
    const show = await git(['remote', 'show', 'origin']);
    if (show.exitCode === 0) {
      const m = show.stdout.match(/HEAD branch:\s*(\S+)/);
      if (m && m[1] !== '(unknown)') defaultBranch = m[1];
    }
  }
  if (!defaultBranch) {
    // Discovery failed entirely — degrade to the local base, do not assume main.
    return { ref: localBase, kind: 'local', branch: localBase, degraded: 'discovery-failed' };
  }

  // Fetch the default branch. A failed fetch degrades to the caller's local
  // base (FR-3): remote-less/unreachable repos must still complete, not HALT.
  // Use `localBase` (a known-existing local branch) rather than the bare origin
  // default name, which may not exist locally — consistent with the no-origin
  // and discovery-failed fallbacks above.
  const fetched = await git(['fetch', 'origin', defaultBranch]);
  if (fetched.exitCode !== 0) {
    return { ref: localBase, kind: 'local', branch: localBase, degraded: 'fetch-failed' };
  }
  return { ref: `origin/${defaultBranch}`, kind: 'remote', branch: defaultBranch };
}

/**
 * Public entry point used by the rebase gate. Thin delegate over
 * `resolveBaseCore` — kept as a separate name for call-site clarity/back-compat;
 * behavior is identical.
 */
export async function resolveBase(
  git: GitRunner,
  localBase: string,
): Promise<ResolvedBase> {
  return resolveBaseCore(git, localBase);
}

/**
 * A fresh-base resolution: everything `resolveBase` returns, plus the
 * ls-remote freshness evidence (Task 2, ai-conductor
 * build-review-grades-plan-vs-diff-against-a-stale-o). `fresh: true` means the
 * tracking ref already matched `ls-remote`'s reported head (no fetch was
 * needed); `fresh: false` covers both "fetched a stale ref" and "no remote /
 * probe failure — degraded to local" (`remoteHeadSha` is `null` in the latter
 * case).
 */
export interface FreshBaseResolution extends ResolvedBase {
  trackingRefSha: string | null;
  remoteHeadSha: string | null;
  fresh: boolean;
}

/**
 * The current checked-out branch name (short form), or `null` if it cannot be
 * determined (detached HEAD, empty repo, etc). Used as the `localBase`
 * fallback for `resolveBaseCore` when `resolveFreshBase` has no explicit
 * caller-supplied local base (its contract takes none — see
 * `FreshBaseResolution` callers in the acceptance spec).
 */
async function currentBranch(git: GitRunner): Promise<string> {
  const r = await git(['symbolic-ref', '--short', 'HEAD']);
  if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim();
  return 'HEAD';
}

/**
 * Purely-local default-branch discovery (no network) — the pre-existing
 * behavior `assembleBuildReviewInputs` relied on before `resolveFreshBase`
 * existed. Tries, in order: origin/HEAD's symbolic-ref (local ref read),
 * `init.defaultBranch` config, then whichever of `main`/`master` exists as a
 * local branch. Used as the fail-soft fallback so a no-remote/probe-failure
 * degrade never collapses the base to `currentBranch(HEAD)` — that makes
 * `merge-base(base, HEAD) === HEAD` and the grader sees an empty diff.
 */
async function localDefaultBranch(git: GitRunner): Promise<string | null> {
  const originBranch = await originDefaultBranch(git);
  if (originBranch) return originBranch;

  const cfg = await git(['config', '--get', 'init.defaultBranch']);
  if (cfg.exitCode === 0 && cfg.stdout.trim()) return cfg.stdout.trim();

  for (const candidate of ['main', 'master']) {
    const check = await git(['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`]);
    if (check.exitCode === 0) return candidate;
  }

  return null;
}

/**
 * Shared fresh-base resolver (build-review-grades-plan-vs-diff-against-a-stale-o,
 * Task 2). Probes `refs/remotes/origin/<default>` (the local tracking ref, NOT
 * re-fetched) against `git ls-remote origin <default>` (the true remote head)
 * to decide whether a fetch is actually needed:
 *
 *   - shas match → `fresh: true`, no fetch performed.
 *   - shas differ → `fresh: false`; fetches (via `resolveBaseCore`) and
 *     resolves to the freshly-fetched ref, UNLESS `opts.probeOnly` is set, in
 *     which case no fetch happens and the pre-existing tracking ref/kind/branch
 *     shape is returned unchanged.
 *   - any git/network error (no origin, discovery failure, ls-remote failure,
 *     rev-parse failure) → fail-soft to `resolveBaseCore`'s local-fallback
 *     shape, with `trackingRefSha: null`, `remoteHeadSha: null`, `fresh: false`.
 *     Never throws.
 */
export async function resolveFreshBase(
  git: GitRunner,
  opts: { probeOnly?: boolean } = {},
): Promise<FreshBaseResolution> {
  const localBase = await currentBranch(git);

  const failSoft = async (): Promise<FreshBaseResolution> => {
    // Prefer the purely-local default-branch discovery (pre-existing
    // behavior) over `localBase` (the current branch) — using the current
    // branch as the merge-base ref makes merge-base(ref, HEAD) === HEAD,
    // handing the grader an empty diff (build-review-grades-plan-vs-diff-
    // against-a-stale-o retro).
    const fallbackBranch = (await localDefaultBranch(git)) ?? localBase;
    return {
      ref: fallbackBranch,
      kind: 'local',
      branch: fallbackBranch,
      trackingRefSha: null,
      remoteHeadSha: null,
      fresh: false,
    };
  };

  try {
    const remotes = await git(['remote']);
    const hasOrigin = remotes.exitCode === 0 &&
      remotes.stdout.split('\n').map((l) => l.trim()).includes('origin');
    if (!hasOrigin) return failSoft();

    const defaultBranch = await originDefaultBranch(git);
    if (!defaultBranch) return failSoft();

    const trackingRef = await git(['rev-parse', `refs/remotes/origin/${defaultBranch}`]);
    if (trackingRef.exitCode !== 0 || !trackingRef.stdout.trim()) return failSoft();
    const trackingRefSha = trackingRef.stdout.trim();

    const lsRemote = await git(['ls-remote', 'origin', defaultBranch]);
    if (lsRemote.exitCode !== 0) return failSoft();
    const lines = lsRemote.stdout.split('\n');
    const line = lines.find((l) => l.includes(`refs/heads/${defaultBranch}`));
    if (!line) return failSoft();
    const remoteHeadSha = line.split(/\s+/)[0]?.trim();
    if (!remoteHeadSha) return failSoft();

    if (trackingRefSha === remoteHeadSha) {
      return {
        ref: `origin/${defaultBranch}`,
        kind: 'remote',
        branch: defaultBranch,
        trackingRefSha,
        remoteHeadSha,
        fresh: true,
      };
    }

    // Stale: tracking ref lags the true remote head.
    if (opts.probeOnly) {
      return {
        ref: `origin/${defaultBranch}`,
        kind: 'remote',
        branch: defaultBranch,
        trackingRefSha,
        remoteHeadSha,
        fresh: false,
      };
    }

    const fetched = await resolveBaseCore(git, localBase);
    return { ...fetched, trackingRefSha, remoteHeadSha, fresh: false };
  } catch {
    return failSoft();
  }
}

// ── Satisfied predicate (FR-4) ───────────────────────────────────────────────

/**
 * SATISFIED ⇔ the branch is already current with `baseRef`: there are zero
 * commits in `branch..baseRef` (the base has nothing the branch lacks). A
 * genuinely stale branch (base has commits the branch hasn't) is NEVER current.
 */
export async function isBranchCurrent(
  git: GitRunner,
  baseRef: string,
): Promise<boolean> {
  const r = await git(['rev-list', '--count', `HEAD..${baseRef}`]);
  if (r.exitCode !== 0) return false; // unknown ref → not provably current
  return Number.parseInt(r.stdout.trim(), 10) === 0;
}

// ── Path classification (FR-5) ───────────────────────────────────────────────

/**
 * Does a changed path invalidate downstream verification? Only code/test path
 * changes do. Docs-only / CHANGELOG-only changes must NOT invalidate (FR-5
 * resolution of the FR-5×FR-7 overlap). This is a semantic classifier, not an
 * ad-hoc string check.
 */
export function isCodeOrTestPath(path: string): boolean {
  const p = path.trim();
  if (!p) return false;
  // Documentation / metadata that never invalidates build or manual_test.
  if (p === 'CHANGELOG.md') return false;
  if (p.startsWith('.docs/')) return false;
  if (p.startsWith('docs/')) return false;
  if (/(^|\/)README(\.[A-Za-z]+)?$/i.test(p)) return false;
  // Everything else (src/**, test/**, lib/**, config, etc.) is code/test.
  return true;
}

/**
 * Given a `git diff --name-only`-style list, return the subset that are
 * code/test paths (the ones that would invalidate build/manual_test).
 */
export function filterCodeOrTestPaths(paths: string[]): string[] {
  return paths.filter(isCodeOrTestPath);
}

/** The set of paths that differ between two tree-ish refs (name-only). */
export async function changedPathsBetween(
  git: GitRunner,
  fromRef: string,
  toRef: string,
): Promise<string[]> {
  const r = await git(['diff', '--name-only', fromRef, toRef]);
  if (r.exitCode !== 0) return [];
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ── Conflict inspection ──────────────────────────────────────────────────────

/** Files git reports as unmerged (conflicted) during a paused rebase. */
export async function conflictedFiles(git: GitRunner): Promise<string[]> {
  const r = await git(['diff', '--name-only', '--diff-filter=U']);
  if (r.exitCode !== 0) return [];
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Is a rebase paused mid-flight? True when git's rebase state directory
 * (`rebase-merge` or `rebase-apply`) exists for this worktree. This catches an
 * in-progress rebase even when the operator staged the resolution (`git add`)
 * but never ran `git rebase --continue`, so there are no unmerged paths left.
 * `--git-path` resolves the correct dir for linked worktrees too.
 */
export async function rebaseStateActive(
  git: GitRunner,
  projectRoot: string,
): Promise<boolean> {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const r = await git(['rev-parse', '--git-path', name]);
    if (r.exitCode !== 0) continue;
    const p = r.stdout.trim();
    if (!p) continue;
    const abs = isAbsolute(p) ? p : join(projectRoot, p);
    if (await access(abs).then(() => true, () => false)) return true;
  }
  return false;
}

// ── HALT (FR-8) ──────────────────────────────────────────────────────────────

/**
 * Park for a human: write `.pipeline/HALT` listing the conflicted files and the
 * resume procedure. The rebase is LEFT PAUSED (no `--abort`); the caller must
 * not mark the feature processed, continue, or open a PR.
 */
export async function writeHalt(
  projectRoot: string,
  conflicts: string[],
  extraReason?: string,
): Promise<void> {
  const fileList = conflicts.length > 0 ? conflicts.join(', ') : '(unknown)';
  const note =
    `rebase conflict — parked for human resolution\n` +
    (extraReason ? `${extraReason}\n` : '') +
    `Conflicted files: ${fileList}\n\n` +
    `Resume procedure:\n` +
    `  1. Resolve the conflicts in the listed file(s).\n` +
    `  2. git rebase --continue\n` +
    `  3. rm .pipeline/HALT\n` +
    `  4. Re-queue the feature for the daemon.\n`;
  await writeHaltMarker(projectRoot, note, 'needs-human');
}

/** Park a seal refusal that happened before git started a rebase. */
export async function writeSealHalt(projectRoot: string, reason: string): Promise<void> {
  const note =
    `protected-artifact seal error\n` +
    `${reason}\n\n` +
    `Recovery procedure:\n` +
    `  1. Review the protected-artifact diff and confirm the amendment is authorized.\n` +
    `  2. Perform an audited reseal with the engine rotation function.\n` +
    `  3. Clear .pipeline/HALT and .pipeline/HALT.class, then re-queue the feature.\n\n` +
    `This refusal happens before and does not start a git rebase; do not run git rebase --continue.\n`;
  await writeHaltMarker(projectRoot, note, 'needs-human');
}

// ── Outcome model ────────────────────────────────────────────────────────────

export type RebaseOutcome =
  | {
      kind: 'noop';
      /** Complete rebase delta when the base advanced without touching code/test paths. */
      allChangedPaths?: string[];
    }
  | {
      kind: 'mergeable_skip';
      /** The ref the skip decision was taken against, e.g. `origin/main`. */
      baseRef: string;
      /** That ref's resolved sha, or null when it could not be read. */
      baseSha: string | null;
      /** Whether that ref came from origin or from a local branch. */
      baseKind: 'remote' | 'local';
    }
  | {
      kind: 'changed';
      changedCodePaths: string[];
      /** Complete pre-filter rebase delta; absent when the delta is uncomputable. */
      allChangedPaths?: string[];
      featureSurface?: string[];
    }
  | { kind: 'conflict_halt'; conflicts: string[]; reason: string };

/** A protected-artifact refusal raised before git starts a rebase. */
export class ProtectedArtifactSealRejection extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ProtectedArtifactSealRejection';
  }
}

/**
 * Perform the rebase end to end and return a classified outcome. Pure of the
 * conductor's verdict/selector wiring — the caller writes verdicts + events.
 *
 *   noop               → branch already current; nothing to do (FR-4).
 *   mergeable_skip      → behind but cleanly mergeable at normal finish.
 *   changed            → clean rebase that changed code/test paths (FR-5).
 *   conflict_halt      → a conflict or rebase error; rebase left paused.
 */
/**
 * Decide whether a TEXTUALLY clean prospective merge is enough to skip the
 * rebase entirely.
 *
 * `git merge-tree --write-tree --quiet` proves only that the two trees do not
 * collide. It proves nothing about whether this branch's gates — `build_review`
 * grades the plan against the diff, `test_suite` proves an exact tree,
 * `manual_test` exercises runtime behavior — were formed against the base that
 * is actually going to be merged into. Skipping on textual cleanliness alone
 * ships a feature validated against a base that has moved on.
 *
 * Two refusals, both deterministic and both fail-closed:
 *
 *   - **Degraded base.** When origin exists but discovery or `git fetch`
 *     failed, `resolveBase` silently compares against LOCAL `<base>`, which in
 *     a daemon worktree can be arbitrarily far behind origin — so the 'clean'
 *     verdict is meaningless. A repository with genuinely NO origin is not
 *     degraded: its local base is the truth.
 *   - **The base moved in code.** When the base has gained code or test paths
 *     since this branch's merge-base, every gate verdict on this branch predates
 *     them. Rebase and let the existing delta-aware invalidation decide what to
 *     re-verify.
 *
 * An uncomputable merge-base or delta is not skippable: the justification for
 * the skip could not be established, and shipping on an unestablished
 * justification is exactly the failure this guard exists for.
 */
export async function classifyMergeableSkip(
  git: GitRunner,
  base: ResolvedBase,
): Promise<
  | { skippable: true; baseSha: string | null }
  | { skippable: false; reason: 'degraded-base' | 'base-moved-in-code' | 'base-delta-uncomputable' }
> {
  if (isDegradedBase(base)) {
    return { skippable: false, reason: 'degraded-base' };
  }

  const mergeBaseResult = await git(['merge-base', 'HEAD', base.ref]);
  const mergeBase = mergeBaseResult.exitCode === 0 ? mergeBaseResult.stdout.trim() : '';
  if (!mergeBase) {
    return { skippable: false, reason: 'base-delta-uncomputable' };
  }

  let baseDelta: string[];
  try {
    baseDelta = await changedPathsBetween(git, mergeBase, base.ref);
  } catch {
    return { skippable: false, reason: 'base-delta-uncomputable' };
  }
  if (baseDelta.some(isCodeOrTestPath)) {
    return { skippable: false, reason: 'base-moved-in-code' };
  }

  const shaResult = await git(['rev-parse', base.ref]);
  const baseSha = shaResult.exitCode === 0 && shaResult.stdout.trim() ? shaResult.stdout.trim() : null;
  return { skippable: true, baseSha };
}

/** Optional capabilities injectable into `performRebase` (Task 15). */
/**
 * The running feature's `feature_desc`, read from the worktree's own conduct
 * state. Returns undefined when no state file exists or it carries no usable
 * value — a repository with no feature identity is indistinguishable from one
 * whose protected artifacts all belong to other features, and the seal's
 * fail-closed branch is the correct outcome for both.
 */
async function resolveFeatureDesc(projectRoot: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(projectRoot, '.pipeline', 'conduct-state.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { feature_desc?: unknown };
    return typeof parsed.feature_desc === 'string' && parsed.feature_desc.trim()
      ? parsed.feature_desc
      : undefined;
  } catch {
    return undefined;
  }
}

export interface PerformRebaseOpts {
  /**
   * Enables the normal-finish-only prospective-merge policy. Omitted callers
   * retain the mandatory rebase required by recovery/re-kick paths.
   */
  finishMergeabilityCheck?: boolean;

  /**
   * Post-rebase evidence-citation translation (adr-2026-07-12-rebase-evidence-
   * stamp-translation.md), invoked on ANY clean rebase that actually ran
   * (commit shas are rewritten by every real rebase, independent of whether
   * the diff is code-classified as `changed` or `noop`), BEFORE the caller
   * applies rebase verdicts. Absent -> today's behavior, byte-identical no-op
   * (legacy/unit-test callers that don't pass a 4th argument).
   */
  translateAfterRebase?: (
    git: GitRunner,
    projectRoot: string,
    onto: string,
    origHead: string,
    head: string,
  ) => Promise<void>;
}

export async function performRebase(
  git: GitRunner,
  projectRoot: string,
  localBase: string,
  opts?: PerformRebaseOpts,
): Promise<RebaseOutcome> {
  // No usable git work tree (e.g. a non-repo fixture, or git unavailable):
  // degrade to a no-op so the feature still completes (FR-3 spirit) rather
  // than HALTing on a missing remote/repo.
  const inRepo = await git(['rev-parse', '--is-inside-work-tree']);
  if (inRepo.exitCode !== 0 || inRepo.stdout.trim() !== 'true') {
    return { kind: 'noop' };
  }

  // FR-9 (negative path): a rebase already in progress — the operator cleared
  // .pipeline/HALT but did not finish — leaves HEAD detached at the base. That
  // state would otherwise look "current" to isBranchCurrent (HEAD..base == 0)
  // and ship a half-/un-rebased tree. Detect it BEFORE the current-branch check
  // and re-park. We check unmerged paths AND git's rebase state dir, so a
  // staged-but-not-`--continue`d rebase (no unmerged paths) is still caught.
  const preexistingConflicts = await conflictedFiles(git);
  if (preexistingConflicts.length > 0 || (await rebaseStateActive(git, projectRoot))) {
    return {
      kind: 'conflict_halt',
      conflicts: preexistingConflicts,
      reason:
        'rebase already in progress — finish resolving and run `git rebase --continue`, ' +
        'then clear .pipeline/HALT before re-queueing',
    };
  }

  const base = await resolveBase(git, localBase);

  // FR-4: already current → no-op, no re-verification.
  if (await isBranchCurrent(git, base.ref)) {
    return { kind: 'noop' };
  }

  // Normal finish needs merge readiness, while recovery callers need the base
  // commit in their worktree. Only the explicit finish policy may skip a real
  // rebase, and it does so before all rebase-only mutation/preflight work.
  const prospectiveMerge = opts?.finishMergeabilityCheck
    ? await classifyProspectiveMerge(git, base.ref)
    : undefined;
  if (prospectiveMerge === 'clean') {
    const skip = await classifyMergeableSkip(git, base);
    if (skip.skippable) {
      return {
        kind: 'mergeable_skip',
        baseRef: base.ref,
        baseSha: skip.baseSha,
        baseKind: base.kind,
      };
    }
    // Not skippable: fall through to the real rebase below. A textually clean
    // merge rebases cleanly too, so this costs a `changed`/`noop` outcome and a
    // downstream re-verification — never a conflict-resolution loop.
  }
  // A reported conflict (and an indeterminate assessment) deliberately falls
  // through to the established seal, rebase, and bounded resolver path below.

  // A real rebase is about to move HEAD. Verify the durable DECIDE-artifact
  // authority first so a stale or tampered seal fails before history changes.
  // Repositories predating seals retain the legacy rebase behavior.
  try {
    await access(join(projectRoot, PROTECTED_ARTIFACT_SEAL_PATH));
    const verdict = await verifyProtectedArtifactSeal({
      projectRoot,
      // #1379: the #1047 self-amendment tolerance is guarded on this field, so
      // omitting it silently reports a feature's OWN amended DECIDE artifact as
      // a foreign mutation. Resolved here rather than accepted from the caller
      // so no call site can disable the tolerance by forgetting to pass it.
      featureDesc: await resolveFeatureDesc(projectRoot),
      baseBranch: base.branch,
    });
    if (!verdict.ok) throw new ProtectedArtifactSealRejection(verdict.reason);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  // Snapshot the pre-rebase tree before the rebase moves HEAD so clean replay
  // classification and evidence translation can use the original commit.
  const preTree = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const mergeBase = (await git(['merge-base', 'HEAD', base.ref])).stdout.trim();
  const translateCompletedRebase = async (): Promise<void> => {
    if (!opts?.translateAfterRebase) return;
    const ontoSha = (await git(['rev-parse', base.ref])).stdout.trim();
    const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    await opts.translateAfterRebase(git, projectRoot, ontoSha, preTree, head);
  };

  // `--autostash`: a daemon build/lint step can leave uncommitted changes in the
  // worktree (e.g. a formatter dropping an unused import without committing).
  // Plain `git rebase` refuses with "cannot rebase: You have unstaged changes",
  // which surfaces below as a 0-conflict failure and gets mis-parked as a "rebase
  // conflict" the operator can't resolve. Autostash stashes those changes, rebases,
  // and reapplies them — so a clean rebase still succeeds with a dirty tree. (A
  // genuine overlap makes the autostash pop conflict, still caught below.)
  const rebase = await git(['rebase', '--autostash', base.ref]);
  if (rebase.exitCode === 0) {
    const outcome = await classifyClean(git, preTree, mergeBase);
    // Every clean rebase that reaches here rewrites commit shas (the parent
    // changed), regardless of whether classifyClean's code-path heuristic
    // calls it `changed` or `noop` — a docs/config-only rebase still orphans
    // any evidence citation pinned to the pre-rebase shas. Translate
    // unconditionally on any real rebase, not gated on that heuristic.
    await translateCompletedRebase();
    return outcome;
  }

  // Non-zero → conflicts (or another error). Inspect unmerged paths.
  const conflicts = await conflictedFiles(git);
  if (conflicts.length === 0) {
    // No unmerged files but rebase failed — treat as a HALT-worthy error,
    // leaving the rebase in whatever state git left it.
    return {
      kind: 'conflict_halt',
      conflicts: [],
      reason: rebase.stderr.trim() || 'rebase failed without reported conflicts',
    };
  }

  // Any conflict remains paused for the generic resolver or a human.
  return {
    kind: 'conflict_halt',
    conflicts,
    reason: 'rebase conflict requires human resolution',
  };
}

/** Classify a clean rebase by whether it touched any code/test path. */
async function classifyClean(
  git: GitRunner,
  preTree: string,
  mergeBase?: string,
): Promise<RebaseOutcome> {
  // D: the rebase delta (preTree..HEAD). If this diff itself throws (a git
  // process crash, not just a non-zero exit — `changedPathsBetween` already
  // treats a non-zero exit as `[]`), D is uncomputable. A delta-aware
  // decision requires D to be trustworthy — an uncomputable D must never be
  // silently treated as "no code/test paths changed" (that would falsely
  // noop) nor left eligible for delta-aware invalidation. Fail closed by
  // treating it as if code/test paths changed AND forcing featureSurface to
  // undefined, so `applyRebaseVerdicts`/`classifyGateInvalidation` fall back
  // to the fixed invalidation set exactly like an uncomputable F.
  let changed: string[];
  let dUncomputable = false;
  try {
    changed = await changedPathsBetween(git, preTree, 'HEAD');
  } catch {
    changed = [];
    dUncomputable = true;
  }
  const codePaths = filterCodeOrTestPaths(changed);
  if (!dUncomputable && codePaths.length === 0) {
    return { kind: 'noop', allChangedPaths: changed };
  }
  // F: the feature's own claimed surface — files the feature's commits
  // touched, before the rebase (mergeBase..preTree). Threaded onto the
  // outcome for the delta-aware gate-invalidation classifier (Task 6+);
  // this task only computes and carries it through.
  let featureSurface: string[] | undefined;
  if (!dUncomputable && mergeBase) {
    try {
      const r = await git(['diff', '--name-only', mergeBase, preTree]);
      featureSurface =
        r.exitCode !== 0
          ? undefined
          : r.stdout
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
    } catch {
      featureSurface = undefined;
    }
  }
  return {
    kind: 'changed',
    changedCodePaths: codePaths,
    ...(dUncomputable ? {} : { allChangedPaths: changed }),
    featureSurface,
  };
}


// ── Resolution loop (feat/rebase-resolution-skill) ───────────────────────────

export type ResolutionAttempt = (
  { resolved: true } | { resolved: false; reason: string }
) & ProviderAttributionMetadata;
export interface ResolutionContext { conflicts: string[]; projectRoot: string; baseRef: string }
export type RebaseResolver = (ctx: ResolutionContext) => Promise<ResolutionAttempt>;

// ── Setup failure resolution (TS-3 / Task 9) ────────────────────────────────

export type SetupFailureAttempt = { attempted: true } & ProviderAttributionMetadata;
export interface SetupFailureContext { worktreePath: string; outputTail: string; slug: string }
export type SetupFailureResolver = (ctx: SetupFailureContext) => Promise<SetupFailureAttempt>;

// ── CI failure resolution (ci-fix resolver autofix) ─────────────────────────

export type CiFailureAttempt = { attempted: true } & ProviderAttributionMetadata;
export interface CiFailureContext { worktreePath: string; prUrl: string; hint: string; slug: string }
export type CiFailureResolver = (ctx: CiFailureContext) => Promise<CiFailureAttempt>;

/**
 * Was a vanished feature commit's INTENT already realized by the base, rather
 * than lost?
 *
 * A rebase legitimately drops a commit whose work the new base already carries:
 * the replay empties it, either because the change is verbatim upstream or
 * because it conflicted with an upstream edit to the same region that a
 * resolver then settled in the base's favour. Both erase the subject this
 * guard looks for while losing nothing.
 *
 * End-state alone cannot separate that from a `--skip`: after either, HEAD
 * simply holds the base's shape of the region. What separates them is whether
 * the dropped commit's own intent survives — so this compares the commit's
 * diff against HEAD's content of the paths it touched:
 *
 *   - every line the commit ADDED is present in HEAD, and
 *   - no line it REMOVED is back in HEAD
 *
 * The upstream-equivalent fix (both sides delete the same dead code) passes:
 * its removals are gone and it added nothing. A `--skip`'d commit fails: the
 * content it introduced is simply absent.
 *
 * Fails closed — a rename, a binary hunk, or any git failure reports "not
 * superseded" and the HALT stands.
 */
interface DroppedFileEdit {
  oldPath: string | null;
  newPath: string | null;
  added: string[];
  removed: string[];
}

/** Count each line of `content`, trimmed. Blank lines are not counted. */
function lineCounts(content: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/** Split a `git show -U0` body into one record per file it touched. */
function parseDroppedCommitDiff(diff: string): DroppedFileEdit[] | null {
  const edits: DroppedFileEdit[] = [];
  let current: DroppedFileEdit | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { oldPath: null, newPath: null, added: [], removed: [] };
      edits.push(current);
      continue;
    }
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) return null;
    if (current === null || line.startsWith('@@')) continue;
    if (line.startsWith('--- ')) {
      const source = line.slice(4).trim();
      current.oldPath = source === '/dev/null' ? null : source.replace(/^a\//, '');
    } else if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      current.newPath = target === '/dev/null' ? null : target.replace(/^b\//, '');
    } else if (line.startsWith('+')) {
      const body = line.slice(1).trim();
      if (body) current.added.push(body);
    } else if (line.startsWith('-')) {
      const body = line.slice(1).trim();
      if (body) current.removed.push(body);
    }
  }
  return edits;
}

async function supersededByBase(git: GitRunner, sha: string): Promise<boolean> {
  // -U0: hunk bodies carry only the commit's own +/- lines, no context.
  const show = await git(['show', '--format=', '--unified=0', '--no-renames', sha]);
  if (show.exitCode !== 0) return false;
  const edits = parseDroppedCommitDiff(show.stdout);
  if (edits === null) return false;
  // A commit with no diff offers no evidence that its intent survives. Absence
  // of evidence is not supersession: fail closed and let the HALT stand.
  if (edits.length === 0) return false;

  for (const edit of edits) {
    if (edit.newPath === null) {
      // The commit deleted the file: its intent survives only if HEAD has no
      // such file either.
      if (edit.oldPath === null) return false;
      const stillThere = await git(['cat-file', '-e', `HEAD:${edit.oldPath}`]);
      if (stillThere.exitCode === 0) return false;
      continue;
    }

    const head = await git(['show', `HEAD:${edit.newPath}`]);
    if (head.exitCode !== 0) {
      // HEAD dropped the file. Anything the commit added is gone with it; a
      // pure deletion's intent is satisfied.
      if (edit.added.length > 0) return false;
      continue;
    }
    const headCounts = lineCounts(head.stdout);

    // Additions must be present at least as often as the commit introduced them.
    for (const [line, count] of lineCounts(edit.added.join('\n'))) {
      if ((headCounts.get(line) ?? 0) < count) return false;
    }

    // Removals are judged against the commit's OWN parent, not by bare presence:
    // a structural line like `});` legitimately survives elsewhere in the file.
    // What must hold is that HEAD carries no more copies than the removal left.
    if (edit.removed.length === 0) continue;
    const parentPath = edit.oldPath ?? edit.newPath;
    const parent = await git(['show', `${sha}^:${parentPath}`]);
    if (parent.exitCode !== 0) return false;
    const parentCounts = lineCounts(parent.stdout);
    for (const [line, count] of lineCounts(edit.removed.join('\n'))) {
      if ((headCounts.get(line) ?? 0) > (parentCounts.get(line) ?? 0) - count) return false;
    }
  }
  return true;
}

/**
 * Check whether every commit subject from before the rebase is still present in
 * the current `baseRef..HEAD` range. Subject-set membership (not patch-id) lets
 * a conflict resolution legitimately change a commit's diff while keeping its
 * subject; a --skip'd commit loses its subject entirely and is caught here.
 *
 * A missing subject is not lost work on its own: when the base already carries
 * the commit's change, the replay empties it and git drops it. Each missing
 * subject is therefore resolved back to its pre-rebase commit (via `ORIG_HEAD`,
 * the tip git recorded before replaying) and put through {@link supersededByBase}
 * before the guard reports loss. A subject that cannot be resolved fails closed.
 *
 * Empty `subjectsBefore` → true (nothing to lose).
 */
export async function featureCommitsPreserved(
  git: GitRunner,
  baseRef: string,
  subjectsBefore: string[],
): Promise<boolean> {
  if (subjectsBefore.length === 0) return true;
  const r = await git(['log', '--format=%s', `${baseRef}..HEAD`]);
  if (r.exitCode !== 0) return false;
  const currentSubjects = new Set(
    r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0),
  );
  const missing = subjectsBefore.filter((s) => !currentSubjects.has(s));
  if (missing.length === 0) return true;

  // NUL-delimited so a subject containing whitespace still splits correctly.
  const pre = await git(['log', '--format=%H%x00%s', `${baseRef}..ORIG_HEAD`]);
  if (pre.exitCode !== 0) return false;
  const shaBySubject = new Map<string, string>();
  for (const line of pre.stdout.split('\n')) {
    const [sha, subject] = line.split('\0');
    if (!sha?.trim() || subject === undefined) continue;
    // First writer wins: the newest commit carrying a repeated subject.
    if (!shaBySubject.has(subject.trim())) shaBySubject.set(subject.trim(), sha.trim());
  }

  for (const subject of missing) {
    const sha = shaBySubject.get(subject);
    if (!sha) return false;
    if (!(await supersededByBase(git, sha))) return false;
  }
  return true;
}

/**
 * Bounded resolution loop: dispatch `resolver` up to `cap` times attempting to
 * complete the paused rebase in `conflictOutcome`. Returns a reclassified
 * outcome when the resolver succeeds cleanly, or a `conflict_halt` when it
 * fails, gives up, or exhausts the cap.
 *
 * Acceptance guards (applied ONLY after the rebase completes, no retry):
 *   FR-8 isBranchCurrent  — branch must be current with the base it rebased onto.
 *   FR-9 featureCommitsPreserved — every pre-rebase feature commit subject must
 *        survive (catches --skip drops; tolerates diff-changing resolutions).
 *
 * The helper is PURE and git-injected (no event emission, no writeHalt, no
 * config reads). Callers wire those as needed.
 */
export async function resolveRebaseConflicts(
  git: GitRunner,
  projectRoot: string,
  conflictOutcome: RebaseOutcome,
  resolver: RebaseResolver,
  cap: number,
): Promise<RebaseOutcome> {
  // FR-7: cap of 0 disables resolution entirely.
  if (cap <= 0) return conflictOutcome;

  // Capture rebase state BEFORE calling the resolver (the --continue that
  // completes the rebase will remove the state directory).
  let onto: string | null = null;
  for (const name of ['rebase-merge/onto', 'rebase-apply/onto']) {
    const r = await git(['rev-parse', '--git-path', name]);
    if (r.exitCode !== 0) continue;
    const filePath = r.stdout.trim();
    if (!filePath) continue;
    const absPath = isAbsolute(filePath) ? filePath : join(projectRoot, filePath);
    try {
      const content = await readFile(absPath, 'utf-8');
      onto = content.trim();
      break;
    } catch {
      // file does not exist yet — try the next state dir name
    }
  }

  if (onto === null) {
    // Not actually mid-rebase — nothing to do.
    return conflictOutcome;
  }

  // The rebase state retains ORIG_HEAD while paused: it is the feature tip
  // before replay began. Its merge-base with `onto` is the base before the
  // advance, which lets the resolved outcome describe the complete base
  // advance rather than the replayed feature patch.
  const preAdvanceBaseResult = await git(['merge-base', 'ORIG_HEAD', onto]);
  const preAdvanceBase = preAdvanceBaseResult.stdout.trim();
  if (preAdvanceBaseResult.exitCode !== 0 || !preAdvanceBase) {
    return {
      kind: 'conflict_halt',
      conflicts: conflictOutcome.kind === 'conflict_halt' ? conflictOutcome.conflicts : [],
      reason: 'could not derive the pre-advance base for resolved rebase classification',
    };
  }

  // Feature commit subjects that must survive: all commits in <onto>..ORIG_HEAD.
  // ORIG_HEAD is the pre-rebase feature tip (set by git before it starts replaying).
  const subjR = await git(['log', '--format=%s', `${onto}..ORIG_HEAD`]);
  const subjectsBefore =
    subjR.exitCode === 0
      ? subjR.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
      : [];

  // Use the conflict list already captured in the outcome (avoids a redundant
  // git call and is consistent with the snapshot at conflict time).
  const conflicts =
    conflictOutcome.kind === 'conflict_halt'
      ? conflictOutcome.conflicts
      : await conflictedFiles(git);

  for (let attempt = 1; attempt <= cap; attempt++) {
    // Refresh the conflicted-file list each attempt: a multi-patch rebase can
    // pause again on a DIFFERENT set of files after a partial `--continue`, so a
    // retry must see the current conflicts, not the snapshot from conflict time.
    const attemptConflicts = await conflictedFiles(git);
    const ctxConflicts = attemptConflicts.length > 0 ? attemptConflicts : conflicts;
    const result = await resolver({ conflicts: ctxConflicts, projectRoot, baseRef: onto });

    if (!result.resolved) {
      // FR-6: resolver gave up — short-circuit, no further attempts.
      return {
        kind: 'conflict_halt',
        conflicts,
        reason: (result as { resolved: false; reason: string }).reason || 'resolver gave up',
      };
    }

    // result.resolved === true — check whether the rebase actually finished.
    const stillActive = await rebaseStateActive(git, projectRoot);
    const currentConflicts = await conflictedFiles(git);
    if (stillActive || currentConflicts.length > 0) {
      // Rebase did NOT complete — count as a failed attempt and retry.
      continue;
    }

    // Rebase completed. Run acceptance guards (NO retry on failure — a
    // completed-but-bad rebase is a definitive rejection, not a transient error).

    // FR-8: branch must be current with the base it rebased onto.
    if (!(await isBranchCurrent(git, onto))) {
      return {
        kind: 'conflict_halt',
        conflicts,
        reason: 'rebase resolution left the branch not current with base',
      };
    }

    // FR-9: every pre-rebase feature commit subject must still be present.
    if (!(await featureCommitsPreserved(git, onto, subjectsBefore))) {
      return {
        kind: 'conflict_halt',
        conflicts,
        reason: 'rebase resolution dropped feature commit(s)',
      };
    }

    // Both guards pass — classify the complete base advance, not `onto..HEAD`:
    // that latter range is the replayed feature patch and omits base-only
    // changes while incorrectly including feature-only ones. Unlike the
    // general helper, a failed diff here cannot be treated as an empty delta:
    // doing so would falsely return noop after a completed resolution.
    let allChangedPaths: string[];
    try {
      const delta = await git(['diff', '--name-only', preAdvanceBase, onto]);
      if (delta.exitCode !== 0) {
        return { kind: 'changed', changedCodePaths: [] };
      }
      allChangedPaths = delta.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch {
      return { kind: 'changed', changedCodePaths: [] };
    }
    const changedCodePaths = filterCodeOrTestPaths(allChangedPaths);
    return changedCodePaths.length > 0
      ? { kind: 'changed', changedCodePaths, allChangedPaths }
      : { kind: 'noop', allChangedPaths };
  }

  // All cap attempts consumed without the rebase completing.
  return {
    kind: 'conflict_halt',
    conflicts,
    reason: `rebase resolution failed after ${cap} attempt(s)`,
  };
}

/**
 * Gated wrapper around {@link resolveRebaseConflicts}. This is the piece of the
 * daemon's rebase mechanism that BOTH `conductor.ts`'s finish-time `runRebaseStep`
 * and `daemon-rekick.ts`'s FR-12 play-forward `resumeRebaseFirst` must share so a
 * conflict reached on EITHER path gets the same bounded automated `/rebase`
 * resolution before a human HALT (#300 — the play-forward path previously wrote a
 * bare HALT on the first conflict).
 *
 *   - A non-`conflict_halt` outcome passes through untouched.
 *   - `cap <= 0` or no `resolve` fn → the conflict is returned unchanged (FR-7);
 *     the caller writes the HALT, exactly the pre-resolution behavior.
 *   - Otherwise `resolve` is dispatched up to `cap` times; a throwing `resolve`
 *     degrades to a failed attempt (→ eventual HALT) and never propagates.
 *
 * Event emission stays at the call site via the optional `onAttempt` / `onSettled`
 * callbacks so this helper preserves `rebase.ts`'s "pure, git-injected, no event
 * coupling" contract. A throwing callback is swallowed (best-effort observability
 * must never block resolution).
 */
export async function runGatedRebaseResolution(opts: {
  git: GitRunner;
  projectRoot: string;
  outcome: RebaseOutcome;
  cap: number;
  resolve?: RebaseResolver;
  /** Fired before each resolver dispatch with the 1-based attempt index + cap. */
  onAttempt?: (index: number, cap: number) => void | Promise<void>;
  /** Fired once after the loop settles: `succeeded` (rebase completed) or `exhausted`. */
  onSettled?: (kind: 'succeeded' | 'exhausted') => void | Promise<void>;
}): Promise<RebaseOutcome> {
  const { git, projectRoot, outcome, cap, resolve, onAttempt, onSettled } = opts;
  if (outcome.kind !== 'conflict_halt') return outcome;
  if (cap <= 0 || !resolve) return outcome;

  let attempt = 0;
  const countingResolver: RebaseResolver = async (ctx) => {
    attempt += 1;
    if (onAttempt) {
      try {
        await onAttempt(attempt, cap);
      } catch {
        /* best-effort: observability must not block resolution */
      }
    }
    try {
      return await resolve(ctx);
    } catch (err) {
      return { resolved: false, reason: err instanceof Error ? err.message : String(err) };
    }
  };

  const resolved = await resolveRebaseConflicts(git, projectRoot, outcome, countingResolver, cap);
  if (onSettled) {
    try {
      await onSettled(resolved.kind === 'conflict_halt' ? 'exhausted' : 'succeeded');
    } catch {
      /* best-effort */
    }
  }
  return resolved;
}

// ── Verdict + event wiring (consumed by the conductor) ───────────────────────

/**
 * Write the gate verdicts implied by a rebase outcome and return whether the
 * rebase gate itself is satisfied (→ proceed to finish) or the loop must HALT.
 *
 *   noop / mergeable_skip → rebase satisfied (no downstream invalidation).
 *   changed                   → rebase satisfied, BUT downstream gates
 *                               (build, + manual_test if it ran) are kicked
 *                               back unsatisfied so the loop re-verifies.
 *   conflict_halt             → rebase NOT satisfied; caller writes HALT.
 */
export async function applyRebaseVerdicts(
  projectRoot: string,
  outcome: RebaseOutcome,
  ranManualTest: boolean,
  preVerify?: (step: StepName) => Promise<{ done: boolean; reason?: string }>,
): Promise<{ satisfied: boolean; kickedBack: StepName[]; reverified: StepName[] }> {
  if (outcome.kind === 'conflict_halt') {
    await writeVerdict(projectRoot, 'rebase', {
      satisfied: false,
      reason: `rebase conflict: ${outcome.reason}`,
      checkedAt: Date.now(),
    });
    return { satisfied: false, kickedBack: [], reverified: [] };
  }

  // rebase gate is satisfied (branch now current with base).
  const satisfiedVerdict: GateVerdict = {
    satisfied: true,
    reason:
      outcome.kind === 'noop'
        ? 'branch already current with base'
        : outcome.kind === 'mergeable_skip'
          ? `branch is mergeable with ${outcome.baseRef}@${outcome.baseSha ?? 'unknown'} ` +
            `(${outcome.baseKind}), which has no code/test changes since the merge-base; rebase skipped`
        : outcome.kind === 'changed' && outcome.featureSurface === undefined
          ? 'rebased onto base (code changed — feature surface F uncomputable, fail-closed to legacy invalidate-all)'
          : 'rebased onto base (code changed — downstream re-verify)',
    checkedAt: Date.now(),
  };
  await writeVerdict(projectRoot, 'rebase', satisfiedVerdict);

  if (outcome.kind !== 'changed') {
    return { satisfied: true, kickedBack: [], reverified: [] };
  }

  // FR-5: code/test paths changed → invalidate downstream gates kickback-shaped.
  const evidence =
    `rebase changed code/test paths: ${outcome.changedCodePaths.slice(0, 5).join(', ')}` +
    (outcome.changedCodePaths.length > 5
      ? ` (+${outcome.changedCodePaths.length - 5} more)`
      : '');
  const kickedBack: StepName[] = [];
  const reverified: StepName[] = [];

  // Task 3: Pre-verify pass confirms build with a fresh objective verdict.
  // When preVerify('build') returns { done: true }, the build gate is confirmed
  // to be still satisfied (evidence-intact after file-changing rebase), so write
  // a fresh objective verdict and add it to reverified instead of kickedBack.
  let buildReVerified = false;
  if (preVerify) {
    try {
      const buildPreVerify = await preVerify('build');
      if (buildPreVerify.done) {
        // Pre-verify succeeded — build is evidence-intact, write fresh verdict.
        await writeVerdict(projectRoot, 'build', {
          satisfied: true,
          reason: 're-verified mechanically after file-changing rebase — evidence remains intact',
          checkedAt: Date.now(),
        });
        reverified.push('build');
        buildReVerified = true;
      }
    } catch {
      // Task 5: preVerify throw → fail-closed, no error escapes.
      // Error is caught here; buildReVerified stays false, allowing normal
      // kickback verdict write (lines below) to handle build as invalidated.
    }
  }

  // test_suite forms the deterministic BUILD gate after build; build_review
  // follows it. A file-changing rebase can stale
  // any of those proofs, so each must be invalidated before SHIP can resume.
  // Task 6 (ADR-2026-07-20): when the feature's claimed surface (F) is
  // available, select the invalidation set via classifyGateInvalidation
  // instead of the fixed set — a delta that never touches the feature's own
  // runtime source (only foreign runtime, or test/docs paths) preserves the
  // feature-runtime-scoped judged gates (prd_audit,
  // architecture_review_as_built) rather than blindly re-opening them.
  //
  // Fallback (Tasks 10-11 harden this further): if `featureSurface` is
  // missing on the outcome, F is uncomputable — fall back to the FULL
  // legacy invalidate-all set as a safe default rather than guess. Per the
  // ADR's fail-closed invariant, this must cover every judged gate this
  // feature's classifier can invalidate — not just the pre-#655 fixed four
  // — or a gate whose surface can't be proven to miss the delta would be
  // silently left un-re-verified (prd_audit/architecture_review_as_built
  // included).
  const targets: StepName[] =
    outcome.featureSurface !== undefined
      ? ([
          'build',
          ...classifyGateInvalidation(outcome.changedCodePaths, outcome.featureSurface, ranManualTest)
            .invalidated,
        ] as StepName[])
      : ranManualTest
        ? ([
            'build',
            'test_suite',
            'build_review',
            'manual_test',
            'prd_audit',
            'architecture_review_as_built',
          ] as StepName[])
        : ([
            'build',
            'test_suite',
            'build_review',
            'prd_audit',
            'architecture_review_as_built',
          ] as StepName[]);
  for (const target of targets) {
    // Skip build if it was pre-verified (already wrote verdict above).
    if (target === 'build' && buildReVerified) {
      continue;
    }
    await writeVerdict(projectRoot, target, {
      satisfied: false,
      reason: 'invalidated by file-changing rebase',
      checkedAt: Date.now(),
      kickback: { from: 'rebase', evidence },
    });
    kickedBack.push(target);
  }
  return { satisfied: true, kickedBack, reverified };
}

/**
 * Record rebase-step completion in engine state (#436 refactor).
 *
 * A rebase outcome is "done" for state-recording purposes whenever
 * `applyRebaseVerdicts` wrote a satisfied gate verdict — i.e. every outcome
 * kind except `conflict_halt` (noop / changed leave
 * the branch current with base). A `conflict_halt` outcome parks the step for
 * human resolution and must NOT be stamped `done` — the gate stays
 * unsatisfied and a resumed run needs to re-attempt the rebase.
 *
 * Shared by the in-loop `runRebaseStep` (conductor.ts) and the pre-loop
 * `resumeRebaseFirst` re-kick path (daemon-rekick.ts) so both call sites
 * record identically instead of drifting (#436).
 */
export async function recordRebaseStepCompletion(
  stateFilePath: string,
  outcome: RebaseOutcome,
): Promise<void> {
  if (outcome.kind === 'conflict_halt') return;
  await saveStepStatus(stateFilePath, 'rebase', 'done');
}

/**
 * Emit a `rebase_gate_invalidated` or `rebase_gate_preserved` event for
 * every judged gate `classifyGateInvalidation` classified (Tasks 8-9,
 * ADR-2026-07-20).
 *
 * For invalidated gates, `matchedPaths` carries only the delta paths that
 * justify invalidating THIS specific gate, per its `GATE_SURFACE` kind:
 *   - 'feature-runtime' (prd_audit, architecture_review_as_built): featureSrc.
 *   - 'feature-codetest' (build_review): featureSrc ∪ the feature's own test
 *     paths.
 *   - 'all-runtime' (manual_test): featureSrc ∪ foreignSrc.
 *   - 'any-codetest' (test_suite): the full delta (test ∪ featureSrc ∪
 *     foreignSrc).
 *
 * For preserved gates, `surface` is the gate's DECLARED dependency surface
 * (non-empty — what the gate depends on, per the ADR decision table), not
 * the (empty, by construction) intersection with the delta — a preserved
 * gate still has a real declared surface, it simply wasn't hit. For
 * 'feature-runtime' kind this is `F ∩ runtime` (the feature's own runtime
 * paths) and for 'feature-codetest' it is `F ∩ (runtime ∪ test)`; for
 * 'all-runtime'/'any-codetest' kind — whose declared surface is
 * the whole runtime tree and isn't a finite path list derivable from this
 * rebase's delta — a descriptive sentinel is used instead.
 * `deltaConsidered` carries the same per-kind matched-path computation as
 * `matchedPaths` above (empty for a preserved gate, by construction — that
 * emptiness is precisely why it was preserved).
 *
 * A no-op when the outcome isn't a file-changing rebase, or `featureSurface`
 * is unavailable (classifyGateInvalidation cannot be applied — see the
 * fixed-set fallback in applyRebaseVerdicts).
 */
export async function emitGateInvalidationEvents(
  events: ConductorEventEmitter,
  outcome: RebaseOutcome,
  ranManualTest: boolean,
): Promise<void> {
  if (outcome.kind !== 'changed' || outcome.featureSurface === undefined) return;

  const { invalidated, preserved } = classifyGateInvalidation(
    outcome.changedCodePaths,
    outcome.featureSurface,
    ranManualTest,
  );
  const { test, featureSrc, foreignSrc } = partitionDelta(
    outcome.changedCodePaths,
    outcome.featureSurface,
  );

  const featureTest = featureTestPaths(outcome.changedCodePaths, outcome.featureSurface);

  const matchedPathsFor = (gate: string): string[] => {
    const surface = GATE_SURFACE[gate];
    return surface === 'feature-runtime'
      ? featureSrc
      : surface === 'feature-codetest'
        ? [...featureSrc, ...featureTest]
        : surface === 'all-runtime'
          ? [...featureSrc, ...foreignSrc]
          : [...test, ...featureSrc, ...foreignSrc];
  };

  // Declared dependency surface (what the gate depends on) — distinct from
  // matchedPathsFor's delta-intersection. Non-empty even when the gate is
  // preserved (it always has real inputs; it just wasn't hit this rebase).
  const featureRuntimeSurface = outcome.featureSurface.filter(isRuntimeSourcePath);
  const featureCodeTestSurface = outcome.featureSurface.filter(
    (p) => isRuntimeSourcePath(p) || isTestPath(p),
  );
  const declaredSurfaceFor = (gate: string): string[] => {
    const surface = GATE_SURFACE[gate];
    if (surface === 'feature-runtime') return featureRuntimeSurface;
    if (surface === 'feature-codetest') return featureCodeTestSurface;
    return ['<all runtime source>'];
  };

  for (const gate of invalidated) {
    await events.emit({
      type: 'rebase_gate_invalidated',
      gate: gate as StepName,
      matchedPaths: matchedPathsFor(gate),
    });
  }

  for (const gate of preserved) {
    await events.emit({
      type: 'rebase_gate_preserved',
      gate: gate as StepName,
      surface: declaredSurfaceFor(gate),
      deltaConsidered: matchedPathsFor(gate),
    });
  }
}

/** Map a rebase outcome to its structured event. Best-effort emission. */
export async function emitRebaseEvent(
  events: ConductorEventEmitter,
  outcome: RebaseOutcome,
): Promise<void> {
  try {
    switch (outcome.kind) {
      case 'noop':
        await events.emit(
          outcome.allChangedPaths === undefined
            ? { type: 'rebase_noop' }
            : {
                type: 'rebase_changed',
                changedPaths: [],
                allChangedPaths: outcome.allChangedPaths,
              },
        );
        break;
      case 'mergeable_skip':
        await events.emit({
          type: 'rebase_mergeable_skip',
          baseRef: outcome.baseRef,
          baseSha: outcome.baseSha,
          baseKind: outcome.baseKind,
        });
        break;
      case 'changed':
        await events.emit({
          type: 'rebase_changed',
          changedPaths: outcome.changedCodePaths,
          ...(outcome.allChangedPaths === undefined
            ? {}
            : { allChangedPaths: outcome.allChangedPaths }),
        });
        break;
      case 'conflict_halt':
        await events.emit({
          type: 'rebase_conflict_halt',
          reason: outcome.reason,
          conflicts: outcome.conflicts,
        });
        break;
    }
  } catch {
    /* best-effort: event failure must not affect the rebase result */
  }
}

// ── .docs keep-both resolver ────────────────────────────────────────────────

/**
 * Deterministic resolver for .docs/ conflicts: keep both sides of add/add or
 * rename/rename conflicts by preserving both versions with distinct names,
 * then stage and continue the rebase.
 *
 * STRICT SCOPE: Only processes add/add and rename/rename conflicts within .docs/.
 * Rejects:
 *   - Any conflict outside .docs/
 *   - Edit conflicts (content collision on same file)
 *   - Mixed scenarios (some .docs/, some non-.docs/)
 *
 * Returns {resolved: true} when all .docs/ conflicts are kept-both resolved
 * and the rebase --continue succeeds. Returns {resolved: false, reason} if
 * any conflict is out of scope or if rebase --continue fails.
 */
export const docsKeepBothResolver: RebaseResolver = async (ctx) => {
  const { conflicts, projectRoot, baseRef } = ctx;

  // Only resolve .docs/ conflicts; anything else is not our domain.
  if (!conflicts.every((f) => f.startsWith('.docs/'))) {
    return { resolved: false, reason: 'non-.docs/ conflicts cannot be keep-both resolved' };
  }

  const git = makeGitRunner(projectRoot);

  try {
    // Resolve each .docs/ conflict by keeping both sides.
    // For rename/rename conflicts, multiple paths might be in the conflicts list but belong
    // to the same conflict (original file + both renamed versions). We process them and then
    // use git add -A to stage everything in .docs/.
    for (const conflictedFile of conflicts) {
      await resolveDocsConflictKeepBoth(git, projectRoot, conflictedFile);
    }

    // Stage all changes in .docs/ directory (covers add/add and rename/rename resolutions).
    const stageResult = await git(['add', '-A', '.docs/']);
    if (stageResult.exitCode !== 0) {
      return { resolved: false, reason: 'failed to stage resolved .docs/ files' };
    }

    // Continue the rebase.
    const cont = await git(['-c', 'core.editor=true', 'rebase', '--continue']);
    if (cont.exitCode !== 0) {
      return { resolved: false, reason: 'rebase --continue failed after .docs keep-both resolution' };
    }

    return { resolved: true };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    // Distinguish between scope rejections (edit conflicts) and unexpected errors.
    if (errorMsg.includes('edit conflict')) {
      return {
        resolved: false,
        reason: `${errorMsg} — not in keep-both scope`,
      };
    }
    return { resolved: false, reason: `unexpected error during .docs resolution: ${errorMsg}` };
  }
};

/**
 * Resolve a single .docs/ conflict by keeping both versions. Handles ONLY:
 *   - add/add: write both stage 2 and stage 3 to distinct filenames
 *   - rename/rename: both renamed versions already distinct, just keep both
 *
 * REJECTS:
 *   - edit conflicts: same file with common ancestor, both sides edited content
 *   - delete/edit or other asymmetric conflicts
 *
 * Throws an error if the conflict is not add/add or rename/rename.
 * Returns the paths of resolved files to be staged (for valid conflicts only).
 */
async function resolveDocsConflictKeepBoth(
  git: GitRunner,
  projectRoot: string,
  conflictedFile: string,
): Promise<string[]> {
  const resolvedPaths: string[] = [];

  // Get the unmerged status to determine conflict type.
  const statusR = await git(['ls-files', '--stage', conflictedFile]);
  const stages = statusR.stdout
    .trim()
    .split('\n')
    .filter((l) => l.length > 0);

  if (stages.length === 0) {
    // File not in index — shouldn't happen, but no-op.
    return resolvedPaths;
  }

  // Parse stages: each line is "mode hash stage\tpath"
  // Stages: 1 = common ancestor, 2 = ours (base), 3 = theirs (feature).
  const stageMap = new Map<number, string>();
  for (const line of stages) {
    const m = line.match(/^(\d+)\s+[0-9a-f]+\s+(\d+)\t(.+)$/);
    if (m) {
      const stage = parseInt(m[2], 10);
      const path = m[3];
      stageMap.set(stage, path);
    }
  }

  // Determine the conflict type by which stages are present.
  const hasStage1 = stageMap.has(1);
  const hasStage2 = stageMap.has(2);
  const hasStage3 = stageMap.has(3);

  if (!hasStage2 || !hasStage3) {
    // Not a typical conflict with both sides — shouldn't happen.
    return resolvedPaths;
  }

  if (!hasStage1) {
    // add/add conflict: both sides added the file, no common ancestor.
    // Write both versions with suffixes to distinguish them.
    const { dir, name, ext } = parsePath(conflictedFile);
    const base2 = await git(['show', `:2:${conflictedFile}`]);
    const base3 = await git(['show', `:3:${conflictedFile}`]);

    if (base2.exitCode === 0 && base3.exitCode === 0) {
      const path2 = join(dir, `${name}~ours${ext}`);
      const path3 = join(dir, `${name}~theirs${ext}`);
      await writeFile(join(projectRoot, path2), base2.stdout, 'utf-8');
      await writeFile(join(projectRoot, path3), base3.stdout, 'utf-8');
      resolvedPaths.push(path2, path3);
      // Remove the conflicted entry itself from the index.
      await git(['rm', conflictedFile]);
    }
  } else {
    // hasStage1 = true: either edit conflict or rename/rename.
    // Distinguish: rename/rename has stage2Path !== stage3Path; edit conflict has them equal.
    const stage2Path = stageMap.get(2);
    const stage3Path = stageMap.get(3);

    // If stage 2 and stage 3 point to the same path, it's an edit conflict → reject.
    if (stage2Path === stage3Path) {
      throw new Error(
        `edit conflict (content divergence) in ${conflictedFile} — keep-both can only resolve add/add or rename/rename`,
      );
    }

    // rename/rename conflict: both sides renamed the same file differently.
    if (stage2Path && stage3Path) {
      // Extract the content from both stages.
      const stage2Content = await git(['show', `:2:${conflictedFile}`]);
      const stage3Content = await git(['show', `:3:${conflictedFile}`]);

      // If the git show commands fail, try using the renamed paths directly.
      let content2: string = '';
      let content3: string = '';

      if (stage2Content.exitCode === 0) {
        content2 = stage2Content.stdout;
      } else {
        // Fallback: try to read from the renamed path in the index
        const fallback2 = await git(['show', `:2:${stage2Path}`]);
        if (fallback2.exitCode === 0) content2 = fallback2.stdout;
      }

      if (stage3Content.exitCode === 0) {
        content3 = stage3Content.stdout;
      } else {
        // Fallback: try to read from the renamed path in the index
        const fallback3 = await git(['show', `:3:${stage3Path}`]);
        if (fallback3.exitCode === 0) content3 = fallback3.stdout;
      }

      // Write both versions to their renamed paths if we have content.
      if (content2 || content3) {
        if (content2) {
          await writeFile(join(projectRoot, stage2Path), content2, 'utf-8');
          resolvedPaths.push(stage2Path);
        }
        if (content3) {
          await writeFile(join(projectRoot, stage3Path), content3, 'utf-8');
          resolvedPaths.push(stage3Path);
        }
        // Remove the original conflicted file from the index.
        await git(['rm', '--cached', conflictedFile]);
      }
    }
  }

  return resolvedPaths;
}

/** Parse a path into {dir, name, ext} for suffix manipulation. */
function parsePath(path: string): { dir: string; name: string; ext: string } {
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : '.';
  const file = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;

  const lastDot = file.lastIndexOf('.');
  const name = lastDot >= 0 ? file.slice(0, lastDot) : file;
  const ext = lastDot >= 0 ? file.slice(lastDot) : '';

  return { dir, name, ext };
}

// ── Tier 1 resolver driver ──────────────────────────────────────────────────

/**
 * Tier 1 deterministic resolution driver for safe .docs/ keep-both conflicts
 * on a paused rebase.
 *
 * Returns {resolved: string[], remaining: string[]} tracking which conflicted
 * files were resolved and which remain. A file is considered resolved if:
 *   - It was in the original conflict list AND
 *   - A resolver successfully handled it (staged the resolution)
 *
 * Strategy: Stage all resolvable conflicts, then attempt ONE rebase --continue.
 * If it succeeds, all staged files are considered resolved. If it fails
 * (due to unresolvable conflicts), we keep the staging and report what was
 * attempted. The rebase remains paused with a mix of staged + unstaged conflicts.
 *
 * Operates in one pass:
 *   1. Identify .docs/ conflicts and attempt resolution (stage only, no continue)
 *   2. Attempt ONE rebase --continue
 *   3. Check what conflicts remain
 */
export async function runTier1(
  git: GitRunner,
  projectRoot: string,
): Promise<{ resolved: string[]; remaining: string[] }> {
  const originalConflicts = await conflictedFiles(git);

  // If no conflicts, nothing to do.
  if (originalConflicts.length === 0) {
    return { resolved: [], remaining: [] };
  }

  const staged: string[] = [];

  // Attempt to stage .docs/ resolutions for .docs/ conflicts.
  const docsConflicts = originalConflicts.filter((f) => f.startsWith('.docs/'));
  if (docsConflicts.length > 0) {
    const docsStaged = await tier1StageDocsKeepBoth(git, projectRoot, docsConflicts);
    if (docsStaged) {
      staged.push(...docsConflicts);
    }
  }

  // If nothing was staged, nothing was resolved.
  if (staged.length === 0) {
    return { resolved: [], remaining: originalConflicts };
  }

  // Attempt to continue the rebase with staged resolutions.
  const cont = await git(['-c', 'core.editor=true', 'rebase', '--continue']);
  const continueSucceeded = cont.exitCode === 0;

  // If --continue succeeded, the rebase advanced (either completed or paused on new conflicts).
  // All staged files are considered resolved.
  if (continueSucceeded) {
    const remaining = await conflictedFiles(git);
    return { resolved: staged, remaining };
  }

  // If --continue failed (e.g., new conflicts surfaced), the staged files are still staged
  // but the rebase didn't advance. Report them as attempted (staged) but not fully resolved.
  const finalConflicts = await conflictedFiles(git);
  return { resolved: staged, remaining: finalConflicts };
}

/**
 * Attempt to stage .docs/ conflict resolutions using the keep-both resolver.
 * Resolves all .docs/ conflicts at once by keeping both sides of add/add
 * and rename/rename conflicts, and stages the results.
 * Does NOT run rebase --continue.
 *
 * Returns true if all .docs/ conflicts were staged, false if any conflict
 * is out of scope.
 */
async function tier1StageDocsKeepBoth(
  git: GitRunner,
  projectRoot: string,
  docsConflicts: string[],
): Promise<boolean> {
  try {
    // Resolve each .docs/ conflict.
    for (const conflictedFile of docsConflicts) {
      await resolveDocsConflictKeepBoth(git, projectRoot, conflictedFile);
    }

    // Stage all changes in .docs/.
    const stageResult = await git(['add', '-A', '.docs/']);
    if (stageResult.exitCode !== 0) return false;

    return true;
  } catch {
    // Any error (edit conflict, unexpected state) → resolver cannot proceed.
    return false;
  }
}
