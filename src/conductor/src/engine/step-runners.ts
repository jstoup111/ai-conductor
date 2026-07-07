import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider } from '../execution/llm-provider.js';
import { ModelAvailability } from './model-availability.js';
import type { StepName, ConductState, ComplexityTier, RunMode } from '../types/index.js';
import type { HarnessConfig, EffortLevel } from '../types/config.js';
import type { StepRunner, StepRunResult, StepRunOptions } from './conductor.js';
import { ALL_STEPS, getStepDefinition, tryGetStepIndex } from './steps.js';
import {
  resolveStepConfig,
  phaseForStep,
  type ResolvedStepConfig,
} from './resolved-config.js';
import {
  classifySignal,
  hasInsufficientInfo,
  type Signal,
} from './complexity.js';
import type { ResolutionContext, ResolutionAttempt } from './rebase.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { findArtifactFiles } from './artifacts.js';
import { assembleBuildReviewInputs } from './build-review-inputs.js';
import { buildGraderPrompt } from './build-review-prompt.js';

const STEP_PROMPTS: Record<StepName, string> = {
  bootstrap: '/bootstrap',
  memory: '/memory',
  assess: '/assess',
  explore: '/explore',
  prd: '/prd',
  complexity: '/conduct complexity',
  stories: '/stories',
  conflict_check: '/conflict-check',
  plan: '/plan',
  architecture_diagram: '/architecture-diagram',
  architecture_review: '/architecture-review',
  worktree: '/conduct worktree',
  acceptance_specs: '/writing-system-tests',
  build: '/pipeline',
  // Display sentinel for the model table; the grader dispatch is driven by
  // the fresh-session assembly logic (see resolveRebaseConflict pattern),
  // not by invoking a literal `/build-review` skill.
  build_review: '/build-review',
  manual_test: '/manual-test',
  prd_audit: '/prd-audit',
  // Runs the architecture-review skill in its as-built compliance-gate mode.
  architecture_review_as_built: '/architecture-review --as-built',
  retro: '/retro',
  // Engine-native (like complexity) — never dispatched; present only to keep
  // the Record<StepName, string> exhaustive.
  rebase: '/conduct rebase',
  finish: '/finish',
  // Conditional SHIP sub-routine: plans remediation for a blocking audit.
  remediate: '/remediate',
};

// Autonomous steps run in Claude's `-p` (print) mode with
// --dangerously-skip-permissions. Completion is enforced by the conductor's
// post-step completion gate + retry budget (see Conductor.run), matching the
// bash conductor's reliability pattern: a single print-mode turn may exit
// before the work is truly done, but the conductor retries on miss up to
// `maxRetries` times before falling into the recovery menu.
const AUTONOMOUS_STEPS: Set<StepName> = new Set([
  'bootstrap',
  'memory',
  'assess',
  'worktree',
  'acceptance_specs',
  'build',
  'remediate', // conductor-dispatched gap-remediation planner — runs unattended
]);

// Steps where the skill design requires a back-and-forth conversation (the
// user refines scope with Claude), not a single one-shot response. These are
// dispatched as Claude REPL sessions (positional prompt, no -p flag) so the
// session stays open until the user /quits. In auto mode this set is
// ignored — the step still runs but through print mode, because auto mode
// explicitly trades the Socratic flow for unattended execution.
//
// `finish` belongs here because the skill explicitly asks the user to choose
// between Merge/PR/Keep/Discard (skills/finish/SKILL.md §4). In print mode,
// Claude has no way to receive that choice and silently exits with prose
// instead of acting — leaving the feature unshipped while state shows it
// "complete." In auto mode (line 277 below), the print-mode dispatch + the
// finish completion gate (artifacts.ts) together force the skill to either
// produce a pr_url or write `.pipeline/finish-choice` before passing.
//
// Other non-autonomous steps (complexity, conflict_check, architecture_diagram,
// retro) are one-shot by design: they generate an artifact from existing
// context without needing user input, so print mode is the right dispatch
// for them even outside auto mode.
const INTERACTIVE_STEPS: Set<StepName> = new Set([
  'explore', // divergent Q&A + approach selection + track confirmation
  'prd', // product-only design doc with operator approval
  'stories',
  'plan',
  'architecture_review',
  'manual_test',
  'finish',
]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract a complexity tier (S/M/L) from Claude's complexity-assessment output.
 * Looks for the last occurrence of `TIER: <letter>` (case-insensitive). Falls back
 * to the last standalone S/M/L letter if the explicit marker is absent.
 */
export function parseTierFromOutput(output: string): ComplexityTier | null {
  if (!output) return null;

  const markerMatches = [...output.matchAll(/TIER:\s*([SML])/gi)];
  if (markerMatches.length > 0) {
    const letter = markerMatches[markerMatches.length - 1][1].toUpperCase();
    return letter as ComplexityTier;
  }

  // Fallback: scan from the end for a single isolated S/M/L token.
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^([SML])[.!\s]*$/i);
    if (m) return m[1].toUpperCase() as ComplexityTier;
  }
  return null;
}

