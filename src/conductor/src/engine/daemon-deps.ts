import { execa } from 'execa';
import { mkdir, writeFile, readFile, access, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import * as chokidar from 'chokidar';
import { HALT_MARKER } from './halt-marker.js';
import type { BacklogItem } from './daemon.js';
import type { LLMProvider } from '../execution/llm-provider.js';
import type {
  FeatureRunnerDeps,
  FeatureWorktree,
  WorktreeOutcome,
} from './daemon-runner.js';
import { prepareWorktree } from './worktree-prepare.js';
import { makeProductionGh } from './pr-labels.js';
import { ensureWorktree } from './worktree-shared.js';
import { FINISH_CHOICE_MARKER, FINISH_CHOICE_VALUES } from './artifacts.js';

export interface RealDepsConfig {
  /** The main checkout the daemon runs from. */
  projectRoot: string;
  /** Directory under which per-feature worktrees are created. */
  worktreeBase: string;
  /** Branch the worktrees fork from (e.g. 'main'). */
  baseBranch: string;
  /** Run the gate loop in a worktree to DONE/HALT (assembled by the CLI). */
  runConductorInWorktree: (worktree: FeatureWorktree, item: BacklogItem) => Promise<void>;
  /** LLM provider used for the Phase 9.1 `done`-feature retro narrative. */
  provider: LLMProvider;
  /**
   * The resolved active memory provider for this run (adr-2026-06-29-per-project-memory-provider-selection). Computed at
   * run start by `resolveMemoryProvider` and carried on context so every
   * memory-using step sees the same single active provider (FR-10).
   */
  memoryProvider?: unknown;
  log?: (msg: string) => void;
}

const PROCESSED_SUBDIR = '.daemon/processed';
const WARNED_SUBDIR = '.daemon/warned';

/** Concrete (git/fs) implementation of the feature-runner primitives. */
export function makeFeatureRunnerDeps(cfg: RealDepsConfig): FeatureRunnerDeps {
  const processedDir = join(cfg.projectRoot, PROCESSED_SUBDIR);

  return {
    log: cfg.log,
    // The real daemon path always emits to the engineer store on completion
    // (Phase 9.1). Manual `/conduct` runs don't go through makeFeatureRunnerDeps.
    daemon: true,
    provider: cfg.provider,
    // Thread the resolved active memory provider onto run context (adr-2026-06-29-per-project-memory-provider-selection/FR-10).
    memoryProvider: cfg.memoryProvider,
    // Project key for the engineer store = the main checkout's basename (NOT the
    // worktree path, which is always `<projectRoot>/.worktrees/<slug>`).
    project: basename(cfg.projectRoot),
    // FR-9: the MAIN checkout path — the watch registry lives here, and gh ops
    // are issued from here after the worktree is torn down on ship.
    projectRoot: cfg.projectRoot,
    // FR-16: production gh runner for clear-on-success label ops.
    runGh: makeProductionGh(),

    createWorktree: async (slug) => {
      const branch = `feat/daemon-${slug}`;
      const path = join(cfg.worktreeBase, slug);
      const root = cfg.projectRoot;
      // Idempotent create/reconcile via the shared worktree mechanism (parity with
      // the engineer). The base ref is resolved lazily — only when a fresh branch is
      // cut — so the reuse/attach paths issue no extra git call.
      const { path: p, branch: b } = await ensureWorktree({
        root,
        path,
        branch,
        resolveBase: () => resolveWorktreeBase(root, cfg.baseBranch),
        log: cfg.log,
      });
      return { path: p, branch: b };
    },

    // Write WORKTREE_NAMESPACE into the worktree .env and run the project's
    // bin/setup (no-op if absent). Keeps the daemon stack-agnostic while letting
    // each project translate the namespace into its own shared/namespaced infra.
    prepareWorktree: (wt) => prepareWorktree(wt.path, cfg.log),

    runConductor: (wt, item) => cfg.runConductorInWorktree(wt, item),

    readOutcome: (wt) => readWorktreeOutcome(wt.path),

    teardownWorktree: async (wt, keep) => {
      if (keep) return; // halt/error → leave it for the human
      await execa('git', ['worktree', 'remove', '--force', wt.path], {
        cwd: cfg.projectRoot,
      }).catch(() => {
        /* best-effort cleanup */
      });
    },

    markProcessed: async (slug, prUrl) => {
      await mkdir(processedDir, { recursive: true });
      // Persist as JSON so the startup dashboard can surface the shipped PR link.
      // Legacy ledgers held the plain text `shipped`; readProcessedEntries still
      // parses those (no PR), so this is backward-compatible.
      await writeFile(
        join(processedDir, slug),
        `${JSON.stringify({ status: 'shipped', prUrl: prUrl ?? null })}\n`,
        'utf-8',
      );
    },

    // NOTE (#204/#205, as-built review): the shipped record is NOT written
    // here. Per adr-2026-07-03-committed-shipped-record-dispatch-dedup
    // Decision 1, `/finish` commits `.docs/shipped/<slug>.md` on the
    // IMPLEMENTATION branch (via `conduct shipped-record`) before the final
    // push, so the human merge lands code + shipped-fact atomically. A
    // daemon-side write here would land on the main checkout's base branch —
    // never pushed, and it permanently breaks fastForwardRoot's --ff-only
    // advance once local main is ahead of origin.
  };
}

/**
 * The ref a fresh feature worktree forks from. Prefer the remote-tracking
 * `origin/<baseBranch>` so the build starts from the latest *fetched* origin tip
 * rather than the LOCAL `<baseBranch>`, which can lag origin: `fastForwardRoot`
 * only advances local `<baseBranch>` while the root checkout is actually on it,
 * so whenever another process leaves the root on a different branch (or detached
 * HEAD), local `<baseBranch>` goes stale and worktrees cut from it would build
 * against old code.
 *
 * Falls back to the local `<baseBranch>` when `origin/<baseBranch>` cannot be
 * resolved (local-only repo with no origin, or never fetched) — preserving the
 * prior behavior for those repos.
 */
async function resolveWorktreeBase(projectRoot: string, baseBranch: string): Promise<string> {
  const remote = `origin/${baseBranch}`;
  try {
    await execa('git', ['rev-parse', '--verify', '--quiet', remote], { cwd: projectRoot });
    return remote;
  } catch {
    return baseBranch;
  }
}

/** Has this slug already been shipped by the daemon? (for discoverBacklog). */
export async function isProcessed(projectRoot: string, slug: string): Promise<boolean> {
  try {
    await access(join(projectRoot, PROCESSED_SUBDIR, slug));
    return true;
  } catch {
    return false;
  }
}

/**
 * Cache repair (ADR Decisions 2b/2c): a discovery skip driven by a base-branch
 * shipped record writes the missing `.daemon/processed/<slug>` marker so later
 * polls take the ledger fast path instead of re-reading shipped records. Uses
 * the same JSON shape `markProcessed` writes; a malformed record still repairs
 * (the stem match alone proved the ship) with a null prUrl. Callers treat
 * failures as best-effort — discoverBacklog already catches and logs.
 */
export async function repairProcessed(
  projectRoot: string,
  slug: string,
  record: { pr?: string } | { malformed: true },
): Promise<void> {
  const processedDir = join(projectRoot, PROCESSED_SUBDIR);
  await mkdir(processedDir, { recursive: true });
  const prUrl = 'malformed' in record ? null : (record.pr ?? null);
  await writeFile(
    join(processedDir, slug),
    `${JSON.stringify({ status: 'shipped', prUrl })}\n`,
    'utf-8',
  );
}

/**
 * Has this slug's "merged spec cannot build" skip already been surfaced once?
 * Mirrors `isProcessed` but for the `.daemon/warned/` markers — lets
 * `discoverBacklog` log a persistently-unbuildable merged spec exactly once
 * instead of on every poll tick.
 */
export async function hasWarned(projectRoot: string, slug: string): Promise<boolean> {
  try {
    await access(join(projectRoot, WARNED_SUBDIR, slug));
    return true;
  } catch {
    return false;
  }
}

/** Record that this slug's skip has been surfaced, suppressing repeat skip logs. */
export async function markWarned(projectRoot: string, slug: string): Promise<void> {
  const warnedDir = join(projectRoot, WARNED_SUBDIR);
  await mkdir(warnedDir, { recursive: true });
  await writeFile(join(warnedDir, slug), 'warned\n', 'utf-8');
}

/**
 * True while a halted feature's worktree HALT marker is still present — the
 * park-gate the daemon checks before re-dispatching (see daemon.ts `isHalted`).
 * A human clears `.pipeline/HALT` to make the feature re-eligible. Takes the
 * worktree base so it stays in lockstep with `createWorktree`'s path convention
 * (`<worktreeBase>/<slug>`), not a re-derived `.worktrees`.
 */
export async function isHalted(worktreeBase: string, slug: string): Promise<boolean> {
  return exists(join(worktreeBase, slug, HALT_MARKER));
}

/** Read the loop outcome from a worktree's `.pipeline` markers. */
export async function readWorktreeOutcome(worktreePath: string): Promise<WorktreeOutcome> {
  const done = await exists(join(worktreePath, '.pipeline/DONE'));
  const haltPath = join(worktreePath, HALT_MARKER);
  const halted = await exists(haltPath);

  let reason: string | undefined;
  if (halted) {
    reason = (await readFile(haltPath, 'utf-8').catch(() => '')).trim() || undefined;
  }

  let prUrl: string | undefined;
  try {
    const state = JSON.parse(
      await readFile(join(worktreePath, '.pipeline/conduct-state.json'), 'utf-8'),
    ) as { pr_url?: string };
    prUrl = state.pr_url;
  } catch {
    /* no state / no pr_url */
  }

  // Task 12 (#204, #205): read the finish skill's recorded outcome so the
  // ship-record write can be skipped for `discard`/`keep` — the gate-driven
  // loop converges (DONE) for every finish choice, so `done` alone can't
  // distinguish a real ship from "the operator chose not to ship."
  // Tolerant of a missing/malformed marker (undefined → treated as ship, the
  // pre-Task-12 default for `pr`/`merge-local`).
  let finishChoice: WorktreeOutcome['finishChoice'];
  try {
    const raw = (
      await readFile(join(worktreePath, FINISH_CHOICE_MARKER), 'utf-8')
    ).trim();
    if ((FINISH_CHOICE_VALUES as readonly string[]).includes(raw)) {
      finishChoice = raw as WorktreeOutcome['finishChoice'];
    }
  } catch {
    /* no marker — leave undefined */
  }

  return { done, halted, reason, prUrl, finishChoice };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Watch a halted feature's worktree for HALT marker removal, calling `onCleared`
 * when the `.pipeline/HALT` file is deleted or renamed away.
 *
 * Uses chokidar to watch for filesystem events. On detecting an unlink event
 * (both delete and rename), re-verifies the file is truly gone before calling
 * the callback. Returns a dispose function that closes the watcher (idempotent).
 *
 * Errors and missing directories are handled gracefully:
 * - If the worktree directory doesn't exist, returns a no-op dispose function
 * - Watcher errors are swallowed (best-effort monitoring)
 * - Calling dispose multiple times is safe
 *
 * Internal implementation. Use `makeWatchHaltClearedSeam` to create the
 * DaemonDeps-compatible seam.
 *
 * @param worktreeBase Directory under which per-feature worktrees live
 * @param slug Feature slug (worktree is at `<worktreeBase>/<slug>`)
 * @param onCleared Callback fired exactly once when HALT marker is confirmed gone
 * @returns Dispose function that closes the watcher
 */
export function watchHaltCleared(
  worktreeBase: string,
  slug: string,
  onCleared: () => void,
): () => void {
  const haltPath = join(worktreeBase, slug, HALT_MARKER);
  let watcher: chokidar.FSWatcher | null = null;
  let disposed = false;

  // Start the watcher
  try {
    watcher = chokidar.watch(haltPath, { ignoreInitial: true });

    watcher.on('unlink', async () => {
      if (disposed) return;

      // Re-verify the file is actually gone
      const stillExists = await exists(haltPath);
      if (!stillExists) {
        onCleared();
      }
    });

    // Swallow watcher errors (best-effort monitoring)
    watcher.on('error', () => {
      /* ignore */
    });
  } catch {
    // If the directory doesn't exist or the watcher fails to start,
    // just return a no-op dispose
    watcher = null;
  }

  // Return idempotent dispose function
  return () => {
    if (disposed) return;
    disposed = true;
    if (watcher) {
      watcher.close().catch(() => {
        /* best-effort cleanup */
      });
    }
  };
}

/**
 * Factory for the DaemonDeps watchHaltCleared seam (Task 12).
 *
 * Creates a seam-compatible function `(slug: string, onCleared: () => void) => () => void`
 * that uses the real filesystem watcher to detect HALT marker removal.
 *
 * @param worktreeBase Directory under which per-feature worktrees live
 * @returns DaemonDeps-compatible watchHaltCleared function
 */
export function makeWatchHaltClearedSeam(
  worktreeBase: string,
): (slug: string, onCleared: () => void) => () => void {
  return (slug: string, onCleared: () => void) => {
    return watchHaltCleared(worktreeBase, slug, onCleared);
  };
}
