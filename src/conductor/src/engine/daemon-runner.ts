import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import type { BacklogItem, FeatureOutcome } from './daemon.js';
import type { LLMProvider } from '../execution/llm-provider.js';
import { emitEngineerSignal, resolveEngineerDir } from './engineer-store.js';
import {
  enrollWatch as enrollWatchImpl,
  sweepMergeableLabels as sweepMergeableLabelsImpl,
  type WatchEntry,
  type SweepOpts,
} from './mergeable-sweep.js';
import {
  prMergeState,
  removeLabel,
  setReady,
  cleanupHaltPresentation,
  makeProductionGh,
  type GhRunner,
} from './pr-labels.js';
import type { FinishChoice } from './artifacts.js';
import type { TriageOutcome } from './setup-triage.js';
import { SetupFailureError } from './worktree-prepare.js';

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
  /**
   * The finish skill's recorded outcome (from `.pipeline/finish-choice`),
   * when readable. `discard`/`keep` are no-ship outcomes even though the
   * gate-driven loop still converges (writes DONE) for them; /finish itself
   * skips the shipped-record commit for those choices (#204, #205).
   */
  finishChoice?: FinishChoice;
  /**
   * Setup-failure triage evidence: outcome of the triage engine when a
   * SetupFailureError is caught in daemon mode. Contains classification
   * and diagnostics (tree state, quarantine info, output tail) for routing
   * and human inspection.
   */
  triageEvidence?: TriageOutcome;
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
  /** Persist that a slug shipped (with its PR url, when opened) so
   *  discoverBacklog skips it next poll and the startup dashboard can link it. */
  markProcessed: (slug: string, prUrl?: string) => Promise<void>;
  /**
   * Daemon mode. When true, emit a structured engineer signal + narrative to the
   * cross-project engineer store on completion (Phase 9.1). Manual `/conduct` runs
   * pass false — they keep writing repo `.docs/retros/` and emit nothing.
   */
  daemon: boolean;
  /** LLM provider used to produce the `done`-feature retro narrative. */
  provider: LLMProvider;
  /**
   * The resolved active memory provider for this run (adr-2026-06-29-per-project-memory-provider-selection).
   * Computed once at run start via `resolveMemoryProvider` — all memory-using
   * steps see the same provider (FR-10). Optional so existing test helpers
   * that predate this field do not require updates.
   */
  memoryProvider?: unknown;
  /**
   * Project key for the engineer store — the project's basename, derived from the
   * main checkout (`basename(projectRoot)`), NOT the worktree path. Worktrees
   * live at `<projectRoot>/.worktrees/<slug>`, so deriving from the worktree
   * would yield `.worktrees` for every project and collapse cross-project
   * disambiguation (FR-9).
   */
  project: string;
  log?: (msg: string) => void;
  /**
   * FR-9: project root of the main checkout — used as the watch registry location
   * and as `repoCwd` for gh commands post-teardown. Absent → label ops are skipped.
   */
  projectRoot?: string;
  /**
   * FR-16: gh runner for clear-on-success label ops (removeLabel + setReady).
   * Defaults to the production factory when absent.
   */
  runGh?: GhRunner;
  /**
   * FR-9: enroll a shipped PR in the mergeable watch registry.
   * Defaults to the real enrollWatch; injected in tests to assert call order and
   * verify failure isolation (teardown/markProcessed still run on throw).
   */
  enrollWatch?: (projectRoot: string, entry: WatchEntry) => Promise<void>;
  /**
   * FR-14: mergeable label sweep, invoked after each feature completes.
   * Defaults to the real sweepMergeableLabels; injected in tests to assert cadence
   * and verify throw-isolation (feature result unaffected by sweep errors).
   */
  sweepMergeableLabels?: (opts: SweepOpts) => Promise<void>;
  /**
   * Escalate a false-ship outcome by pushing the worktree branch and opening a
   * draft `needs-remediation` PR, preserving the work on origin. Called when an
   * outcome converges `DONE` but fails the ship-eligibility guard (finishChoice
   * is not 'pr', prUrl is null, etc.). The worktree path is the cwd so the
   * operation has full git context. Returns the escalation result (prUrl on
   * success, {} on push failure — a best-effort best documented contract for
   * FR-7 degradation). Optional; if absent, the failed-ship branch skips
   * escalation and merely halts.
   */
  escalateBuildFailure?: (opts: {
    projectRoot: string;
    failureReason: string;
  }) => Promise<{ prUrl?: string }>;
  /**
   * Task 13: Setup-failure triage dispatcher (daemon mode only). When present,
   * the daemon catches SetupFailureError and routes it through the triage engine
   * to classify the failure and decide whether to route to quarantine+retry or
   * park. Optional; if absent, SetupFailureError behaves like any other error
   * (worktree kept, feature marked error).
   */
  runSetupTriage?: (worktree: FeatureWorktree, error: SetupFailureError) => Promise<TriageOutcome>;
}

