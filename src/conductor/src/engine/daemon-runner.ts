import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { BacklogItem, FeatureOutcome } from './daemon.js';
import type { LLMProvider } from '../execution/llm-provider.js';
import { emitEngineerSignal, resolveEngineerDir } from './engineer-store.js';

/**
 * Outcome of running the gate loop inside a feature's worktree, read from the
 * `.pipeline/DONE` / `.pipeline/HALT` markers the conductor writes.
 */
export interface WorktreeOutcome {
  done: boolean;
  halted: boolean;
  reason?: string;
  prUrl?: string;
  costTokens?: number;
}

export interface FeatureWorktree {
  path: string;
  branch: string;
}

/**
 * The real-I/O primitives a feature run needs. Injected so the orchestration
 * (done/halted/error + teardown discipline) is unit-testable without git,
 * Claude, or gh.
 */
export interface FeatureRunnerDeps {
  /** `git worktree add` a fresh branch+dir for the feature, cut from the
   *  fast-forwarded default branch — so the vetted stories+plan physically exist
   *  in it already (no separate materialization/copy step). */
  createWorktree: (slug: string) => Promise<FeatureWorktree>;
  /**
   * Optional worktree preparation run before the
   * build: write `WORKTREE_NAMESPACE` into the worktree's `.env` (so the
   * project's config can isolate this worktree's database) and run the
   * project's conventional `bin/setup` non-interactively. No-op when the
   * project ships no `bin/setup`. Absent on manual `/conduct` runs. A throw
   * aborts the feature (worktree kept) rather than building against a
   * half-prepared environment.
   */
  prepareWorktree?: (worktree: FeatureWorktree) => Promise<void>;
  /** Run the conductor's gate loop in the worktree to DONE/HALT (finish=open PR). */
  runConductor: (worktree: FeatureWorktree, item: BacklogItem) => Promise<void>;
  /** Read the loop outcome from the worktree's markers. */
  readOutcome: (worktree: FeatureWorktree) => Promise<WorktreeOutcome>;
  /** Remove the worktree (keep=true leaves it for inspection after halt/error). */
  teardownWorktree: (worktree: FeatureWorktree, keep: boolean) => Promise<void>;
  /** Persist that a slug shipped so discoverBacklog skips it next poll. */
  markProcessed: (slug: string) => Promise<void>;
  /**
   * Daemon mode. When true, emit a structured engineer signal + narrative to the
   * cross-project engineer store on completion (Phase 9.1). Manual `/conduct` runs
   * pass false — they keep writing repo `.docs/retros/` and emit nothing.
   */
  daemon: boolean;
  /** LLM provider used to produce the `done`-feature retro narrative. */
  provider: LLMProvider;
  /**
   * Project key for the engineer store — the project's basename, derived from the
   * main checkout (`basename(projectRoot)`), NOT the worktree path. Worktrees
   * live at `<projectRoot>/.worktrees/<slug>`, so deriving from the worktree
   * would yield `.worktrees` for every project and collapse cross-project
   * disambiguation (FR-9).
   */
  project: string;
  log?: (msg: string) => void;
}

/**
 * Build the `runFeature` the daemon pool calls. Discipline:
 *   - done   → mark processed, remove the worktree, report prUrl.
 *   - halted → KEEP the worktree (for the human), park the feature.
 *   - error / no marker → keep the worktree, report error.
 *   - a thrown primitive is caught here too (belt-and-suspenders; the pool also
 *     guards), worktree kept for inspection.
 */