/**
 * Extract per-signal counts from Claude's complexity-assessment output.
 * Expected lines (case-insensitive, in any order):
 *   MODELS: <n>
 *   INTEGRATIONS: <n>
 *   AUTH: <0|1|2>          (0=none, 1=role, 2=oauth/multi-tenant)
 *   STATE_MACHINES: <n>    (also accepts STATEMACHINES / STATE MACHINES)
 *   STORIES: <n>
 * Missing signals are omitted; caller decides what to do with <5 values.
 */
export function parseSignalCountsFromOutput(
  output: string,
): Partial<Record<Signal, number>> {
  if (!output) return {};
  const counts: Partial<Record<Signal, number>> = {};
  const patterns: Array<[Signal, RegExp]> = [
    ['models', /^\s*MODELS?\s*:\s*(\d+)/im],
    ['integrations', /^\s*INTEGRATIONS?\s*:\s*(\d+)/im],
    ['auth', /^\s*AUTH\s*:\s*(\d+)/im],
    ['stateMachines', /^\s*STATE[_\s-]?MACHINES?\s*:\s*(\d+)/im],
    ['stories', /^\s*STORIES\s*:\s*(\d+)/im],
  ];
  for (const [signal, pattern] of patterns) {
    const match = output.match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n >= 0) counts[signal] = n;
    }
  }
  return counts;
}

/**
 * Deterministic complexity scoring. Classifies each extracted signal, then
 * majority-votes across ONLY the signals that were actually provided (with
 * tie-break toward the higher tier). Missing signals are NOT defaulted — that
 * would bias the result toward S and reproduce the exact downgrade bug this
 * scoring is meant to prevent.
 *
 * Returns null when fewer than 3 signals are available; caller should fall
 * back to `parseTierFromOutput` (Claude's letter), which is less reliable
 * but better than nothing.
 */
export function scoreComplexityFromCounts(
  counts: Partial<Record<Signal, number>>,
): ComplexityTier | null {
  const entries = Object.entries(counts) as Array<[Signal, number]>;
  if (hasInsufficientInfo(entries.length)) return null;
  const presentTiers: Partial<Record<Signal, ComplexityTier>> = {};
  for (const [signal, count] of entries) {
    presentTiers[signal] = classifySignal(signal, count);
  }
  return assessTierPartial(presentTiers);
}

/**
 * Majority-vote across a partial record of signal tiers, with tie-break toward
 * the higher tier. Parallels `assessTier` but doesn't require all five signals
 * to be present — important so un-extracted signals don't bias the outcome
 * toward S (the default for un-set entries in a full record).
 */
function assessTierPartial(
  signals: Partial<Record<Signal, ComplexityTier>>,
): ComplexityTier {
  const counts: Record<ComplexityTier, number> = { S: 0, M: 0, L: 0 };
  for (const tier of Object.values(signals)) {
    if (tier) counts[tier]++;
  }
  const maxCount = Math.max(counts.S, counts.M, counts.L);
  const candidates = (['S', 'M', 'L'] as ComplexityTier[]).filter(
    (t) => counts[t] === maxCount,
  );
  const order: Record<ComplexityTier, number> = { S: 0, M: 1, L: 2 };
  return candidates.reduce((a, b) => (order[b] > order[a] ? b : a));
}

