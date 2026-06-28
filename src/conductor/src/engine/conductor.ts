import {
  readFile,
  writeFile,
  mkdir,
  access as accessFile,
  unlink as unlinkFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, join } from 'node:path';
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
import type { ParallelBranch } from '../types/config.js';
import { evaluateWhen } from './when-expression.js';
import type { HarnessConfig } from '../types/config.js';
import { ConductorEventEmitter } from '../ui/events.js';
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
} from './steps.js';
import { checkGate } from './gates.js';
import {
  findArtifactFiles as findArtifactFilesForStep,
  STEP_ARTIFACT_GLOBS,
  checkStepCompletion,
  CUSTOM_COMPLETION_PREDICATES,
  classifyPrdAuditGaps,
  readRemediationPlan,
  sweepStaleReviewArtifacts,
  type RemediationGap,
} from './artifacts.js';
import { resolveStepConfig } from './resolved-config.js';
import { selectNextGate } from './selector.js';
import { computeAndWriteVerdict, readAllVerdicts } from './gate-verdicts.js';
import { WorktreeManager } from './worktree.js';
import { attemptAutoHeal } from './autoheal.js';
import {
  countResolvedTasks,
  haltMarkerExists,
  clearHaltMarker,
} from './task-progress.js';
import {
  makeGitRunner,
  performRebase,
  applyRebaseVerdicts,
  emitRebaseEvent,
  writeHalt,
  originDefaultBranch,
  type RebaseOutcome,
} from './rebase.js';

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
const LOOP_HALT_MARKER = '.pipeline/HALT';

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
   * Set when Claude reports "No conversation found" (session evaporated).
   * The conductor resets the session state and retries without burning budget.
   */
  sessionExpired?: boolean;
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
  projectRoot?: string;
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
   * Hybrid session model (Phase 4): reset the LLM session before each new step
   * in the looped region (`build`…`finish`) so each runs on fresh context
   * (Ralph-style resilience — context never bloats across the SHIP phase). A
   * step's internal retries still resume the same session. The front half keeps
   * the persistent session. Default false (persistent session everywhere).
   */
  freshContextPerStep?: boolean;
  /**
   * Daemon mode (Phase 9.1). When true, the in-loop `retro` step is skipped:
   * the daemon's emission step owns narrative production into the cross-project
   * engineer store instead of writing `.docs/retros/` into the feature repo (ADR-002
   * Option A). Manual `/conduct` runs leave this false and keep writing repo
   * retros unchanged. Default false.
   */
  daemon?: boolean;
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
}

