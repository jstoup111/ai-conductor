import { readdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  makeGitRunner,
  rebaseStateActive,
  performRebase,
  applyRebaseVerdicts,
  emitRebaseEvent,
  writeHalt,
  type RebaseOutcome,
} from './rebase.js';
import type { ConductorEventEmitter } from '../ui/events.js';

// ── Main-advance re-kick sweep (ADR-013 / FR-7, FR-9, FR-12) ──────────────────
//
// On a genuine base-SHA advance the daemon re-kicks every halted feature. The
// sweep ONLY clears the marker — it issues no direct dispatch (FR-8); PR #109's
// discovery un-park path re-dispatches the cleared feature on the next poll.
//
// For each live-HALT worktree the sweep: (FR-9) skips if already re-kicked at
// this SHA → logs the reason → if a 9.0 rebase is paused, `git rebase --abort`
// (best-effort; a FAILED abort leaves the marker INTACT, no half-clear) →
// renames `.pipeline/HALT`→`.pipeline/HALT.cleared` (reason preserved) → removes
// `.pipeline/HALT` → writes a `.pipeline/REKICK` sentinel (FR-12) → records the
// triggering SHA as that feature's last-rekick SHA.
//
// The pure `rekickSweep` takes injected primitives so it is unit-testable
// without git/network/worktree. The real fs/git impls below are wired by the
// CLI.

export const HALT_MARKER = '.pipeline/HALT';
export const HALT_CLEARED_MARKER = '.pipeline/HALT.cleared';
export const REKICK_SENTINEL = '.pipeline/REKICK';

export interface RekickSweepDeps {
  /** Slugs whose worktree currently carries a live `.pipeline/HALT` marker. */
  listHaltedWorktrees: () => Promise<string[]>;
  /** First line / summary of a worktree's HALT reason (for logging). */
  readHaltReason: (slug: string) => Promise<string>;
  /** True when the worktree has a 9.0 rebase paused mid-flight. */
  hasRebaseInProgress: (slug: string) => Promise<boolean>;
  /** `git rebase --abort` in the worktree. MUST throw on failure (→ marker kept). */
  abortRebase: (slug: string) => Promise<void>;
  /** Preserve reason → remove HALT → drop the REKICK sentinel. */
  clearMarker: (slug: string) => Promise<void>;
  /**
   * Per-feature last-rekick SHA guard (FR-9), owned by the orchestrator so it
   * persists across the startup + live sweeps of one run. A feature already
   * re-kicked at SHA `X` is not re-kicked again at `X`.
   */
  lastRekickSha: Map<string, string>;
  log?: (msg: string) => void;
}

export interface RekickSweepResult {
  cleared: string[];
  skipped: string[];
}

/**
 * Re-kick every live-HALT worktree at base SHA `sha`. Returns the slugs cleared
 * and the slugs skipped (FR-9 already-rekicked, failed abort, or a clear error).
 * Never throws: a per-worktree failure is logged and isolated; the sweep
 * continues with the rest (FR-7 / FR-10).
 */
export async function rekickSweep(
  deps: RekickSweepDeps,
  sha: string,
): Promise<RekickSweepResult> {
  const log = deps.log ?? (() => {});
  const cleared: string[] = [];
  const skipped: string[] = [];

  let slugs: string[];
  try {
    slugs = await deps.listHaltedWorktrees();
  } catch (err) {
    log(`re-kick: could not list halted worktrees (${errMsg(err)}); skipping sweep`);
    return { cleared, skipped };
  }

  for (const slug of slugs) {
    // FR-9: bounded — already re-kicked at this SHA → leave parked.
    if (deps.lastRekickSha.get(slug) === sha) {
      skipped.push(slug);
      continue;
    }

    let reason = 'unknown';
    try {
      reason = await deps.readHaltReason(slug);
    } catch {
      /* best-effort: a missing reason is logged as unknown */
    }
    log(`re-kick ${slug} @ ${sha.slice(0, 12)} — ${reason}`);

    // FR-7b: abort a paused rebase BEFORE clearing. A failed abort leaves the
    // marker intact (no half-clear of a corrupt rebase state) and skips it.
    try {
      if (await deps.hasRebaseInProgress(slug)) {
        await deps.abortRebase(slug);
        log(`re-kick ${slug}: aborted in-progress rebase before clearing`);
      }
    } catch (err) {
      log(`re-kick ${slug}: rebase --abort FAILED (${errMsg(err)}); leaving marker intact`);
      skipped.push(slug);
      continue;
    }

    try {
      await deps.clearMarker(slug);
    } catch (err) {
      log(`re-kick ${slug}: clear failed (${errMsg(err)}); skipped`);
      skipped.push(slug);
      continue;
    }

    deps.lastRekickSha.set(slug, sha);
    cleared.push(slug);
  }

  return { cleared, skipped };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Real fs/git primitives (wired by daemon-cli.ts) ──────────────────────────

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Slugs under `worktreeBase` whose worktree carries a live `.pipeline/HALT`. */
export async function listHaltedWorktrees(worktreeBase: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(worktreeBase, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (await exists(join(worktreeBase, e.name, HALT_MARKER))) out.push(e.name);
  }
  return out;
}

/** First non-empty line of a worktree's HALT marker, or `unknown`. */
export async function readHaltReason(worktreeBase: string, slug: string): Promise<string> {
  try {
    const content = await readFile(join(worktreeBase, slug, HALT_MARKER), 'utf-8');
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (t.length > 0) return t;
    }
  } catch {
    /* unreadable → unknown */
  }
  return 'unknown';
}

