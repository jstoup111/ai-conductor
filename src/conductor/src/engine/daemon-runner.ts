import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import type { BacklogItem, FeatureOutcome } from './daemon.js';
import type { LLMProvider } from '../execution/llm-provider.js';
import type { ProviderExecutionContext } from './provider-execution.js';
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
import type { ConductorEventEmitter } from '../ui/events.js';
import {
  evaluateShipmentEvidence,
  resolveImplementationPrBinding,
  type ShipmentEvidenceInput,
  type ShipmentEvidenceResult,
} from './shipment-evidence.js';
import { currentCommitSha } from './project-prelude.js';
import { writeHaltMarker } from './halt-marker.js';
import { writeAutoPark } from './park-marker.js';
import type { OperatorParkedTermination } from './conductor.js';

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

export interface FeatureRunScope {
  events: ConductorEventEmitter;
  providerExecution: ProviderExecutionContext;
  /** Immutable logger that attributes runner-owned output to this feature. */
  log?: (message: string) => void;
  stop: () => void | Promise<void>;
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
  prepareWorktree?: (worktree: FeatureWorktree, log?: (message: string) => void) => Promise<void>;
  /** Run the conductor's gate loop in the worktree to DONE/HALT (finish=open PR). */
  runConductor: (
    worktree: FeatureWorktree,
    item: BacklogItem,
    providerExecution?: ProviderExecutionContext,
    events?: ConductorEventEmitter,
    log?: (message: string) => void,
  ) => Promise<void | OperatorParkedTermination>;
  /** Read the loop outcome from the worktree's markers. */
  readOutcome: (worktree: FeatureWorktree) => Promise<WorktreeOutcome>;
  /**
   * Strict durable-evidence verifier for a terminal PR outcome. The production
   * default reads committed evidence; injection keeps daemon orchestration
   * tests independent of a real Git repository.
   */
  shipmentEvidence?: (input: ShipmentEvidenceInput) => Promise<ShipmentEvidenceResult>;
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
  /** Legacy narrative provider when provider-aware feature execution is absent. */
  provider?: LLMProvider;
  /** Fresh provider routing state allocated once for each feature run. */
  providerExecution?: () => ProviderExecutionContext;
  /** Feature-local provider/event state, opened after worktree creation. */
  beginFeatureRun?: (
    worktree: FeatureWorktree,
    item: BacklogItem,
  ) => FeatureRunScope | Promise<FeatureRunScope>;
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
  /** Clear halt presentation after a verified ship. Injected in tests. */
  cleanupHaltPresentation?: typeof cleanupHaltPresentation;
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
    log?: (message: string) => void;
  }) => Promise<{ prUrl?: string }>;
  /**
   * Task 13: Setup-failure triage handler (daemon mode only). When a
   * SetupFailureError is caught during prepareWorktree and daemon mode is
   * enabled, route it here for classification. Returns 'park' to error the
   * feature, or 'quarantined-pass' to continue to runConductor.
   */
  runSetupTriage?: (
    error: SetupFailureError,
    worktree: FeatureWorktree,
    item: BacklogItem,
    providerExecution?: ProviderExecutionContext,
    log?: (message: string) => void,
  ) => Promise<TriageOutcome>;
  /**
   * Task 14 (TS-5): Surface quarantine evidence to the resuming build agent.
   * Called once triage settles on a non-park outcome, BEFORE the worktree is
   * handed to `runConductor`. Writes `.pipeline/QUARANTINE` in the worktree
   * when a quarantine ref is live (this rotation or a prior one) so the
   * dispatched agent can see the ref, preserved paths, and recovery guidance.
   * Optional; absent → no sentinel is written (backward-compatible). Fail-open
   * by contract of the real implementation — daemon-runner also guards the
   * call so a thrown error never blocks dispatch.
   */
  surfaceQuarantineRef?: (
    worktree: FeatureWorktree,
    slug: string,
    outcome: TriageOutcome,
    log?: (message: string) => void,
  ) => Promise<void>;
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
 * A PR-shaped terminal marker is only a candidate for shipment. Re-check the
 * record against the worktree's committed HEAD before any daemon-owned ship
 * side effect (cache, presentation cleanup, watch enrollment, or teardown).
 */