function stepHasCompletionCheck(step: StepName): boolean {
  if (CUSTOM_COMPLETION_PREDICATES[step]) return true;
  return (STEP_ARTIFACT_GLOBS[step] ?? []).length > 0;
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
  private freshContextPerStep: boolean;
  private daemon: boolean;
  private sleep: (ms: number) => Promise<void>;
  private onReviewArtifacts: (step: StepName, files: string[]) => Promise<ArtifactReviewResult>;
  private onRecovery?: (
    step: StepName,
    isGating: boolean,
    context?: RecoveryContext,
  ) => Promise<RecoveryOption>;
  private onComplexityAssessment?: (recommended: ComplexityTier | null) => Promise<ComplexityTier>;
  /**
   * The most recent engine-native rebase outcome. The `rebase` step is special:
   * its gate verdict is computed by the native handler (not from a file
   * artifact), so `advanceTail` must NOT recompute/overwrite it. A
   * `conflict_halt` outcome here drives the loop to HALT.
   */
  private lastRebaseOutcome: RebaseOutcome | null = null;

  constructor(opts: ConductorOptions) {
    this.stateFilePath = opts.stateFilePath;
    this.stepRunner = opts.stepRunner;
    this.events = opts.events;
    this.resume = opts.resume ?? false;
    this.fromStep = opts.fromStep;
    this.mode = opts.mode ?? 'default';
    this.config = opts.config ?? {};
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.featureDesc = opts.featureDesc;
    this.verifyArtifacts = opts.verifyArtifacts ?? false;
    this.freshContextPerStep = opts.freshContextPerStep ?? false;
    this.daemon = opts.daemon ?? false;
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
    }

    // Save state on SIGINT before exit
    const sigintHandler = async () => {
      await writeState(this.stateFilePath, state);
      process.exit(130); // 128 + SIGINT(2) — standard Unix convention
    };
    process.on('SIGINT', sigintHandler);

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
          return;
        }

        // Mark in_progress before running
        await saveStepStatus(this.stateFilePath, step.name, 'in_progress');
        state[step.name] = 'in_progress';

        await this.events.emit({ type: 'step_started', step: step.name, index: i });

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

        // Fresh session per step (Phase 4 + daemon fix): when freshContextPerStep
        // is on (daemon/auto only — interactive `/conduct` leaves it false so the
        // brainstorm→stories→plan design session keeps its context), start EVERY
        // executed step on a brand-new LLM session so context never accumulates
        // across the loop. The retry loop below reuses this session (resume) for
        // the step's OWN attempts only.
        //
        // This also resets before the FIRST executed step (`acceptance_specs` in a
        // daemon run — the front half is pre-seeded `done` and skipped above). That
        // matters on a REUSED worktree: resetSession() unlinks the stale
        // `session-created` / rewrites `conduct-session-id`, so the step dispatches
        // `claude --session-id <new>` (create) instead of `--resume <new>` against
        // a conversation that never existed (which surfaced as "session
        // unavailable (expired or in use)" and errored the feature out).
        if (this.freshContextPerStep && this.stepRunner.resetSession) {
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

        const stepMaxRetries = resolved.max_retries;
        // Snapshot of resolved-task count before the most recent build retry,
        // so the circuit breaker can detect "Claude ran but completed zero
        // additional tasks" = no point retrying further, hand off to REPL.
        let resolvedTasksBefore = step.name === 'build'
          ? await countResolvedTasks(this.projectRoot)
          : 0;

        while (attempt < stepMaxRetries) {
          attempt++;

          const result =
            step.name === 'complexity'
              ? await this.runComplexityStep(state)
              : step.name === 'worktree'
                ? await this.runWorktreeStep(state)
                : step.name === 'rebase'
                  ? await this.runRebaseStep(state)
                  : await this.stepRunner.run(step.name, state, { retryReason: retryHint });

          // Rate limit: wait deterministically, then retry WITHOUT burning the
          // retry budget (matches bin/conduct:2248–2280 handle_rate_limit).
          if (result.rateLimited) {
            const waitSeconds = result.waitSeconds ?? 300;
            await this.events.emit({ type: 'rate_limit', waitSeconds });
            await this.sleep(waitSeconds * 1000);
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

          if (!result.success) {
            lastError = result.output ?? `Step '${step.name}' session ended with error`;
            retryHint = `Previous attempt failed: ${lastError}. Finish the work now.`;
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
            let completion = await checkStepCompletion(this.projectRoot, step.name, {
              sessionStartedAt: state.session_started_at,
              featureDesc: state.feature_desc,
              config: this.config,
            });

            // Auto-heal hook: before treating a build-gate miss as a failure,
            // reconcile .pipeline/task-status.json against git log. If the
            // prior pipeline run committed work for tasks still marked
            // "pending", mark them completed in-place and re-check the gate
            // — the retry never has to fire.
            if (
              !completion.done &&
              step.name === 'build' &&
              !autoHealAttempted.has('build')
            ) {
              autoHealAttempted.add('build');
              const heal = await attemptAutoHeal(this.projectRoot).catch(() => ({
                healed: [],
                skipped: [],
              }));
              await this.events.emit({
                type: 'auto_heal',
                step: 'build',
                healed: heal.healed.length,
                skipped: heal.skipped.length,
              });
              if (heal.healed.length > 0) {
                completion = await checkStepCompletion(this.projectRoot, step.name, {
                  sessionStartedAt: state.session_started_at,
                  featureDesc: state.feature_desc,
                  config: this.config,
                });
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
                const resolvedTasksAfter = await countResolvedTasks(this.projectRoot);
                const markerSet = await haltMarkerExists(this.projectRoot);
                if (markerSet) {
                  stalled = 'halt_marker';
                } else if (attempt >= 2 && resolvedTasksAfter <= resolvedTasksBefore) {
                  stalled = 'no_task_progress';
                }
                if (stalled) {
                  await this.events.emit({
                    type: 'build_stall',
                    step: step.name,
                    reason: stalled,
                    resolvedBefore: resolvedTasksBefore,
                    resolvedAfter: resolvedTasksAfter,
                  });
                  await clearHaltMarker(this.projectRoot);

                  // Hand off: open an interactive Claude session so the user
                  // can break the stall. After the REPL exits, re-check
                  // completion one more time. If passing, the step succeeds;
                  // if still failing, fall into the normal recovery menu.
                  // Skipped in auto mode — there's no human to break the stall,
                  // so we fall straight through to the (auto) failure handling.
                  if (this.mode !== 'auto' && this.stepRunner.runInteractive) {
                    await this.stepRunner.runInteractive(step.name);
                  }
                  const recheck = await checkStepCompletion(this.projectRoot, step.name, {
                    sessionStartedAt: state.session_started_at,
                    featureDesc: state.feature_desc,
                    config: this.config,
                  });
                  if (recheck.done) {
                    succeeded = true;
                    successOutput = result.output;
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
                await this.stepRunner.run('remediate', state, {
                  retryReason:
                    'A blocking prd-audit is at .pipeline/prd-audit.md (an as-built ' +
                    'review may be at .pipeline/architecture-review-as-built.md). Plan ' +
                    'remediation per the /remediate skill and write ' +
                    '.pipeline/remediation.json.',
                });
                const plan = await readRemediationPlan(
                  this.projectRoot,
                  state.session_started_at,
                );
                if (plan) {
                  const fixes = plan.gaps.filter((g) => g.disposition !== 'halt');
                  const halts = plan.gaps.filter((g) => g.disposition === 'halt');
                  if (fixes.length > 0) {
                    remediationRounds++;
                    const target = earliestRemediationTarget(fixes, steps);
                    await this.events.emit({
                      type: 'kickback',
                      from: 'prd_audit',
                      to: target,
                      evidence: fixes.map((g) => `${g.id}→${g.disposition}`).join('; '),
                      count: remediationRounds,
                    });
                    pendingRetryHints.set(target, buildRemediationHint(fixes));
                    const nav = navigateBack(state, target, steps);
                    state = nav.state;
                    (state as Record<string, unknown>).prd_audit = 'stale';
                    await writeState(this.stateFilePath, state);
                    i = nav.index - 1; // for-loop i++ lands on the target step
                    continue;
                  }
                  if (halts.length > 0) {
                    const reason =
                      'prd-audit halted: needs human DECIDE — ' +
                      halts
                        .map((g) => `${g.id} (${g.category}: ${g.rationale})`)
                        .join('; ');
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
                    await this.events.emit({ type: 'loop_halt', reason });
                    await writeState(this.stateFilePath, state);
                    process.off('SIGINT', sigintHandler);
                    return;
                  }
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
              await this.events.emit({ type: 'loop_halt', reason });
              await writeState(this.stateFilePath, state);
              process.off('SIGINT', sigintHandler);
              return;
            }

            // Unattended hard failure on a gating/structural step. Write a HALT
            // marker (not just return) so a supervising daemon classifies this as
            // `halted` — worktree kept, NOT marked processed, retryable after a
            // human looks — instead of "loop ended without DONE or HALT marker".
            const reason = `step '${step.name}' failed in auto mode (retries exhausted)`;
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
            await this.events.emit({ type: 'loop_halt', reason });
            await writeState(this.stateFilePath, state);
            process.off('SIGINT', sigintHandler);
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

          // For complexity + worktree, 'done' (and tier / worktree fields) are
          // written atomically in their engine handlers. For all other steps, here.
          if (step.name !== 'complexity' && step.name !== 'worktree') {
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
            return;
          }
          if (advance !== null) {
            i = advance - 1; // the for loop's i++ lands on the selector's choice
            continue;
          }
        }
      }

      // Clean up SIGINT handler
      process.off('SIGINT', sigintHandler);

      // All steps completed successfully
      await this.events.emit({
        type: 'feature_complete',
        prUrl: state.pr_url,
        featureDesc: state.feature_desc,
        sessionStartedAt: state.session_started_at,
      });
      state.feature_status = 'complete';
      await writeState(this.stateFilePath, state);
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
      await this.events.emit({ type: 'loop_halt', reason });
    } finally {
      process.off('SIGINT', sigintHandler);
    }
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
    // The gate-driven tail only engages when completion is verified against
    // artifacts. Without verifyArtifacts the conductor trusts the runner and
    // stays fully linear (unchanged behavior).
    if (!this.verifyArtifacts) return null;

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
      // FR-5: a file-changing rebase invalidated build (+manual_test) via
      // kickback-shaped verdicts. Those gates aren't `kickbackTarget` steps, so
      // emit the kickback event(s) here; the selector below routes back to them.
      if (this.lastRebaseOutcome?.kind === 'changed') {
        const verdicts = await readAllVerdicts(this.projectRoot);
        for (const target of ['build', 'manual_test'] as StepName[]) {
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
      const verdict = await computeAndWriteVerdict(this.projectRoot, step.name, {
        sessionStartedAt: state.session_started_at,
        featureDesc: state.feature_desc,
        config: this.config,
      });
      await this.events.emit({
        type: 'gate_verdict',
        step: step.name,
        satisfied: verdict.satisfied,
        reason: verdict.reason,
      });
    }

    if (indexOf(step.name) < topo.firstLoopIndex) {
      return null; // front half stays linear (before the first loop gate)
    }

    // Mark tier/mode-skipped steps in the looped region as 'skipped' so the
    // selector skips them AND downstream prerequisite gates (checkGate) pass —
    // the selector-driven tail can jump over a step without the linear body
    // ever marking it.
    let markedSkip = false;
    const tier = state.complexity_tier ?? 'L';
    for (const s of steps) {
      if (
        getStepStatus(state, s.name) === 'pending' &&
        (s.skippableForTiers.includes(tier) ||
          shouldSkipForBootstrapMode(s.name, state.bootstrap_mode))
      ) {
        (state as Record<string, unknown>)[s.name] = 'skipped';
        markedSkip = true;
      }
    }
    if (markedSkip) await writeState(this.stateFilePath, state);

    const verdicts = await readAllVerdicts(this.projectRoot);

    // Kickback: a step re-opened an upstream gate (verdict is
    // {satisfied:false, kickback.from === this step}). Re-open that gate
    // (pending) + cascade-stale its downstream so they re-run; HALT if a gate
    // has been re-opened past the cap.
    for (const target of topo.kickbackTargets) {
      const v = verdicts[target];
      if (v && v.satisfied === false && v.kickback?.from === step.name) {
        const count = (kickbackCounts.get(target) ?? 0) + 1;
        kickbackCounts.set(target, count);
        await this.events.emit({
          type: 'kickback',
          from: step.name,
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
          await this.events.emit({ type: 'loop_halt', reason });
          return 'halt';
        }
        const nav = navigateBack(state, target, steps);
        Object.assign(state, nav.state);
        await writeState(this.stateFilePath, state);
      }
    }

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
      await this.events.emit({ type: 'loop_halt', reason });
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
   * self-directed orchestration (skipping `brainstorm`, botching git so the main
   * repo ended up on the feature branch). A direct call keeps main untouched and
   * lets the per-step engine drive `brainstorm` etc. normally.
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
      return { success: true };
    }

    const git = makeGitRunner(this.projectRoot);
    const localBase = await this.discoverLocalBase(git);

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
    this.lastRebaseOutcome = outcome;

    // manual_test counts as "ran" when it isn't skipped for this feature.
    const ranManualTest =
      getStepStatus(state, 'manual_test') !== 'skipped';
    await applyRebaseVerdicts(this.projectRoot, outcome, ranManualTest);
    await emitRebaseEvent(this.events, outcome);

    if (outcome.kind === 'conflict_halt') {
      await writeHalt(this.projectRoot, outcome.conflicts, outcome.reason);
    }

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
 */
export function buildRemediationHint(fixes: RemediationGap[]): string {
  const lines = fixes.map((g) => {
    const tasks = g.tasks.length ? ` Tasks: ${g.tasks.map((t) => t.title).join('; ')}` : '';
    return `- ${g.id} [${g.disposition}]: ${g.rationale}.${tasks}`;
  });
  return (
    'Remediating blocking prd-audit gaps (see .pipeline/remediation.json and ' +
    '.pipeline/prd-audit.md). The task list may already show complete, but the ' +
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
  if (step === 'build' && /tasks? not completed/i.test(r)) {
    return (
      `Previous attempt did not satisfy the completion check: ${r}. ` +
      `The implementation may already be done — verify each listed task ID ` +
      `against git log and files on disk before rewriting. If the work is ` +
      `complete, update .pipeline/task-status.json to mark those tasks ` +
      `"completed" (with their commit SHAs) instead of re-implementing.`
    );
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
