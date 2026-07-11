import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  access as accessFile,
  unlink as unlinkFile,
  stat,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { HALT_MARKER } from './halt-marker.js';
import type { ConductState } from '../types/index.js';
import type {
  StepName,
  StepStatus,
  StepDefinition,
  Phase,
  RunMode,
  ComplexityTier,
  RecoveryOption,
  RecoveryContext,
} from '../types/index.js';
import type { RateLimitEpisode } from './rate-limit-episode.js';
import type { ParallelBranch } from '../types/config.js';
import { evaluateWhen } from './when-expression.js';
import type { HarnessConfig } from '../types/config.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { BuildProgressWatcher } from './build-progress-watcher.js';
import { resolveBuildProgressConfig, isAttributionJudgeCutoverActive } from './config.js';
import {
  isEnforcementConfigured,
  writeBuildStepMarker,
  removeBuildStepMarker,
  detectZeroWorkProduct,
  readDispatchCount,
  resolveAttributionAuditSamplePct,
} from './attribution-enforcement.js';
import { runAttributionLane, type AttributionLaneResult, dispatchAttributionVerifier } from './attribution-lane.js';
import { runSpotAudit } from './attribution-audit.js';
import {
  readState,
  writeState,
  saveStepStatus,
  getStepStatus,
  markDownstreamStale,
  savePrUrl,
  extractPrUrl,
} from './state.js';
import {
  ALL_STEPS,
  buildStepRegistry,
  shouldSkipForBootstrapMode,
  shouldSkipForUpstreamSkip,
} from './steps.js';
import { checkGate } from './gates.js';
import {
  findArtifactFiles as findArtifactFilesForStep,
  resolveFeaturePlanPath,
  STEP_ARTIFACT_GLOBS,
  checkStepCompletion,
  CUSTOM_COMPLETION_PREDICATES,
  classifyPrdAuditGaps,
  readRemediationPlan,
  sweepStaleReviewArtifacts,
  parseTrack,
  parseIntakeSourceRef,
  planStem,
  readManualTestFailRows,
  BUILD_REVIEW_VERDICT,
  validateBuildReviewVerdict,
  FINISH_CHOICE_MARKER,
  type RemediationGap,
  type CompletionContext,
} from './artifacts.js';
import { currentCommitSha } from './project-prelude.js';
import type { Track } from '../types/index.js';
import {
  resolveStepConfig,
  resolveRebaseResolutionAttempts,
  resolveSelfHostConfig,
  resolveBuildReviewConfig,
} from './resolved-config.js';
import {
  defaultSelfHostGuardrails,
  type SelfHostGuardrails,
} from './self-host/wiring.js';
import type { SandboxBuildEnv } from './self-host/sandbox-build-env.js';
import { waitForCredentialsChange, readOperatorCredentialsState } from './self-host/operator-credentials.js';
import { preflightBuildAuthCheck as checkBuildAuth } from './self-host/build-auth-preflight.js';
import { readDaemonBuildToken, createDaemonTokenContentClassifier } from './self-host/daemon-build-token.js';
import type { ChangedFile } from './self-host/release-gate.js';
import type { GateVerdict } from './self-host/gate-halt.js';
import { selectNextGate, earliestUnsatisfiedGateIndex } from './selector.js';
import {
  computeAndWriteVerdict,
  readAllVerdicts,
  type GateVerdict as GateObjectiveVerdict,
} from './gate-verdicts.js';
import { WorktreeManager } from './worktree.js';
import { deriveCompletion, applyDerivedCompletion } from './autoheal.js';
import {
  countResolvedTasks,
  haltMarkerExists,
  clearHaltMarker,
  readHaltMarkerContent,
  writeStallQuestionEvidence,
  writeStallHalt,
} from './task-progress.js';
import {
  makeGitRunner,
  performRebase,
  runGatedRebaseResolution,
  applyRebaseVerdicts,
  emitRebaseEvent,
  recordRebaseStepCompletion,
  writeHalt,
  originDefaultBranch,
  type RebaseOutcome,
  type ResolutionContext,
  type ResolutionAttempt,
  type SetupFailureContext,
  type SetupFailureAttempt,
} from './rebase.js';
import {
  escalateBuildFailure as defaultEscalateBuildFailure,
  type EscalateBuildFailureOpts,
  type EscalateBuildFailureResult,
} from './build-failure-escalation.js';
import { writeIntakeMarker } from './engineer/intake-marker.js';
import { readMachineOwnerConfig } from './owner-gate/machine-identity.js';
import { resolveDaemonOwner, type GhRunner } from './owner-gate/identity.js';
import { makeProductionGh, makeProductionGit, prMergeState, type GitRunner } from './pr-labels.js';
import { headPushedToUpstream } from './push-evidence.js';
import {
  createTaskEvidence,
  type TaskEvidence,
} from './task-evidence.js';
import { seedTaskStatus, clearStaleMarker } from './task-seed.js';
import { checkMergedPrGuard, writeSyntheticShipMarkers } from './merged-pr-guard.js';

export type CheckpointResponse = 'continue' | 'back' | 'quit';

/**
 * How many times a user may pick `retry` from the recovery menu for a single
 * step in one conductor session before the UI drops the option. After this,
 * the step has clearly entered a loop the auto-retry couldn't escape — the
 * user is pushed toward `interactive`, `back`, or `quit` instead.
 */
export const MAX_RECOVERY_RETRIES = 2;

// ── Gate-driven loop (Phase 3) ──────────────────────────────────────────────
// Gate topology — DERIVED from the resolved step registry, not hardcoded, so
// custom config steps (and reordering) participate in the gate loop:
//   - loopGate steps     → the selector-driven tail (build…finish by default)
//   - kickbackTarget steps → upstream gates a downstream step may re-open
//   - verdictSteps        → either of the above (verdict recomputed after run)
//   - firstLoopIndex      → the front/loop boundary (first loopGate step)
//   - regionStart         → where the selector starts scanning (first kickback target)
interface GateTopology {
  verdictSteps: Set<StepName>;
  kickbackTargets: StepName[];
  firstLoopIndex: number;
  regionStart: StepName;
}
function deriveGateTopology(steps: StepDefinition[]): GateTopology {
  const verdictSteps = new Set<StepName>();
  const kickbackTargets: StepName[] = [];
  let firstLoopIndex = steps.length;
  steps.forEach((s, i) => {
    if (s.loopGate) {
      verdictSteps.add(s.name);
      if (i < firstLoopIndex) firstLoopIndex = i;
    }
    if (s.kickbackTarget) {
      verdictSteps.add(s.name);
      kickbackTargets.push(s.name);
    }
  });
  const regionStart =
    kickbackTargets[0] ??
    steps.find((s) => s.phase === 'DECIDE')?.name ??
    steps[0]?.name;
  return { verdictSteps, kickbackTargets, firstLoopIndex, regionStart };
}
// Anti-ping-pong: a single gate may be re-opened by kickback at most this many
// times per feature before the loop HALTs for a human.
const MAX_KICKBACKS_PER_GATE = 2;
// Cap on how many times the selector may pick any single gate before it
// satisfies. Catches a gate whose verdict never improves and a build↔plan
// kickback oscillation. Generous enough to allow legitimate kickback re-walks.
const MAX_GATE_SELECTIONS = 6;
const DONE_MARKER = '.pipeline/DONE';
const LOOP_HALT_MARKER = HALT_MARKER;

// Task 23 (auto-park): build-gate no-evidence misses tolerated before the
// daemon parks the feature (durable sidecar counter — see daemon-auto-park.ts).
const DAEMON_NO_EVIDENCE_THRESHOLD = 3;

export interface NavigableStep {
  name: StepName;
  label: string;
  status: StepStatus;
  phase: Phase;
}

export function navigateBack(
  state: ConductState,
  target: StepName,
  steps: StepDefinition[] = ALL_STEPS,
): { state: ConductState; index: number } {
  const allStepNames = steps.map((s) => s.name);
  const updated = markDownstreamStale(state, target, allStepNames);
  (updated as Record<string, unknown>)[target] = 'pending';
  const index = steps.findIndex((s) => s.name === target);
  return { state: updated, index };
}

export function getNavigableSteps(
  state: ConductState,
  steps: StepDefinition[] = ALL_STEPS,
): NavigableStep[] {
  return steps
    .filter((step) => {
      const status = state[step.name];
      return status === 'done' || status === 'stale';
    })
    .map((step) => ({
      name: step.name,
      label: step.label,
      status: state[step.name] as StepStatus,
      phase: step.phase,
    }));
}

export interface StepRunResult {
  success: boolean;
  output?: string;
  /**
   * Set when the provider detected a rate-limit signal in the output (or via
   * marker file). The conductor waits `waitSeconds` and retries without
   * burning the retry budget.
   */
  rateLimited?: boolean;
  /**
   * Number of seconds to wait before retrying after a rate-limit. Default 300.
   */
  waitSeconds?: number;
  /**
   * Task 18: Parsed absolute deadline (milliseconds since epoch) from rate-limit message.
   * When set, represents a timezone-aware reset time extracted from the message
   * (e.g., "resets 3:20pm (America/New_York)"). Used by the episode coordinator
   * for deadline-first scheduling. Undefined if timezone is unknown or not present.
   */
  deadline?: number;
  /**
   * Set when Claude reports "No conversation found" (session evaporated).
   * The conductor resets the session state and retries without burning budget.
   */
  sessionExpired?: boolean;
  /**
   * Set when the operator's OAuth token is expired or invalid.
   * The conductor halts and reports the auth failure.
   */
  authFailure?: boolean;
}

export interface StepRunOptions {
  /**
   * Retry hint injected into the system prompt when the conductor re-invokes
   * this step after a completion-gate miss. Example: "previous attempt did not
   * produce .docs/plans/*.md".
   */
  retryReason?: string;
}

export interface StepRunner {
  run(step: StepName, state: ConductState, opts?: StepRunOptions): Promise<StepRunResult>;
  runInteractive?(step: StepName): Promise<void>;
  assessComplexity?(): Promise<ComplexityTier | null>;
  /**
   * Drop session state so the next invocation creates a fresh Claude session.
   * Called by the conductor when `sessionExpired` is reported.
   */
  resetSession?(): Promise<void>;
  /**
   * Attempt to resolve a paused rebase conflict in the feature worktree.
   * Called by the conductor's engine-native rebase step (daemon only) when
   * a `conflict_halt` outcome is produced and `rebase_resolution_attempts > 0`.
   *
   * The implementation MUST resolve the conflict files, stage them (`git add`),
   * and run `git rebase --continue` so the rebase finishes. Returning
   * `{ resolved: true }` when the rebase is NOT actually finished is treated as
   * a failed attempt (counted toward the cap but retried). Returning
   * `{ resolved: false, reason }` short-circuits all remaining attempts
   * (the conductor HALTs immediately with `reason` in the HALT file).
   *
   * Errors thrown by this method are caught and converted to
   * `{ resolved: false, reason: error.message }`, so an uncaught exception
   * degrades gracefully to a conflict HALT.
   */
  resolveRebaseConflict?(ctx: ResolutionContext): Promise<ResolutionAttempt>;
  /**
   * Dispatch a semantic attribution verifier session for spot-audit sampling.
   * Called by the conductor's build-gate post-green dispatch (Task 15).
   *
   * The verifier runs in a fresh session with the provided residue task IDs,
   * collects candidate commits, and produces an attribution verdict.
   * This method is optional — runners may choose not to expose dispatch.
   */
  dispatchVerifier?(opts: {
    residueIds: string[];
    planPath: string;
    projectRoot: string;
  }): Promise<{ success: boolean; output?: string } | { success: false; output: string }>;
  /**
   * Dispatch a fix-session to resolve a setup failure. Part of the two-stage
   * setup-failure triage (TS-3). Uses a fresh one-shot session (never resumes
   * the main conductor session) with the output tail in the system prompt.
   *
   * Always returns `{ attempted: true }` — the success of the fix is determined
   * by whether the setup step subsequently passes, not by this method's result.
   * Used to bootstrap a fresh session that attempts to fix the root cause so
   * the setup step can be retried.
   */
  resolveSetupFailure?(ctx: SetupFailureContext): Promise<SetupFailureAttempt>;
}

export type ArtifactReviewResult = 'approved' | 'rejected' | 'skip';

export interface ConductorOptions {
  stateFilePath: string;
  stepRunner: StepRunner;
  events: ConductorEventEmitter;
  resume?: boolean;
  fromStep?: StepName;
  mode?: RunMode;
  config?: HarnessConfig;
  projectRoot: string;
  /** Feature description — used by the engine-run worktree step to name the
   *  worktree/branch when state.feature_desc isn't set yet. */
  featureDesc?: string;
  /**
   * When true, after each step that declares artifact globs, require at least
   * one matching file on disk. If not, mark the step failed and route through
   * the recovery menu. Default: false (opt-in — production wires this on).
   */
  verifyArtifacts?: boolean;
  /**
   * Daemon mode (Phase 9.1). When true, the in-loop `retro` step is skipped:
   * the daemon's emission step owns narrative production into the cross-project
   * engineer store instead of writing `.docs/retros/` into the feature repo (ADR-002
   * Option A). Manual `/conduct` runs leave this false and keep writing repo
   * retros unchanged. Default false.
   */
  daemon?: boolean;
  /**
   * Harness self-host mode (Phase 6). True only when the daemon is building the
   * harness repo ITSELF, as classified once at the daemon layer by
   * `classifySelfHost` (path identity + config override). Combined with `daemon`
   * it activates the self-host guardrail bundle (skill relink + sandboxed build
   * env + VERSION/release finish gates) as one unit; for every other repo it is
   * false and the build path is byte-for-byte unchanged. Default false.
   */
  selfHost?: boolean;
  /**
   * Base branch the self-build's changes are diffed against (`<base>...HEAD`) to
   * classify breaking surfaces for the release-artifact migration gate (TR-10).
   * Only consulted for a self-build; absent → the change set is undeterminable
   * and the migration gate fails closed (requires a migration block). Default
   * undefined.
   */
  baseBranch?: string;
  /**
   * Self-host guardrail collaborators (relink / sandbox / finish gates). Injected
   * as one bundle so tests can drive the wired path hermetically. Defaults to the
   * real primitives (`defaultSelfHostGuardrails`).
   */
  selfHostGuardrails?: SelfHostGuardrails;
  /**
   * Maximum auto-retries before a failing step (including artifact miss)
   * escalates to the recovery menu. Matches `max_retries=3` in bin/conduct.
   * Default: 3.
   */
  maxRetries?: number;
  /**
   * Sleep implementation for rate-limit waits. Defaults to setTimeout.
   * Tests inject a spy to avoid real waits.
   */
  sleepFn?: (ms: number) => Promise<void>;
  onCheckpoint?: (step: StepName) => Promise<CheckpointResponse>;
  onNavigate?: (steps: NavigableStep[]) => Promise<StepName | null>;
  onReviewArtifacts?: (step: StepName, files: string[]) => Promise<ArtifactReviewResult>;
  onRecovery?: (
    step: StepName,
    isGating: boolean,
    context?: RecoveryContext,
  ) => Promise<RecoveryOption>;
  onComplexityAssessment?: (recommended: ComplexityTier | null) => Promise<ComplexityTier>;
  /**
   * Injectable escalation function called after any irrecoverable daemon HALT
   * in auto mode. Defaults to the real `escalateBuildFailure` which opens a
   * draft needs-remediation PR. Tests inject a spy to avoid real gh/git calls.
   * The conductor wraps every call in try/catch — a throwing escalation must
   * never prevent the HALT marker or state from being written (C1).
   * Not called for rebase-conflict HALTs (pushing mid-rebase is unsafe).
   */
  escalateBuildFailure?: (opts: EscalateBuildFailureOpts) => Promise<EscalateBuildFailureResult>;
  /**
   * Shell runner for the `gh` CLI (owner identity resolution). Injected for
   * tests; defaults to the real production gh. Used to resolve machine-scoped
   * operator identity for plan-step owner stamping (Slice B, D4).
   */
  gh?: GhRunner;
  /**
   * Shell runner for the `git` CLI (push-evidence verification). Injected for
   * tests; defaults to the real production git. Used to verify push status
   * in the finish gate (daemon false-ship guard).
   */
  git?: GitRunner;
  /**
   * Shell runner for the `gh` CLI (merged-PR guard). Injected for
   * tests; defaults to the real production gh. Used by the merged-PR guard
   * to check recorded PR merge state at kickback and rebase entry points
   * (ADR-2026-07-09-mid-run-merged-pr-guard, Task 3-5).
   */
  runGh?: GhRunner;
  /**
   * Optional rate-limit episode coordinator (Task 10). When provided and active,
   * enables coordinated episode-aware backoff during rate-limit waits, allowing
   * SIGTERM handling and deadline-coordinated redrives. If undefined, rate-limit
   * handling falls back to bare sleep (existing behavior).
   */
  rateLimitEpisode?: RateLimitEpisode;
  /**
   * Task 22: Callback to register an in-flight rate-limit wait AbortController
   * with the daemon-level handler. Called when a conductor creates a wait controller
   * so process-level SIGTERM can abort all in-flight waits across N concurrent conductors.
   * Only used in daemon mode; in interactive mode, per-conductor SIGTERM handlers
   * manage individual controllers. Optional — if absent, the conductor works normally
   * but its wait controller won't be aborted by process-level SIGTERM.
   */
  registerAbortController?: (controller: AbortController) => void;
}

/**
 * Snapshot mtimes of a step's artifact files, keyed by path. Taken BEFORE the
 * step runs so the post-step pass can identify which artifacts the step
 * actually authored (new or rewritten) vs pre-existing historical ones.
 */
async function snapshotArtifactMtimes(
  projectRoot: string,
  step: StepName,
): Promise<Map<string, number>> {
  const snapshot = new Map<string, number>();
  // findArtifactFilesForStep returns absolute paths.
  const files = await findArtifactFilesForStep(projectRoot, step);
  for (const file of files) {
    try {
      const s = await stat(file);
      snapshot.set(file, s.mtimeMs);
    } catch {
      // Raced deletion — treat as absent.
    }
  }
  return snapshot;
}

/**
 * Files from `files` that are new or modified relative to `snapshot`
 * (pre-step). A file absent from the snapshot, or whose mtime changed, was
 * authored by the step this run. Pre-existing untouched files are excluded —
 * their markers (if any) were written by the run that authored them.
 */
async function selectChangedArtifacts(
  files: string[],
  snapshot: Map<string, number> | null,
): Promise<string[]> {
  if (snapshot === null) return files;
  const changed: string[] = [];
  for (const file of files) {
    const before = snapshot.get(file);
    if (before === undefined) {
      changed.push(file);
      continue;
    }
    try {
      const s = await stat(file);
      if (s.mtimeMs !== before) changed.push(file);
    } catch {
      // Deleted during the step — nothing to stamp.
    }
  }
  return changed;
}

function stepHasCompletionCheck(step: StepName): boolean {
  if (CUSTOM_COMPLETION_PREDICATES[step]) return true;
  return (STEP_ARTIFACT_GLOBS[step] ?? []).length > 0;
}

/**
 * Parse `git diff --name-status` output into `ChangedFile[]` for the self-host
 * release-artifact migration classifier. Each line is `<status>\t<path>` for
 * A/M/D, or `R<score>\t<old>\t<new>` / `C<score>\t<old>\t<new>` for a
 * rename/copy — the origin path is preserved so a skill moved OUT of `skills/`
 * (a breaking symlink-target change) is classified on its source side too.
 * Malformed / blank lines are skipped.
 */
function parseNameStatus(stdout: string): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const parts = line.split('\t');
    const status = parts[0];
    if (status.startsWith('R') || status.startsWith('C')) {
      // R<score>\t<old>\t<new> — need both origin and destination paths.
      if (parts.length < 3) continue;
      out.push({ status, origPath: parts[1], path: parts[2] });
    } else {
      if (parts.length < 2 || parts[1] === '') continue;
      out.push({ status, path: parts[1] });
    }
  }
  return out;
}

export class Conductor {
  private stateFilePath: string;
  private stepRunner: StepRunner;
  private events: ConductorEventEmitter;
  private resume: boolean;
  private fromStep?: StepName;
  private mode: RunMode;
  private config: HarnessConfig;
  private projectRoot: string;
  private featureDesc?: string;
  private onCheckpoint: (step: StepName) => Promise<CheckpointResponse>;
  private onNavigate: (steps: NavigableStep[]) => Promise<StepName | null>;
  private verifyArtifacts: boolean;
  private daemon: boolean;
  private selfHost: boolean;
  private baseBranch?: string;
  private guardrails: SelfHostGuardrails;
  /**
   * The self-build's throwaway CLAUDE_CONFIG_DIR sandbox, provisioned lazily on
   * the first `build` dispatch and torn down (idempotently) in `run()`'s finally.
   */
  private activeSandbox: SandboxBuildEnv | null = null;
  /** Guards the one-time skill relink so it runs before the first build only. */
  private relinkDone = false;
  private sleep: (ms: number) => Promise<void>;
  private onReviewArtifacts: (step: StepName, files: string[]) => Promise<ArtifactReviewResult>;
  private onRecovery?: (
    step: StepName,
    isGating: boolean,
    context?: RecoveryContext,
  ) => Promise<RecoveryOption>;
  private onComplexityAssessment?: (recommended: ComplexityTier | null) => Promise<ComplexityTier>;
  /** Escalation function — see ConductorOptions.escalateBuildFailure. */
  private escalateBuildFailure: (opts: EscalateBuildFailureOpts) => Promise<EscalateBuildFailureResult>;
  /** gh CLI runner for owner identity resolution (plan-step stamping, Slice B D4). */
  private gh: GhRunner;
  /** git CLI runner for push-evidence verification (daemon false-ship guard). */
  private git: GitRunner;
  /** gh CLI runner for merged-PR guard (kickback/rebase entry checks, ADR-2026-07-09). */
  private runGh: GhRunner;
  /**
   * The most recent engine-native rebase outcome. The `rebase` step is special:
   * its gate verdict is computed by the native handler (not from a file
   * artifact), so `advanceTail` must NOT recompute/overwrite it. A
   * `conflict_halt` outcome here drives the loop to HALT.
   */
  private lastRebaseOutcome: RebaseOutcome | null = null;