export function makeRunFeature(
  deps: FeatureRunnerDeps,
): (item: BacklogItem) => Promise<FeatureOutcome> {
  const log = deps.log ?? (() => {});

  return async (item: BacklogItem): Promise<FeatureOutcome> => {
    let worktree: FeatureWorktree | null = null;
    try {
      // The worktree is cut from the fast-forwarded default branch, so the vetted
      // stories+plan are already committed in it — no materialization/copy needed.
      worktree = await deps.createWorktree(item.slug);
      // Prepare the worktree before the build: write WORKTREE_NAMESPACE and run
      // the project's bin/setup. A project that ships no bin/setup still gets
      // the namespace written; a setup failure throws and is handled like any
      // other primitive throw (worktree kept, feature errored).
      if (deps.prepareWorktree) await deps.prepareWorktree(worktree);
      await deps.runConductor(worktree, item);
      const outcome = await deps.readOutcome(worktree);

      // Phase 9.1: on daemon completion, emit a structured signal + narrative to
      // the cross-project engineer store. Runs AFTER readOutcome and BEFORE any
      // teardown (the worktree context is still present for the retro). Manual
      // runs (daemon=false) emit nothing and keep their repo `.docs/retros/`.
      // Best-effort inside emitEngineerSignal — never throws, so it cannot affect
      // the feature outcome or teardown discipline below.
      if (deps.daemon) {
        await emitDaemonSignal(deps, worktree, item, outcome);
      }

      if (outcome.done) {
        await deps.markProcessed(item.slug);
        await deps.teardownWorktree(worktree, false);
        log(`✓ ${item.slug} shipped${outcome.prUrl ? ` → ${outcome.prUrl}` : ''}`);
        return {
          slug: item.slug,
          status: 'done',
          prUrl: outcome.prUrl,
          costTokens: outcome.costTokens,
        };
      }

      if (outcome.halted) {
        await deps.teardownWorktree(worktree, true); // keep for the human
        log(`✋ ${item.slug} halted — worktree kept (${outcome.reason ?? 'see .pipeline/HALT'})`);
        return {
          slug: item.slug,
          status: 'halted',
          reason: outcome.reason,
          costTokens: outcome.costTokens,
        };
      }

      // Loop ended without DONE or HALT — treat as an error, keep the worktree.
      const noMarkerReason = outcome.reason ?? 'loop ended without DONE or HALT marker';
      await writeErrorHalt(worktree, noMarkerReason);
      await deps.teardownWorktree(worktree, true);
      return {
        slug: item.slug,
        status: 'error',
        reason: noMarkerReason,
        costTokens: outcome.costTokens,
      };
    } catch (err) {
      // Any thrown error (a step crash, or worktree-prep / bin/setup failing) —
      // capture it into a diagnostic `.pipeline/HALT` so the operator can see WHY
      // (the daemon log otherwise shows a bare `error`) and the feature parks for
      // inspection instead of being silently excluded for the run's lifetime.
      const reason = err instanceof Error ? err.message : String(err);
      if (worktree) {
        await writeErrorHalt(worktree, reason);
        await deps.teardownWorktree(worktree, true).catch(() => {});
      }
      return {
        slug: item.slug,
        status: 'error',
        reason,
      };
    }
  };
}

/**
 * Write a diagnostic `.pipeline/HALT` into a worktree whose feature errored, so
 * the failure is visible (the daemon log only shows `error`) and the feature
 * parks for human inspection rather than being silently excluded. Best-effort:
 * a write failure must never mask the original error.
 */
async function writeErrorHalt(worktree: FeatureWorktree, reason: string): Promise<void> {
  const note =
    `feature errored — parked for human inspection\n${reason}\n\n` +
    `Resume procedure:\n` +
    `  1. Fix the cause of the error above (project setup / config / environment / a crashed step).\n` +
    `  2. rm .pipeline/HALT\n` +
    `  3. Re-queue the feature (restart the daemon if it was excluded this run).\n`;
  await mkdir(join(worktree.path, '.pipeline'), { recursive: true }).catch(() => {});
  await writeFile(join(worktree.path, '.pipeline', 'HALT'), note, 'utf-8').catch(() => {});
}

/**
 * Emit one engineer signal for a completed daemon feature. Maps the worktree
 * outcome to a `FeatureOutcome`, resolves the engineer dir from the environment
 * (`$AI_CONDUCTOR_ENGINEER_DIR`), reads the worktree's `.pipeline/events.jsonl`,
 * derives a fresh runId, and detects whether the retro step was tier-skipped.
 * Best-effort: `emitEngineerSignal` swallows all errors, so this never throws.
 */
async function emitDaemonSignal(
  deps: FeatureRunnerDeps,
  worktree: FeatureWorktree,
  item: BacklogItem,
  outcome: WorktreeOutcome,
): Promise<void> {
  const featureOutcome: FeatureOutcome = {
    slug: item.slug,
    status: outcome.done ? 'done' : outcome.halted ? 'halted' : 'error',
    reason: outcome.reason,
    prUrl: outcome.prUrl,
    costTokens: outcome.costTokens,
  };
  const eventsPath = join(worktree.path, '.pipeline', 'events.jsonl');
  const tierSkippedRetro = await retroTierSkipped(eventsPath);
  await emitEngineerSignal({
    engineerDir: resolveEngineerDir(),
    eventsPath,
    outcome: featureOutcome,
    project: deps.project,
    feature: item.slug,
    runId: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    worktreePath: worktree.path,
    provider: deps.provider,
    tierSkippedRetro,
    log: deps.log,
  });
}


/**
 * True if the feature's events show the `retro` step was tier-skipped, so the
 * emission produces a signal without a narrative (no narrative source to use).
 * Tolerant of a missing/malformed log (returns false).
 */
async function retroTierSkipped(eventsPath: string): Promise<boolean> {
  try {
    const raw = await readFile(eventsPath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed) as { type?: string; step?: string };
        if (evt.type === 'tier_skip' && evt.step === 'retro') return true;
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // no log / unreadable → not tier-skipped (best-effort)
  }
  return false;
}