/**
 * Parse the last `{"resolved": ...}` JSON object from the rebase skill's
 * stdout. The skill contract requires the final line of output to be one of:
 *   {"resolved": true}
 *   {"resolved": false, "reason": "..."}
 *
 * Scans lines from the end for the last parseable object with a boolean
 * `resolved` field. Returns `{resolved: false, reason: '...'}` when no such
 * object is found — NEVER returns `{resolved: true}` on garbage output.
 */
export function parseRebaseResolutionOutput(output: string): ResolutionAttempt {
  if (!output || output.trim().length === 0) {
    return { resolved: false, reason: 'rebase skill returned no parseable result' };
  }
  const lines = output.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'resolved' in parsed &&
        typeof (parsed as Record<string, unknown>).resolved === 'boolean'
      ) {
        const obj = parsed as Record<string, unknown>;
        if (obj.resolved === true) {
          return { resolved: true };
        }
        const reason =
          typeof obj.reason === 'string' && obj.reason.length > 0
            ? obj.reason
            : 'unspecified';
        return { resolved: false, reason };
      }
    } catch {
      // Not valid JSON — try the previous line.
    }
  }
  return { resolved: false, reason: 'rebase skill returned no parseable result' };
}

export interface StepRunnerOptions {
  featureDesc?: string;
  totalSteps?: number;
  pipelineDir?: string;
  stepCooldown?: number;
  sleepFn?: (ms: number) => Promise<void>;
  /**
   * Harness config for resolving per-step overrides. Falls back to
   * DEFAULT_STEP_* baselines when the config omits a field.
   */
  config?: HarnessConfig;
  /** CLI `--model <name>` override. Applies to every step. */
  modelOverride?: string;
  /** CLI `--effort <level>` override. Applies to every step. */
  effortOverride?: EffortLevel;
  /**
   * Conductor run mode. When `'auto'`, INTERACTIVE_STEPS are still dispatched
   * in print mode (unattended execution). Otherwise, steps in that set open a
   * Claude REPL so the user can iterate with the skill. Default: `'default'`.
   */
  mode?: RunMode;
  /**
   * Test-only injection points for the `build_review` one-shot grader
   * dispatch. Production always uses `makeGitRunner(projectDir)` and the
   * most recently modified `.docs/plans/*.md`; tests inject a scripted
   * GitRunner and a fixture plan path to avoid touching real git state.
   */
  gitRunner?: GitRunner;
  planPath?: string;
}

export class DefaultStepRunner implements StepRunner {
  private sessionStarted = false;
  private sessionStartedInitialized = false;
  private featureDesc: string;
  private totalSteps: number;
  private pipelineDir: string | null;
  private stepCooldown: number;
  private sleepFn: (ms: number) => Promise<void>;
  private config?: HarnessConfig;
  private modelOverride?: string;
  private effortOverride?: EffortLevel;
  private mode: RunMode;
  private modelAvailability: ModelAvailability;
  private gitRunner: GitRunner;
  private planPathOverride?: string;
  callCount = 0;

  constructor(
    private provider: LLMProvider,
    private sessionId: string,
    private projectDir: string,
    options?: StepRunnerOptions,
  ) {
    this.featureDesc = options?.featureDesc ?? '';
    this.totalSteps = options?.totalSteps ?? ALL_STEPS.length;
    this.pipelineDir = options?.pipelineDir ?? null;
    this.stepCooldown = options?.stepCooldown ?? 0;
    this.sleepFn = options?.sleepFn ?? defaultSleep;
    this.config = options?.config;
    this.modelOverride = options?.modelOverride;
    this.effortOverride = options?.effortOverride;
    this.mode = options?.mode ?? 'default';
    this.modelAvailability = new ModelAvailability(this.config?.model_fallback_ladder, (line) =>
      console.warn(line),
    );
    this.gitRunner = options?.gitRunner ?? makeGitRunner(this.projectDir);
    this.planPathOverride = options?.planPath;
  }

