import { execa } from 'execa';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import type { StepName } from '../types/index.js';
import { writeVerdict, type GateVerdict } from './gate-verdicts.js';
import type { ConductorEventEmitter } from '../ui/events.js';

// ── Engine-native `rebase` loopGate (Phase 9.0) ──────────────────────────────
//
// Pure, testable helpers that rebase a daemon worktree branch onto the latest
// discovered base and classify the outcome. The conductor consumes these
// natively (no Claude dispatch) when the gate loop reaches the `rebase` step.
//
// Design keystone (ADR-001 / FR-4): the gate verdict is SATISFIED iff the
// branch is already current with the base. A genuinely stale branch must never
// report satisfied — that is the critical correctness property.

const LOOP_HALT_MARKER = '.pipeline/HALT';

/** Minimal git runner — injected so the helpers are unit-testable without a repo. */
export interface GitRunner {
  (args: string[]): Promise<GitResult>;
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** A real git runner rooted at `cwd`, never throwing on non-zero exit. */
export function makeGitRunner(cwd: string): GitRunner {
  return async (args: string[]): Promise<GitResult> => {
    try {
      const r = await execa('git', args, { cwd, reject: false });
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
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true }).catch(() => {});
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
  await writeFile(join(projectRoot, LOOP_HALT_MARKER), note, 'utf-8').catch(() => {});
}

// ── Outcome model ────────────────────────────────────────────────────────────

export type RebaseOutcome =
  | { kind: 'noop' }
  | { kind: 'changed'; changedCodePaths: string[] }
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
export async function performRebase(
  git: GitRunner,
  projectRoot: string,
  localBase: string,
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
    return classifyClean(git, preTree);
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
): Promise<RebaseOutcome> {
  const changed = await changedPathsBetween(git, preTree, 'HEAD');
  const codePaths = filterCodeOrTestPaths(changed);
  if (codePaths.length === 0) return { kind: 'noop' };
  return { kind: 'changed', changedCodePaths: codePaths };
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
): Promise<{ satisfied: boolean; kickedBack: StepName[] }> {
  if (outcome.kind === 'conflict_halt') {
    await writeVerdict(projectRoot, 'rebase', {
      satisfied: false,
      reason: `rebase conflict: ${outcome.reason}`,
      checkedAt: Date.now(),
    });
    return { satisfied: false, kickedBack: [] };
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
    return { satisfied: true, kickedBack: [] };
  }

  // FR-5: code/test paths changed → invalidate downstream gates kickback-shaped.
  const evidence =
    `rebase changed code/test paths: ${outcome.changedCodePaths.slice(0, 5).join(', ')}` +
    (outcome.changedCodePaths.length > 5
      ? ` (+${outcome.changedCodePaths.length - 5} more)`
      : '');
  const kickedBack: StepName[] = [];
  const targets: StepName[] = ranManualTest ? ['build', 'manual_test'] : ['build'];
  for (const target of targets) {
    await writeVerdict(projectRoot, target, {
      satisfied: false,
      reason: 'invalidated by file-changing rebase',
      checkedAt: Date.now(),
      kickback: { from: 'rebase', evidence },
    });
    kickedBack.push(target);
  }
  return { satisfied: true, kickedBack };
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