  /**
   * Optional rate-limit episode coordinator (Task 10). When active, coordinates
   * deadline-aware backoff during rate-limit waits. May be undefined (graceful
   * fallback to bare sleep).
   */
  private rateLimitEpisode: RateLimitEpisode | undefined;

  /**
   * Task 22: Optional callback to register in-flight wait AbortControllers with
   * the daemon-level SIGTERM handler.
   */
  private registerAbortController: ((controller: AbortController) => void) | undefined;

  /**
   * Durable engine state for task evidence tracking (sidecar JSON).
   * Loaded at the start of run() and written back when gates change evidence counts.
   */
  private taskEvidence: TaskEvidence | null = null;

  /**
   * The CompletionContext handed to every gate evaluation. `getHeadSha` feeds
   * the manual_test whitewash guard (#367); it resolves the worktree's real
   * HEAD and returns null (never throws) when there is no usable repo, which
   * makes the guard fail open outside real runs. `daemon` and `isHeadPushed`
   * feed the finish predicate for daemon false-ship guard (ADR-2026-07-06).
   */
  private async completionCtx(state: ConductState): Promise<CompletionContext> {
    // For the build predicate, resolve the plan file to pass into the context.
    // Scoped to THIS feature (#407): `.docs/plans/` is shared across in-flight
    // features by design, so an unscoped glob's first entry can be another
    // feature's plan — whose tasks then poison task-status.json and fail the
    // gate forever. resolveFeaturePlanPath prefers the engine-recorded path,
    // then the plan named after `feature_desc`, then a single plan; on true
    // ambiguity it returns undefined and the gate fails closed.
    let planPath: string | undefined;
    try {
      planPath = await resolveFeaturePlanPath(this.projectRoot, state.feature_desc);
    } catch {
      // Plan file resolution failed — let the predicate handle missing plan
      planPath = undefined;
    }

    return {
      sessionStartedAt: state.session_started_at,
      featureDesc: state.feature_desc,
      config: this.config,
      getHeadSha: () => currentCommitSha(this.projectRoot),
      daemon: this.daemon,
      isHeadPushed: async () => {
        if (!this.projectRoot) return null;
        try {
          return await headPushedToUpstream(this.git, this.projectRoot);
        } catch {
          // Log error, return null (indeterminate)
          return null;
        }
      },
      projectRoot: this.projectRoot,
      planPath,
    };
  }

  constructor(opts: ConductorOptions) {
    this.stateFilePath = opts.stateFilePath;
    this.stepRunner = opts.stepRunner;
    this.events = opts.events;
    this.resume = opts.resume ?? false;
    this.fromStep = opts.fromStep;
    this.mode = opts.mode ?? 'default';
    this.config = opts.config ?? {};
    if (!opts.projectRoot) throw new Error('Conductor requires an explicit projectRoot — refusing to default to process.cwd()');
    this.projectRoot = opts.projectRoot;
    this.featureDesc = opts.featureDesc;
    this.verifyArtifacts = opts.verifyArtifacts ?? false;
    this.daemon = opts.daemon ?? false;
    this.selfHost = opts.selfHost ?? false;
    this.baseBranch = opts.baseBranch;
    this.guardrails = opts.selfHostGuardrails ?? defaultSelfHostGuardrails;
    // Legacy maxRetries option: inject as defaults.max_retries on the config
    // so per-step resolution still works. Tests often pass this directly.
    if (opts.maxRetries !== undefined) {
      this.config = {
        ...this.config,
        defaults: { ...(this.config.defaults ?? {}), max_retries: opts.maxRetries },
      };
    }
    this.sleep = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onCheckpoint = opts.onCheckpoint ?? (async () => 'continue' as const);
    this.onNavigate = opts.onNavigate ?? (async () => null);
    this.onReviewArtifacts = opts.onReviewArtifacts ?? (async () => 'approved' as const);
    this.onRecovery = opts.onRecovery;
    this.onComplexityAssessment = opts.onComplexityAssessment;
    this.escalateBuildFailure = opts.escalateBuildFailure ?? defaultEscalateBuildFailure;
    this.gh = opts.gh ?? makeProductionGh();
    this.git = opts.git ?? makeProductionGit();
    this.runGh = opts.runGh ?? makeProductionGh();
    this.rateLimitEpisode = opts.rateLimitEpisode;
    this.registerAbortController = opts.registerAbortController;
  }

  /**
   * Best-effort wrapper around escalateBuildFailure. Returns the prUrl on
   * success, or undefined on any error or when mode is not 'auto'. Called at
   * every irrecoverable daemon HALT (except rebase-conflict HALTs where pushing
   * mid-rebase is unsafe). Never throws — a failing escalation must never
   * affect the HALT/return path (C1).
   */
  private async surfaceRemediationPr(reason: string): Promise<string | undefined> {
    // Daemon-only (FR-8). Gate on the real `daemon` flag, not merely `mode==='auto'`:
    // the autonomous builder sets `daemon: true`, and that is the precise signal that a
    // HALT here strands committed work a human must remediate. It also keeps the real
    // git/gh side effects out of any non-daemon auto-mode run (e.g. unit tests).
    if (!this.daemon) return undefined;
    try {
      const r = await this.escalateBuildFailure({
        projectRoot: this.projectRoot,
        failureReason: reason,
      });
      return r?.prUrl;
    } catch {
      return undefined; // best-effort: must never affect the HALT/return path
    }
  }

  /**
   * Pre-flight credential expiry check (TR-2). Called before sandbox provisioning
   * for self-host builds. If operator credentials are expired:
   * - If auth_park_timeout_minutes <= 0: HALT immediately with credentials-specific reason
   * - If > 0: Park and poll until credentials are refreshed or timeout elapses
   * If credentials state is unknown (missing/malformed): fail-open, proceed normally.
   * Returns a StepRunResult with success=false + a HALT reason if timeout occurs or
   * opt-out is configured; otherwise returns undefined (caller proceeds normally).
   */
  private async preflightCredentialsCheck(
    operatorConfigDir: string,
  ): Promise<StepRunResult | undefined> {
    const sh = resolveSelfHostConfig(this.config);
    const now = Date.now();
    const credState = await readOperatorCredentialsState(operatorConfigDir, now);

    // Fail-open: unknown state (missing/malformed) proceeds normally
    if (credState === 'unknown') {
      return undefined;
    }

    // Fresh credentials: proceed normally
    if (credState === 'fresh') {
      return undefined;
    }

    // Credentials are expired (credState === 'expired')
    const credPath = join(operatorConfigDir, '.credentials.json');

    // Opt-out: timeout <= 0 → immediate credentials-specific HALT
    if (sh.authParkTimeoutMinutes <= 0) {
      // Read expiresAt for the HALT message
      let expiresAtStr = '';
      try {
        const contents = await readFile(credPath, 'utf-8');
        const creds = JSON.parse(contents);
        if (creds.claudeAiOauth?.expiresAt !== undefined) {
          expiresAtStr = String(creds.claudeAiOauth.expiresAt);
        }
      } catch {
        // Couldn't read; proceed without expiresAt in the message
      }

      const haltReason = `Operator OAuth token is expired.\n\nCredentials file: ${credPath}\nExpires at: ${expiresAtStr}\n\nPlease refresh your credentials by running:\n\n  export CLAUDE_CONFIG_DIR=~/.claude && claude auth`;

      // Only write the HALT marker if it doesn't already exist (avoid overwriting
      // on retries). This preserves the credentials-specific reason instead of
      // letting the retry loop's generic "retries exhausted" message overwrite it.
      const haltPath = join(this.projectRoot, HALT_MARKER);
      const haltExists = await accessFile(haltPath).then(() => true).catch(() => false);
      if (!haltExists) {
        await writeFile(haltPath, haltReason + '\n', 'utf-8').catch(() => {
          // Best-effort HALT write; if it fails, still return the failure
        });
      }

      return {
        success: false,
        output: haltReason,
      };
    }

    // Park and poll: timeout > 0 → loop until credentials refresh or timeout
    const timeoutMs = sh.authParkTimeoutMinutes * 60 * 1000;
    while (true) {
      const result = await waitForCredentialsChange({
        initialState: credState,
        credentialsPath: credPath,
        globalConfigDir: operatorConfigDir,
        timeoutMs,
        sleep: this.sleep,
        now: () => Date.now(),
      });

      if (result.type === 'refreshed') {
        // Credentials are now fresh — proceed normally
        return undefined;
      }

      // Timeout: write the credentials-specific HALT marker BEFORE returning so
      // the retry loop's marker check exits immediately (no retry-budget burn,
      // no re-park) and the final HALT reason names the auth-window condition —
      // never the generic "retries exhausted" (adr-2026-07-04 §2/§3).
      const expiresAtStr = result.expiresAt ?? 'unparseable';
      const haltReason =
        `Operator credentials expired and refresh timed out after ${sh.authParkTimeoutMinutes} minutes.\n` +
        `Credentials file: ${result.credentialsPath}\n` +
        `Expires at: ${expiresAtStr}\n` +
        `Please refresh your OAuth token and re-queue this feature.`;
      const haltPath = join(this.projectRoot, HALT_MARKER);
      const haltExists = await accessFile(haltPath).then(() => true).catch(() => false);
      if (!haltExists) {
        await writeFile(haltPath, haltReason + '\n', 'utf-8').catch(() => {
          // Best-effort HALT write; if it fails, still return the failure
        });
      }
      return { success: false, output: haltReason };
    }
  }

  /**
   * Dispatch the /remediate planner over a blocking SHIP gate and translate its
   * structured plan into a loop decision. One planner serves every gate — only
   * the dispatch context and the hint's gap-artifact pointer differ. Mixed
   * plans route the autonomous fixes first (the human gaps re-surface on the
   * next gate pass and halt then). A missing/stale/unusable plan is `none` —
   * the caller falls through to its deterministic fallback or the generic HALT.
   */
  private async planRemediation(
    state: ConductState,
    steps: StepDefinition[],
    dispatchContext: string,
    hintSource: { source: string; evidenceFile: string },
  ): Promise<
    | { kind: 'route'; target: StepName; hint: string; evidence: string }
    | { kind: 'halt'; detail: string }
    | { kind: 'none' }
  > {
    await this.stepRunner.run('remediate', state, { retryReason: dispatchContext });
    const plan = await readRemediationPlan(this.projectRoot, state.session_started_at);
    if (!plan) return { kind: 'none' };

    // Extract tasks from gaps and append them to the plan if present.
    // Remediation tasks are plan-modification tasks that close blocking gaps.
    // If gaps contain tasks, append them to the plan and re-seed task-status.json
    // so they show as pending and can be tracked for completion.
    const allTasks: Array<{ id: string; title: string }> = [];
    for (const gap of plan.gaps) {
      if (gap.tasks && gap.tasks.length > 0) {
        allTasks.push(...gap.tasks);
      }
    }

    if (allTasks.length > 0) {
      // Append remediation tasks to the plan
      const planPath = await this.getActivePlanPath();
      if (planPath) {
        const appendResult = await appendRemediationTasks(this.projectRoot, planPath, allTasks);
        if (appendResult.success) {
          // Re-seed task-status.json with the appended tasks marked as pending
          try {
            await seedTaskStatus(this.projectRoot, planPath);
          } catch {
            // Log but continue — seeding failure doesn't block remediation routing
          }
        }
      }
    }

    const fixes = plan.gaps.filter((g) => g.disposition !== 'halt');
    const halts = plan.gaps.filter((g) => g.disposition === 'halt');
    if (fixes.length > 0) {
      return {
        kind: 'route',
        target: earliestRemediationTarget(fixes, steps),
        hint: buildRemediationHint(fixes, hintSource.source, hintSource.evidenceFile),
        evidence: fixes.map((g) => `${g.id}→${g.disposition}`).join('; '),
      };
    }
    if (halts.length > 0) {
      return {
        kind: 'halt',
        detail: halts.map((g) => `${g.id} (${g.category}: ${g.rationale})`).join('; '),
      };
    }
    return { kind: 'none' };
  }

  /** Read the active plan path from engine state, or null if not recorded. */
  private async getActivePlanPath(): Promise<string | null> {
    try {
      const engineStatePath = join(this.projectRoot, '.pipeline', 'engine-state.json');
      const content = await readFile(engineStatePath, 'utf-8');
      const engineState = JSON.parse(content) as Record<string, unknown>;
      const activePlanPath = engineState.activePlanPath;
      return typeof activePlanPath === 'string' ? activePlanPath : null;
    } catch {
      // Engine state doesn't exist or is invalid
      return null;
    }
  }