  resolvedConfigFor(step: StepName, tier?: ComplexityTier): ResolvedStepConfig {
    return resolveStepConfig(step, phaseForStep(step), this.config, {
      modelCliOverride: this.modelOverride,
      effortCliOverride: this.effortOverride,
      tier,
    });
  }

  modelForStep(step: StepName): string {
    return this.resolvedConfigFor(step).model;
  }

  async run(step: StepName, state: ConductState, opts?: StepRunOptions): Promise<StepRunResult> {
    if (step === 'complexity') {
      throw new Error(
        'complexity is handled by the engine via assessComplexity(); it must not be dispatched to run()',
      );
    }
    if (step === 'rebase') {
      throw new Error(
        'rebase is handled by the engine (native git rebase-on-latest); it must not be dispatched to run()',
      );
    }

    // build_review is a one-shot grader dispatch — never resumes the main
    // conductor session (see runBuildReview() for the resolveRebaseConflict
    // fresh-uuid/resume:false pattern).
    if (step === 'build_review') {
      return this.runBuildReview();
    }

    // Lazy-init: check marker file on first run
    if (!this.sessionStartedInitialized && this.pipelineDir) {
      this.sessionStarted = await this.fileExists(join(this.pipelineDir, 'session-created'));
      this.sessionStartedInitialized = true;
    }

    // Apply cooldown before steps (skip first step)
    if (this.callCount > 0 && this.stepCooldown > 0) {
      const multiplier = this.callCount >= 20 ? 3 : this.callCount >= 10 ? 2 : 1;
      await this.sleepFn(this.stepCooldown * 1000 * multiplier);
    }

    const prompt = STEP_PROMPTS[step];
    const resume = this.sessionStarted;
    const autonomous = AUTONOMOUS_STEPS.has(step);
    const resolved = this.resolvedConfigFor(step, state.complexity_tier);

    const systemPrompt = this.buildSystemPrompt(step, autonomous, opts?.retryReason);

    // Autonomous steps use invoke() (captured output) so we can detect rate
    // limits and stale sessions. Collaborative steps use invokeInteractive()
    // because the user is actively interacting via REPL.
    if (autonomous) {
      return this.runAutonomous(step, prompt, resume, systemPrompt, resolved);
    }

    // Open a REPL when the step is designed for user conversation AND we're
    // not in auto mode (auto = unattended, must still one-shot so the flow
    // advances). In interactive mode, open REPL for all conversational steps
    // except one-shot analysis steps. Otherwise dispatch print mode.
    let interactive: boolean;
    if (this.mode === 'interactive') {
      // In interactive mode, open REPL for all conversational steps except
      // one-shot steps that generate artifacts without user input
      const oneShotSteps = new Set(['complexity', 'conflict_check', 'architecture_diagram', 'retro', 'rebase']);
      interactive = !oneShotSteps.has(step);
    } else if (this.mode === 'auto') {
      interactive = false;
    } else {
      // default mode: REPL only for explicitly conversational steps
      interactive = INTERACTIVE_STEPS.has(step);
    }

    // Consult the availability cache before dispatch so a model already
    // known-dead (e.g. downgraded during an earlier autonomous step) isn't
    // handed to the interactive REPL — effectiveModel() substitutes a live
    // model and fires the substitution warning itself.
    const { model: effectiveModel } = this.modelAvailability.effectiveModel(resolved.model);

    try {
      await this.provider.invokeInteractive({
        prompt,
        sessionId: this.sessionId,
        resume,
        interactive,
        cwd: this.projectDir,
        // In auto mode there is no human to approve permissions, and the spawned
        // `claude` would otherwise launch in the user's default permission mode
        // (which may be `plan` → ALL writes blocked, so e.g. prd can never
        // save its `.docs/specs/` PRD and the step loops). Skip permissions so the
        // step can write, like autonomous steps. Interactive REPL mode (non-auto)
        // keeps prompts so the user approves.
        dangerouslySkipPermissions: this.mode === 'auto',
        systemPrompt,
        model: effectiveModel,
        effort: resolved.effort,
      });
      this.sessionStarted = true;
      this.callCount++;

      // Persist marker and session ID after first success
      if (this.pipelineDir) {
        await writeFile(join(this.pipelineDir, 'session-created'), '1', 'utf-8');
        await writeFile(join(this.pipelineDir, 'conduct-session-id'), this.sessionId, 'utf-8');
      }

      return { success: true };
    } catch {
      this.callCount++;
      return { success: false, output: `Session for ${step} exited with error` };
    }
  }