/**
 * Verify that an outcome is a legitimate ship: `done=true` AND `finishChoice='pr'`
 * AND `prUrl` is non-null. This is the only outcome eligible for the ship side
 * effects (markProcessed, cleanup, enroll). Any other done-outcome is a false
 * ship that requires halting and remediation escalation (#337).
 */
function isVerifiedShip(outcome: WorktreeOutcome): boolean {
  return outcome.done === true && outcome.finishChoice === 'pr' && outcome.prUrl != null;
}

/**
 * Generate a reason string explaining why an outcome is a false ship, naming the
 * specific contradiction (missing finishChoice, finishChoice != 'pr', prUrl null).
 * Used in the HALT marker and escalation reason.
 */
function failureReasonForFalseShip(outcome: WorktreeOutcome): string {
  if (!outcome.finishChoice) {
    return 'done without a finish-choice marker (expected finishChoice: "pr")';
  }
  if (outcome.finishChoice !== 'pr') {
    return `done without a verified PR ship — finish choice is "${outcome.finishChoice}" not "pr"`;
  }
  if (!outcome.prUrl) {
    return 'done without a verified PR ship — prUrl is null or missing (expected after successful push)';
  }
  return 'done outcome failed ship eligibility guard (unknown reason)';
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
  const gh = deps.runGh ?? makeProductionGh();
  const enroll = deps.enrollWatch ?? enrollWatchImpl;
  const sweep = deps.sweepMergeableLabels ?? sweepMergeableLabelsImpl;

  /** FR-14: best-effort sweep; never throws, never disrupts feature processing. */
  const maybeSweep = async (): Promise<void> => {
    if (!deps.projectRoot) return;
    try {
      await sweep({ projectRoot: deps.projectRoot, log, runGh: deps.runGh });
    } catch (err) {
      log(`[daemon-runner] sweep error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

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
      if (deps.prepareWorktree) {
        try {
          await deps.prepareWorktree(worktree);
        } catch (prepareErr) {
          // Check if error is a SetupFailureError (by name and presence of outputTail)
          const isSetupFailure = prepareErr instanceof Error &&
            (prepareErr.name === 'SetupFailureError' || (prepareErr.constructor?.name === 'SetupFailureError')) &&
            typeof (prepareErr as any).outputTail === 'string';
          if (
            isSetupFailure &&
            deps.daemon &&
            deps.runSetupTriage
          ) {
            // Daemon mode with triage handler: classify and route the failure
            const triageOutcome = await deps.runSetupTriage(worktree, prepareErr as SetupFailureError);
            if (triageOutcome.kind === 'park') {
              // Triage returned park: error outcome, worktree kept
              log(
                `[daemon-runner] triage outcome: park, erroring feature — ${triageOutcome.outputTail}`,
              );
              await writeErrorHalt(worktree, triageOutcome.outputTail, log, triageOutcome);
              await deps.teardownWorktree(worktree, true);
              return {
                slug: item.slug,
                status: 'error',
                reason: triageOutcome.outputTail || 'setup failed and parked after triage',
              };
            }
            // Other triage outcomes (pass, quarantined-pass, fixed-pass) → continue to runConductor
            log(`[daemon-runner] triage outcome: ${triageOutcome.kind}, continuing to runConductor`);
          } else {
            // Not a SetupFailureError, or daemon=false, or no triage handler: today's path
            throw prepareErr;
          }
        }
      }
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
        if (isVerifiedShip(outcome)) {
          // Happy path: outcome is a verified ship (done=true, finishChoice='pr', prUrl != null).
          // Run the existing ship side effects.

          // FR-16: clear-on-success — verify-after-write cleanup of halt presentation
          // markers (label, draft status, body marker). Returns 'confirmed' on success,
          // 'partial' on any residual markers. Best-effort: logged and swallowed so
          // enroll + teardown still run regardless.
          if (outcome.prUrl && deps.projectRoot) {
            try {
              const cleanupResult = await cleanupHaltPresentation(gh, deps.projectRoot, outcome.prUrl, log);
              log(`[daemon-runner] cleanup result: ${cleanupResult}`);
            } catch (err) {
              log(
                `[daemon-runner] clear-on-success error: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }

          // FR-9: enroll the shipped PR in the mergeable watch registry BEFORE
          // teardown (worktree path still valid for context). Best-effort: enroll
          // internally swallows; the outer wrap logs any re-throw so teardown still
          // runs.
          if (outcome.prUrl && deps.projectRoot) {
            try {
              await enroll(deps.projectRoot, {
                prUrl: outcome.prUrl,
                slug: item.slug,
                repoCwd: deps.projectRoot,
              });
            } catch (err) {
              log(`[daemon-runner] enrollWatch error: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          await deps.markProcessed(item.slug, outcome.prUrl);

          // #204/#205: the durable `.docs/shipped/<slug>.md` record is NOT
          // written here — `/finish` commits it on the IMPLEMENTATION branch
          // (via `conduct shipped-record`) before the branch's final push, so
          // the human merge lands code + shipped-fact atomically (ADR
          // adr-2026-07-03-committed-shipped-record-dispatch-dedup, Decision 1).
          // If the finish flow failed to write it, dedup degrades to the
          // `.daemon/processed/` ledger marker written above.

          await deps.teardownWorktree(worktree, false);
          log(`✓ ${item.slug} shipped${outcome.prUrl ? ` → ${outcome.prUrl}` : ''}`);
          // FR-14: sweep mergeable labels after feature completes.
          await maybeSweep();
          return {
            slug: item.slug,
            status: 'done',
            prUrl: outcome.prUrl,
            costTokens: outcome.costTokens,
          };
        }

        // False-ship case: outcome converged DONE but failed the ship-eligibility guard.
        // #337: halting ineligible outcomes prevents silent locked-up features.
        // Remove the DONE marker (the gate loop wrote it prematurely), write HALT with a
        // reason naming the contradiction, call escalateBuildFailure (best-effort — push
        // failure logs and does not disrupt), keep the worktree, teardown with keep=true,
        // and report halted.
        const reason = failureReasonForFalseShip(outcome);
        const doneMarker = join(worktree.path, '.pipeline', 'DONE');
        await rm(doneMarker, { force: true }).catch(() => {});
        await writeErrorHalt(worktree, reason, log);

        // Escalate the false ship: push the branch and open a draft needs-remediation PR
        // (so even the failure path preserves the work on origin). Best-effort: logs any
        // error internally. Optional: if no escalateBuildFailure is present, the HALT
        // marker and kept worktree still protect the work.
        if (deps.escalateBuildFailure) {
          try {
            await deps.escalateBuildFailure({
              projectRoot: worktree.path,
              failureReason: reason,
            });
          } catch (err) {
            log(
              `[daemon-runner] escalateBuildFailure error: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        await deps.teardownWorktree(worktree, true);
        log(`✋ ${item.slug} false-ship halted — worktree kept (${reason})`);
        // FR-14: sweep mergeable labels after feature completes (failed-ship).
        await maybeSweep();
        return {
          slug: item.slug,
          status: 'halted',
          reason,
          costTokens: outcome.costTokens,
        };
      }

      if (outcome.halted) {
        await deps.teardownWorktree(worktree, true); // keep for the human
        log(`✋ ${item.slug} halted — worktree kept (${outcome.reason ?? 'see .pipeline/HALT'})`);
        // FR-14: sweep mergeable labels after feature completes (halted).
        await maybeSweep();
        return {
          slug: item.slug,
          status: 'halted',
          reason: outcome.reason,
          costTokens: outcome.costTokens,
        };
      }

      // Loop ended without DONE or HALT — treat as an error, keep the worktree.
      const noMarkerReason = outcome.reason ?? 'loop ended without DONE or HALT marker';
      // If triage evidence is present (and it's a park outcome), pass it to writeErrorHalt
      const triageEvidenceForHalt =
        outcome.triageEvidence && outcome.triageEvidence.kind === 'park'
          ? outcome.triageEvidence
          : undefined;
      await writeErrorHalt(worktree, noMarkerReason, log, triageEvidenceForHalt);
      await deps.teardownWorktree(worktree, true);
      // FR-14: sweep mergeable labels after feature completes (error/no-marker).
      await maybeSweep();
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
        await writeErrorHalt(worktree, reason, log);
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
async function writeErrorHalt(worktree: FeatureWorktree, reason: string, log?: (msg: string) => void, triageEvidence?: unknown): Promise<void> {
  let note = `feature errored — parked for human inspection\n${reason}\n`;

  // If triage evidence is present and it's a park outcome, render extended diagnostics
  const triage = triageEvidence as any;
  if (triage && typeof triage === 'object' && triage.kind === 'park') {
    note += `\n──── Triage Evidence ────\n`;

    // Output tail
    if (triage.outputTail) {
      note += `\nOutput tail:\n${triage.outputTail}\n`;
    }

    // Quarantine ref or explicit no-quarantine statement
    if (triage.quarantineRef) {
      note += `\nQuarantine ref: ${triage.quarantineRef}\n`;
    } else {
      note += `\nNo quarantine present (clean-HEAD case)\n`;
    }

    // Contract outcome
    if (triage.contractOutcome) {
      note += `\nContract outcome: ${triage.contractOutcome}\n`;
    }
  }

  note +=
    `\nResume procedure:\n` +
    `  1. Fix the cause of the error above (project setup / config / environment / a crashed step).\n` +
    `  2. rm .pipeline/HALT\n` +
    `  3. Re-queue the feature (restart the daemon if it was excluded this run).\n`;
  await mkdir(join(worktree.path, '.pipeline'), { recursive: true }).catch((err) => {
    if (log) log(`[daemon-runner] HALT mkdir error: ${err instanceof Error ? err.message : String(err)}`);
  });
  await writeFile(join(worktree.path, '.pipeline', 'HALT'), note, 'utf-8').catch((err) => {
    if (log) log(`[daemon-runner] HALT write error: ${err instanceof Error ? err.message : String(err)}`);
  });
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