/**
 * True when the worktree has a 9.0 rebase paused mid-flight. Reuses
 * `rebaseStateActive`, which resolves the worktree's gitdir via
 * `git rev-parse --git-path` (a linked worktree's `.git` is a file).
 */
export async function hasRebaseInProgress(worktreePath: string): Promise<boolean> {
  return rebaseStateActive(makeGitRunner(worktreePath), worktreePath);
}

/** `git rebase --abort` in the worktree; throws on a non-zero exit (FR-7b). */
export async function abortRebase(worktreePath: string): Promise<void> {
  const git = makeGitRunner(worktreePath);
  const r = await git(['rebase', '--abort']);
  if (r.exitCode !== 0) {
    throw new Error(r.stderr.trim() || `git rebase --abort exited ${r.exitCode}`);
  }
}

/**
 * Clear a worktree's HALT non-destructively: preserve the reason to
 * `.pipeline/HALT.cleared` (overwriting any prior one), remove `.pipeline/HALT`,
 * and drop a `.pipeline/REKICK` sentinel so the resume runs rebase-first (FR-12).
 */
export async function clearMarker(worktreePath: string): Promise<void> {
  const halt = join(worktreePath, HALT_MARKER);
  const cleared = join(worktreePath, HALT_CLEARED_MARKER);
  // rename overwrites an existing `.cleared` and removes HALT atomically; the
  // explicit rm is a harmless backstop if the source was already gone.
  await rename(halt, cleared).catch(async () => {
    // Source absent (concurrent teardown) — clearing a now-absent marker is a
    // no-op (story negative path), not an error.
  });
  await rm(halt, { force: true });
  await writeFile(join(worktreePath, REKICK_SENTINEL), `rekick\n`, 'utf-8');
}

// ── FR-12: resume rebase-first (play-forward) ────────────────────────────────

export type RekickResumeResult = 'skipped' | 'rebased' | 'halted';

/**
 * Honor the `.pipeline/REKICK` sentinel a sweep dropped. When present, run
 * 9.0's rebase-onto-latest in the worktree BEFORE the conductor resumes the
 * pending gate, so an advanced base is integrated and the gate (e.g. prd-audit)
 * re-verifies against the new base instead of the stale one. One-shot: the
 * sentinel is consumed (deleted) whether or not the rebase conflicts.
 *
 *   'skipped'  — no sentinel; caller proceeds normally (no rebase forced).
 *   'rebased'  — rebase ran (noop/clean/changelog-resolved); caller resumes the
 *                gate loop. FR-5 kickbacks (build/manual_test) are written by
 *                `applyRebaseVerdicts` so the loop re-verifies changed code.
 *   'halted'   — the rebase re-conflicted on the new base; 9.0's HALT was
 *                written and the rebase left paused. Caller MUST re-park (skip
 *                `conductor.run()`); FR-9 bounds re-kick at this SHA.
 *
 * Reuses the exact 9.0 rebase primitives (`performRebase`/`applyRebaseVerdicts`/
 * `emitRebaseEvent`/`writeHalt`) — it never reimplements the rebase logic.
 */
export async function resumeRebaseFirst(opts: {
  worktreePath: string;
  /** Local base branch name to rebase onto (origin default is preferred inside). */
  localBase: string;
  events: ConductorEventEmitter;
  /** Whether manual_test ran for this feature (drives the FR-5 kickback set). */
  ranManualTest: boolean;
  log?: (msg: string) => void;
}): Promise<RekickResumeResult> {
  const sentinel = join(opts.worktreePath, REKICK_SENTINEL);
  if (!(await exists(sentinel))) return 'skipped';

  // One-shot: consume the sentinel up front so a crash can't loop on it.
  await rm(sentinel, { force: true });

  const git = makeGitRunner(opts.worktreePath);
  let outcome: RebaseOutcome;
  try {
    outcome = await performRebase(git, opts.worktreePath, opts.localBase);
  } catch (err) {
    outcome = {
      kind: 'conflict_halt',
      conflicts: [],
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  await applyRebaseVerdicts(opts.worktreePath, outcome, opts.ranManualTest);
  await emitRebaseEvent(opts.events, outcome);

  if (outcome.kind === 'conflict_halt') {
    // Re-conflict on the new base → re-park via 9.0's existing HALT path.
    await writeHalt(opts.worktreePath, outcome.conflicts, outcome.reason);
    opts.log?.(`re-kick ${basename(opts.worktreePath)}: rebase re-conflicted on advanced base — re-parked`);
    return 'halted';
  }

  opts.log?.(`re-kick ${basename(opts.worktreePath)}: rebased onto latest before resuming gate`);
  return 'rebased';
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
