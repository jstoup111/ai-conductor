import { readFile, access as accessFile, unlink as unlinkFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, join } from 'node:path';
import type { ConductState } from '../types/index.js';
import type {
  StepName,
  StepStatus,
  Phase,
  RunMode,
  ComplexityTier,
  RecoveryOption,
  RecoveryContext,
} from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { readState, writeState, saveStepStatus, getStepStatus, markDownstreamStale } from './state.js';
import {
  ALL_STEPS,
  getStepIndex,
  shouldSkipForTier,
  shouldSkipForBootstrapMode,
  isCheckpointStep,
} from './steps.js';
import { checkGate, isGatingStep } from './gates.js';
import {
  findArtifactFiles as findArtifactFilesForStep,
  STEP_ARTIFACT_GLOBS,
  checkStepCompletion,
  CUSTOM_COMPLETION_PREDICATES,
} from './artifacts.js';
import { resolveStepConfig, phaseForStep } from './resolved-config.js';
import { attemptAutoHeal } from './autoheal.js';
import {
  countResolvedTasks,
  haltMarkerExists,
  clearHaltMarker,
} from './task-progress.js';

export type CheckpointResponse = 'continue' | 'back' | 'quit';

/**
 * How many times a user may pick `retry` from the recovery menu for a single
 * step in one conductor session before the UI drops the option. After this,
 * the step has clearly entered a loop the auto-retry couldn't escape — the
 * user is pushed toward `interactive`, `back`, or `quit` instead.
 */
export const MAX_RECOVERY_RETRIES = 2;

export interface NavigableStep {
  name: StepName;
  label: string;
  status: StepStatus;
  phase: Phase;
}

export function navigateBack(
  state: ConductState,
  target: StepName,
): { state: ConductState; index: number } {
  const allStepNames = ALL_STEPS.map((s) => s.name);
  let updated = markDownstreamStale(state, target, allStepNames);
  (updated as Record<string, unknown>)[target] = 'pending';
  const index = getStepIndex(target);
  return { state: updated, index };
}

