import { execa } from 'execa';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import type { StepName } from '../types/index.js';
import { writeVerdict, type GateVerdict } from './gate-verdicts.js';
import { writeHaltMarker } from './halt-marker.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import { withEngineCommitEnv } from './engine-commit-env.js';
import { saveStepStatus } from './state.js';
import { classifyGateInvalidation, partitionDelta, GATE_SURFACE } from './gate-invalidation.js';

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
 */
export async function resolveBase(
  git: GitRunner,
  localBase: string,
): Promise<ResolvedBase> {
  // Is there an `origin` remote at all?
  const remotes = await git(['remote']);
  const hasOrigin = remotes.exitCode === 0 &&
    remotes.stdout.split('\n').map((l) => l.trim()).includes('origin');
  if (!hasOrigin) {
    return { ref: localBase, kind: 'local', branch: localBase };
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
    return { ref: localBase, kind: 'local', branch: localBase };
  }

  // Fetch the default branch. A failed fetch degrades to the caller's local
  // base (FR-3): remote-less/unreachable repos must still complete, not HALT.
  // Use `localBase` (a known-existing local branch) rather than the bare origin
  // default name, which may not exist locally — consistent with the no-origin
  // and discovery-failed fallbacks above.
  const fetched = await git(['fetch', 'origin', defaultBranch]);
  if (fetched.exitCode !== 0) {
    return { ref: localBase, kind: 'local', branch: localBase };
  }
  return { ref: `origin/${defaultBranch}`, kind: 'remote', branch: defaultBranch };
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
  if (/\.(md|mdx|txt|rst)$/i.test(p)) return false;
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

// ── CHANGELOG auto-resolution (FR-7) ─────────────────────────────────────────

const CHANGELOG = 'CHANGELOG.md';
const UNRELEASED_HEADING = /^##\s+\[Unreleased\]/im;

/**
 * Extract THIS feature's additions to the `## [Unreleased]` block as the list
 * of lines present in `headContent` but not in `baseContent`. Captured from
 * base..HEAD BEFORE rebasing so they can be re-appended after taking the base
 * version on conflict. Only `[Unreleased]`-block lines are considered.
 */
export function unreleasedAdditions(
  baseContent: string,
  headContent: string,
): string[] {
  const baseBlock = unreleasedBlockLines(baseContent);
  const headBlock = unreleasedBlockLines(headContent);
  const baseSet = new Set(baseBlock.map((l) => l.trim()));
  // This feature's net-new content lines (ignore blanks/section headings).
  return headBlock.filter((line) => {
    const t = line.trim();
    if (t.length === 0) return false;
    if (/^#{2,3}\s/.test(t)) return false; // skip nested headings like ### Added
    return !baseSet.has(t);
  });
}

/** Lines inside the `## [Unreleased]` block, up to the next `## ` heading. */
function unreleasedBlockLines(content: string): string[] {
  const lines = content.split('\n');
  const out: string[] = [];
  let capturing = false;
  for (const line of lines) {
    if (UNRELEASED_HEADING.test(line)) {
      capturing = true;
      continue;
    }
    if (capturing && /^##\s+/.test(line)) break; // next top-level section
    if (capturing) out.push(line);
  }
  return out;
}

/**
 * Produce the resolved CHANGELOG: the base/upstream version plus this
 * feature's `[Unreleased]` additions re-appended exactly once. Returns null
 * when the safe append cannot be applied (no `[Unreleased]` block in the base
 * → conflict is structurally outside the block → caller HALTs).
 */
export function buildResolvedChangelog(
  baseContent: string,
  featureAdditions: string[],
): string | null {
  if (!UNRELEASED_HEADING.test(baseContent)) return null;

  const baseBlock = unreleasedBlockLines(baseContent);
  const present = new Set(baseBlock.map((l) => l.trim()));
  // Dedup: only append additions the base doesn't already contain (no false
  // negative = no duplicate block; no false positive = nothing dropped).
  const toAppend = featureAdditions.filter((l) => !present.has(l.trim()));
  if (toAppend.length === 0) return baseContent;

  const lines = baseContent.split('\n');
  // Find the end of the [Unreleased] block (first `## ` after the heading, or EOF).
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (UNRELEASED_HEADING.test(lines[i])) {
      headingIdx = i;
      break;
    }
  }
  let insertAt = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      insertAt = i;
      break;
    }
  }
  // Trim a single trailing blank line inside the block so appends stay tidy.
  let tail = insertAt;
  while (tail > headingIdx + 1 && lines[tail - 1].trim() === '') tail--;
  const before = lines.slice(0, tail);
  const after = lines.slice(insertAt);
  const block = [...before, ...toAppend, '', ...after];
  return block.join('\n');
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
  await writeHaltMarker(projectRoot, note);
}