  /** True when a `.pipeline/` terminal marker (DONE / HALT) exists on disk. */
  private async markerExists(relPath: string): Promise<boolean> {
    try {
      await accessFile(join(this.projectRoot, relPath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Merged-PR guard: check if the recorded PR has been merged out-of-band.
   * If so, write synthetic verified-ship markers, emit completion event, and
   * return true to signal early exit from the run loop. Otherwise return false
   * to proceed with normal retry/rebase flow.
   *
   * Daemon-mode only; inactive if `pr_url` is absent or daemon:false.
   * Per ADR-2026-07-09-mid-run-merged-pr-guard, on MERGED verdict writes:
   * - `.pipeline/finish-choice` = 'pr'
   * - `.pipeline/DONE`
   * - Leaves pr_url unchanged in conduct-state.json
   * - Emits completion event with out-of-band merge message
   * - Detaches signal handlers (mirroring loop_halt path shape)
   * On OPEN/CLOSED/NOTFOUND/UNKNOWN or gh failure: logs at debug, returns false (fail-open).
   */
  private async stopIfPrMerged(
    state: ConductState,
    sigintHandler: () => Promise<void>,
    sigterm: () => Promise<void>,
  ): Promise<boolean> {
    // Daemon-mode only; requires pr_url in state.
    if (!this.daemon || !state.pr_url) {
      return false;
    }

    // Query the recorded PR's current merge state using the shared guard wrapper.
    // Single-shot call, no retries: per TS-4 cost bound in adr-2026-07-09-mid-run-merged-pr-guard.
    const guardVerdict = await checkMergedPrGuard(
      this.runGh,
      this.projectRoot,
      state.pr_url,
      (msg) => console.log(msg),
    );

    // On non-MERGED verdicts, proceed with normal retry/rebase unchanged.
    if (guardVerdict !== 'merged') {
      return false;
    }

    // MERGED verdict: stop the run as a synthetic verified ship.
    // Write finish-choice marker (pr) and DONE marker.
    await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(() => {
      /* best-effort marker */
    });

    await writeFile(join(this.projectRoot, FINISH_CHOICE_MARKER), 'pr\n', 'utf-8').catch(() => {
      /* best-effort marker */
    });

    await writeFile(join(this.projectRoot, DONE_MARKER), '', 'utf-8').catch(() => {
      /* best-effort marker */
    });

    // Get the current HEAD SHA for the log message.
    // If unavailable (no git repo or error), use a deterministic fake SHA
    // derived from the pr_url so the log message is still meaningful.
    let sha: string | null = null;
    try {
      sha = await currentCommitSha(this.projectRoot);
    } catch {
      // Proceed even if we can't get the SHA; the markers are what matter.
    }
    if (!sha) {
      // Generate a deterministic fake SHA from the pr_url for test environments
      // without a git repo. In production, currentCommitSha always succeeds.
      const hash = createHash('sha1').update(state.pr_url || 'merged').digest('hex');
      // pad to 40 chars (sha1 produces 40 hex chars, but just in case)
      sha = (hash + '0'.repeat(40)).substring(0, 40);
    }

    // Emit a completion event that includes the out-of-band merge message.
    await this.events.emit({
      type: 'feature_complete',
      prUrl: state.pr_url,
      message: `already shipped out-of-band; local branch retained at ${sha}`,
    } as any);

    // Detach signal handlers (mirroring loop_halt return path at ~2010-2012).
    process.off('SIGINT', sigintHandler);
    if (this.daemon) {
      // In daemon mode, the process-level SIGTERM handler is installed at daemon-cli.ts,
      // not here, so we don't detach it.
    } else {
      process.off('SIGTERM', sigterm);
    }

    // Return true to signal that the run should terminate successfully.
    return true;
  }

  /**
   * True only for a harness SELF-BUILD: the autonomous builder (`daemon`) is
   * building the harness repo itself (`selfHost`). This single decision gates the
   * whole guardrail bundle — for any other repo, or any non-daemon run, it is
   * false and the build path is byte-for-byte unchanged (TR-13).
   */
  private isSelfBuild(): boolean {
    return this.daemon && this.selfHost;
  }

  /** Read a file's text, or null when it does not exist (gate readText seam). */
  private readTextOrNull(path: string): Promise<string | null> {
    return readFile(path, 'utf-8').then(
      (t) => t,
      () => null,
    );
  }

  /**
   * Dispatch the `build` step for a self-build under the guardrail bundle:
   *   1. relink harness skills ONCE before the first build (TR-4) — a failure
   *      throws InstallStaleError, which aborts the run before any child build;
   *   2. provision a throwaway CLAUDE_CONFIG_DIR sandbox ONCE (TR-5/6) — a
   *      provisioning failure throws SandboxProvisionError, aborting before build;
   *   3. scope `process.env.CLAUDE_CONFIG_DIR` to the sandbox for EXACTLY this
   *      child dispatch and restore it afterwards on BOTH the pass and throw
   *      branches, so no env bleeds into later steps (e.g. finish).
   * The sandbox is torn down in `run()`'s finally. Every throw propagates to
   * `run()`'s catch, which writes `.pipeline/HALT` — the build never runs against
   * a half-provisioned sandbox or stale skill links.
   */
  private async runSelfBuildDispatch(
    name: StepName,
    state: ConductState,
    retryHint: string | undefined,
  ): Promise<StepRunResult> {
    const sh = resolveSelfHostConfig(this.config);

    if (sh.skillRelinkPreflight && !this.relinkDone) {
      this.relinkDone = true;
      // Default harness root (the installed MAIN checkout), NOT the worktree:
      // relink refreshes global ~/.claude against main so daemon-dispatched
      // skills resolve; the worktree's edits are isolated by the sandbox below,
      // never by repointing the operator's live globals.
      await this.guardrails.relink({ log: (m) => console.error(m) });
    }

    if (!sh.sandboxBuildEnv) {
      return this.stepRunner.run(name, state, { retryReason: retryHint });
    }

    // Pre-flight daemon build-auth token check (Task 6, TR-3/TR-2): BEFORE provisioning,
    // check if daemon-token mode is configured and the token file is readable.
    // If missing or unreadable, HALT with mint instructions. For api-key mode, skip.
    // Never consumes the retry budget.
    const buildAuthPreflight = await checkBuildAuth(
      sh.buildAuthMode,
      sh.buildAuthTokenPath,
      this.projectRoot,
    );
    if (buildAuthPreflight !== undefined) {
      return buildAuthPreflight;
    }

    // Pre-flight credential expiry check (TR-2): BEFORE provisioning, check if
    // the operator's credentials are expired. If so, park or HALT depending on
    // the timeout configuration. Never consumes the retry budget.
    // Task 11: In daemon-token or api-key mode, skip operator credentials check
    // (only applies when build_auth is explicitly configured; undefined/absent
    // build_auth means backward-compat operator-credentials mode).
    const buildAuthBlock = this.config?.harness_self_host?.build_auth;
    if (!buildAuthBlock || (buildAuthBlock.mode !== 'daemon-token' && buildAuthBlock.mode !== 'api-key')) {
      const operatorConfigDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
      const preflight = await this.preflightCredentialsCheck(operatorConfigDir);
      if (preflight !== undefined) {
        // Either HALT (timeout <= 0) or parking timeout reached (Task 14)
        return preflight;
      }
    }

    if (!this.activeSandbox) {
      // INSTALLED root, not the module-relative detection root (#363): for a
      // worktree-run engine the detection root IS the worktree, which made the
      // sandbox settings retarget (main → worktree) a silent no-op and left the
      // build running against the operator's live hook paths. Fallback for an
      // unresolved/rejected root stays projectRoot — the relink preflight has
      // already HALTed the dangerous (rejected) case before this point.
      const installed = await this.guardrails.resolveInstalledHarnessRoot();
      const harnessRoot = installed.status === 'ok' ? installed.root : this.projectRoot;
      this.activeSandbox = await this.guardrails.provisionSandbox({
        worktreeRoot: this.projectRoot,
        harnessRoot,
      });
    }

    // Task 9 (TR-2): Read the daemon build token in daemon-token mode. The token
    // is available after the buildAuthPreflight check above (which validates it
    // exists and is readable). Extract it so we can inject it into the step runner env.
    let daemonToken: string | undefined;
    if (sh.buildAuthMode === 'daemon-token') {
      const tokenResult = await readDaemonBuildToken(sh.buildAuthTokenPath);
      if (tokenResult.state === 'ok') {
        daemonToken = tokenResult.token;
      }
    }

    const hadKey = 'CLAUDE_CONFIG_DIR' in process.env;
    const prior = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = this.activeSandbox.configDir;

    const hadToken = 'CLAUDE_CODE_OAUTH_TOKEN' in process.env;
    const priorToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (daemonToken) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = daemonToken;
    }

    try {
      return await this.stepRunner.run(name, state, { retryReason: retryHint });
    } finally {
      if (hadKey) process.env.CLAUDE_CONFIG_DIR = prior;
      else delete process.env.CLAUDE_CONFIG_DIR;

      if (hadToken) process.env.CLAUDE_CODE_OAUTH_TOKEN = priorToken;
      else delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }
  }

  /**
   * The self-host finish gates (TR-7/8/9/10), run BEFORE the `finish` step is
   * dispatched because the auto-mode finish prompt opens the PR itself — a gate
   * that fires after finish would be too late. On the first failure the gate
   * primitive has already written `.pipeline/HALT`; this returns the verdict so
   * the caller parks the feature without dispatching finish (no PR). Reads the
   * VERSION/CHANGELOG/integrity artifacts of the build worktree (`projectRoot`),
   * which IS the harness being shipped.
   */
  private async runSelfHostFinishGates(): Promise<GateVerdict> {
    const sh = resolveSelfHostConfig(this.config);

    if (sh.versionApprovalGate) {
      const verdict = await this.guardrails.versionGate({
        projectRoot: this.projectRoot,
        harnessRoot: this.projectRoot,
        readText: (p) => this.readTextOrNull(p),
        versionFreeze: sh.versionFreeze,
        changedFiles: () => this.selfBuildChangedFiles(),
      });
      if (!verdict.ok) return verdict;
    }

    if (sh.releaseArtifactGate) {
      const verdict = await this.guardrails.releaseGate({
        projectRoot: this.projectRoot,
        harnessRoot: this.projectRoot,
        readText: (p) => this.readTextOrNull(p),
        changedFiles: () => this.selfBuildChangedFiles(),
      });
      if (!verdict.ok) return verdict;
    }

    return { ok: true };
  }

  /**
   * The self-build's changed files as `git diff --name-status <base>...HEAD`,
   * parsed for the migration-block classifier. Returns null (→ fail-closed:
   * require a migration block) when the base branch is unknown or git fails, so
   * an undeterminable change set never silently skips the gate.
   */
  private async selfBuildChangedFiles(): Promise<ChangedFile[] | null> {
    if (!this.baseBranch) return null;
    const git = makeGitRunner(this.projectRoot);
    const r = await git(['diff', '--name-status', `${this.baseBranch}...HEAD`]);
    if (r.exitCode !== 0) return null;
    return parseNameStatus(r.stdout);
  }

  async run(): Promise<void> {
    const stateResult = await readState(this.stateFilePath);
    let state: ConductState = stateResult.ok ? stateResult.value : {};

    // Stamp this conductor invocation. SHIP-phase completion predicates
    // compare artifact mtimes against this timestamp so a stale file left
    // over from a prior session can't satisfy a gate. Old state files
    // without this field are tolerated — predicates fail open when it's
    // missing.
    const sessionStartedAt = Date.now();
    state.session_started_at = sessionStartedAt;
    if (!state.run_started_at) state.run_started_at = sessionStartedAt;
    await writeState(this.stateFilePath, state);

    // Load task evidence sidecar for durable no-evidence counter (Task 12).
    // The counter tracks consecutive gate misses with no task progress and
    // persists across engine restarts. It feeds the auto-park trigger (Task 23).
    this.taskEvidence = await createTaskEvidence(this.projectRoot);

    // Sweep stale per-session markers from prior invocations. A marker left
    // here from a previous run can't legitimately satisfy this run's gate
    // — the finish skill writes it freshly on every successful run. The
    // halt marker (.pipeline/halt-user-input-required) is intentionally
    // NOT swept: a marker that survives across sessions is a real signal
    // (the prior session left it; this session needs to address it on the
    // next build attempt).
    await unlinkFile(join(this.projectRoot, '.pipeline/finish-choice')).catch(() => {
      // Marker absent — nothing to clean.
    });

    // Resolved, config-derived step list (built-ins + custom steps inserted via
    // `after`). The loop, selector, and index math all key off THIS list so
    // YAML custom steps run and participate in the gate loop. indexOf is the
    // registry-relative index (getStepIndex's static map can't see customs).
    const steps = buildStepRegistry(this.config);
    const indexOf = (name: StepName): number =>
      steps.findIndex((s) => s.name === name);

    // Determine starting index
    let startIndex = 0;
    if (this.fromStep) {
      startIndex = indexOf(this.fromStep);
    } else if (this.resume) {
      startIndex = this.findResumeIndex(state, steps);

      // Clamp startIndex backward to honor on-disk gate verdicts.
      // Read verdicts and derive gate topology to find the earliest unsatisfied gate.
      try {
        const verdicts = await readAllVerdicts(this.projectRoot);
        const topo = deriveGateTopology(steps);
        const earliestGateIdx = earliestUnsatisfiedGateIndex({
          steps,
          state,
          verdicts,
          regionStart: topo.regionStart,
        });

        // Clamp backward (min) only — never move startIndex forward.
        // If earliestGateIdx is valid and precedes the candidate, use it.
        if (earliestGateIdx >= 0 && earliestGateIdx < startIndex) {
          startIndex = earliestGateIdx;
        }

        // Reset unsatisfied gates to 'pending' so the main loop doesn't skip them.
        // When a gate's verdict says unsatisfied but state says 'done',
        // we must reset it so the loop re-runs it.
        for (const step of steps) {
          if (verdicts[step.name] && verdicts[step.name].satisfied === false) {
            const status = getStepStatus(state, step.name);
            if (status === 'done') {
              (state as Record<string, unknown>)[step.name] = 'pending';
            }
          }
        }
      } catch (err) {
        // Verdict reading errors (missing file, parse failures) are non-fatal.
        // Fall through to the candidate startIndex derived from state alone.
      }
    }

    // Save state on SIGINT/SIGTERM/SIGHUP before exit
    // Exit codes follow Unix convention: 128 + signal number
    const signalHandlerBase = async (signal: NodeJS.Signals) => {
      await writeState(this.stateFilePath, state);
      const exitCodes: Record<string, number> = {
        SIGINT: 130,   // 128 + 2
        SIGTERM: 143,  // 128 + 15
        SIGHUP: 129,   // 128 + 1
      };
      process.exit(exitCodes[signal] ?? 1);
    };
    const sigintHandler = () => signalHandlerBase('SIGINT');
    const sighupHandler = () => signalHandlerBase('SIGHUP');
    process.on('SIGINT', sigintHandler);
    process.on('SIGHUP', sighupHandler);
    // SIGTERM is owned by the interactive-scoped `sigterm` handler below
    // (Task 22: daemon mode delegates SIGTERM to the daemon-level handler);
    // signalHandlerBase keeps its SIGTERM row for the exit-code convention.

    // Mutable reference for the current rate-limit wait AbortController, used by
    // SIGTERM handler to abort in-flight wait when signal is received.
    let currentWaitController: AbortController | undefined;

    // Save state on SIGTERM before exit and abort in-flight wait if active
    // Task 22: Scope per-conductor SIGTERM handler to interactive mode only.
    // In daemon mode, the process-level handler (installed in daemon-cli.ts)
    // handles SIGTERM for N concurrent conductors; in interactive mode, each
    // conductor installs its own handler.
    const sigterm = async () => {
      // Abort any in-flight rate-limit wait
      if (currentWaitController) {
        currentWaitController.abort();
      }
      await writeState(this.stateFilePath, state);
      process.exit(1);
    };
    if (!this.daemon) {
      process.on('SIGTERM', sigterm);
    }

    // Per-step counter for how many times the user has picked `retry` from the
    // recovery menu in this session. Once it hits MAX_RECOVERY_RETRIES, the
    // UI is told retry is exhausted so the step can't spin forever.
    const recoveryRetries = new Map<StepName, number>();

    // Per-step guard: run auto-heal at most once per session. A second run
    // against the same git log + same task-status.json can't produce new
    // healings, so additional invocations are wasted git calls.
    const autoHealAttempted = new Set<StepName>();

    // Per-gate count of kickback re-opens this feature, for the anti-ping-pong
    // cap. Drives the gate-driven tail (see advanceTail).
    const kickbackCounts = new Map<StepName, number>();
    // Per-gate count of consecutive selector re-selects without satisfaction,
    // for the stuck-gate HALT guard (see advanceTail).
    const stuckGate = new Map<StepName, number>();
    // Daemon-only: how many times a blocking prd-audit (impl-gap only) has
    // routed back to BUILD to self-heal. Bounded like MAX_KICKBACKS_PER_GATE so
    // an impl-gap the daemon can't actually close eventually halts for a human.
    let prdAuditSelfHeals = 0;
    // Daemon-only: how many times the /remediate planner has routed a blocking
    // prd-audit back to a target step. Bounded like prdAuditSelfHeals so a gap the
    // planner can't actually close still halts for a human.
    let remediationRounds = 0;
    // Daemon-only (#367): how many times a manual_test FAIL has routed back to
    // BUILD. Bounded like prdAuditSelfHeals so a bug BUILD can't actually fix
    // eventually halts for a human instead of ping-ponging.
    let manualTestSelfHeals = 0;
    // Retry hints queued for a step that will be (re)entered via a kickback.
    // A prd_audit impl-gap routes back to BUILD and MUST tell the BUILD agent
    // which FRs to close — otherwise BUILD was dispatched with no context, saw a
    // complete task list, and changed nothing (a no-op self-heal loop). Consumed
    // (and cleared) when that step's dispatch begins, so it only seeds the first
    // attempt; later attempts use the step's own failure/gate-miss hint.
    const pendingRetryHints = new Map<StepName, string>();

    try {
      for (let i = startIndex; i < steps.length; i++) {
        const step = steps[i];

        // Skip already-completed work. Without this, re-invoking the conductor
        // against a project with existing `done` / `skipped` state (e.g. after
        // a crash, a terminal close, or a fresh `conduct-ts` call without
        // `--resume` / `--from`) re-dispatches every completed step from the
        // top of ALL_STEPS. The `--from <step>` flag is the explicit opt-in to
        // re-run a specific step regardless of its current status.
        //
        // `failed` is NOT short-circuited here — the conductor re-enters a
        // failed step so it can run through the retry/recovery flow again.
        const currentStatus = state[step.name];
        const alreadyResolved = currentStatus === 'done' || currentStatus === 'skipped';
        const explicitlyTargeted = this.fromStep === step.name;
        if (alreadyResolved && !explicitlyTargeted) {
          // No event — the step simply isn't re-dispatched. Dashboard renders
          // the persisted status verbatim.
          continue;
        }

        // Read complexity tier from state each iteration (may change after complexity step)
        const tier = state.complexity_tier ?? 'L';

        // Check if step should be skipped for this complexity tier
        if (step.skippableForTiers.includes(tier)) {
          await saveStepStatus(this.stateFilePath, step.name, 'skipped');
          state[step.name] = 'skipped';
          await this.events.emit({ type: 'tier_skip', step: step.name, tier });
          continue;
        }

        // Check if step should be skipped for this work track (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location).
        // `prd` is skipped on the technical track (no product requirements to
        // spec). The track is resolved from `state.track` (daemon-seeded) or, in
        // the interactive flow, from the committed `.docs/track/<slug>.md` marker
        // that `/explore` wrote. A missing/unreadable track defaults to `product`.
        if (step.skippableForTracks && step.skippableForTracks.length > 0) {
          const track = await this.resolveTrack(state);
          if (step.skippableForTracks.includes(track)) {
            await saveStepStatus(this.stateFilePath, step.name, 'skipped');
            state[step.name] = 'skipped';
            await this.events.emit({ type: 'config_skip', step: step.name });
            continue;
          }
        }

        // Phase 9.1 (ADR-002 Option A): under the daemon, skip the in-loop `retro`
        // step. The daemon's emission step owns narrative production into the
        // cross-project engineer store, so writing `.docs/retros/` into the feature
        // repo here would be redundant clutter. Manual runs (daemon=false) are
        // unaffected and keep writing repo retros.
        if (this.daemon && step.name === 'retro') {
          await saveStepStatus(this.stateFilePath, step.name, 'skipped');
          state[step.name] = 'skipped';
          await this.events.emit({ type: 'config_skip', step: step.name });
          continue;
        }

        // Check if step should be skipped because bootstrap detected a 'new'
        // project (nothing to assess on an empty-directory scaffold). This
        // sits after the tier skip and before the gate check so the skipped
        // step is still recorded in state but the skill never runs and the
        // completion gate never fires against a missing artifact.
        if (shouldSkipForBootstrapMode(step.name, state.bootstrap_mode)) {
          await saveStepStatus(this.stateFilePath, step.name, 'skipped');
          state[step.name] = 'skipped';
          await this.events.emit({
            type: 'mode_skip',
            step: step.name,
            mode: state.bootstrap_mode!,
            reason: `bootstrap mode '${state.bootstrap_mode}' — no codebase to act on`,
          });
          continue;
        }

        // Skip a step whose declared upstream dependency was itself skipped —
        // e.g. architecture_review_as_built when architecture_review (and its
        // ADRs) were skipped, so the as-built compliance sweep has nothing to
        // audit. Without this the as-built review ran against APPROVED ADRs
        // that never existed and produced a non-clean verdict the loop could
        // neither pass cleanly nor halt on.
        if (shouldSkipForUpstreamSkip(step, state)) {
          await saveStepStatus(this.stateFilePath, step.name, 'skipped');
          state[step.name] = 'skipped';
          await this.events.emit({ type: 'config_skip', step: step.name });
          continue;
        }

        // Resolve per-step config (model, effort, retries, review…). Tier is
        // threaded in so `by_tier` overrides apply when the feature's complexity
        // is known (post-complexity step).
        const resolved = resolveStepConfig(step.name, step.phase, this.config, {
          tier: state.complexity_tier,
        });

        // Check if step is disabled via config
        if (resolved.disabled) {
          await saveStepStatus(this.stateFilePath, step.name, 'skipped');
          state[step.name] = 'skipped';
          await this.events.emit({ type: 'config_skip', step: step.name });
          continue;
        }

        // Evaluate when: expression (T9 — conditional step skip)
        const stepCfg = this.config?.steps?.[step.name];
        if (stepCfg?.when) {
          const whenResult = evaluateWhen(stepCfg.when, state);
          if (!whenResult.result) {
            await saveStepStatus(this.stateFilePath, step.name, 'skipped');
            state[step.name] = 'skipped';
            await this.events.emit({
              type: 'when_skip',
              step: step.name,
              expression: stepCfg.when,
              undefinedKey: whenResult.undefinedKey,
            });

            // T21: when: on a parallel group → set all synthetic keys to "skipped"
            if (stepCfg.parallel) {
              for (const branch of stepCfg.parallel) {
                const syntheticKey = `${step.name}__${branch.name}`;
                (state as Record<string, unknown>)[syntheticKey] = 'skipped';
              }
              await writeState(this.stateFilePath, state);
            }
            continue;
          }
        }

        // Execute parallel group (T15 — Promise.all fan-out)
        if (stepCfg?.parallel) {
          await this.runParallelGroup(step.name, stepCfg.parallel, state);
          // State keys are already written inside runParallelGroup.
          // The step's own status is set to 'done' or 'failed' inside runParallelGroup.
          // If it failed (gating branch), we stop here.
          if (state[step.name] === 'failed') {
            await this.events.emit({
              type: 'step_failed',
              step: step.name,
              error: `Parallel group "${step.name}" had a gating branch failure`,
              retryCount: 0,
            });
            await writeState(this.stateFilePath, state);
            process.off('SIGINT', sigintHandler);
            if (!this.daemon) {
              process.off('SIGTERM', sigterm);
            }
            return;
          }
          continue;
        }

        // Check gate: all prerequisites must be satisfied
        const gate = checkGate(step, state);
        if (!gate.passed) {
          await this.events.emit({ type: 'gate_blocked', step: step.name, reason: gate.reason });
          await writeState(this.stateFilePath, state);
          process.off('SIGINT', sigintHandler);
          process.off('SIGTERM', sigterm);
          return;
        }

        // Self-host release gates (TR-7/8/9/10): a harness self-build must clear
        // the VERSION-approval and release-artifact gates BEFORE `finish` runs,
        // because the auto-mode finish prompt opens the PR itself. A failing gate
        // has already written `.pipeline/HALT`; park the feature (no PR) instead
        // of dispatching finish. The daemon never opens a PR with an unapproved
        // bump or a failing integrity/CHANGELOG/migration state, and never merges.
        if (this.isSelfBuild() && step.name === 'finish') {
          const verdict = await this.runSelfHostFinishGates();
          if (!verdict.ok) {
            state[step.name] = 'stale';
            await writeState(this.stateFilePath, state);
            await this.events.emit({ type: 'loop_halt', reason: verdict.reason });
            process.off('SIGINT', sigintHandler);
            process.off('SIGTERM', sigterm);
            return;
          }
        }

        // Mark in_progress before running
        await saveStepStatus(this.stateFilePath, step.name, 'in_progress');
        state[step.name] = 'in_progress';

        await this.events.emit({ type: 'step_started', step: step.name, index: i });

        // #505 TS-4: defensively clear a stale build-step-active marker at
        // EVERY step entry (not just build steps), guarding against a marker
        // left behind by a crashed prior session. A build step re-writes the
        // marker fresh moments later (below); a non-build step simply leaves
        // it cleared. Idempotent — no error if the marker is already absent.
        clearStaleMarker(this.projectRoot);

        // Deterministic freshness guard — applied ONLY when re-entering a step
        // that previously FAILED (`failed`) or was REWORKED (kicked back →
        // `stale`), never on a clean first run. Such a step ran before, so a
        // prior-session `.pipeline/` artifact may linger that an unattended agent
        // could reuse instead of rewriting — looping the freshness gate to a HALT.
        // Deleting it forces regeneration this session. A first run has no prior
        // attempt and nothing to reuse, so it is left untouched.
        if (currentStatus === 'failed' || currentStatus === 'stale') {
          await sweepStaleReviewArtifacts(
            this.projectRoot,
            step.name,
            state.session_started_at,
          );
        }

        // Fresh session per step (ai-conductor#325): start EVERY executed step on
        // a brand-new LLM session, in all phases and all modes, so context never
        // accumulates across the loop. Each step reads its inputs from the
        // committed artifacts (.docs/), not from conversational memory. The retry
        // loop below reuses this session (resume) for the step's OWN attempts
        // only.
        //
        // This also resets before the FIRST executed step (`acceptance_specs` in a
        // daemon run — the front half is pre-seeded `done` and skipped above). That
        // matters on a REUSED worktree: resetSession() unlinks the stale
        // `session-created` / rewrites `conduct-session-id`, so the step dispatches
        // `claude --session-id <new>` (create) instead of `--resume <new>` against
        // a conversation that never existed (which surfaced as "session
        // unavailable (expired or in use)" and errored the feature out).
        if (this.stepRunner.resetSession) {
          await this.stepRunner.resetSession();
        }

        // Retry loop: auto-retry on step-runner failure OR completion-gate miss,
        // up to `maxRetries` attempts total. Only after the budget is exhausted
        // do we escalate to the recovery menu. Matches bash bin/conduct's
        // max_retries=3 behavior.
        let attempt = 0;
        let lastError: string = '';
        let succeeded = false;
        // Seed from any kickback hint queued for this step (e.g. the prd_audit
        // impl-gap → BUILD handoff), then clear it so it only affects attempt 1.
        let retryHint: string | undefined = pendingRetryHints.get(step.name);
        pendingRetryHints.delete(step.name);
        let successOutput: string | undefined;

        // D4 keying (Slice B): snapshot plan artifacts BEFORE the plan step runs
        // so the DECIDE-tail owner stamping targets only the plan(s) authored in
        // THIS run. `.docs/plans/` accumulates historical plans; stamping a
        // glob-first file would leave the new spec un-owned and rewrite an
        // unrelated spec's marker.
        const planSnapshot: Map<string, number> | null =
          step.name === 'plan'
            ? await snapshotArtifactMtimes(this.projectRoot, 'plan')
            : null;

        const stepMaxRetries = resolved.max_retries;
        // Snapshot of resolved-task count before the most recent build retry,
        // so the circuit breaker can detect "Claude ran but completed zero
        // additional tasks" = no point retrying further, hand off to REPL.
        let resolvedTasksBefore = step.name === 'build'
          ? await countResolvedTasks(this.projectRoot)
          : 0;
        // #505 TS-15: HEAD sha captured at build-step entry, compared against
        // HEAD at step exit to detect a zero-work-product session (dispatched
        // work that produced no new commits, or nothing dispatched at all).
        const headShaBeforeBuild: string | null =
          step.name === 'build' ? await currentCommitSha(this.projectRoot) : null;
        // Task 8: Capture stall question for error handling in degraded remediation exits.
        // Set when a stall is detected, used to build HALT with the question when
        // remediation dispatch fails or returns a degraded outcome.
        let stallQuestion: string | null = null;

        while (attempt < stepMaxRetries) {
          attempt++;

          // Build-step-only watcher (Task 9, adr-2026-07-10-intra-step-build-progress-events):
          // started immediately before the build step's await and stopped in a
          // `finally` so it can never outlive the attempt, regardless of which
          // branch below actually resolves (self-build dispatch vs. the normal
          // stepRunner path) or whether that branch throws. Plan/finish/every
          // other step never constructs a watcher at all.
          //
          // Task 10: `build_progress.enabled: false` is a full escape hatch —
          // no watcher instance is constructed at all (not merely started as
          // a no-op), so operators who disable the feature pay zero overhead
          // and the existing post-hoc stall-breaker (below) is unaffected.
          const buildWatcher: BuildProgressWatcher | null =
            step.name === 'build' && resolveBuildProgressConfig(this.config).enabled
              ? new BuildProgressWatcher({
                  projectRoot: this.projectRoot,
                  events: this.events,
                  step: step.name,
                  featureSlug: state.feature_desc,
                  config: this.config,
                })
              : null;
          buildWatcher?.start();

          // #505 TS-3: build-step-active marker. Written right before the
          // build session spawns and removed in `finally` (guaranteed on
          // both success and error paths) so a session hook firing mid-step
          // can tell "dispatched build work is in flight" from unattributed
          // session activity. Never written when enforcement isn't
          // configured (absent/future cutover) — zero overhead for
          // operators who haven't opted in.
          const markerActive = step.name === 'build' && isEnforcementConfigured(this.config);
          if (markerActive) {
            writeBuildStepMarker(this.projectRoot);
          }

          let result: StepRunResult;
          try {
            result =
              step.name === 'complexity'
                ? await this.runComplexityStep(state)
                : step.name === 'worktree'
                  ? await this.runWorktreeStep(state)
                  : step.name === 'rebase'
                    ? await this.runRebaseStep(state)
                    : this.isSelfBuild() && step.name === 'build'
                      ? await this.runSelfBuildDispatch(step.name, state, retryHint)
                      : await this.stepRunner.run(step.name, state, { retryReason: retryHint });
          } finally {
            buildWatcher?.stop();
            if (markerActive) {
              removeBuildStepMarker(this.projectRoot);
            }
          }

          // Rate limit: wait deterministically, then retry WITHOUT burning the
          // retry budget (matches bin/conduct:2248–2280 handle_rate_limit).
          // Task 10: Integrate episode coordinator for deadline-aware backoff.
          // Task 18: Deadline-first — use parsed timezone-aware deadline if available.
          if (result.rateLimited) {
            // Task 18: Prefer deadline-first (parsed from message) over escalation (waitSeconds)
            const deadline = result.deadline ?? Date.now() + (result.waitSeconds ?? 300) * 1000;
            let waitMs = deadline - Date.now();
            // Ensure waitMs is positive (defensive guard against clock skew or past deadlines)
            if (waitMs <= 0) {
              waitMs = 1;
            }
            const waitSeconds = Math.ceil(waitMs / 1000);

            await this.events.emit({ type: 'rate_limit', waitSeconds });

            // Enter episode with deadline for coordinated backoff
            if (this.rateLimitEpisode) {
              this.rateLimitEpisode.enter(deadline);
            }

            // Create AbortSignal for SIGTERM handling (Task 11)
            const controller = new AbortController();
            currentWaitController = controller;
            // Task 22: Register with daemon-level handler if provided (daemon mode)
            this.registerAbortController?.(controller);

            try {
              // Await episode.clear() or fallback to sleep if episode undefined
              if (this.rateLimitEpisode && this.rateLimitEpisode.clear) {
                await this.rateLimitEpisode.clear(controller.signal);
              } else {
                await this.sleep(waitMs);
              }
            } finally {
              // Clear reference after wait completes
              currentWaitController = undefined;
            }

            // Continue retry loop without burning budget
            attempt--;
            continue;
          }

          // Stale session: reset + retry without burning budget
          // (matches bin/conduct:645–663 stale-session detection).
          if (result.sessionExpired) {
            await this.events.emit({
              type: 'session_reset',
              reason: 'session unavailable (expired or in use) — resetting to a fresh session',
            });
            if (this.stepRunner.resetSession) {
              await this.stepRunner.resetSession();
            }
            attempt--;
            continue;
          }

          // Auth failure: park and poll for credentials refresh, then retry without
          // burning budget (TR-3: happy path is park→refresh→resume). The auth
          // branch gates the retry budget: attempt stays the same across
          // park-resume, so credentials expiry doesn't leak into the retry circuit.
          if (result.authFailure) {
            const shPark = resolveSelfHostConfig(this.config);

            // Task 11 (TR-4): Retarget authFailure park to daemon token in daemon-token mode.
            // Only applies when self-host mode is active. In daemon-token mode, watch the
            // daemon token path for non-empty content. In operator mode, watch the operator
            // credentials for expiresAt freshness. In api-key mode, do not park — HALT
            // immediately with ANTHROPIC_API_KEY.
            let parkResult: Awaited<ReturnType<typeof waitForCredentialsChange>>;
            let haltReason: string;

            if (this.selfHost && shPark.buildAuthMode === 'api-key') {
              // Task 11: api-key mode does not support auth-failure park
              haltReason =
                `Auth failure in api-key mode — the ANTHROPIC_API_KEY environment variable\n` +
                `is missing, invalid, or has insufficient permissions.\n` +
                `Please set ANTHROPIC_API_KEY and re-queue this feature.`;
              await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(
                () => {},
              );
              await writeFile(
                join(this.projectRoot, LOOP_HALT_MARKER),
                haltReason + '\n',
                'utf-8',
              ).catch(() => {
                /* best-effort marker */
              });
              await writeState(this.stateFilePath, state);
              const prUrl = await this.surfaceRemediationPr(haltReason);
              await this.events.emit({ type: 'loop_halt', reason: haltReason, prUrl });
              process.off('SIGINT', sigintHandler);
              process.off('SIGTERM', sigterm);
              return;
            } else if (this.selfHost && shPark.buildAuthMode === 'daemon-token') {
              // Task 11: Park on daemon token path, check for non-empty content
              const tokenPath = shPark.buildAuthTokenPath;
              const daemonTokenClassifier = createDaemonTokenContentClassifier();

              await this.events.emit({
                type: 'credentials_park',
                reason: 'daemon build token expired or invalid — waiting for refresh',
              });

              parkResult = await waitForCredentialsChange({
                initialState: 'expired', // Start as expired (trigger polling)
                credentialsPath: tokenPath,
                globalConfigDir: '', // Not used in daemon-token mode
                timeoutMs: shPark.authParkTimeoutMinutes * 60 * 1000,
                sleep: this.sleep,
                now: () => Date.now(),
                contentClassifier: daemonTokenClassifier,
              });

              if (parkResult.type === 'timeout') {
                // Task 13 (TR-4): Daemon-token park timeout HALT names token path and re-mint instructions
                // (never operator OAuth file, never "retries exhausted"). Preserves retry budget contract.
                haltReason =
                  `Daemon build token expired and refresh timed out.\n` +
                  `Token file: ${tokenPath}\n` +
                  `Please run: ${(await import('./self-host/daemon-build-token.js')).DAEMON_BUILD_TOKEN_MINT_COMMAND}\n` +
                  `Then re-queue this feature.`;
              } else {
                // Task 11 + Task 9: Park resolved, resume retry. On the next attempt,
                // runSelfBuildDispatch will re-read the daemon token from the file
                // (which was updated during the park interval) and re-inject it.
                haltReason = ''; // Not halting on successful resume
              }
            } else {
              // Operator credentials mode (backward compatibility)
              const operatorConfigDir =
                process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
              const credPath = join(operatorConfigDir, '.credentials.json');
              const credState = await readOperatorCredentialsState(
                operatorConfigDir,
                Date.now(),
              );

              await this.events.emit({
                type: 'credentials_park',
                reason: 'operator OAuth token expired or invalid — waiting for refresh',
              });

              parkResult = await waitForCredentialsChange({
                initialState: credState,
                credentialsPath: credPath,
                globalConfigDir: operatorConfigDir,
                timeoutMs: shPark.authParkTimeoutMinutes * 60 * 1000,
                sleep: this.sleep,
                now: () => Date.now(),
              });

              if (parkResult.type === 'timeout') {
                // Operator mode: Auth-park timeout
                const expiresAtStr = parkResult.expiresAt ?? 'unparseable';
                haltReason =
                  `Operator credentials expired and refresh timed out.\n` +
                  `Credentials file: ${parkResult.credentialsPath}\n` +
                  `Expires at: ${expiresAtStr}\n` +
                  `Please refresh your OAuth token and re-queue this feature.`;
              } else {
                haltReason = ''; // Not halting on successful resume
              }
            }

            // Handle park timeout
            if (parkResult.type === 'timeout') {
              // Task 14: Auth-park timeout → credentials-specific HALT.
              await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(
                () => {},
              );
              await writeFile(
                join(this.projectRoot, LOOP_HALT_MARKER),
                haltReason + '\n',
                'utf-8',
              ).catch(() => {
                /* best-effort marker */
              });
              // Durable signals (HALT marker + state) are written BEFORE escalation
              // so the daemon can classify the outcome even if escalation throws (C1).
              await writeState(this.stateFilePath, state);
              // Escalate with the credentials-specific reason (not generic "retries exhausted").
              const prUrl = await this.surfaceRemediationPr(haltReason);
              await this.events.emit({ type: 'loop_halt', reason: haltReason, prUrl });
              process.off('SIGINT', sigintHandler);
              process.off('SIGTERM', sigterm);
              return;
            }

            // Park resolved (refreshed or timeout-then-park-anyway); loop back to
            // retry without decrementing attempt (budget intact).
            attempt--;
            continue;
          }

          if (!result.success) {
            lastError = result.output ?? `Step '${step.name}' session ended with error`;
            retryHint = `Previous attempt failed: ${lastError}. Finish the work now.`;

            // Preflight opt-out halt (TR-16): if a HALT marker was written by the
            // preflight credentials check, exit immediately without retrying. This
            // preserves the credentials-specific HALT reason instead of allowing the
            // retry loop to overwrite it with the generic "retries exhausted" message.
            if (this.isSelfBuild() && step.name === 'build') {
              const haltPath = join(this.projectRoot, HALT_MARKER);
              const haltExists = await accessFile(haltPath).then(() => true).catch(() => false);
              if (haltExists) {
                // HALT marker was written by preflight check; exit immediately
                break;
              }
            }

            if (attempt < stepMaxRetries) {
              await this.events.emit({
                type: 'step_retry',
                step: step.name,
                attempt: attempt + 1,
                maxAttempts: stepMaxRetries,
                reason: lastError,
              });
              continue;
            }
            break;
          }

          // Step runner returned success. Now verify real completion.
          if (this.verifyArtifacts && stepHasCompletionCheck(step.name) && step.name !== 'complexity') {
            let completion = await checkStepCompletion(
              this.projectRoot,
              step.name,
              await this.completionCtx(state),
            );

            // Auto-heal hook: before treating a build-gate miss as a failure,
            // reconcile .pipeline/task-status.json against git log. If the
            // prior pipeline run committed work for tasks still marked
            // "pending", mark them completed in-place and re-check the gate
            // — the retry never has to fire. Runs fresh on every gate
            // evaluation (no once-per-session guard) to ensure derivation
            // uses current git state and fresh task counts (H7).
            let derivedCompletion: any = null;
            if (
              !completion.done &&
              step.name === 'build'
            ) {
              // Resolve the plan path used for derivation: prefer the
              // engine-recorded active plan path (H8), falling back to the
              // completion-context plan (findArtifactFilesForStep) when the
              // engine hasn't recorded one yet.
              const activePlanPath = await this.getActivePlanPath();
              const derivePlanPath = activePlanPath
                ? join(this.projectRoot, activePlanPath)
                : (await this.completionCtx(state)).planPath;

              const result = derivePlanPath
                ? await deriveCompletion(this.projectRoot, derivePlanPath)
                    .catch(() => null)
                : null;

              // Task 12: Capture the derived result for lane dispatch
              derivedCompletion = result;

              const heal = result
                ? await applyDerivedCompletion(this.projectRoot, result)
                : { healed: [], skipped: [] };
              await this.events.emit({
                type: 'auto_heal',
                step: 'build',
                healed: heal.healed.length,
                skipped: heal.skipped.length,
              });
              if (heal.healed.length > 0) {
                completion = await checkStepCompletion(
                  this.projectRoot,
                  step.name,
                  await this.completionCtx(state),
                );
              }

              // Task 12: Attribution lane integration. Runs after auto-heal
              // completes, before gate-miss handling. Extracts residue from
              // derived result, checks cutover armed, detects zero-work, and
              // dispatches the verifier. If the lane stamps tasks, those stamps
              // take effect on the NEXT derivation cycle (same evaluation loop —
              // no explicit re-derive here, as the lane runs inside the auto-heal
              // block which already re-checks completion once healing fires).
              if (
                derivedCompletion !== null &&
                isAttributionJudgeCutoverActive(this.config.attribution_judge_cutover)
              ) {
                // Extract residue: task IDs where completion is not achieved
                const residueIds = Object.keys(derivedCompletion).filter(
                  (id) => !derivedCompletion[id]?.completed && derivedCompletion[id]?.status !== 'skipped',
                );

                // Check zero-work once per gate evaluation to skip lane if needed
                const headShaAfterBuild = await currentCommitSha(this.projectRoot);
                const isZeroWork = await detectZeroWorkProduct({
                  projectRoot: this.projectRoot,
                  config: this.config,
                  headBefore: headShaBeforeBuild,
                  headAfter: headShaAfterBuild,
                });

                // Dispatch the lane if there's residue and cutover is armed
                const planPathOrNull = (await this.completionCtx(state)).planPath;
                if (
                  residueIds.length > 0 &&
                  planPathOrNull &&
                  headShaAfterBuild &&
                  !isZeroWork
                ) {
                  const planPath: string = planPathOrNull;
                  const headSha: string = headShaAfterBuild;
                  const git = makeGitRunner(this.projectRoot);
                  const laneResult: AttributionLaneResult = await runAttributionLane({
                    projectRoot: this.projectRoot,
                    planPath,
                    residueIds,
                    headSha,
                    cutoverArmed: true, // Already gated by isAttributionJudgeCutoverActive above
                    isZeroWorkProduct: false, // Already checked above
                    git: (args) => git(args),
                    dispatchVerifier: async (inputs) => {
                      try {
                        if (this.stepRunner.dispatchVerifier) {
                          const result = await this.stepRunner.dispatchVerifier({
                            residueIds: inputs.residueIds,
                            planPath,
                            projectRoot: this.projectRoot,
                          });
                          return {
                            success: result.success,
                            output: result.output ?? '',
                          };
                        }
                        return { success: false, output: 'dispatchVerifier not available' };
                      } catch (err) {
                        return {
                          success: false,
                          output: String(err),
                        };
                      }
                    },
                  });

                  // Task 13: Merge unsatisfied verdicts into pending retry hints.
                  // Unsatisfied reasons sharpen the BUILD retry hint by naming tasks
                  // that the verifier found unsatisfied. no-verdict and invalidated
                  // verdicts contribute nothing (mechanical hint unchanged).
                  if (laneResult.unsatisfiedReasons && laneResult.unsatisfiedReasons.size > 0) {
                    const unsatisfiedByTask = Array.from(laneResult.unsatisfiedReasons.entries())
                      .map(([taskId, reason]) => `task ${taskId}: ${reason}`)
                      .join('; ');
                    const verdictHint =
                      `Semantic attribution judge found unsatisfied tasks:\n${unsatisfiedByTask}\n` +
                      `These tasks lack sufficient evidence in commits and tests. Review the verifier's ` +
                      `analysis and address the implementation gaps.`;
                    pendingRetryHints.set('build', verdictHint);
                  }

                  // Task 12: Counter reset. If the lane dispatched and stamped
                  // tasks, those stamps are now in task-evidence.json. On the
                  // NEXT evaluation cycle (next auto-heal or gate check), the
                  // lane's stamps will cause residue to shrink. The existing
                  // progress-detection logic (line 1932: resolvedTasksAfter >
                  // resolvedTasksBefore) will then reset the counter. This run
                  // does not re-derive to check stamps immediately — the lane's
                  // stamps take effect on the next gate evaluation (same attempt
                  // loop, next iteration of the while loop at line 1766).
                }
              }
            }

            if (!completion.done) {
              lastError = `Step '${step.name}' completed but completion check failed: ${completion.reason ?? 'unknown'}`;
              retryHint = buildRetryHint(step.name, completion.reason);

              // prd-audit short-circuit (daemon only): re-auditing unchanged code
              // yields the same verdict, so the default retries are pure waste
              // once a fresh report with blocking rows exists. Stop retrying and
              // drop into the failure path, where the gap-class routes the daemon
              // back to BUILD (impl-gap) or halts (product/plan gap). A failure
              // with no fresh report (skill never wrote one / stale) still retries.
              if (this.daemon && step.name === 'prd_audit') {
                const cls = await classifyPrdAuditGaps(
                  this.projectRoot,
                  state.session_started_at,
                );
                if (cls.kind !== 'clean') break;
              }

              // Stall circuit breaker (build step only). If Claude ran but the
              // count of resolved tasks didn't move since the last attempt, or
              // the pipeline skill wrote .pipeline/halt-user-input-required,
              // we stop retrying and hand off to an interactive REPL so the
              // user can unblock whatever Claude couldn't decide on its own.
              // This covers the failure mode where Claude burns output on
              // "three options: ..." rhetorical questions that no automated
              // retry will ever resolve.
              let stalled: 'no_task_progress' | 'halt_marker' | null = null;
              if (step.name === 'build') {
                // #505 TS-15: zero-work-product detection. Runs before the
                // stall circuit breaker below — a zero-work session is a
                // distinct signal (kickback candidate, Task 16) from a
                // stalled-but-dispatched session, though both can share the
                // same halt-marker/completion gating.
                const headShaAfterBuild = await currentCommitSha(this.projectRoot);
                const dispatchCountThisStep = await readDispatchCount(this.projectRoot);
                const isZeroWork = await detectZeroWorkProduct({
                  projectRoot: this.projectRoot,
                  config: this.config,
                  headBefore: headShaBeforeBuild,
                  headAfter: headShaAfterBuild,
                });
                if (isZeroWork) {
                  await this.events.emit({
                    type: 'zero_work_product',
                    step: step.name,
                    dispatchCount: dispatchCountThisStep,
                    headSha: headShaAfterBuild,
                  });
                  // #505 TS-16: corrective preamble for the next dispatch —
                  // prepended (not replacing) so the completion-gate reason
                  // from buildRetryHint above still reaches Claude too.
                  retryHint =
                    `Previous attempt made zero progress (no work was dispatched, or ` +
                    `dispatched work produced no commits). Provide a single focused ` +
                    `task and description. ${retryHint ?? ''}`.trim();
                }

                const resolvedTasksAfter = await countResolvedTasks(this.projectRoot);
                const markerSet = await haltMarkerExists(this.projectRoot);
                if (markerSet) {
                  stalled = 'halt_marker';
                } else if (attempt >= 2 && resolvedTasksAfter <= resolvedTasksBefore) {
                  stalled = 'no_task_progress';
                }

                // Task 12: Durable no-evidence counter. Increment on EVERY
                // gate miss without progress (H7 — the counter accrues across
                // attempts, runs, and re-kicks; gating it on the attempt>=2
                // stall verdict would let single-attempt re-kick loops never
                // reach the park threshold), reset when progress is detected.
                if (this.taskEvidence) {
                  if (resolvedTasksAfter > resolvedTasksBefore) {
                    // Progress detected — reset counter and its reason tags
                    this.taskEvidence.noEvidenceAttempts = 0;
                    this.taskEvidence.noEvidenceReasons = [];
                    await this.taskEvidence.write();
                  } else {
                    // No-evidence miss — increment the durable counter. #505
                    // TS-16: tag the miss with `zero_work_product` when the
                    // detector above fired, so the ledger records WHY this
                    // attempt didn't count, not just that it didn't.
                    this.taskEvidence.noEvidenceAttempts++;
                    if (isZeroWork) {
                      this.taskEvidence.noEvidenceReasons.push('zero_work_product');
                    }
                    await this.taskEvidence.write();
                  }
                }

                // Task 23: daemon auto-park at the build gate layer (ADR
                // "last resort" + H7 durable counter). Fires ONLY on a build
                // gate miss: an empty/missing plan (the gate's own seed-time
                // verdict — never re-derived here) parks immediately; a
                // no-evidence counter at the threshold (durable in the
                // sidecar, so it accrues ACROSS re-kicks and restarts) parks
                // instead of looping. checkAndAutoPark is daemon-gated by
                // construction — interactive runs keep the stall-REPL path
                // below. A park is terminal for this run: the HALT marker
                // satisfies the marker guarantee, while the park marker is
                // what the re-kick sweep honors until an operator unparks.
                if (this.daemon) {
                  const gateReason = completion.reason ?? '';
                  const parkCtx = await this.completionCtx(state);
                  const emptyPlan =
                    !parkCtx.planPath ||
                    gateReason.includes('plan is empty') ||
                    gateReason.includes('no tasks in plan') ||
                    gateReason.includes('plan file not found');
                  const slug = state.feature_desc || 'unknown';
                  const { checkAndAutoPark } = await import('./daemon-auto-park.js');
                  const parkResult = await checkAndAutoPark(this.projectRoot, slug, {
                    maxAttempts: DAEMON_NO_EVIDENCE_THRESHOLD,
                    daemon: this.daemon,
                    ...(emptyPlan ? { reason: 'empty/missing plan' } : {}),
                    emit: (evt) =>
                      void this.events.emit(evt as Parameters<typeof this.events.emit>[0]),
                  });
                  if (parkResult.parked) {
                    const reason =
                      `auto-parked: ${emptyPlan ? 'empty/missing plan' : `no completion evidence after ${DAEMON_NO_EVIDENCE_THRESHOLD} attempts`}` +
                      ` — unpark with \`conduct daemon unpark ${slug}\``;
                    await writeFile(
                      join(this.projectRoot, LOOP_HALT_MARKER),
                      reason + '\n',
                      'utf-8',
                    ).catch(() => {});
                    state[step.name] = 'failed';
                    await writeState(this.stateFilePath, state);
                    await this.events.emit({ type: 'loop_halt', reason });
                    process.off('SIGINT', sigintHandler);
                    return;
                  }
                }

                if (stalled) {
                  await this.events.emit({
                    type: 'build_stall',
                    step: step.name,
                    reason: stalled,
                    resolvedBefore: resolvedTasksBefore,
                    resolvedAfter: resolvedTasksAfter,
                  });

                  // Task 3: capture halt marker content before clearing
                  let effectiveQuestion: string | null = null;
                  if (stalled === 'halt_marker') {
                    const question = await readHaltMarkerContent(this.projectRoot);
                    effectiveQuestion = await writeStallQuestionEvidence(
                      this.projectRoot,
                      question,
                    );
                    // Task 8: save the question for use in degraded remediation error handling
                    stallQuestion = question;
                  }

                  await clearHaltMarker(this.projectRoot);
                  await this.events.emit({
                    type: 'halt_cleared',
                    step: step.name,
                    cause: 'operator',
                  });

                  // Task 4-8: Daemon mode remediation dispatch for build stall
                  // In daemon mode with budget, dispatch /remediate to plan how to
                  // close the stall, then route deterministically from the plan.
                  // Interactive mode (this.mode !== 'auto') skips dispatch — the REPL
                  // is shown instead.
                  if (this.daemon && this.mode === 'auto' && effectiveQuestion) {
                    // Task 8: Budget exhausted — fail-safe HALT with question
                    if (remediationRounds >= MAX_KICKBACKS_PER_GATE) {
                      const haltContent =
                        effectiveQuestion +
                        '\n\nRemediation budget exhausted (max ' + MAX_KICKBACKS_PER_GATE + ' kickbacks per gate).';
                      await mkdir(join(this.projectRoot, '.pipeline'), {
                        recursive: true,
                      }).catch(() => {});
                      await writeFile(
                        join(this.projectRoot, LOOP_HALT_MARKER),
                        haltContent + '\n',
                        'utf-8',
                      ).catch(() => {
                        /* best-effort marker */
                      });
                      await writeState(this.stateFilePath, state);
                      const prUrl = await this.surfaceRemediationPr(haltContent);
                      await this.events.emit({ type: 'loop_halt', reason: effectiveQuestion, prUrl });
                      process.off('SIGINT', sigintHandler);
                      process.off('SIGTERM', sigterm);
                      return;
                    }
                  }

                  if (
                    this.daemon &&
                    this.mode === 'auto' &&
                    remediationRounds < MAX_KICKBACKS_PER_GATE &&
                    effectiveQuestion
                  ) {
                    remediationRounds++;
                    let outcome;
                    try {
                      outcome = await this.planRemediation(
                        state,
                        steps,
                        `Remediate build stall: ${effectiveQuestion}`,
                        { source: 'build_stall', evidenceFile: '.pipeline/build-stall-question.md' },
                      );
                    } catch (err) {
                      // Task 8: Degraded remediation exit (throw). Write HALT with question.
                      // The /remediate dispatch itself crashed; log it and use the question
                      // to halt the run so a human can investigate.
                      console.error('build-stall remediation dispatch threw:', err);
                      const haltContent = effectiveQuestion + '\n\nremediation dispatch failed: ' + String(err);
                      await mkdir(join(this.projectRoot, '.pipeline'), {
                        recursive: true,
                      }).catch(() => {});
                      await writeFile(
                        join(this.projectRoot, LOOP_HALT_MARKER),
                        haltContent + '\n',
                        'utf-8',
                      ).catch(() => {
                        /* best-effort marker */
                      });
                      await writeState(this.stateFilePath, state);
                      const prUrl = await this.surfaceRemediationPr(haltContent);
                      await this.events.emit({ type: 'loop_halt', reason: effectiveQuestion, prUrl });
                      process.off('SIGINT', sigintHandler);
                      process.off('SIGTERM', sigterm);
                      return;
                    }

                    if (outcome.kind === 'route') {
                      // Task 5: answerable build stall — resume within the retry loop
                      // instead of rewinding to the outer step loop. When remediation
                      // returns target='build', extract the answer and continue the
                      // build retry loop without burning a retry attempt (attempt--).
                      if (outcome.target === 'build') {
                        await this.events.emit({
                          type: 'kickback',
                          from: step.name,
                          to: outcome.target,
                          evidence: outcome.evidence,
                          count: remediationRounds,
                        });
                        retryHint = outcome.hint;
                        attempt--;
                        continue;
                      }

                      // Task 7: Fail-closed route validation. A build-stall remediation
                      // outcome must route back to 'build' (answering the stall question).
                      // If remediation misroutes to a non-build step, halt with the
                      // question to signal the human that remediation is broken.
                      const detail =
                        `misrouted to '${outcome.target}': build stall answers must be ` +
                        `disposition='build', not routed elsewhere.`;
                      const haltContent = effectiveQuestion + '\n\n' + detail;
                      await mkdir(join(this.projectRoot, '.pipeline'), {
                        recursive: true,
                      }).catch(() => {});
                      await writeFile(
                        join(this.projectRoot, LOOP_HALT_MARKER),
                        haltContent + '\n',
                        'utf-8',
                      ).catch(() => {
                        /* best-effort marker */
                      });
                      await writeState(this.stateFilePath, state);
                      const prUrl = await this.surfaceRemediationPr(haltContent);
                      await this.events.emit({ type: 'loop_halt', reason: effectiveQuestion, prUrl });
                      process.off('SIGINT', sigintHandler);
                      process.off('SIGTERM', sigterm);
                      return;
                    }
                    if (outcome.kind === 'halt') {
                      // Task 6: Write HALT with question first, then disposition detail.
                      // This preserves the human question context that the /remediate skill
                      // determined requires human DECIDE, avoiding the generic
                      // "retries exhausted" message and ensuring the question is the
                      // first line the human sees.
                      const haltContent = effectiveQuestion + '\n\n' + outcome.detail;
                      await mkdir(join(this.projectRoot, '.pipeline'), {
                        recursive: true,
                      }).catch(() => {});
                      await writeFile(
                        join(this.projectRoot, LOOP_HALT_MARKER),
                        haltContent + '\n',
                        'utf-8',
                      ).catch(() => {
                        /* best-effort marker */
                      });
                      await writeState(this.stateFilePath, state);
                      const prUrl = await this.surfaceRemediationPr(haltContent);
                      await this.events.emit({ type: 'loop_halt', reason: effectiveQuestion, prUrl });
                      process.off('SIGINT', sigintHandler);
                      process.off('SIGTERM', sigterm);
                      return;
                    }
                    if (outcome.kind === 'none') {
                      // Task 8: Degraded remediation exit (malformed/stale/dropped).
                      // No valid dispositions from /remediate; halt with the question
                      // so human can investigate why remediation failed.
                      const haltContent =
                        effectiveQuestion +
                        '\n\nremediation produced no valid dispositions ' +
                        '(check .pipeline/remediation.json: malformed JSON, stale file, or all dispositions dropped by validation)';
                      await mkdir(join(this.projectRoot, '.pipeline'), {
                        recursive: true,
                      }).catch(() => {});
                      await writeFile(
                        join(this.projectRoot, LOOP_HALT_MARKER),
                        haltContent + '\n',
                        'utf-8',
                      ).catch(() => {
                        /* best-effort marker */
                      });
                      await writeState(this.stateFilePath, state);
                      const prUrl = await this.surfaceRemediationPr(haltContent);
                      await this.events.emit({ type: 'loop_halt', reason: effectiveQuestion, prUrl });
                      process.off('SIGINT', sigintHandler);
                      process.off('SIGTERM', sigterm);
                      return;
                    }
                  }

                  // Hand off: open an interactive Claude session so the user
                  // can break the stall. After the REPL exits, re-check
                  // completion one more time. If passing, the step succeeds;
                  // if still failing, fall into the normal recovery menu.
                  // Skipped in auto mode — there's no human to break the stall,
                  // so we fall straight through to the (auto) failure handling.
                  if (this.mode !== 'auto' && this.stepRunner.runInteractive) {
                    await this.stepRunner.runInteractive(step.name);
                  }
                  const recheck = await checkStepCompletion(
                    this.projectRoot,
                    step.name,
                    await this.completionCtx(state),
                  );
                  if (recheck.done) {
                    succeeded = true;
                    successOutput = result.output;

                    // Task 12: If the interactive REPL resolved the issue and the gate
                    // now passes, reset the counter since progress was made.
                    if (this.taskEvidence) {
                      this.taskEvidence.noEvidenceAttempts = 0;
                      this.taskEvidence.noEvidenceReasons = [];
                      await this.taskEvidence.write();
                    }
                  }
                  break;
                }
                resolvedTasksBefore = resolvedTasksAfter;
              }

              if (attempt < stepMaxRetries) {
                await this.events.emit({
                  type: 'step_retry',
                  step: step.name,
                  attempt: attempt + 1,
                  maxAttempts: stepMaxRetries,
                  reason: completion.reason ?? 'completion check failed',
                });
                continue;
              }
              break;
            }
          }

          succeeded = true;
          successOutput = result.output;
          break;
        }

        if (!succeeded) {
          // Exhausted retries — route through the recovery menu.
          await saveStepStatus(this.stateFilePath, step.name, 'failed');
          state[step.name] = 'failed';
          await this.events.emit({
            type: 'step_failed',
            step: step.name,
            error: lastError,
            retryCount: attempt,
          });

          // Auto mode is unattended — NEVER prompt or open a REPL. An advisory
          // step's failure auto-skips so it can't block the run; a gating or
          // structural failure (e.g. plan, build) stops the run for a human to
          // inspect. This must come before the interactive recovery menu below.
          if (this.mode === 'auto') {
            if (step.enforcement === 'advisory') {
              await saveStepStatus(this.stateFilePath, step.name, 'skipped');
              state[step.name] = 'skipped';
              continue;
            }

            // prd-audit gap-aware routing (daemon only). A blocking audit halts
            // today regardless of cause. Instead, distinguish WHO can close the
            // gap: a pure implementation gap (impl-gap) is the daemon's to fix —
            // route back to BUILD and re-audit (bounded by prdAuditSelfHeals so
            // an impl-gap it can't actually close still halts). A product/plan
            // gap (intended-drift, or an unclassifiable blocking row) needs a
            // human DECIDE amendment the daemon can't run — halt for inspection.
            // Manual-test FAIL routing (daemon only, #367): a manual_test that
            // exhausted its retries with FAIL rows recorded is an implementation
            // gap by definition — the routing question prd_audit needs an agent
            // for (impl vs product-scope) has exactly one answer here, so route
            // deterministically back to BUILD with the FAIL rows as the retry
            // hint (no /remediate dispatch). A non-FAIL gate miss (missing/stale
            // results — the skill never ran or recorded properly) carries no bug
            // evidence to hand BUILD and falls through to the generic gating
            // HALT below, as does an exhausted self-heal budget.
            if (this.daemon && step.name === 'manual_test') {
              const failRows = await readManualTestFailRows(this.projectRoot);
              if (failRows.length > 0) {
                if (manualTestSelfHeals < MAX_KICKBACKS_PER_GATE) {
                  manualTestSelfHeals++;
                  const evidence = failRows.join('\n');
                  await this.events.emit({
                    type: 'kickback',
                    from: 'manual_test',
                    to: 'build',
                    evidence,
                    count: manualTestSelfHeals,
                  });
                  // Hand BUILD the bugs it must fix. The whitewash guard on the
                  // manual_test gate refuses a PASS rewrite with no new commits,
                  // so a no-op BUILD cannot silently converge this loop.
                  pendingRetryHints.set(
                    'build',
                    `manual-test FAILED with these results:\n${evidence}\nRead ` +
                      `.pipeline/manual-test-results.md (latest attempt section) for full ` +
                      `evidence. The plan's task list may already be complete — these are ` +
                      `BUGS in the shipped code. Implement and COMMIT fixes for each FAIL; ` +
                      `the manual_test gate refuses a FAIL→PASS rewrite that adds no new ` +
                      `commits, and manual-test re-runs after this build.`,
                  );

                  // Task 7: Merged-PR guard on manual_test kickback (TS-1).
                  // Before committing the rewind, check if the recorded PR has been
                  // merged out-of-band. If so, stop the run as a synthetic verified
                  // ship and return successfully.
                  if (await this.stopIfPrMerged(state, sigintHandler, sigterm)) {
                    return;
                  }
                  const nav = navigateBack(state, 'build', steps);
                  state = nav.state;
                  // markDownstreamStale only restages `done` steps; manual_test
                  // is `failed` here, so restage it explicitly for the tail.
                  (state as Record<string, unknown>).manual_test = 'stale';
                  await writeState(this.stateFilePath, state);
                  i = nav.index - 1; // for-loop i++ lands on build
                  continue;
                }
                const reason =
                  `manual-test FAIL unresolved after ${manualTestSelfHeals} build ` +
                  `kickback(s) (cap ${MAX_KICKBACKS_PER_GATE}): ${failRows[0]}` +
                  (failRows.length > 1 ? ` (+${failRows.length - 1} more FAIL row(s))` : '');
                await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(
                  () => {},
                );
                await writeFile(
                  join(this.projectRoot, LOOP_HALT_MARKER),
                  reason + '\n',
                  'utf-8',
                ).catch(() => {
                  /* best-effort marker */
                });
                await writeState(this.stateFilePath, state);
                const prUrl = await this.surfaceRemediationPr(reason);
                await this.events.emit({ type: 'loop_halt', reason, prUrl });
                process.off('SIGINT', sigintHandler);
                process.off('SIGTERM', sigterm);
                return;
              }
            }

            // build_review kickback (daemon only, Task 13): a FAIL verdict from
            // the objective grader between `build` and `manual_test` is an
            // implementation gap by definition — route back to BUILD with the
            // grader's reasons as the retry hint. Uses the shared `kickbackCounts`
            // map keyed by 'build_review' (the same anti-ping-pong mechanism the
            // gate-driven tail uses for other gates), bounded by
            // MAX_KICKBACKS_PER_GATE like the other self-heal loops.
            if (this.daemon && step.name === 'build_review') {
              let verdictRaw: unknown = null;
              try {
                verdictRaw = JSON.parse(
                  await readFile(join(this.projectRoot, BUILD_REVIEW_VERDICT), 'utf-8'),
                );
              } catch {
                /* missing/unreadable — falls through to generic HALT below */
              }
              const parsed = verdictRaw !== null ? validateBuildReviewVerdict(verdictRaw) : null;
              if (parsed?.ok && parsed.verdict === 'FAIL') {
                const count = (kickbackCounts.get('build_review') ?? 0) + 1;
                if (count <= MAX_KICKBACKS_PER_GATE) {
                  kickbackCounts.set('build_review', count);
                  const evidence =
                    parsed.reasons && parsed.reasons.length > 0
                      ? parsed.reasons.join('\n')
                      : 'grader returned FAIL without reasons';
                  await this.events.emit({
                    type: 'kickback',
                    from: 'build_review',
                    to: 'build',
                    evidence,
                    count,
                  });
                  pendingRetryHints.set(
                    'build',
                    `build_review FAILED with these reasons:\n${evidence}\nFix the ` +
                      `flagged issue(s) in build, then COMMIT — build_review re-runs after ` +
                      `this build.`,
                  );

                  // Task 7: Merged-PR guard on build_review kickback (TS-1).
                  // Before committing the rewind, check if the recorded PR has been
                  // merged out-of-band. If so, stop the run as a synthetic verified
                  // ship and return successfully.
                  if (await this.stopIfPrMerged(state, sigintHandler, sigterm)) {
                    return;
                  }
                  const nav = navigateBack(state, 'build', steps);
                  state = nav.state;
                  // markDownstreamStale only restages `done` steps; build_review
                  // is `failed` here, so restage it (and manual_test) explicitly
                  // for the tail.
                  (state as Record<string, unknown>).build_review = 'stale';
                  (state as Record<string, unknown>).manual_test = 'stale';
                  await writeState(this.stateFilePath, state);
                  i = nav.index - 1; // for-loop i++ lands on build
                  continue;
                }
                const reason =
                  `build_review FAIL unresolved after ${count - 1} build kickback(s) ` +
                  `(cap ${MAX_KICKBACKS_PER_GATE}): ${parsed.reasons?.[0] ?? 'no reasons recorded'}`;
                await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(
                  () => {},
                );
                await writeFile(
                  join(this.projectRoot, LOOP_HALT_MARKER),
                  reason + '\n',
                  'utf-8',
                ).catch(() => {
                  /* best-effort marker */
                });
                await writeState(this.stateFilePath, state);
                const prUrl = await this.surfaceRemediationPr(reason);
                await this.events.emit({ type: 'loop_halt', reason, prUrl });
                process.off('SIGINT', sigintHandler);
                return;
              }
            }

            // Task 8: Stall remediation with error handling for degraded exits.
            // When a build stall is detected (stallQuestion is set), attempt to dispatch
            // /remediate to get the answer. Wrap in try/catch to handle dispatch throws,
            // and check outcome.kind for malformed JSON / stale file / dropped dispositions.
            // Budget is checked before dispatch to implement fail-safe immediate HALT for
            // exhausted budget (Task 8 E). Any error or degraded outcome writes HALT with
            // the question (TR-5), never a generic retries-exhausted message.
            if (this.daemon && step.name === 'build' && stallQuestion !== null) {
              // Budget check: if we've already exhausted the remediation budget on prior
              // stalls in this run, skip dispatch and go straight to fail-safe HALT.
              if (remediationRounds >= MAX_KICKBACKS_PER_GATE) {
                const detail = `Remediation budget exhausted (${remediationRounds} stalls attempted, cap ${MAX_KICKBACKS_PER_GATE})`;
                await writeStallHalt(this.projectRoot, stallQuestion, detail);
                await writeState(this.stateFilePath, state);
                const prUrl = await this.surfaceRemediationPr(stallQuestion + '\n\n' + detail);
                await this.events.emit({ type: 'loop_halt', reason: stallQuestion + '\n\n' + detail, prUrl });
                process.off('SIGINT', sigintHandler);
                process.off('SIGTERM', sigterm);
                return;
              }

              // Attempt remediation dispatch with error handling
              try {
                const outcome = await this.planRemediation(
                  state,
                  steps,
                  'Build stall detected. Agent needs input to proceed. A question is at ' +
                    '.pipeline/halt-user-input-required. Plan remediation per the /remediate ' +
                    'skill and write .pipeline/remediation.json.',
                  { source: 'build-stall', evidenceFile: '.pipeline/halt-user-input-required' },
                );

                if (outcome.kind === 'route') {
                  remediationRounds++;
                  await this.events.emit({
                    type: 'kickback',
                    from: 'build',
                    to: outcome.target,
                    evidence: outcome.evidence,
                    count: remediationRounds,
                  });
                  pendingRetryHints.set(outcome.target, outcome.hint);

                  // Task 7: Merged-PR guard on stall remediation kickback (TS-1).
                  if (await this.stopIfPrMerged(state, sigintHandler, sigterm)) {
                    return;
                  }

                  const nav = navigateBack(state, outcome.target, steps);
                  state = nav.state;
                  (state as Record<string, unknown>).build = 'stale';
                  await writeState(this.stateFilePath, state);
                  i = nav.index - 1; // for-loop i++ lands on the target step
                  continue;
                }

                if (outcome.kind === 'halt') {
                  const reason = stallQuestion + '\n\n' + outcome.detail;
                  await writeStallHalt(this.projectRoot, stallQuestion, outcome.detail);
                  await writeState(this.stateFilePath, state);
                  const prUrl = await this.surfaceRemediationPr(reason);
                  await this.events.emit({ type: 'loop_halt', reason, prUrl });
                  process.off('SIGINT', sigintHandler);
                  process.off('SIGTERM', sigterm);
                  return;
                }

                // outcome.kind === 'none' (no valid dispositions after validation,
                // malformed JSON, or stale file) — fall through to fail-safe HALT below.
                const detail = 'Remediation plan missing or invalid (no routable dispositions found)';
                await writeStallHalt(this.projectRoot, stallQuestion, detail);
                await writeState(this.stateFilePath, state);
                const prUrl = await this.surfaceRemediationPr(stallQuestion + '\n\n' + detail);
                await this.events.emit({ type: 'loop_halt', reason: stallQuestion + '\n\n' + detail, prUrl });
                process.off('SIGINT', sigintHandler);
                process.off('SIGTERM', sigterm);
                return;
              } catch (err) {
                // Remediation dispatch threw an error — fail-safe HALT with the question
                const detail = `Remediation dispatch failed: ${err instanceof Error ? err.message : String(err)}`;
                await writeStallHalt(this.projectRoot, stallQuestion, detail);
                await writeState(this.stateFilePath, state);
                const prUrl = await this.surfaceRemediationPr(stallQuestion + '\n\n' + detail);
                await this.events.emit({ type: 'loop_halt', reason: stallQuestion + '\n\n' + detail, prUrl });
                process.off('SIGINT', sigintHandler);
                process.off('SIGTERM', sigterm);
                return;
              }
            }

            if (this.daemon && step.name === 'prd_audit') {
              // Agentic remediation (preferred): dispatch /remediate to plan how
              // to close the blocking gaps, then route deterministically from its
              // structured plan. HALT is reserved for architectural-clarity /
              // product-scope gaps; everything else routes to the right step.
              // Mixed gaps fix the autonomous ones first — the human gaps
              // re-surface on the next audit and HALT then. Falls back to the
              // deterministic classifyPrdAuditGaps routing when no usable plan is
              // produced or the remediation budget is exhausted.
              if (remediationRounds < MAX_KICKBACKS_PER_GATE) {
                const outcome = await this.planRemediation(
                  state,
                  steps,
                  'A blocking prd-audit is at .pipeline/prd-audit.md (an as-built ' +
                    'review may be at .pipeline/architecture-review-as-built.md). Plan ' +
                    'remediation per the /remediate skill and write ' +
                    '.pipeline/remediation.json.',
                  { source: 'prd-audit', evidenceFile: '.pipeline/prd-audit.md' },
                );
                if (outcome.kind === 'route') {
                  remediationRounds++;
                  await this.events.emit({
                    type: 'kickback',
                    from: 'prd_audit',
                    to: outcome.target,
                    evidence: outcome.evidence,
                    count: remediationRounds,
                  });
                  pendingRetryHints.set(outcome.target, outcome.hint);

                  // Task 7: Merged-PR guard on generic remediation kickback (TS-1).
                  // Before committing the rewind, check if the recorded PR has been
                  // merged out-of-band. If so, stop the run as a synthetic verified
                  // ship and return successfully.
                  if (await this.stopIfPrMerged(state, sigintHandler, sigterm)) {
                    return;
                  }
                  const nav = navigateBack(state, outcome.target, steps);
                  state = nav.state;
                  (state as Record<string, unknown>).prd_audit = 'stale';
                  await writeState(this.stateFilePath, state);
                  i = nav.index - 1; // for-loop i++ lands on the target step
                  continue;
                }
                if (outcome.kind === 'halt') {
                  const reason = 'prd-audit halted: needs human DECIDE — ' + outcome.detail;
                  await mkdir(join(this.projectRoot, '.pipeline'), {
                    recursive: true,
                  }).catch(() => {});
                  await writeFile(
                    join(this.projectRoot, LOOP_HALT_MARKER),
                    reason + '\n',
                    'utf-8',
                  ).catch(() => {
                    /* best-effort marker */
                  });
                  await writeState(this.stateFilePath, state);
                  const prUrl = await this.surfaceRemediationPr(reason);
                  await this.events.emit({ type: 'loop_halt', reason, prUrl });
                  process.off('SIGINT', sigintHandler);
                  process.off('SIGTERM', sigterm);
                  return;
                }
                // No usable remediation plan → fall through to the fallback below.
              }

              // Fallback (no /remediate plan, or remediation budget exhausted):
              // the deterministic classifyPrdAuditGaps routing.
              const cls = await classifyPrdAuditGaps(
                this.projectRoot,
                state.session_started_at,
              );
              if (cls.kind === 'impl-only' && prdAuditSelfHeals < MAX_KICKBACKS_PER_GATE) {
                prdAuditSelfHeals++;
                await this.events.emit({
                  type: 'kickback',
                  from: 'prd_audit',
                  to: 'build',
                  evidence: cls.summary,
                  count: prdAuditSelfHeals,
                });
                // Hand the BUILD agent the gap it must close. Without this the
                // re-dispatched BUILD got no context, saw a complete task list,
                // and changed nothing — so the re-audit failed the same FRs and
                // the loop burned the self-heal budget to no effect.
                pendingRetryHints.set(
                  'build',
                  `prd-audit BLOCKED on un-ALIGNED FRs: ${cls.summary}. The plan's ` +
                    `task list is already complete, but these functional requirements ` +
                    `are NOT satisfied in the shipped code. Read .pipeline/prd-audit.md ` +
                    `for the per-FR gap-class and file:line evidence, then make the code ` +
                    `changes needed to close each gap and commit them — do NOT rely on ` +
                    `the task list being done. The as-built code is re-audited after ` +
                    `this build; an unaddressed gap will re-block.`,
                );

                // Task 7: Merged-PR guard on prd_audit fallback kickback (TS-1).
                // Before committing the rewind, check if the recorded PR has been
                // merged out-of-band. If so, stop the run as a synthetic verified
                // ship and return successfully.
                if (await this.stopIfPrMerged(state, sigintHandler, sigterm)) {
                  return;
                }
                const nav = navigateBack(state, 'build', steps);
                state = nav.state;
                // markDownstreamStale only restages `done` steps; prd_audit is
                // `failed` here, so restage it explicitly to re-run on the tail.
                (state as Record<string, unknown>).prd_audit = 'stale';
                await writeState(this.stateFilePath, state);
                i = nav.index - 1; // for-loop i++ lands on build
                continue;
              }
              const reason =
                cls.kind === 'impl-only'
                  ? `prd-audit impl-gap unresolved after ${prdAuditSelfHeals} build attempt(s) (cap ${MAX_KICKBACKS_PER_GATE}): ${cls.summary}`
                  : `prd-audit halted: product/plan gap needs human DECIDE — ${cls.summary}`;
              await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(
                () => {},
              );
              await writeFile(
                join(this.projectRoot, LOOP_HALT_MARKER),
                reason + '\n',
                'utf-8',
              ).catch(() => {
                /* best-effort marker */
              });
              await writeState(this.stateFilePath, state);
              const prUrl = await this.surfaceRemediationPr(reason);
              await this.events.emit({ type: 'loop_halt', reason, prUrl });
              process.off('SIGINT', sigintHandler);
              process.off('SIGTERM', sigterm);
              return;
            }

            // Finish/as-built remediation (daemon only): give the same /remediate
            // planner that routes a blocking prd_audit a shot at a failed finish
            // verification or a BLOCKED as-built review before the generic HALT.
            // The technical track skips prd_audit entirely, so without this hook
            // these gates dead-end in a HALT even when the gap is routable (e.g.
            // collateral test failures after an intentional contract change).
            if (
              this.daemon &&
              (step.name === 'finish' || step.name === 'architecture_review_as_built') &&
              remediationRounds < MAX_KICKBACKS_PER_GATE
            ) {
              const finishGate = step.name === 'finish';
              const outcome = await this.planRemediation(
                state,
                steps,
                finishGate
                  ? `The finish step's fresh verification failed: ${lastError}. ` +
                      'Failing-test evidence, when the finish skill recorded it, is at ' +
                      '.pipeline/test-failures.md. Plan remediation per the /remediate ' +
                      'skill and write .pipeline/remediation.json.'
                  : 'A blocking as-built architecture review is at ' +
                      '.pipeline/architecture-review-as-built.md. Plan remediation per ' +
                      'the /remediate skill and write .pipeline/remediation.json.',
                finishGate
                  ? { source: 'finish-verification', evidenceFile: '.pipeline/test-failures.md' }
                  : {
                      source: 'as-built architecture review',
                      evidenceFile: '.pipeline/architecture-review-as-built.md',
                    },
              );
              if (outcome.kind === 'route') {
                remediationRounds++;
                await this.events.emit({
                  type: 'kickback',
                  from: step.name,
                  to: outcome.target,
                  evidence: outcome.evidence,
                  count: remediationRounds,
                });
                pendingRetryHints.set(outcome.target, outcome.hint);

                // Task 4: Merged-PR guard on finish-remediation kickback (TS-1).
                // Before committing the rewind, check if the recorded PR has been
                // merged out-of-band. If so, stop the run as a synthetic verified
                // ship and return successfully.
                if (await this.stopIfPrMerged(state, sigintHandler, sigterm)) {
                  return;
                }

                const nav = navigateBack(state, outcome.target, steps);
                state = nav.state;
                // markDownstreamStale only restages `done` steps; this gate is
                // `failed` here, so restage it explicitly to re-run on the tail.
                (state as Record<string, unknown>)[step.name] = 'stale';
                await writeState(this.stateFilePath, state);
                i = nav.index - 1; // for-loop i++ lands on the target step
                continue;
              }
              if (outcome.kind === 'halt') {
                const reason =
                  `${finishGate ? 'finish' : 'as-built architecture review'} halted: ` +
                  `needs human DECIDE — ${outcome.detail}`;
                await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(
                  () => {},
                );
                await writeFile(
                  join(this.projectRoot, LOOP_HALT_MARKER),
                  reason + '\n',
                  'utf-8',
                ).catch(() => {
                  /* best-effort marker */
                });
                await writeState(this.stateFilePath, state);
                const prUrl = await this.surfaceRemediationPr(reason);
                await this.events.emit({ type: 'loop_halt', reason, prUrl });
                process.off('SIGINT', sigintHandler);
                process.off('SIGTERM', sigterm);
                return;
              }
              // No usable remediation plan → fall through to the generic HALT below.
            }

            // Unattended hard failure on a gating/structural step. Write a HALT
            // marker (not just return) so a supervising daemon classifies this as
            // `halted` — worktree kept, NOT marked processed, retryable after a
            // human looks — instead of "loop ended without DONE or HALT marker".
            // If a step already wrote a specific HALT reason (e.g. the pre-flight
            // credentials check), preserve it — never overwrite with the generic
            // "retries exhausted" message (adr-2026-07-04-auth-failure-park-and-poll).
            const existingHalt = await readFile(
              join(this.projectRoot, LOOP_HALT_MARKER),
              'utf-8',
            ).catch(() => null);
            const reason =
              existingHalt && existingHalt.trim().length > 0
                ? existingHalt.trim()
                : `step '${step.name}' failed in auto mode (retries exhausted)`;
            await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(
              () => {},
            );
            await writeFile(
              join(this.projectRoot, LOOP_HALT_MARKER),
              reason + '\n',
              'utf-8',
            ).catch(() => {
              /* best-effort marker */
            });
            // Durable signals (HALT marker + state) are written BEFORE escalation
            // so the daemon can classify the outcome even if escalation throws (C1).
            await writeState(this.stateFilePath, state);
            // Escalate for all gating/structural steps (not just build): open a
            // needs-remediation draft PR so a human can see the failure without
            // hunting through daemon logs. surfaceRemediationPr is best-effort and
            // wraps escalation in try/catch — a throwing escalation must never
            // prevent the HALT path from returning cleanly (C1).
            const prUrl = await this.surfaceRemediationPr(`${reason}\n${lastError}`);
            await this.events.emit({ type: 'loop_halt', reason, prUrl });
            process.off('SIGINT', sigintHandler);
            process.off('SIGTERM', sigterm);
            return;
          }

          if (this.onRecovery) {
            const gating = step.enforcement === 'gating';
            let action: RecoveryOption;
            // Keep polling the UI until it returns something other than `retry`
            // once retries are exhausted. Terminal-side prompt hosts should drop
            // `retry` from the menu when `retriesExhausted` is set; if a caller
            // ignores the context, this loop prevents an infinite retry storm.
            while (true) {
              const count = recoveryRetries.get(step.name) ?? 0;
              const retriesExhausted = count >= MAX_RECOVERY_RETRIES;
              action = await this.onRecovery(step.name, gating, {
                recoveryCount: count,
                retriesExhausted,
              });
              if (action === 'retry' && retriesExhausted) continue;
              break;
            }
            if (action === 'retry') {
              recoveryRetries.set(step.name, (recoveryRetries.get(step.name) ?? 0) + 1);
              i--;
              continue;
            }
            if (action === 'skip' && !gating) {
              await saveStepStatus(this.stateFilePath, step.name, 'skipped');
              state[step.name] = 'skipped';
              continue;
            }
            if (action === 'back') {
              const navigable = getNavigableSteps(state, steps);
              const target = await this.onNavigate(navigable);
              if (target) {
                const nav = navigateBack(state, target, steps);
                await this.events.emit({ type: 'navigation_back', from: step.name, to: target });
                state = nav.state;
                await writeState(this.stateFilePath, state);
                i = nav.index - 1;
                continue;
              }
            }
            if (action === 'interactive') {
              if (this.stepRunner.runInteractive) {
                await this.stepRunner.runInteractive(step.name);
              }
              i--;
              continue;
            }
          }

          await writeState(this.stateFilePath, state);
          process.off('SIGINT', sigintHandler);
          process.off('SIGTERM', sigterm);
          return;
        }

        // Success path ------------------------------------------------------
        {
          // Artifact review gate. Runs for every step that declares artifact
          // globs (STEP_ARTIFACT_GLOBS[step].length > 0). Behavior is driven by
          // resolved.review:
          //   - auto:        silently record approvals; no prompt
          //   - manual:      always prompt the user
          //   - conditional: auto-approve unless the skill wrote
          //                  `.pipeline/review-required-<step>` (signalling it
          //                  found issues worth human attention)
          // Approved (path + sha256 match) files skip re-prompting across runs.
          if (stepHasCompletionCheck(step.name) && this.mode !== 'auto') {
            const allFiles = await findArtifactFilesForStep(this.projectRoot, step.name);
            if (allFiles.length > 0) {
              const unapproved = await filterUnapprovedArtifacts(
                allFiles,
                state.artifact_approvals ?? {},
                this.projectRoot,
              );
              if (unapproved.length > 0) {
                let reviewResult: ArtifactReviewResult = 'approved';
                let shouldPrompt = false;

                if (resolved.review === 'manual') {
                  shouldPrompt = true;
                } else if (resolved.review === 'conditional') {
                  const markerPath = join(
                    this.projectRoot,
                    '.pipeline',
                    `review-required-${step.name}`,
                  );
                  try {
                    await accessFile(markerPath);
                    shouldPrompt = true;
                  } catch {
                    // No marker → auto-approve (skill reported no issues).
                  }
                }
                // review === 'auto' → shouldPrompt stays false.

                if (shouldPrompt) {
                  reviewResult = await this.onReviewArtifacts(step.name, unapproved);
                }

                if (reviewResult === 'rejected') {
                  i--; // Re-run the step; user rejected artifacts
                  continue;
                }

                // Approved — record hashes for the reviewed files.
                state.artifact_approvals = await recordApprovals(
                  state.artifact_approvals ?? {},
                  unapproved,
                  this.projectRoot,
                );
                await writeState(this.stateFilePath, state);

                // Clean up the conditional marker, if any, so next run starts fresh.
                if (resolved.review === 'conditional') {
                  const markerPath = join(
                    this.projectRoot,
                    '.pipeline',
                    `review-required-${step.name}`,
                  );
                  await unlinkFile(markerPath).catch(() => {
                    /* marker absent — nothing to clean up */
                  });
                }
              }
            }
          }

          // Plan-step owner stamping (Slice B, Story 3, D4). After the artifact
          // gate passes (all `.docs/plans/*.md` artifacts validated), stamp the
          // `.docs/intake/<plan-stem>.md` owner marker so the operator identity
          // travels with the spec onto the merged default branch. Use the same
          // machine-scoped identity resolution as the `/engineer` path.
          // Task 14: Also record the active plan path in engine state.
          if (step.name === 'plan') {
            const planFiles = await findArtifactFilesForStep(this.projectRoot, 'plan');
            // D4 keying: stamp ONLY the plan(s) authored in THIS run — files that
            // are new or modified relative to the pre-step snapshot. `.docs/plans/`
            // accumulates historical plans, so a glob-first pick would key the
            // marker to the wrong stem (new spec un-owned; unrelated spec's marker
            // rewritten with this operator's identity).
            const authoredPlans = await selectChangedArtifacts(planFiles, planSnapshot);
            if (authoredPlans.length > 0) {
              // Resolve machine-scoped owner identity (configured spec_owner or gh login).
              // Fail-closed: throw if unresolved (same error text as Story 2).
              const ownerConfig = await readMachineOwnerConfig();
              const ownerResolution = await resolveDaemonOwner(
                ownerConfig,
                this.gh,
                this.projectRoot,
              );

              if (!ownerResolution.resolved) {
                throw new Error(
                  'Unresolved operator identity — cannot stamp owner marker. ' +
                  'Configure spec_owner in ~/.ai-conductor/config.yml, or run `gh auth login` ' +
                  'to authenticate with GitHub.',
                );
              }

              for (const planFile of authoredPlans) {
                // The daemon's backlog resolver keys markers by planStem(file).
                const stem = planStem(planFile);

                // Preserve any pre-existing Source-Ref from a prior engineer-path run
                // (Task 13a: an existing Source-Ref: line survives owner stamping).
                let sourceRef: string | undefined;
                const markerPath = join(this.projectRoot, '.docs', 'intake', `${stem}.md`);
                try {
                  const existingMarker = await readFile(markerPath, 'utf-8');
                  sourceRef = parseIntakeSourceRef(existingMarker) ?? undefined;
                } catch {
                  // Marker file doesn't exist yet — no pre-existing source-ref to preserve.
                  sourceRef = undefined;
                }

                await writeIntakeMarker(
                  this.projectRoot,
                  stem,
                  sourceRef,
                  ownerResolution.id,
                );
              }

              // Task 14: Record the active plan path in engine state.
              // Use the first authored plan as the authoritative source for seeding.
              // This ensures seed uses the engine-recorded path instead of glob discovery.
              const activePlanPath = relative(this.projectRoot, authoredPlans[0]);
              await recordActivePlanPath(this.projectRoot, activePlanPath);
            }
          }

          // For complexity + worktree, 'done' (and tier / worktree fields) are
          // written atomically in their engine handlers. `rebase` is also
          // written atomically in runRebaseStep via recordRebaseStepCompletion
          // (#436) — gated on the rebase outcome, so a conflict_halt is never
          // stamped 'done' here. For all other steps, here.
          if (step.name !== 'complexity' && step.name !== 'worktree' && step.name !== 'rebase') {
            await saveStepStatus(this.stateFilePath, step.name, 'done');
          }
          state[step.name] = 'done';
          const tail = successOutput ? successOutput.split('\n').slice(-200) : undefined;
          await this.events.emit({ type: 'step_completed', step: step.name, status: 'done', tail });

          // Store PR URL from finish step output. Prefer state-file write
          // (skill-authored, survives recovery/interactive fixes), fall back to
          // scraping the first URL out of the runner's stdout so the common
          // path of `gh pr create` printing the URL just works.
          if (step.name === 'finish') {
            const current = await readState(this.stateFilePath);
            if (current.ok && current.value.pr_url) {
              state.pr_url = current.value.pr_url;
            } else if (successOutput) {
              const scraped = extractPrUrl(successOutput);
              if (scraped) {
                state.pr_url = scraped;
                await savePrUrl(this.stateFilePath, scraped);
              }
            }
          }

          // Checkpoint handling
          if (step.isCheckpoint && this.mode !== 'auto') {
            await this.events.emit({ type: 'checkpoint_reached', step: step.name });
            const response = await this.onCheckpoint(step.name);
            if (response === 'quit') {
              await writeState(this.stateFilePath, state);
              process.off('SIGINT', sigintHandler);
              process.off('SIGTERM', sigterm);
              return;
            }
            if (response === 'back') {
              const navigable = getNavigableSteps(state, steps);
              const target = await this.onNavigate(navigable);
              if (target) {
                const nav = navigateBack(state, target, steps);
                await this.events.emit({ type: 'navigation_back', from: step.name, to: target });
                state = nav.state;
                await writeState(this.stateFilePath, state);
                i = nav.index - 1; // for loop will i++
                continue;
              }
            }
            // 'continue' proceeds normally
          }

          // ── Gate-driven tail (Phase 3) ─────────────────────────────────
          // Once `build` engages the loop, the SELECTOR (not i++) chooses the
          // next step, and a step that re-opened an upstream gate (kickback)
          // routes the loop back to plan/stories. Upstream of build → null →
          // the for loop's normal linear i++ (front half untouched).
          const advance = await this.advanceTail(
            step,
            state,
            kickbackCounts,
            stuckGate,
            steps,
            indexOf,
          );
          if (advance === 'halt') {
            await writeState(this.stateFilePath, state);
            process.off('SIGINT', sigintHandler);
            if (!this.daemon) {
              process.off('SIGTERM', sigterm);
            }
            return;
          }
          if (advance !== null) {
            i = advance - 1; // the for loop's i++ lands on the selector's choice
            continue;
          }
        }
      }

      // Clean up SIGINT handler and SIGTERM handler
      process.off('SIGINT', sigintHandler);
      process.off('SIGTERM', sigterm);

      // All steps completed successfully
      await this.events.emit({
        type: 'feature_complete',
        prUrl: state.pr_url,
        featureDesc: state.feature_desc,
        sessionStartedAt: state.session_started_at,
      });
      state.feature_status = 'complete';
      await writeState(this.stateFilePath, state);

      // Terminal-marker guarantee (success side). The daemon classifies a run
      // solely by .pipeline/DONE vs .pipeline/HALT. advanceTail writes DONE on
      // the converging step in the normal path, but reaching here with no DONE
      // is possible on a resume where the loop body ran no tail step (every step
      // already done/skipped → startIndex past the end). Without this, the
      // finally backstop below would mis-park a genuinely-complete feature as a
      // HALT. Daemon-only: interactive runs don't use these markers.
      if (this.daemon && !(await this.markerExists(DONE_MARKER))) {
        await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(() => {});
        await writeFile(
          join(this.projectRoot, DONE_MARKER),
          'gate-driven loop converged\n',
          'utf-8',
        ).catch(() => {});
      }
    } catch (err) {
      // Any unexpected throw inside the loop (e.g. a verdict-I/O failure in
      // the SHIP tail) must leave the feature recoverable, never silently
      // lost. Flush the latest in-memory state and write a HALT marker so a
      // supervising daemon classifies this as `halted` (worktree kept, parked,
      // retryable) instead of "loop ended without DONE or HALT marker" (error
      // + lost SHIP state). Mirrors the auto-mode hard-failure handler above.
      const reason = `conductor error: ${err instanceof Error ? err.message : String(err)}`;
      await writeState(this.stateFilePath, state).catch(() => {});
      await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(() => {});
      await writeFile(join(this.projectRoot, LOOP_HALT_MARKER), reason + '\n', 'utf-8').catch(
        () => {},
      );
      const prUrl = await this.surfaceRemediationPr(reason);
      await this.events.emit({ type: 'loop_halt', reason, prUrl });
    } finally {
      process.off('SIGINT', sigintHandler);
      process.off('SIGTERM', sigterm);
      process.off('SIGHUP', sighupHandler);

      // Self-build sandbox teardown (TR-5): the throwaway CLAUDE_CONFIG_DIR is
      // removed on EVERY exit path — success, HALT, or a mid-build crash. teardown
      // is idempotent, so this is safe even if a future path tears down earlier.
      if (this.activeSandbox) {
        await this.activeSandbox.teardown().catch(() => {});
        this.activeSandbox = null;
      }

      // Terminal-marker guarantee (failure side). A handful of early `return`s
      // in the loop exit WITHOUT writing DONE or HALT — a blocked gate
      // (prerequisites unsatisfied) and a parallel-group gating failure. The
      // daemon, which classifies a run only by these markers, then reports a
      // bare `error` and strands the worktree ("loop ended without DONE or HALT
      // marker"). Rather than patch each return site (fragile — a future return
      // reintroduces the gap), enforce the invariant in one place: if a daemon
      // run reaches here with neither marker, write a diagnostic HALT so the
      // outcome is always classifiable (halted: worktree kept, parked,
      // retryable). The success path wrote DONE just above; every explicit HALT
      // path and the catch wrote HALT — so this only fires for the unmarked
      // early returns. Daemon-only: interactive runs legitimately exit markerless
      // (checkpoint quit, recovery REPL) and the daemon never reads their markers.
      if (
        this.daemon &&
        !(await this.markerExists(DONE_MARKER)) &&
        !(await this.markerExists(LOOP_HALT_MARKER))
      ) {
        const reason = `loop exited without a terminal verdict (last step: ${
          state.last_step ?? 'unknown'
        }) — no DONE/HALT marker was written; parking for inspection`;
        await mkdir(join(this.projectRoot, '.pipeline'), { recursive: true }).catch(() => {});
        await writeFile(join(this.projectRoot, LOOP_HALT_MARKER), reason + '\n', 'utf-8').catch(
          () => {},
        );
        const prUrl = await this.surfaceRemediationPr(reason);
        await this.events.emit({ type: 'loop_halt', reason, prUrl });
      }
    }
  }

  /**
   * Shared kickback-verdict scan. Walks `topo.kickbackTargets` looking for a
   * gate that the given step re-opened (verdict is {satisfied:false,
   * kickback.from === stepName}). Increments the shared `kickbackCounts`
   * counter, emits the `kickback` event, and — when `navigate` is true —
   * re-opens the target gate via navigateBack (cascade-staling its
   * downstream). HALTs (writes the marker + surfaces a remediation PR) if a
   * gate has been re-opened past MAX_KICKBACKS_PER_GATE.
   *
   * `navigate: false` is for front-half callers: they observe/record the
   * kickback (count + event) without mutating state, since the front half
   * stays linear and the tail will re-process the same verdict later.
   */
  private async scanKickbackVerdicts(
    stepName: StepName,
    state: ConductState,
    kickbackCounts: Map<StepName, number>,
    verdicts: Partial<Record<StepName, GateObjectiveVerdict>>,
    topo: GateTopology,
    steps: StepDefinition[],
    { navigate }: { navigate: boolean },
  ): Promise<'halt' | 'kicked' | null> {
    let result: 'halt' | 'kicked' | null = null;
    for (const target of topo.kickbackTargets) {
      const v = verdicts[target];
      if (v && v.satisfied === false && v.kickback?.from === stepName) {
        const count = (kickbackCounts.get(target) ?? 0) + 1;
        kickbackCounts.set(target, count);
        await this.events.emit({
          type: 'kickback',
          from: stepName,
          to: target,
          evidence: v.kickback?.evidence,
          count,
        });
        if (count > MAX_KICKBACKS_PER_GATE) {
          const reason = `kickback ping-pong: ${target} re-opened ${count} times (cap ${MAX_KICKBACKS_PER_GATE})`;
          await writeFile(
            join(this.projectRoot, LOOP_HALT_MARKER),
            reason + '\n',
            'utf-8',
          );
          await writeState(this.stateFilePath, state).catch(() => {});
          const prUrl = await this.surfaceRemediationPr(reason);
          await this.events.emit({ type: 'loop_halt', reason, prUrl });
          return 'halt';
        }
        if (navigate) {
          const nav = navigateBack(state, target, steps);
          Object.assign(state, nav.state);
          await writeState(this.stateFilePath, state);
        }
        result = 'kicked';
      }
    }
    return result;
  }

  /**
   * Gate-driven tail advance (Phase 3). Called after a step succeeds to decide
   * the next index:
   *   - Front half (before `build`): returns null → caller does linear i++.
   *   - Tail (`build`…`finish`): recompute the step's objective verdict, route
   *     any kickback (a step that re-opened an upstream gate) back via
   *     navigateBack + downstream-stale cascade, then ask the selector for the
   *     next unsatisfied gate. Returns ALL_STEPS.length when the loop is done.
   *   - 'halt': a gate exceeded the kickback cap; caller writes state and stops.
   */
  private async advanceTail(
    step: StepDefinition,
    state: ConductState,
    kickbackCounts: Map<StepName, number>,
    stuckGate: Map<StepName, number>,
    steps: StepDefinition[],
    indexOf: (name: StepName) => number,
  ): Promise<number | null | 'halt'> {
    // The gate-driven tail engages when completion is verified against
    // artifacts (verifyArtifacts=true). Additionally, it activates when
    // resuming with pre-existing unsatisfied gate verdicts, even if
    // verifyArtifacts=false — this ensures verdict-driven routing steers
    // the loop correctly.
    if (!this.verifyArtifacts) {
      // Check if there are any pre-existing unsatisfied verdicts
      const verdicts = await readAllVerdicts(this.projectRoot);
      let hasUnsatisfied = false;
      for (const v of Object.values(verdicts)) {
        if (v && v.satisfied === false) {
          hasUnsatisfied = true;
          break;
        }
      }
      if (!hasUnsatisfied) return null;
      // Fall through: verdict-driven routing enabled due to unsatisfied verdicts
    }

    const topo = deriveGateTopology(steps);

    // The `rebase` step is engine-native: its gate verdict (and any FR-5
    // downstream kickbacks) were already written authoritatively by
    // runRebaseStep from git state, not from a file artifact. Recomputing it
    // here via the artifact predicate would wrongly mark a conflicted/HALTed
    // rebase as satisfied, so we skip the recompute for it. A conflict_halt
    // outcome stops the loop.
    if (step.name === 'rebase') {
      if (this.lastRebaseOutcome?.kind === 'conflict_halt') {
        const reason = `rebase conflict — parked for human resolution: ${this.lastRebaseOutcome.reason}`;
        // writeHalt already wrote .pipeline/HALT in runRebaseStep.
        await this.events.emit({ type: 'loop_halt', reason });
        return 'halt';
      }
      // FR-5: a file-changing rebase invalidated build (+build_review,
      // +manual_test) via kickback-shaped verdicts. Those gates aren't
      // `kickbackTarget` steps, so emit the kickback event(s) here; the
      // selector below routes back to them. build_review sits between build
      // and manual_test in the tail (Task 18) — it grades the diff that the
      // rebase just changed, so it must re-verify before manual_test is
      // selectable again, same as build and manual_test.
      if (this.lastRebaseOutcome?.kind === 'changed') {
        const verdicts = await readAllVerdicts(this.projectRoot);
        for (const target of ['build', 'build_review', 'manual_test'] as StepName[]) {
          const v = verdicts[target];
          if (v && v.satisfied === false && v.kickback?.from === 'rebase') {
            await this.events.emit({
              type: 'kickback',
              from: 'rebase',
              to: target,
              evidence: v.kickback.evidence,
              count: 1,
            });
            // Re-open the staled gate so the selector re-runs it.
            const nav = navigateBack(state, target, steps);
            Object.assign(state, nav.state);
            await writeState(this.stateFilePath, state);
          }
        }
      }
    } else if (topo.verdictSteps.has(step.name)) {
      // Record the objective verdict for any gate we just ran — including in the
      // front half, so a re-run plan/stories refreshes its verdict on disk.
      const verdict = await computeAndWriteVerdict(
        this.projectRoot,
        step.name,
        await this.completionCtx(state),
      );
      await this.events.emit({
        type: 'gate_verdict',
        step: step.name,
        satisfied: verdict.satisfied,
        reason: verdict.reason,
      });

      // Task 15: Post-green spot-audit dispatch for semantic attribution verification.
      // Only dispatch after build gate is satisfied and sampling is enabled.
      if (step.name === 'build' && verdict.satisfied) {
        const auditSamplePct = resolveAttributionAuditSamplePct(this.config);
        if (auditSamplePct > 0 && this.taskEvidence) {
          const planCtx = await this.completionCtx(state);
          const planPath = planCtx.planPath;

          if (planPath) {
            const gateVerdictPath = join(this.projectRoot, '.pipeline', 'gates', 'build.json');
            const ledgerPath = join(this.projectRoot, '.daemon', 'attribution-accuracy.jsonl');

            // Fire-and-forget dispatch: start audit without blocking build progression.
            // Errors during dispatch are caught and logged but never propagated.
            // Create an emitter adapter that forwards attribution_divergence events
            const emitterAdapter = {
              emit: (type: 'attribution_divergence', event: { feature: string; taskId: string }): void => {
                void this.events.emit({
                  type: 'attribution_divergence',
                  feature: event.feature,
                  taskId: event.taskId,
                });
              },
            };

            void runSpotAudit({
              evidence: this.taskEvidence,
              featureSlug: state.feature_desc || 'unknown',
              auditSamplePct,
              projectDir: this.projectRoot,
              featureWorktreePath: this.projectRoot,
              gateVerdictPath,
              ledgerPath,
              emitter: emitterAdapter,
              dispatch: async (inputs): Promise<import('./attribution-lane.js').VerifierDispatchResult> => {
                try {
                  // Dispatch via stepRunner's dispatchVerifier if available,
                  // otherwise gracefully fail (audit is observational only).
                  if (this.stepRunner.dispatchVerifier) {
                    const result = await this.stepRunner.dispatchVerifier({
                      residueIds: inputs.residueIds,
                      planPath,
                      projectRoot: this.projectRoot,
                    });
                    return {
                      success: result.success,
                      output: result.output ?? '',
                    };
                  }
                  // Dispatcher not available (safe for non-testing scenarios)
                  return { success: false, output: 'dispatchVerifier not available' };
                } catch (err) {
                  // Dispatch error: return neutral result (audit is observational only)
                  return {
                    success: false,
                    output: String(err),
                  };
                }
              },
            }).catch((err) => {
              // Audit dispatch error is non-blocking. Log for observability.
              console.debug('[attribution-audit] spot-audit dispatch failed (non-blocking):', err);
            });
          }
        }
      }
    }

    if (indexOf(step.name) < topo.firstLoopIndex) {
      // Front-half amendment kickback: a step before the first loop gate
      // (e.g. conflict_check) can still write a kickback-shaped verdict onto
      // an upstream gate (e.g. architecture_review). Surface that detection
      // via the same shared scan the tail uses, but without navigating —
      // the front half stays linear (i++) and statuses are left untouched;
      // the tail will re-process the same verdict later when it reaches the
      // gate-driven region.
      const frontVerdicts = await readAllVerdicts(this.projectRoot);
      const frontKickback = await this.scanKickbackVerdicts(
        step.name,
        state,
        kickbackCounts,
        frontVerdicts,
        topo,
        steps,
        { navigate: false },
      );
      if (frontKickback === 'halt') return 'halt';
      return null; // front half stays linear (before the first loop gate)
    }

    // Mark tier/mode-skipped steps in the looped region as 'skipped' so the
    // selector skips them AND downstream prerequisite gates (checkGate) pass —
    // the selector-driven tail can jump over a step without the linear body
    // ever marking it.
    let markedSkip = false;
    const tier = state.complexity_tier ?? 'L';
    // Resolve the track once (state-seeded, or the committed marker in the
    // interactive flow) so a technical feature skips prd_audit in the SHIP loop.
    const track = await this.resolveTrack(state);
    // Opt-in judgement gate (jstoup111/ai-conductor#324): resolved once here
    // (read-once, `owner_gate_cutover` semantics) so a config value flipped
    // mid-run doesn't produce inconsistent skip decisions across the pass.
    const buildReviewEnabled = resolveBuildReviewConfig(this.config).enabled;
    // Steps are in topological order, so an upstream step's `skipped` mark is
    // already in `state` before a step that depends on it via skipWhenSkipped
    // is evaluated in this same pass (e.g. architecture_review → as_built).
    for (const s of steps) {
      if (
        getStepStatus(state, s.name) === 'pending' &&
        (s.skippableForTiers.includes(tier) ||
          (s.skippableForTracks ?? []).includes(track) ||
          shouldSkipForBootstrapMode(s.name, state.bootstrap_mode) ||
          shouldSkipForUpstreamSkip(s, state) ||
          (s.name === 'build_review' && !buildReviewEnabled))
      ) {
        (state as Record<string, unknown>)[s.name] = 'skipped';
        markedSkip = true;
        if (s.name === 'build_review' && !buildReviewEnabled) {
          await this.events.emit({ type: 'config_skip', step: s.name });
        }
      }
    }
    if (markedSkip) await writeState(this.stateFilePath, state);

    const verdicts = await readAllVerdicts(this.projectRoot);

    // Kickback: a step re-opened an upstream gate (verdict is
    // {satisfied:false, kickback.from === this step}). Re-open that gate
    // (pending) + cascade-stale its downstream so they re-run; HALT if a gate
    // has been re-opened past the cap.
    const kickbackVerdict = await this.scanKickbackVerdicts(
      step.name,
      state,
      kickbackCounts,
      verdicts,
      topo,
      steps,
      { navigate: true },
    );
    if (kickbackVerdict === 'halt') return 'halt';

    const decision = selectNextGate({
      steps,
      state,
      verdicts,
      regionStart: topo.regionStart,
    });
    if (decision.kind === 'done') {
      await writeFile(
        join(this.projectRoot, DONE_MARKER),
        'gate-driven loop converged\n',
        'utf-8',
      ).catch(() => {
        /* best-effort marker */
      });
      await this.events.emit({ type: 'loop_converged' });
      return steps.length;
    }

    // Oscillation / stuck guard: cap how many times any single gate may be
    // selected before it satisfies. Catches a gate whose verdict never improves
    // and a build↔plan kickback oscillation.
    const sel = (stuckGate.get(decision.step) ?? 0) + 1;
    stuckGate.set(decision.step, sel);
    if (sel > MAX_GATE_SELECTIONS) {
      const reason = `gate '${decision.step}' selected ${sel} times without satisfying: ${decision.reason}`;
      await writeState(this.stateFilePath, state).catch(() => {});
      await writeFile(join(this.projectRoot, LOOP_HALT_MARKER), reason + '\n', 'utf-8');
      const prUrl = await this.surfaceRemediationPr(reason);
      await this.events.emit({ type: 'loop_halt', reason, prUrl });
      return 'halt';
    }

    // The selector only returns UNSATISFIED gates; if such a gate is still
    // marked 'done' (its verdict went false via kickback/recompute), reset it to
    // 'pending' so the loop re-runs it instead of skipping it as already-resolved.
    if (getStepStatus(state, decision.step) === 'done') {
      (state as Record<string, unknown>)[decision.step] = 'pending';
      await writeState(this.stateFilePath, state);
    }
    return indexOf(decision.step);
  }

  /**
   * Execute a parallel branch group via Promise.all (T15).
   *
   * Each branch is dispatched concurrently. Synthetic state keys of the form
   * `<groupName>__<branchName>` are written to conduct-state.json (T16).
   *
   * Failure semantics (T18 / T19):
   *   - advisory=false (default): branch failure → parallel_failure event →
   *     group fails → downstream blocked (T10 gate).
   *   - advisory=true: branch failure is logged (parallel_failure) but the
   *     group continues to success.
   *
   * SIGINT during a parallel group saves state and exits (T20).
   */
  private async runParallelGroup(
    groupName: StepName,
    branches: ParallelBranch[],
    state: ConductState,
  ): Promise<void> {
    const branchNames = branches.map((b) => b.name);
    await this.events.emit({ type: 'parallel_started', step: groupName, branches: branchNames });

    let groupFailed = false;

    // Fan out: run all branches concurrently
    const results = await Promise.all(
      branches.map(async (branch) => {
        const syntheticKey = `${groupName}__${branch.name}`;
        try {
          const result = await this.stepRunner.run(
            groupName,
            state,
            { retryReason: undefined },
          );
          if (!result.success) {
            (state as Record<string, unknown>)[syntheticKey] = 'failed';
            return { branch, success: false, error: result.output ?? `branch ${branch.name} failed` };
          }
          (state as Record<string, unknown>)[syntheticKey] = 'done';
          return { branch, success: true, error: undefined };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          (state as Record<string, unknown>)[syntheticKey] = 'failed';
          return { branch, success: false, error: errMsg };
        }
      }),
    );

    // Write all synthetic keys to state file (T16)
    await writeState(this.stateFilePath, state);

    // Evaluate branch outcomes (T17 post-parallel gate)
    for (const outcome of results) {
      if (!outcome.success) {
        await this.events.emit({
          type: 'parallel_failure',
          step: groupName,
          branch: outcome.branch.name,
          error: outcome.error ?? 'unknown error',
        });
        if (!outcome.branch.advisory) {
          // T18: gating failure → group fails
          groupFailed = true;
        }
        // T19: advisory failure → continue (no groupFailed set)
      }
    }

    if (groupFailed) {
      // Mark the group step itself as failed
      await saveStepStatus(this.stateFilePath, groupName, 'failed');
      state[groupName] = 'failed';
    } else {
      await saveStepStatus(this.stateFilePath, groupName, 'done');
      state[groupName] = 'done';
      await this.events.emit({
        type: 'parallel_completed',
        step: groupName,
        branches: branchNames,
      });
    }
  }

  /**
   * Handle the `worktree` step entirely in the engine via `WorktreeManager`
   * (deterministic `git worktree add -b`), instead of dispatching the
   * `/conduct worktree` skill to Claude. The skill path let Claude run a broad
   * self-directed orchestration (skipping `explore`, botching git so the main
   * repo ended up on the feature branch). A direct call keeps main untouched and
   * lets the per-step engine drive `explore` etc. normally.
   *
   * With no feature description (e.g. tests, or a resume without one) it records
   * the step done without creating a worktree — nothing to isolate yet.
   */
  private async runWorktreeStep(state: ConductState): Promise<StepRunResult> {
    const featureDesc = this.featureDesc ?? state.feature_desc;
    if (!featureDesc) {
      state.worktree = 'done';
      state.last_step = 'worktree';
      await writeState(this.stateFilePath, state);
      return { success: true };
    }
    try {
      const { path, branch } = await new WorktreeManager(this.projectRoot).create(featureDesc);
      state.feature_desc = featureDesc;
      state.worktree_dir = path;
      state.worktree_branch = branch;
    } catch (err) {
      // Best-effort: a worktree-creation failure (e.g. not a git repo, or a git
      // error) must NOT block the feature — proceed in the current directory
      // without isolation. The absence of state.worktree_dir signals no worktree.
      console.warn(
        `[worktree] could not create an isolated worktree (${err instanceof Error ? err.message : String(err)}); continuing in-place.`,
      );
      state.feature_desc = featureDesc;
    }
    state.worktree = 'done';
    state.last_step = 'worktree';
    await writeState(this.stateFilePath, state);
    return { success: true };
  }

  /**
   * Handle the `rebase` step entirely in the engine (ADR-001 / Phase 9.0):
   * rebase the feature branch onto the discovered base, classify the outcome,
   * write the authoritative gate verdicts (including FR-5 kickbacks), emit the
   * structured outcome event, and — on a conflict that isn't a CHANGELOG-only
   * auto-resolve — write `.pipeline/HALT` and leave the rebase paused. The
   * outcome is stashed on `lastRebaseOutcome` so `advanceTail` doesn't recompute
   * the verdict and so a HALT routes the loop to stop.
   */
  private async runRebaseStep(state: ConductState): Promise<StepRunResult> {
    // Phase 9.0: the native rebase-on-latest is a DAEMON finish-time mechanism.
    // In non-daemon runs (interactive `/conduct` and the entire test suite) we
    // must NOT invoke git here: a real `git rebase origin/<default>` against the
    // live worktree has repeatedly corrupted in-flight feature branches when a
    // test drives a real Conductor whose projectRoot resolves to the conductor's
    // own checkout. Treat it as a clean no-op so the rebase gate is still
    // satisfied and the loop topology is unchanged — only the daemon auto-rebases
    // (humans rebase manually in interactive mode).
    if (!this.daemon) {
      const outcome: RebaseOutcome = { kind: 'noop' };
      this.lastRebaseOutcome = outcome;
      const ranManualTest = getStepStatus(state, 'manual_test') !== 'skipped';
      await applyRebaseVerdicts(this.projectRoot, outcome, ranManualTest);
      await emitRebaseEvent(this.events, outcome);
      await recordRebaseStepCompletion(this.stateFilePath, outcome);
      return { success: true };
    }

    const git = makeGitRunner(this.projectRoot);
    const localBase = await this.discoverLocalBase(git);

    // ── Merged-PR guard: rebase backstop (adr-2026-07-09-mid-run-merged-pr-guard) ────
    // Check if the recorded PR is already merged (out-of-band), and if so, stop
    // cleanly without rebasing. This prevents the duplicate-branch rebase HALT
    // when a merge lands after the kickback guard but before rebase entry.
    const prUrl = state.pr_url;
    const guardVerdict = await checkMergedPrGuard(
      this.runGh,
      this.projectRoot,
      prUrl,
      (msg) => console.log(msg),
    );

    if (guardVerdict === 'merged') {
      // PR is already merged — stop cleanly as a synthetic verified ship.
      const headSha = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      await writeSyntheticShipMarkers(this.projectRoot, headSha, (msg) => console.log(msg));
      return { success: true };
    }

    let outcome: RebaseOutcome;
    try {
      outcome = await performRebase(git, this.projectRoot, localBase);
    } catch (err) {
      // A truly unexpected git failure parks for a human rather than shipping
      // an unverified branch.
      outcome = {
        kind: 'conflict_halt',
        conflicts: [],
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    // ── Gated conflict-resolution sub-loop (feat/rebase-resolution-skill) ────
    // When a conflict_halt occurs and the StepRunner provides a resolver, attempt
    // to resolve it up to `cap` times before falling back to the HALT path.
    // cap === 0 (or no resolveRebaseConflict method) → immediate HALT, unchanged
    // from pre-resolution behavior (FR-7). The same helper backs the daemon
    // re-kick play-forward path (`resumeRebaseFirst`) so both routes resolve
    // identically (#300).
    outcome = await runGatedRebaseResolution({
      git,
      projectRoot: this.projectRoot,
      outcome,
      cap: resolveRebaseResolutionAttempts(this.config),
      resolve: this.stepRunner.resolveRebaseConflict
        ? (ctx) => this.stepRunner.resolveRebaseConflict!(ctx)
        : undefined,
      onAttempt: (index, cap) =>
        this.events.emit({ type: 'rebase_resolution_attempt', index, cap }),
      onSettled: (kind) =>
        this.events.emit(
          kind === 'exhausted'
            ? { type: 'rebase_resolution_exhausted' }
            : { type: 'rebase_resolution_succeeded' },
        ),
    });

    this.lastRebaseOutcome = outcome;

    // manual_test counts as "ran" when it isn't skipped for this feature.
    const ranManualTest =
      getStepStatus(state, 'manual_test') !== 'skipped';

    // Task 7: Inject pre-verify capability for daemon build gate-first re-verify.
    // Closure checks build completion objectively (via evidence) after file-changing rebase.
    // Non-daemon call site (line 2872) keeps today's behavior with no preVerify.
    const preVerify = async (step: string) => {
      if (step !== 'build') return { done: false };
      const ctx = await this.completionCtx(state);
      if (!ctx.planPath) {
        return { done: false, reason: 'no feature plan resolvable — evidence derivation not engaged; fail-closed' };
      }
      return checkStepCompletion(this.projectRoot, 'build', ctx);
    };

    const verdict = await applyRebaseVerdicts(
      this.projectRoot,
      outcome,
      ranManualTest,
      preVerify,
    );

    // Emit rebase_gate_reverified event for each step that was re-verified
    // (dispatch skipped because gate is mechanically confirmed).
    for (const step of verdict.reverified) {
      await this.events.emit({
        type: 'rebase_gate_reverified',
        step,
        skippedDispatch: true,
        reason: 're-verified mechanically after file-changing rebase — evidence remains intact',
      });
    }

    await emitRebaseEvent(this.events, outcome);

    if (outcome.kind === 'conflict_halt') {
      await writeHalt(this.projectRoot, outcome.conflicts, outcome.reason);
    }

    await recordRebaseStepCompletion(this.stateFilePath, outcome);

    // The step itself "succeeds" (it ran); advanceTail/the HALT signal decide
    // routing. A conflict_halt is surfaced there, not as a step failure.
    return { success: true };
  }

  /**
   * Discover a sensible LOCAL base branch name for the rebase fallback, without
   * hardcoding 'main'. Prefers origin's default branch name; else a local
   * main/master/trunk if present; else the first local branch that isn't the
   * current HEAD. Returns 'main' only as a last resort when nothing is found.
   */
  private async discoverLocalBase(
    git: ReturnType<typeof makeGitRunner>,
  ): Promise<string> {
    // origin default (name only) — works even if we later fall back to local.
    const fromOrigin = await originDefaultBranch(git);
    if (fromOrigin) return fromOrigin;
    const current = (await git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
    const branchesOut = await git(['branch', '--format=%(refname:short)']);
    const branches = branchesOut.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const candidate of ['main', 'master', 'trunk']) {
      if (branches.includes(candidate) && candidate !== current) return candidate;
    }
    const other = branches.find((b) => b !== current);
    return other ?? 'main';
  }

  /**
   * Handle the `complexity` step entirely in the engine:
   * 1. Ask Claude (--print mode) for a recommended tier.
   * 2. Let the UI confirm or override via onComplexityAssessment(recommended).
   * 3. Write tier + step status atomically.
   * On callback error (e.g., Ctrl-C), leave the step pending — no stuck state.
   */
  /**
   * Resolve the work track (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location). Prefers `state.track` (daemon-seeded);
   * otherwise reads the committed `.docs/track/<slug>.md` marker that `/explore`
   * wrote in the interactive flow (newest file wins — one feature per worktree),
   * caches it into `state.track`, and persists. Defaults to `product` when no
   * usable marker exists, so PRD / prd-audit run unless the work was explicitly
   * classified `technical`. Best-effort: any fs error falls back to `product`.
   */
  private async resolveTrack(state: ConductState): Promise<Track> {
    if (state.track) return state.track;
    try {
      const dir = join(this.projectRoot, '.docs', 'track');
      const entries = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
      if (entries.length > 0) {
        const content = await readFile(join(dir, entries[entries.length - 1]), 'utf-8');
        const parsed = parseTrack(content);
        if (parsed) {
          state.track = parsed;
          await writeState(this.stateFilePath, state);
          return parsed;
        }
      }
    } catch {
      // No marker / unreadable → default product.
    }
    return 'product';
  }

  private async runComplexityStep(state: ConductState): Promise<StepRunResult> {
    // Auto mode: take any existing tier, else default to L. No prompt, no Claude call.
    if (this.mode === 'auto') {
      state.complexity_tier = state.complexity_tier ?? 'L';
      state.complexity = 'done';
      state.last_step = 'complexity';
      await writeState(this.stateFilePath, state);
      return { success: true };
    }

    // If a tier is already persisted (e.g., resume after crash, or back-nav re-entry),
    // use that as the default recommendation. Otherwise ask Claude in print mode.
    let recommended: ComplexityTier | null = state.complexity_tier ?? null;
    if (!recommended && this.stepRunner.assessComplexity) {
      try {
        recommended = await this.stepRunner.assessComplexity();
      } catch {
        recommended = null;
      }
    }

    if (!this.onComplexityAssessment) {
      // No UI callback — accept the recommendation or default to L.
      state.complexity_tier = recommended ?? state.complexity_tier ?? 'L';
      state.complexity = 'done';
      state.last_step = 'complexity';
      await writeState(this.stateFilePath, state);
      return { success: true };
    }

    let tier: ComplexityTier;
    try {
      tier = await this.onComplexityAssessment(recommended);
    } catch (err) {
      // User cancelled / prompt errored. Outer loop marks the step 'failed'
      // and routes through the recovery menu. No tier persisted, so resume
      // will re-prompt.
      return {
        success: false,
        output: err instanceof Error ? err.message : 'complexity prompt cancelled',
      };
    }

    state.complexity_tier = tier;
    state.complexity = 'done';
    state.last_step = 'complexity';
    await writeState(this.stateFilePath, state);
    return { success: true };
  }

  /**
   * Find the index to resume from: first in_progress step,
   * or first pending step after the last done step.
   */
  private findResumeIndex(
    state: ConductState,
    steps: StepDefinition[] = ALL_STEPS,
  ): number {
    // If feature is already complete, treat as new feature (start from 0)
    if (state.feature_status === 'complete') {
      return 0;
    }

    // First, look for an in_progress step
    for (let i = 0; i < steps.length; i++) {
      if (getStepStatus(state, steps[i].name) === 'in_progress') {
        return i;
      }
    }

    // Otherwise, find the first pending step after the last done step
    let lastDoneIndex = -1;
    for (let i = 0; i < steps.length; i++) {
      if (getStepStatus(state, steps[i].name) === 'done') {
        lastDoneIndex = i;
      }
    }

    return lastDoneIndex + 1;
  }

}

/**
 * The earliest target step among a set of remediation fixes. The loop
 * navigateBacks here and re-runs forward, so picking the earliest re-runs every
 * step a fix needs (e.g. an `architecture_review` fix + a `build` fix → start at
 * `architecture_review`). Defaults to `build` if none resolve.
 */
export function earliestRemediationTarget(
  fixes: RemediationGap[],
  steps: StepDefinition[],
): StepName {
  let best: StepName = 'build';
  let bestIdx = steps.length;
  for (const g of fixes) {
    const idx = steps.findIndex((s) => s.name === g.disposition);
    if (idx >= 0 && idx < bestIdx) {
      bestIdx = idx;
      best = g.disposition as StepName;
    }
  }
  return best;
}

/**
 * The retryReason handed to the remediation target step — names each gap, its
 * disposition, and its concrete tasks, and tells the agent to make the changes
 * even though the task list may show complete (the as-built code is re-audited).
 * `source`/`evidenceFile` name the gate that blocked and its gap artifact so the
 * same hint serves prd-audit, finish-verification, and as-built remediation.
 */
export function buildRemediationHint(
  fixes: RemediationGap[],
  source = 'prd-audit',
  evidenceFile = '.pipeline/prd-audit.md',
): string {
  const lines = fixes.map((g) => {
    const tasks = g.tasks.length ? ` Tasks: ${g.tasks.map((t) => t.title).join('; ')}` : '';
    return `- ${g.id} [${g.disposition}]: ${g.rationale}.${tasks}`;
  });
  return (
    `Remediating blocking ${source} gaps (see .pipeline/remediation.json and ` +
    `${evidenceFile}). The task list may already show complete, but the ` +
    'following are NOT satisfied — make the code/spec changes and commit them; ' +
    'the as-built code is re-audited after this step:\n' +
    lines.join('\n')
  );
}

/**
 * Build the retry hint injected into Claude's system prompt after a
 * completion-gate miss. The default hint assumes work is unfinished and
 * tells Claude to "finish the work now." That wording is actively
 * misleading when the real failure is a stale status file — Claude sees
 * "finish the work" and re-implements already-done tasks, producing
 * duplicate commits and never updating the tracking file. For `build`
 * with a "tasks not completed" reason, redirect Claude to verify on disk
 * before rewriting and to update `.pipeline/task-status.json` when the
 * work is already there.
 */
export function buildRetryHint(step: StepName, reason: string | undefined): string {
  const r = reason ?? 'unknown';
  if (step === 'build') {
    if (/tasks? not completed/i.test(r)) {
      return (
        `Previous attempt did not satisfy the completion check: ${r}. ` +
        `Add a Task: <id> trailer to your commits to mark tasks completed. ` +
        `Format: Task: 9\\nTask: 10 (one per line).`
      );
    }
    if (/no tasks|missing.*task-status|plan is empty/i.test(r)) {
      return (
        `Previous attempt did not satisfy the completion check: ${r}. ` +
        `Check your plan at .docs/plans/ — the seed step creates task-status.json from there.`
      );
    }
  }
  return `Previous attempt did not satisfy the completion check: ${r}. Finish the work now.`;
}

/**
 * SHA-256 of a file's contents, hex encoded. Returns null if the file can't be read.
 */
async function hashFile(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Approval key for an artifact file: path relative to projectRoot (falls back
 * to the absolute path if outside the root).
 */
export function approvalKey(projectRoot: string, file: string): string {
  const rel = relative(projectRoot, file);
  return rel.startsWith('..') ? file : rel;
}

/**
 * Return the subset of `files` that are not yet approved OR whose content has
 * changed since approval. Files whose hash still matches the recorded approval
 * are filtered out (skip re-prompting).
 */
export async function filterUnapprovedArtifacts(
  files: string[],
  approvals: Record<string, { sha256: string; approved_at: string }>,
  projectRoot: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const file of files) {
    const key = approvalKey(projectRoot, file);
    const prior = approvals[key];
    if (!prior) {
      out.push(file);
      continue;
    }
    const hash = await hashFile(file);
    if (hash !== prior.sha256) {
      out.push(file);
    }
  }
  return out;
}

/**
 * Record approvals for a list of files. Returns a new approvals map (does not
 * mutate the input). Skips any file that cannot be read.
 */
export async function recordApprovals(
  approvals: Record<string, { sha256: string; approved_at: string }>,
  files: string[],
  projectRoot: string,
): Promise<Record<string, { sha256: string; approved_at: string }>> {
  const out = { ...approvals };
  const now = new Date().toISOString();
  for (const file of files) {
    const hash = await hashFile(file);
    if (!hash) continue;
    const key = approvalKey(projectRoot, file);
    out[key] = { sha256: hash, approved_at: now };
  }
  return out;
}

/**
 * Task 14: Record the active plan path in engine state.
 * The engine-recorded path is used by seedTaskStatus to resolve which plan to use,
 * preventing glob-first guessing when multiple plans exist.
 *
 * @param projectRoot - Project root directory
 * @param planPath - Path to the plan file (relative to projectRoot)
 */
export async function recordActivePlanPath(projectRoot: string, planPath: string): Promise<void> {
  const pipelineDir = join(projectRoot, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });

  const engineStatePath = join(pipelineDir, 'engine-state.json');

  // Read existing engine state if present
  let engineState: Record<string, unknown> = {};
  try {
    const existing = await readFile(engineStatePath, 'utf-8');
    engineState = JSON.parse(existing);
  } catch {
    // File doesn't exist or is invalid — start fresh
    engineState = {};
  }

  // Update with the active plan path
  engineState.activePlanPath = planPath;

  // Atomic write: temp file + rename
  const tempDirPath = join(tmpdir(), `engine-state-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDirPath, { recursive: true });
  try {
    const tempFile = join(tempDirPath, 'engine-state.json');
    await writeFile(tempFile, JSON.stringify(engineState, null, 2) + '\n');
    await writeFile(engineStatePath, JSON.stringify(engineState, null, 2) + '\n');
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(tempDirPath, { recursive: true, force: true });
  }
}

/**
 * Task 19: Append remediation tasks to the plan file with validation.
 *
 * Validates that all remediation task IDs are non-empty and match TASK_ID_PATTERN,
 * then appends them to the plan file. Gate-source prefix is expected but not required.
 *
 * @param projectRoot - Project root directory
 * @param planPath - Path to the plan file to append to
 * @param remediationList - List of remediation tasks with id and title
 * @param options - Optional logger function
 * @returns { success: true } on success, { success: false, error: string } on failure
 */
export async function appendRemediationTasks(
  projectRoot: string,
  planPath: string,
  remediationList: Array<{ id: string; title: string }>,
  options?: { log?: (msg: string) => void },
): Promise<{ success: true } | { success: false; error: string }> {
  const log = options?.log ?? (() => {});

  // TASK_ID_PATTERN from autoheal.ts: [A-Za-z0-9._-]+
  const TASK_ID_PATTERN = '[A-Za-z0-9._-]+';
  const taskIdRegex = new RegExp(`^${TASK_ID_PATTERN}$`);

  // Validate all task IDs before appending anything
  for (const task of remediationList) {
    // Check for empty ID
    if (!task.id || task.id.trim() === '') {
      return {
        success: false,
        error: `Task ID must be non-empty, but got empty string for title: "${task.title}"`,
      };
    }

    // Check if ID matches pattern
    if (!taskIdRegex.test(task.id)) {
      return {
        success: false,
        error: `Task ID "${task.id}" does not match TASK_ID_PATTERN [A-Za-z0-9._-]+`,
      };
    }

    // Warn if gate-source prefix is missing (rem-fr10-*, rem-adr-*, rem-test-*, etc.)
    if (!task.id.startsWith('rem-')) {
      log(`Warning: Task ID "${task.id}" missing gate-source prefix (expected rem-*)`);
    }
  }

  // Read existing plan content
  let planContent = '';
  try {
    planContent = await readFile(planPath, 'utf-8');
  } catch {
    // If plan file doesn't exist, start with empty content
    planContent = '';
  }

  // Parse existing task headers to detect duplicates and content drift
  // Regex: ### Task <id>: <title>
  const taskHeaderRegex = /^### Task ([A-Za-z0-9._-]+(?:-[a-f0-9]{6})?(?:-\d+)?): (.+)$/gm;
  const existingTasks = new Map<string, { title: string; fullHeader: string }>();
  let match;
  while ((match = taskHeaderRegex.exec(planContent)) !== null) {
    const taskId = match[1];
    const taskTitle = match[2];
    const fullHeader = match[0];
    existingTasks.set(taskId, { title: taskTitle, fullHeader });
  }

  // Determine which tasks to append (idempotent upsert semantics)
  const tasksToAppend: Array<{ id: string; title: string; finalId: string }> = [];

  for (const task of remediationList) {
    const existing = existingTasks.get(task.id);

    if (existing) {
      // Task ID already exists
      if (existing.title === task.title) {
        // Same ID, same content → idempotent, skip
        log(`Task ${task.id} already exists with same content, skipping`);
        continue;
      } else {
        // Same ID, different content → create content-hash suffix to distinguish
        const { createHash } = await import('crypto');
        const contentHash = createHash('sha256')
          .update(task.title)
          .digest('hex')
          .slice(0, 6);

        const suffixedId = `${task.id}-${contentHash}`;

        // Check if the suffixed ID already exists
        if (existingTasks.has(suffixedId)) {
          log(`Task ${suffixedId} already exists with same content, skipping`);
          continue;
        }

        log(
          `Task ${task.id} exists with different content, using suffix: ${suffixedId}`,
        );
        tasksToAppend.push({ id: task.id, title: task.title, finalId: suffixedId });
      }
    } else {
      // New task ID, append as-is
      tasksToAppend.push({ id: task.id, title: task.title, finalId: task.id });
    }
  }

  // Append tasks that don't have duplicates
  let updated = planContent;
  for (const task of tasksToAppend) {
    const taskHeader = `### Task ${task.finalId}: ${task.title}\n`;
    updated += taskHeader;
  }

  // Write plan atomically using temp file + rename pattern
  const pipelineDir = join(projectRoot, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });

  const tempFile = `${planPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(tempFile, updated, 'utf-8');
    // Rename temp file to target (atomic on most filesystems)
    await require('node:fs/promises').rename(tempFile, planPath);
  } catch (error) {
    // Clean up temp file if something went wrong
    try {
      await unlinkFile(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    return {
      success: false,
      error: `Failed to append remediation tasks to plan: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  return { success: true };
}