  private async runAutonomous(
    step: StepName,
    prompt: string,
    resume: boolean,
    systemPrompt: string,
    resolved: ResolvedStepConfig,
  ): Promise<StepRunResult> {
    // Resolve to a live model up front (skipping any already known-dead
    // model in this process) so a single ladder-covered invocation doesn't
    // waste an attempt on a model we already know is unavailable.
    const { model: effectiveModel } = this.modelAvailability.effectiveModel(resolved.model);

    // Track every model attempted during the ladder walk so a full-ladder
    // exhaustion failure names every model tried — diagnosable from
    // daemon.log alone without re-deriving the walk from the dead-set.
    const attemptedModels: string[] = [];
    const trackingProvider: LLMProvider = {
      invoke: (opts) => {
        attemptedModels.push(opts.model ?? '');
        return this.provider.invoke(opts);
      },
      invokeInteractive: (opts) => this.provider.invokeInteractive(opts),
    };

    const result = await this.modelAvailability.invokeWithLadder(trackingProvider, {
      prompt,
      sessionId: this.sessionId,
      resume,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: effectiveModel,
      effort: resolved.effort,
      cwd: this.projectDir,
    });
    this.callCount++;

    // Auth failure: operator's OAuth token is expired or invalid.
    // Report it — the conductor will halt and report the auth failure.
    if (result.authFailure) {
      return { success: false, output: result.output, authFailure: true };
    }

    // Rate limit: surface wait seconds (from provider result, else fallback 300s).
    if (result.rateLimited) {
      const waitSeconds = result.waitSeconds ?? 300;
      return {
        success: false,
        output: result.output,
        rateLimited: true,
        waitSeconds,
      };
    }

    // Stale session detected. Report it — the conductor will call resetSession()
    // and retry without burning the retry budget.
    if (result.sessionExpired) {
      return { success: false, output: result.output, sessionExpired: true };
    }

    if (result.success) {
      this.sessionStarted = true;
      if (this.pipelineDir) {
        await writeFile(join(this.pipelineDir, 'session-created'), '1', 'utf-8');
        await writeFile(join(this.pipelineDir, 'conduct-session-id'), this.sessionId, 'utf-8');
      }
      return { success: true, output: result.output };
    }

    // Full-ladder exhaustion: every attempted model reported unavailable.
    // Name them all in the output so the eventual HALT (if the conductor's
    // retry budget also exhausts) is diagnosable from daemon.log alone.
    if (result.modelUnavailable && attemptedModels.length > 1) {
      return {
        success: false,
        output: `${result.output} (model fallback ladder exhausted, tried: ${attemptedModels.join(', ')})`,
      };
    }

    return { success: false, output: result.output };
  }

  async resetSession(): Promise<void> {
    const { v4: uuidv4 } = await import('uuid');
    this.sessionId = uuidv4();
    this.sessionStarted = false;
    this.sessionStartedInitialized = true;
    if (this.pipelineDir) {
      const { unlink } = await import('node:fs/promises');
      await unlink(join(this.pipelineDir, 'session-created')).catch(() => {
        // Marker didn't exist — nothing to clear.
      });
      await writeFile(join(this.pipelineDir, 'conduct-session-id'), this.sessionId, 'utf-8');
    }
  }