// ── Outcome model ────────────────────────────────────────────────────────────

export type RebaseOutcome =
  | { kind: 'noop' }
  | { kind: 'changed'; changedCodePaths: string[]; featureSurface?: string[] }
  | { kind: 'changelog_resolved' }
  | { kind: 'conflict_halt'; conflicts: string[]; reason: string };

/**
 * Perform the rebase end to end and return a classified outcome. Pure of the
 * conductor's verdict/selector wiring — the caller writes verdicts + events.
 *
 *   noop               → branch already current; nothing to do (FR-4).
 *   changed            → clean rebase that changed code/test paths (FR-5).
 *   changelog_resolved → CHANGELOG-only conflict auto-resolved (FR-7).
 *   conflict_halt      → any other / mixed conflict (FR-8); rebase left paused.
 */
/** Optional capabilities injectable into `performRebase` (Task 15). */
export interface PerformRebaseOpts {
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

  // Snapshot the pre-rebase tree + the feature's CHANGELOG additions BEFORE the
  // rebase moves HEAD, so we can (a) classify changed paths and (b) re-append
  // the feature's [Unreleased] lines if CHANGELOG conflicts.
  const preTree = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const mergeBase = (await git(['merge-base', 'HEAD', base.ref])).stdout.trim();
  const featureAdditions = await captureFeatureChangelog(git, mergeBase || base.ref);

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
    if (opts?.translateAfterRebase) {
      const ontoSha = (await git(['rev-parse', base.ref])).stdout.trim();
      const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      await opts.translateAfterRebase(git, projectRoot, ontoSha, preTree, head);
    }
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

  // FR-7: auto-resolve ONLY when CHANGELOG.md is the SOLE conflict.
  if (conflicts.length === 1 && conflicts[0] === CHANGELOG) {
    const resolved = await tryResolveChangelogConflict(
      git,
      projectRoot,
      featureAdditions,
    );
    if (resolved) return { kind: 'changelog_resolved' };
    // Could not safely resolve (conflict outside [Unreleased]) → HALT.
    return {
      kind: 'conflict_halt',
      conflicts,
      reason: 'CHANGELOG conflict is outside the [Unreleased] block — cannot auto-resolve',
    };
  }

  // Any non-CHANGELOG or mixed conflict → HALT (rebase stays paused).
  return {
    kind: 'conflict_halt',
    conflicts,
    reason:
      conflicts.includes(CHANGELOG)
        ? 'CHANGELOG conflicts alongside other files — not auto-resolving'
        : 'rebase conflict requires human resolution',
  };
}

/** Capture this feature's CHANGELOG `[Unreleased]` additions from base..HEAD. */
async function captureFeatureChangelog(
  git: GitRunner,
  baseRef: string,
): Promise<string[]> {
  const head = await git(['show', `HEAD:${CHANGELOG}`]);
  if (head.exitCode !== 0) return []; // no CHANGELOG on the branch
  const base = await git(['show', `${baseRef}:${CHANGELOG}`]);
  const baseContent = base.exitCode === 0 ? base.stdout : '';
  return unreleasedAdditions(baseContent, head.stdout);
}