async function shipmentFailureReason(
  deps: FeatureRunnerDeps,
  worktree: FeatureWorktree,
  item: BacklogItem,
  outcome: WorktreeOutcome,
  gh: GhRunner,
): Promise<string | null> {
  if (!isVerifiedShip(outcome)) return failureReasonForFalseShip(outcome);

  const candidateCommit = (await currentCommitSha(worktree.path)) ?? 'HEAD';
  try {
    const input = {
      repoDir: worktree.path,
      slug: item.slug,
      implementationPr: outcome.prUrl!,
      candidateCommit,
    };
    const verdict = deps.shipmentEvidence
      ? await deps.shipmentEvidence(input)
      : await evaluateShipmentEvidence(input, {
          githubRunner: (implementationPr) =>
            resolveImplementationPrBinding(gh, worktree.path, implementationPr),
        });
    if (verdict.kind === 'valid') return null;
    const detail = verdict.kind === 'refusal' ? verdict.code : verdict.reason;
    return `durable shipment evidence refused ship: ${detail}`;
  } catch (error) {
    return `durable shipment evidence check failed: ${error instanceof Error ? error.message : String(error)}`;
  }
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
  const cleanup = deps.cleanupHaltPresentation ?? cleanupHaltPresentation;

  /** FR-14: best-effort sweep; never throws, never disrupts feature processing. */
  const maybeSweep = async (): Promise<void> => {
    if (!deps.projectRoot) return;
    try {
      await sweep({
        projectRoot: deps.projectRoot,
        log,
        runGh: deps.runGh,
        teardownWorktree: deps.teardownWorktree,
      });
    } catch (err) {
      log(`[daemon-runner] sweep error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return async (item: BacklogItem): Promise<FeatureOutcome> => {
    let worktree: FeatureWorktree | null = null;
    let featureRun: FeatureRunScope | undefined;
    let featureLog = log;
    let providerExecution: ProviderExecutionContext | undefined;
    try {
      // The worktree is cut from the fast-forwarded default branch, so the vetted
      // stories+plan are already committed in it — no materialization/copy needed.
      worktree = await deps.createWorktree(item.slug);
      featureRun = await deps.beginFeatureRun?.(worktree, item);
      featureLog = featureRun?.log ?? log;
      providerExecution =
        featureRun?.providerExecution ?? deps.providerExecution?.();
      // Prepare the worktree before the build: write WORKTREE_NAMESPACE and run
      // the project's bin/setup. A project that ships no bin/setup still gets
      // the namespace written; a setup failure throws and is handled like any
      // other primitive throw (worktree kept, feature errored).
      if (deps.prepareWorktree) {
        try {
          await deps.prepareWorktree(worktree, featureLog);
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
            const triageOutcome = await deps.runSetupTriage(
              prepareErr as SetupFailureError,
              worktree,
              item,
              providerExecution,
              featureLog,
            );
            if (triageOutcome.kind === 'park') {
              // Triage returned park: error outcome, worktree kept
              featureLog(
                `[daemon-runner] triage outcome: park, erroring feature — ${triageOutcome.outputTail}`,
              );
              await writeErrorHalt(worktree.path, triageOutcome.outputTail, featureLog, triageOutcome, item.slug);
              await deps.teardownWorktree(worktree, true);
              return {
                slug: item.slug,
                status: 'error',
                reason: triageOutcome.outputTail || 'parked after setup triage',
              };
            }
            // Other triage outcomes (pass, quarantined-pass, fixed-pass) → continue to runConductor
            featureLog(`[daemon-runner] triage outcome: ${triageOutcome.kind}, continuing to runConductor`);

            // Task 14 (TS-5): surface quarantine evidence to the resuming build
            // agent before dispatch. Fail-open — a surfacing failure must never
            // block the build; it is diagnostic only.
            if (deps.surfaceQuarantineRef) {
              try {
                await deps.surfaceQuarantineRef(worktree, item.slug, triageOutcome, featureLog);
              } catch (err) {
                featureLog(
                  `[daemon-runner] quarantine surfacing error (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }
          } else {
            // Not a SetupFailureError, or daemon=false, or no triage handler: today's path
            throw prepareErr;
          }
        }
      }
      const conductorTermination = await deps.runConductor(
        worktree,
        item,
        providerExecution,
        featureRun?.events,
        featureLog,
      );
      if (conductorTermination?.kind === 'operator-parked') {
        return {
          slug: item.slug,
          status: 'parked',
        };
      }
      const outcome = await deps.readOutcome(worktree);

      // Phase 9.1: on daemon completion, emit a structured signal + narrative to
      // the cross-project engineer store. Runs AFTER readOutcome and BEFORE any
      // teardown (the worktree context is still present for the retro). Manual
      // runs (daemon=false) emit nothing and keep their repo `.docs/retros/`.
      // Best-effort inside emitEngineerSignal — never throws, so it cannot affect
      // the feature outcome or teardown discipline below.
      if (deps.daemon) {
        await emitDaemonSignal(deps, worktree, item, outcome, providerExecution, featureLog);
      }

      if (outcome.done) {
        const shipmentFailure = await shipmentFailureReason(deps, worktree, item, outcome, gh);
        if (shipmentFailure === null) {
          // Happy path: outcome is a verified ship (done=true, finishChoice='pr', prUrl != null).
          // Run the existing ship side effects.

          // FR-16: clear-on-success — verify-after-write cleanup of halt presentation
          // markers (label, draft status, body marker). Returns 'confirmed' on success,
          // 'partial' on any residual markers. Best-effort: logged and swallowed so
          // enroll + teardown still run regardless.
          if (outcome.prUrl && deps.projectRoot) {
            try {
              const cleanupResult = await cleanup(
                gh,
                deps.projectRoot,
                outcome.prUrl,
                featureLog,
              );
              featureLog(`[daemon-runner] cleanup result: ${cleanupResult}`);
            } catch (err) {
              featureLog(
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
              featureLog(`[daemon-runner] enrollWatch error: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          await deps.markProcessed(item.slug, outcome.prUrl);
          featureLog(`[daemon-runner] worktree retained at ${worktree.path}`);
          featureLog(`[daemon-runner] retained ${item.slug} — reason: pr-open-awaiting-main`);

          // #204/#205: the durable `.docs/shipped/<slug>.md` record is NOT
          // written here — `/finish` commits it on the IMPLEMENTATION branch
          // (via `conduct shipped-record`) before the branch's final push, so
          // the human merge lands code + shipped-fact atomically (ADR
          // adr-2026-07-03-committed-shipped-record-dispatch-dedup, Decision 1).
          // If the finish flow failed to write it, dedup degrades to the
          // `.daemon/processed/` ledger marker written above.

          featureLog(`✓ ${item.slug} shipped${outcome.prUrl ? ` → ${outcome.prUrl}` : ''}`);
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
        const reason = shipmentFailure;
        const doneMarker = join(worktree.path, '.pipeline', 'DONE');
        await rm(doneMarker, { force: true }).catch(() => {});
        await writeErrorHalt(worktree.path, reason, featureLog, undefined, item.slug);

        // Escalate the false ship: push the branch and open a draft needs-remediation PR
        // (so even the failure path preserves the work on origin). Best-effort: logs any
        // error internally. Optional: if no escalateBuildFailure is present, the HALT
        // marker and kept worktree still protect the work.
        if (deps.escalateBuildFailure) {
          try {
            await deps.escalateBuildFailure({
              projectRoot: worktree.path,
              failureReason: reason,
              log: featureLog,
            });
          } catch (err) {
            featureLog(
              `[daemon-runner] escalateBuildFailure error: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        await deps.teardownWorktree(worktree, true);
        featureLog(`✋ ${item.slug} false-ship halted — worktree kept (${reason})`);
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
        featureLog(`✋ ${item.slug} halted — worktree kept (${outcome.reason ?? 'see .pipeline/HALT'})`);
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
      await writeErrorHalt(worktree.path, noMarkerReason, featureLog, triageEvidenceForHalt, item.slug);
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
      const haltRoot = worktree?.path ?? (
        deps.projectRoot ? join(deps.projectRoot, '.worktrees', item.slug) : undefined
      );
      if (haltRoot) {
        await writeErrorHalt(haltRoot, reason, featureLog, undefined, item.slug);
      }
      if (worktree) {
        await deps.teardownWorktree(worktree, true).catch(() => {});
      }
      return {
        slug: item.slug,
        status: 'error',
        reason,
      };
    } finally {
      await featureRun?.stop();
    }
  };
}

/**
 * Write a diagnostic `.pipeline/HALT` into a worktree whose feature errored, so
 * the failure is visible (the daemon log only shows `error`) and the feature
 * parks for human inspection rather than being silently excluded. Best-effort:
 * a write failure must never mask the original error.
 */
async function writeErrorHalt(
  worktreePath: string,
  reason: string,
  log?: (msg: string) => void,
  triageEvidence?: unknown,
  slug?: string,
  heading = 'feature errored — parked for human inspection',
): Promise<void> {
  let note = `${heading}\n${reason}\n`;

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
      note += `\nNo quarantine ref exists (clean-HEAD case)\n`;
    }

    // Contract outcome
    if (triage.contractOutcome) {
      note += `\nContract outcome: ${triage.contractOutcome}\n`;
    }

    // Dirty paths left behind by an unverifiable half-fix
    if (Array.isArray(triage.preservedPaths) && triage.preservedPaths.length > 0) {
      note += `\nDirty paths after fix-session:\n${triage.preservedPaths.map((p: string) => `  - ${p}`).join('\n')}\n`;
    }
  }

  note +=
    `\nResume procedure:\n` +
    `  1. Fix the cause of the error above (project setup / config / environment / a crashed step).\n` +
    `  2. rm .pipeline/HALT\n` +
    `  3. Re-queue the feature (restart the daemon if it was excluded this run).\n`;
  await writeHaltMarker(worktreePath, note, 'needs-human');
  await Promise.all([
    readFile(join(worktreePath, '.pipeline', 'HALT'), 'utf-8'),
    readFile(join(worktreePath, '.pipeline', 'HALT.class'), 'utf-8'),
  ]).then(([body, haltClass]) => {
    if (body !== note || haltClass !== 'needs-human') {
      throw new Error('marker verification failed');
    }
  }).catch((err) => {
    if (log) {
      log(
        `[daemon-runner] unrecoverable-state: HALT marker write failed for ${slug ?? worktreePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
}

export interface TerminateFeatureOptions {
  worktreePath: string;
  reason: string;
  park: boolean;
  log?: (msg: string) => void;
  triageEvidence?: unknown;
  slug?: string;
  projectRoot?: string;
}

type AutoParkWriteOutcome = 'not-requested' | 'written' | 'failed';

/**
 * Record an errored feature's diagnostic HALT. A non-parked termination leaves
 * no daemon park marker so the normal backlog scan may dispatch it again.
 */
export async function terminateFeature({
  worktreePath,
  reason,
  park,
  log,
  triageEvidence,
  slug,
  projectRoot,
}: TerminateFeatureOptions): Promise<void> {
  const autoParkWriteOutcome: AutoParkWriteOutcome = park && slug
    ? await writeAutoPark(projectRoot ?? worktreePath, slug, reason)
      .then(() => 'written' as const)
      .catch(() => 'failed' as const)
    : 'not-requested';

  await writeErrorHalt(
    worktreePath,
    reason,
    log,
    triageEvidence,
    slug,
    autoParkWriteOutcome === 'not-requested'
      ? 'feature errored — will re-dispatch on the next scan'
      : 'feature errored — parked for human inspection',
  );
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
  providerExecution?: ProviderExecutionContext,
  log?: (message: string) => void,
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
    providerExecution,
    tierSkippedRetro,
    log,
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