export function getNavigableSteps(state: ConductState): NavigableStep[] {
  return ALL_STEPS
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
  /**
   * When true, after each step that declares artifact globs, require at least
   * one matching file on disk. If not, mark the step failed and route through
   * the recovery menu. Default: false (opt-in — production wires this on).
   */
  verifyArtifacts?: boolean;
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
  private onCheckpoint: (step: StepName) => Promise<CheckpointResponse>;
  private onNavigate: (steps: NavigableStep[]) => Promise<StepName | null>;
  private verifyArtifacts: boolean;
  private sleep: (ms: number) => Promise<void>;
  private onReviewArtifacts: (step: StepName, files: string[]) => Promise<ArtifactReviewResult>;
  private onRecovery?: (
    step: StepName,
    isGating: boolean,
    context?: RecoveryContext,
  ) => Promise<RecoveryOption>;
  private onComplexityAssessment?: (recommended: ComplexityTier | null) => Promise<ComplexityTier>;

  constructor(opts: ConductorOptions) {
    this.stateFilePath = opts.stateFilePath;
    this.stepRunner = opts.stepRunner;
    this.events = opts.events;
    this.resume = opts.resume ?? false;
    this.fromStep = opts.fromStep;
    this.mode = opts.mode ?? 'default';
    this.config = opts.config ?? {};
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.verifyArtifacts = opts.verifyArtifacts ?? false;
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

    // Determine starting index
    let startIndex = 0;
    if (this.fromStep) {
      startIndex = getStepIndex(this.fromStep);
    } else if (this.resume) {
      startIndex = this.findResumeIndex(state);
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

    for (let i = startIndex; i < ALL_STEPS.length; i++) {
      const step = ALL_STEPS[i];

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
      if (shouldSkipForTier(step.name, tier)) {
        await saveStepStatus(this.stateFilePath, step.name, 'skipped');
        state[step.name] = 'skipped';
        await this.events.emit({ type: 'tier_skip', step: step.name, tier });
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
      const resolved = resolveStepConfig(step.name, phaseForStep(step.name), this.config, {
        tier: state.complexity_tier,
      });

      // Check if step is disabled via config
      if (resolved.disabled) {
        await saveStepStatus(this.stateFilePath, step.name, 'skipped');
        state[step.name] = 'skipped';
        await this.events.emit({ type: 'config_skip', step: step.name });
        continue;
      }

      // Check gate: all prerequisites must be satisfied
      const gate = checkGate(step.name, state);
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

      // Retry loop: auto-retry on step-runner failure OR completion-gate miss,
      // up to `maxRetries` attempts total. Only after the budget is exhausted
      // do we escalate to the recovery menu. Matches bash bin/conduct's
      // max_retries=3 behavior.
      let attempt = 0;
      let lastError: string = '';
      let succeeded = false;
      let retryHint: string | undefined;
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
            reason: 'Claude reported "No conversation found"',
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
          let completion = await checkStepCompletion(this.projectRoot, step.name);

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
              completion = await checkStepCompletion(this.projectRoot, step.name);
            }
          }

          if (!completion.done) {
            lastError = `Step '${step.name}' completed but completion check failed: ${completion.reason ?? 'unknown'}`;
            retryHint = buildRetryHint(step.name, completion.reason);

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
                if (this.stepRunner.runInteractive) {
                  await this.stepRunner.runInteractive(step.name);
                }
                const recheck = await checkStepCompletion(this.projectRoot, step.name);
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

        if (this.onRecovery) {
          const gating = isGatingStep(step.name);
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
            const navigable = getNavigableSteps(state);
            const target = await this.onNavigate(navigable);
            if (target) {
              const nav = navigateBack(state, target);
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

        // For complexity, tier + 'done' are written atomically in runComplexityStep.
        // For all other steps, write status here.
        if (step.name !== 'complexity') {
          await saveStepStatus(this.stateFilePath, step.name, 'done');
        }
        state[step.name] = 'done';
        const tail = successOutput ? successOutput.split('\n').slice(-200) : undefined;
        await this.events.emit({ type: 'step_completed', step: step.name, status: 'done', tail });

        // Store PR URL from finish step output — read the latest state file
        // rather than the (captured, possibly stale) runner output, so manual
        // fixes during recovery or interactive mode still pick up the URL.
        if (step.name === 'finish') {
          const current = await readState(this.stateFilePath);
          if (current.ok && current.value.pr_url) state.pr_url = current.value.pr_url;
        }

        // Checkpoint handling
        if (isCheckpointStep(step.name) && this.mode !== 'auto') {
          await this.events.emit({ type: 'checkpoint_reached', step: step.name });
          const response = await this.onCheckpoint(step.name);
          if (response === 'quit') {
            await writeState(this.stateFilePath, state);
            process.off('SIGINT', sigintHandler);
            return;
          }
          if (response === 'back') {
            const navigable = getNavigableSteps(state);
            const target = await this.onNavigate(navigable);
            if (target) {
              const nav = navigateBack(state, target);
              await this.events.emit({ type: 'navigation_back', from: step.name, to: target });
              state = nav.state;
              await writeState(this.stateFilePath, state);
              i = nav.index - 1; // for loop will i++
              continue;
            }
          }
          // 'continue' proceeds normally
        }
      }
    }

    // Clean up SIGINT handler
    process.off('SIGINT', sigintHandler);

    // All steps completed successfully
    await this.events.emit({ type: 'feature_complete', prUrl: state.pr_url });
    state.feature_status = 'complete';
    await writeState(this.stateFilePath, state);
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
  private findResumeIndex(state: ConductState): number {
    // If feature is already complete, treat as new feature (start from 0)
    if (state.feature_status === 'complete') {
      return 0;
    }

    // First, look for an in_progress step
    for (let i = 0; i < ALL_STEPS.length; i++) {
      if (getStepStatus(state, ALL_STEPS[i].name) === 'in_progress') {
        return i;
      }
    }

    // Otherwise, find the first pending step after the last done step
    let lastDoneIndex = -1;
    for (let i = 0; i < ALL_STEPS.length; i++) {
      if (getStepStatus(state, ALL_STEPS[i].name) === 'done') {
        lastDoneIndex = i;
      }
    }

    return lastDoneIndex + 1;
  }

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