  async runInteractive(step: StepName): Promise<void> {
    const resolved = this.resolvedConfigFor(step);
    await this.provider.invokeInteractive({
      prompt: `Fix issues from the failed ${step} step, then exit when done.`,
      sessionId: this.sessionId,
      resume: true,
      interactive: true,
      dangerouslySkipPermissions: false,
      model: resolved.model,
      effort: resolved.effort,
      cwd: this.projectDir,
    });
  }

  async assessComplexity(): Promise<ComplexityTier | null> {
    if (!this.sessionStartedInitialized && this.pipelineDir) {
      this.sessionStarted = await this.fileExists(join(this.pipelineDir, 'session-created'));
      this.sessionStartedInitialized = true;
    }

    // Ask Claude for per-signal COUNTS so the tier is computed deterministically
    // by `scoreComplexityFromCounts` below rather than trusting a subjective
    // letter from Claude. Thresholds must match the rubric in
    // skills/conduct/SKILL.md §2.5.
    const systemPrompt =
      'You are assessing complexity for the current feature. Read .docs/specs/*.md ' +
      '(most recent). Count the signals from the design doc. Auth uses a level: ' +
      '0=none/basic, 1=role-based, 2=multi-tenant/OAuth. State machines = number of ' +
      'distinct state machines implied (complex or multi-state counts as 2+). Output ' +
      'exactly these six lines, each on its own line, then stop:\n' +
      'MODELS: <integer>\n' +
      'INTEGRATIONS: <integer>\n' +
      'AUTH: <0|1|2>\n' +
      'STATE_MACHINES: <integer>\n' +
      'STORIES: <integer estimate>\n' +
      'TIER: <S|M|L>   # your best letter judgement, used only as a fallback';

    const resolved = this.resolvedConfigFor('complexity');
    // Walk the fallback ladder so a dead/out-of-credits configured model
    // (e.g. fable) degrades to the next available one instead of failing.
    const result = await this.modelAvailability.invokeWithLadder(this.provider, {
      prompt: '/conduct complexity',
      sessionId: this.sessionId,
      resume: this.sessionStarted,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: this.modelAvailability.effectiveModel(resolved.model).model,
      effort: resolved.effort,
      cwd: this.projectDir,
    });

    if (!result.success) return null;

    // Prefer deterministic scoring over Claude's letter. Only fall back to the
    // letter when we can't extract enough signal counts to score confidently.
    const counts = parseSignalCountsFromOutput(result.output);
    const scored = scoreComplexityFromCounts(counts);
    if (scored) return scored;
    return parseTierFromOutput(result.output);
  }

  /**
   * Dispatch the `rebase` skill in print mode to resolve a paused rebase
   * conflict in the feature worktree and parse its structured JSON result.
   *
   * Uses a fresh session (never resumes the main conductor session) and runs
   * with cwd set to ctx.projectRoot so the skill operates in the right worktree.
   * Model and effort are resolved from the `rebase` step config (default: opus/high —
   * conflict resolution is semantic merge judgment, not deterministic git work).
   *
   * Returns `{resolved: true}` when the skill signals success, or
   * `{resolved: false, reason}` on failure or when stdout contains no
   * parseable `{resolved:...}` JSON — NEVER returns `{resolved: true}` on
   * garbage output (fail-safe).
   */
  async resolveRebaseConflict(ctx: ResolutionContext): Promise<ResolutionAttempt> {
    const resolved = this.resolvedConfigFor('rebase');

    const conflictList =
      ctx.conflicts.length > 0
        ? ctx.conflicts.join(', ')
        : '(run `git diff --name-only --diff-filter=U` to discover)';

    const systemPrompt =
      'You are resolving a paused git rebase conflict. The rebase is stopped mid-flight.\n' +
      `Project root: ${ctx.projectRoot}\n` +
      `Base ref: ${ctx.baseRef}\n` +
      `Conflicted files: ${conflictList}\n\n` +
      'Resolve the conflicts, stage the fixes, and run `git rebase --continue` ' +
      'until the rebase completes or you reach an unsafe hunk.\n' +
      'Your FINAL output line MUST be exactly one of:\n' +
      '{"resolved": true}\n' +
      '{"resolved": false, "reason": "<explanation>"}';

    // Use a fresh one-shot session — never contaminate the main conductor session.
    const { v4: uuidv4 } = await import('uuid');
    const sessionId = uuidv4();

    // Walk the fallback ladder so a dead/out-of-credits configured model
    // (rebase defaults to fable) degrades to the next available one — the
    // rebase resolver must not be blocked by one model's credit exhaustion.
    const result = await this.modelAvailability.invokeWithLadder(this.provider, {
      prompt: '/rebase',
      sessionId,
      resume: false,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: this.modelAvailability.effectiveModel(resolved.model).model,
      effort: resolved.effort,
      cwd: ctx.projectRoot,
    });

    return parseRebaseResolutionOutput(result.output);
  }