/** Classify a clean rebase by whether it touched any code/test path. */
async function classifyClean(
  git: GitRunner,
  preTree: string,
  mergeBase?: string,
): Promise<RebaseOutcome> {
  const changed = await changedPathsBetween(git, preTree, 'HEAD');
  const codePaths = filterCodeOrTestPaths(changed);
  if (codePaths.length === 0) return { kind: 'noop' };
  // F: the feature's own claimed surface — files the feature's commits
  // touched, before the rebase (mergeBase..preTree). Threaded onto the
  // outcome for the delta-aware gate-invalidation classifier (Task 6+);
  // this task only computes and carries it through.
  let featureSurface: string[] | undefined;
  if (mergeBase) {
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
  return { kind: 'changed', changedCodePaths: codePaths, featureSurface };
}

/**
 * Attempt the CHANGELOG-only auto-resolution: take the base's version (which
 * carries siblings' merged entries), re-append this feature's [Unreleased]
 * lines, stage it, and `git rebase --continue`. Returns false (no resolve)
 * when the safe append can't be applied, leaving the rebase paused.
 *
 * Note the rebase ours/theirs inversion: during a rebase, `:2:`/--ours is the
 * branch being rebased ONTO (the base), and `:3:`/--theirs is the commit being
 * replayed (this feature). We take the base side as the foundation.
 */
async function tryResolveChangelogConflict(
  git: GitRunner,
  projectRoot: string,
  featureAdditions: string[],
): Promise<boolean> {
  // The base/upstream version is `:2:` (ours) during a rebase replay.
  const baseSide = await git(['show', `:2:${CHANGELOG}`]);
  if (baseSide.exitCode !== 0) return false;
  const resolved = buildResolvedChangelog(baseSide.stdout, featureAdditions);
  if (resolved === null) return false;

  await writeFile(join(projectRoot, CHANGELOG), resolved, 'utf-8');
  const add = await git(['add', CHANGELOG]);
  if (add.exitCode !== 0) return false;
  const cont = await git(['-c', 'core.editor=true', 'rebase', '--continue']);
  if (cont.exitCode !== 0) {
    // Continue failed (e.g. a further conflict surfaced) → leave paused, HALT.
    return false;
  }
  return true;
}

// ── Resolution loop (feat/rebase-resolution-skill) ───────────────────────────

export type ResolutionAttempt = { resolved: true } | { resolved: false; reason: string };
export interface ResolutionContext { conflicts: string[]; projectRoot: string; baseRef: string }
export type RebaseResolver = (ctx: ResolutionContext) => Promise<ResolutionAttempt>;

// ── Setup failure resolution (TS-3 / Task 9) ────────────────────────────────

export type SetupFailureAttempt = { attempted: true };
export interface SetupFailureContext { worktreePath: string; outputTail: string; slug: string }
export type SetupFailureResolver = (ctx: SetupFailureContext) => Promise<SetupFailureAttempt>;

// ── CI failure resolution (ci-fix resolver autofix) ─────────────────────────

export type CiFailureAttempt = { attempted: true };
export interface CiFailureContext { worktreePath: string; prUrl: string; hint: string; slug: string }
export type CiFailureResolver = (ctx: CiFailureContext) => Promise<CiFailureAttempt>;

/**
 * Check whether every commit subject from before the rebase is still present in
 * the current `baseRef..HEAD` range. Subject-set membership (not patch-id) lets
 * a conflict resolution legitimately change a commit's diff while keeping its
 * subject; a --skip'd commit loses its subject entirely and is caught here.
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
  return subjectsBefore.every((s) => currentSubjects.has(s));
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

    // Both guards pass — reclassify by whether code/test paths changed.
    const changed = filterCodeOrTestPaths(await changedPathsBetween(git, onto, 'HEAD'));
    return changed.length > 0
      ? { kind: 'changed', changedCodePaths: changed }
      : { kind: 'noop' };
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
 *   noop / changelog_resolved → rebase satisfied (docs-only never invalidates).
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
        : outcome.kind === 'changelog_resolved'
          ? 'CHANGELOG-only conflict auto-resolved; branch current'
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

  // build_review sits between build and manual_test — a build change must
  // invalidate it too (it grades the diff that just changed), or the
  // selector could jump straight to manual_test on a stale build_review
  // verdict. Included unconditionally: even if build_review is disabled
  // for this project the verdict file is inert, but when it IS enabled the
  // stale state must exist before manual_test is re-selectable.
  //
  // wiring_check (Task 6) sits between build_review and manual_test — it
  // asserts new code is actually reachable from an entry point, which a
  // file-changing rebase can falsify just as easily as build_review's
  // grading, so it must be invalidated the same way (Task 11).
  // Task 6 (ADR-2026-07-20): when the feature's claimed surface (F) is
  // available, select the invalidation set via classifyGateInvalidation
  // instead of the fixed set — a delta that never touches the feature's own
  // runtime source (only foreign runtime, or test/docs paths) preserves the
  // feature-runtime-scoped judged gates (prd_audit,
  // architecture_review_as_built) rather than blindly re-opening them.
  //
  // Fallback (Tasks 10-11 harden this further): if `featureSurface` is
  // missing on the outcome, F is uncomputable — fall back to the old fixed
  // set (today's blanket invalidation) as a safe default rather than guess.
  const targets: StepName[] =
    outcome.featureSurface !== undefined
      ? ([
          'build',
          ...classifyGateInvalidation(outcome.changedCodePaths, outcome.featureSurface, ranManualTest)
            .invalidated,
        ] as StepName[])
      : ranManualTest
        ? ['build', 'build_review', 'wiring_check', 'manual_test']
        : ['build', 'build_review', 'wiring_check'];
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
 * kind except `conflict_halt` (noop / changelog_resolved / changed all leave
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
 *   - 'all-runtime' (build_review, wiring_check, manual_test): featureSrc ∪
 *     foreignSrc.
 *   - 'any-codetest': the full delta (test ∪ featureSrc ∪ foreignSrc).
 *
 * For preserved gates, `surface` is the same per-kind path set — which is
 * always empty by construction (that emptiness is precisely why the gate
 * was preserved) — and `deltaConsidered` carries the full rebase delta `D`
 * so the event still records what was checked against, for audit purposes.
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

  const matchedPathsFor = (gate: string): string[] => {
    const surface = GATE_SURFACE[gate];
    return surface === 'feature-runtime'
      ? featureSrc
      : surface === 'all-runtime'
        ? [...featureSrc, ...foreignSrc]
        : [...test, ...featureSrc, ...foreignSrc];
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
      surface: matchedPathsFor(gate),
      deltaConsidered: outcome.changedCodePaths,
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
        await events.emit({ type: 'rebase_noop' });
        break;
      case 'changed':
        await events.emit({
          type: 'rebase_changed',
          changedPaths: outcome.changedCodePaths,
        });
        break;
      case 'changelog_resolved':
        await events.emit({ type: 'rebase_changelog_resolved' });
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

/** Read the CHANGELOG additions captured for HALT resume detection (FR-9). */
export async function readChangelogIfPresent(
  projectRoot: string,
): Promise<string | null> {
  try {
    return await readFile(join(projectRoot, CHANGELOG), 'utf-8');
  } catch {
    return null;
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
 * Tier 1 deterministic resolution driver: compose the CHANGELOG resolver +
 * keep-both resolver for .docs/ conflicts on a paused rebase.
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
 *   1. Identify CHANGELOG conflicts and attempt resolution (stage only, no continue)
 *   2. Identify .docs/ conflicts and attempt resolution (stage only, no continue)
 *   3. Attempt ONE rebase --continue
 *   4. Check what conflicts remain
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

  // Attempt to stage CHANGELOG resolution if CHANGELOG.md is in conflicts.
  if (originalConflicts.includes(CHANGELOG)) {
    const changelogStaged = await tier1StageChangelog(git, projectRoot);
    if (changelogStaged) {
      staged.push(CHANGELOG);
    }
  }

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
 * Attempt to stage a CHANGELOG.md conflict resolution using the existing auto-resolver.
 * During a paused rebase, extracts feature additions from the conflict stages
 * (`:3:` is the feature version), builds the resolved version, and stages it.
 * Does NOT run rebase --continue.
 *
 * Returns true if staged, false if the resolver could not safely apply.
 */
async function tier1StageChangelog(
  git: GitRunner,
  projectRoot: string,
): Promise<boolean> {
  // Get the base/upstream version (`:2:` during rebase is ours/the base).
  const baseSide = await git(['show', `:2:${CHANGELOG}`]);
  if (baseSide.exitCode !== 0) return false;

  // Get the feature version (`:3:` during rebase is theirs/the feature).
  const featureSide = await git(['show', `:3:${CHANGELOG}`]);
  if (featureSide.exitCode !== 0) return false;

  // Extract feature additions by comparing feature side with base side.
  const featureAdditions = unreleasedAdditions(baseSide.stdout, featureSide.stdout);

  // Try the auto-resolve (same logic as performRebase).
  const resolved = buildResolvedChangelog(baseSide.stdout, featureAdditions);
  if (resolved === null) return false;

  await writeFile(join(projectRoot, CHANGELOG), resolved, 'utf-8');
  const add = await git(['add', CHANGELOG]);
  if (add.exitCode !== 0) return false;

  return true;
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