  /**
   * Dispatch the build_review grader: a fresh, isolated one-shot session
   * (never resumes the main conductor session), fed strictly the diff since
   * the default branch plus the plan body (assembleBuildReviewInputs /
   * buildGraderPrompt — no task-status, transcript, or maker-summary access).
   *
   * Follows the same one-shot pattern as resolveRebaseConflict: fresh uuid,
   * `resume: false`, walked through the model fallback ladder. On full-ladder
   * exhaustion (every attempted model unavailable) this returns
   * `{success: false}` — the step is reported failed and the build_review
   * completion gate (artifacts.ts) stays unsatisfied; it is never reported
   * as a PASS.
   */
  private async runBuildReview(): Promise<StepRunResult> {
    const resolved = this.resolvedConfigFor('build_review');

    let planPath = this.planPathOverride;
    if (!planPath) {
      const planFiles = await findArtifactFiles(this.projectDir, 'plan');
      planPath = planFiles.sort().at(-1);
    }
    if (!planPath) {
      return {
        success: false,
        output: 'no .docs/plans/*.md present — build_review has no plan to grade the diff against',
      };
    }

    let inputs;
    try {
      inputs = await assembleBuildReviewInputs(this.gitRunner, planPath);
    } catch (err) {
      return {
        success: false,
        output: `build_review input assembly failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const prompt = buildGraderPrompt(inputs);

    // Fresh one-shot session — never contaminate the main conductor session,
    // and never resume a prior grader session either.
    const { v4: uuidv4 } = await import('uuid');
    const sessionId = uuidv4();

    // Track every model attempted during the ladder walk so a full-ladder
    // exhaustion failure names every model tried.
    const attemptedModels: string[] = [];
    const trackingProvider: LLMProvider = {
      invoke: (invokeOpts) => {
        attemptedModels.push(invokeOpts.model ?? '');
        return this.provider.invoke(invokeOpts);
      },
      invokeInteractive: (invokeOpts) => this.provider.invokeInteractive(invokeOpts),
    };

    const result = await this.modelAvailability.invokeWithLadder(trackingProvider, {
      prompt,
      sessionId,
      resume: false,
      dangerouslySkipPermissions: true,
      model: this.modelAvailability.effectiveModel(resolved.model).model,
      effort: resolved.effort,
      cwd: this.projectDir,
    });
    this.callCount++;

    if (result.authFailure) {
      return { success: false, output: result.output, authFailure: true };
    }
    if (result.rateLimited) {
      return {
        success: false,
        output: result.output,
        rateLimited: true,
        waitSeconds: result.waitSeconds ?? 300,
      };
    }
    if (result.sessionExpired) {
      return { success: false, output: result.output, sessionExpired: true };
    }
    if (result.success) {
      return { success: true, output: result.output };
    }

    // Full-ladder exhaustion: every attempted model reported unavailable.
    // Name them all so the eventual HALT is diagnosable from daemon.log alone.
    if (result.modelUnavailable && attemptedModels.length > 1) {
      return {
        success: false,
        output: `${result.output} (model fallback ladder exhausted, tried: ${attemptedModels.join(', ')})`,
      };
    }

    return { success: false, output: result.output };
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private buildSystemPrompt(step: StepName, autonomous: boolean, retryReason?: string): string {
    const stepDef = getStepDefinition(step);
    // Out-of-band steps (e.g. `remediate`) have no position in the linear
    // sequence, so present them by label instead of an "N/total" index rather
    // than throwing "Unknown step".
    const stepIdx = tryGetStepIndex(step);
    const header =
      stepIdx !== null
        ? `[Conduct step ${stepIdx + 1}/${this.totalSteps}]`
        : `[Conduct: ${stepDef.label}]`;
    const featurePart = this.featureDesc ? ` Feature: ${this.featureDesc}` : '';

    let prompt = `${header}${featurePart}`;

    if (!autonomous) {
      prompt = `You are running step: ${stepDef.label}. Complete ONLY this step, then stop and let the user /quit to return to the conductor.\n${prompt}`;
    }

    // Effort is now controlled via CLAUDE_CODE_EFFORT_LEVEL env var (Claude's
    // native reasoning knob) — no prose hint needed in the system prompt.

    // The finish skill normally asks the user to choose Merge/PR/Keep/Discard
    // (skills/finish/SKILL.md §4). In auto/unattended mode there is no user, so
    // print-mode Claude would emit prose and exit without writing
    // `.pipeline/finish-choice` — leaving the gate permanently unsatisfied and
    // the loop stuck (the validation failure this addresses). Tell it to decide
    // deterministically and ACT, ending by writing the marker file.
    if (step === 'finish' && this.mode === 'auto') {
      // Use ABSOLUTE worktree paths for the completion markers. In daemon mode
      // the finish skill performs branch/PR/worktree cleanup that `cd`s into the
      // main repo (see agents/worktree-manager.md), so relative `.pipeline/...`
      // writes would land in the WRONG repo while the completion gate reads the
      // worktree's `.pipeline` — leaving it unsatisfied and HALTing a feature
      // whose PR was genuinely created. `this.pipelineDir` is the worktree's
      // `.pipeline` (daemon-cli passes it); fall back to relative when unset.
      const choicePath = this.pipelineDir
        ? join(this.pipelineDir, 'finish-choice')
        : '.pipeline/finish-choice';
      const statePath = this.pipelineDir
        ? join(this.pipelineDir, 'conduct-state.json')
        : '.pipeline/conduct-state.json';
      prompt +=
        '\n\nUNATTENDED (auto) MODE — no user is present to choose a finish outcome, so do NOT prompt. ' +
        'Decide deterministically and ACT (do not merely describe):\n' +
        '- If the repo has a configured git remote and `gh` is authenticated: push the branch and open a ' +
        'PR with `gh pr create` (NEVER merge). If a PR for this branch already exists, reuse it instead ' +
        'of failing (`gh pr view --json url -q .url`). Before recording `pr` and `pr_url`, verify the ' +
        'STOP gate in §5 Option 2 of the finish skill: (1) the PR URL is non-empty (`gh pr view --json url`), ' +
        'and (2) the branch was pushed (`git merge-base --is-ancestor HEAD refs/remotes/origin/<branch>`). ' +
        'If EITHER check fails, do NOT write the markers — HALT for human review. If BOTH pass: Record ' +
        'the PR URL as the `pr_url` field in ' +
        `\`${statePath}\`, then write the single word \`pr\` to \`${choicePath}\`.\n` +
        '- Otherwise (no remote, or `gh` unavailable/unauthenticated): leave the work committed on the ' +
        `branch and write the single word \`keep\` to \`${choicePath}\`.\n` +
        `IMPORTANT: write these two files at the EXACT absolute paths shown above (\`${choicePath}\` and ` +
        `\`${statePath}\`). Do NOT use relative paths and do NOT \`cd\` elsewhere first — branch/PR/` +
        'worktree cleanup may change the working directory, and the completion gate only reads these ' +
        'absolute worktree paths. Write the marker(s) BEFORE any merge/cleanup step. The step is NOT ' +
        `complete until \`${choicePath}\` exists with one of those exact values (and, for \`pr\`, ` +
        `\`pr_url\` is set in \`${statePath}\`).`;
    }

    if (retryReason) {
      prompt = `RETRY: ${retryReason}\n${prompt}`;
    }

    return prompt;
  }
}
