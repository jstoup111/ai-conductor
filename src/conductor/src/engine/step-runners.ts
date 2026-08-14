import { writeFile, access, readFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, relative } from 'node:path';
import type { LLMProvider } from '../execution/llm-provider.js';
import { ModelAvailability } from './model-availability.js';
import type { StepName, ConductState, ComplexityTier, RunMode } from '../types/index.js';
import type { HarnessConfig, EffortLevel } from '../types/config.js';
import type {
  ComplexityAssessment,
  StepRunner,
  StepRunResult,
  StepRunOptions,
} from './conductor.js';
import { ALL_STEPS, buildStepRegistry, getStepDefinition, tryGetStepIndex } from './steps.js';
import {
  resolveStepConfig,
  phaseForStep,
  resolveProviderPreparationTimeoutMinutes,
  type ResolvedStepConfig,
} from './resolved-config.js';
import {
  classifySignal,
  hasInsufficientInfo,
  type Signal,
} from './complexity.js';
import type { ResolutionContext, ResolutionAttempt, SetupFailureContext, SetupFailureAttempt, CiFailureContext, CiFailureAttempt } from './rebase.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import {
  findArtifactFiles,
  resolveFeaturePlanPath,
  BUILD_REVIEW_VERDICT,
} from './artifacts.js';
import { currentCommitSha } from './project-prelude.js';
import { resolveGateCodeValidityConfig } from './config.js';
import {
  assembleBuildReviewInputs,
  type BuildReviewFrozenInputs,
  type BuildReviewInputOptions,
  type BuildReviewRepairProvenance,
} from './build-review-inputs.js';
import {
  runContainmentFloor,
  runPerTaskCommitFloor,
  renderContainmentFloorReport,
  renderPerTaskFloorReport,
  type ContainmentFloorReport,
} from './per-task-commit-floor.js';
import { resolveBuildReviewConfig } from './resolved-config.js';
import { coordinateBuildReviewRubrics, type BuildReviewDispatchableRubric } from './build-review-coordinator.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import { readBuildReviewCacheEntry, writeBuildReviewCacheEntry } from './build-review-cache.js';
import { readBuildReviewBranchArtifact, writeBuildReviewBranchArtifact } from './build-review-artifacts.js';
import { joinBuildReviewRubricOutcomes } from './build-review-aggregate.js';
import { parseBuildReviewLapId, parseBuildReviewJudgedResult, type BuildReviewRubricResult } from './build-review-domain.js';
import type { BuildReviewRubricProjection } from './build-review-projections.js';
import { classifyTautologyPaths, materializeTautologyPreflight, type TautologyScopedRunResult } from './build-review-tautology-preflight.js';
import {
  CLAUDE_MODEL_POLICY,
  type ProviderModelPolicy,
} from './provider-model-policy.js';
import type {
  ProviderSessionScope,
  ProviderSessionStore,
} from './provider-session.js';
import {
  executeProviderCandidates,
  executeAuxiliaryProviderCandidates,
  type ExecuteProviderCandidatesInput,
  type ProviderExecutionResult,
  type ProviderExecutionContext,
  type WithCandidateSafety,
} from './provider-execution.js';
import {
  ProviderRuntimeSet,
  type ProviderRuntime,
} from './provider-runtime.js';
import { normalizeProviderSelection } from './provider-selection.js';
import type { VerifierDispatchResult } from './attribution-lane.js';
import {
  renderSkillInvocation,
  renderAuxiliarySkillInvocation,
  STEP_SKILL_INVOCATIONS,
} from './skill-invocation.js';
import {
  createHeartbeatPulse,
} from './step-heartbeat.js';
import {
  createProviderLifecycleSupervisor,
  systemProviderLifecycleTimer,
  type ProviderLifecycleHaltedResult,
  type ProviderLifecycleTimer,
} from './provider-lifecycle.js';
import {
  createProviderLifecycleEpisodeStore,
  type ProviderLifecycleEpisodeStore,
} from './provider-lifecycle-store.js';
import { parseFinishPrProseJudgment } from './finish-pr-prose-judgment.js';
import { resolvePlanPatternSource } from './plan-pattern-source.js';
import { runCopyEquivalence } from './copy-equivalence.js';

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

function isProviderLifecycleHalted(
  result: ProviderExecutionResult | ProviderLifecycleHaltedResult,
): result is ProviderLifecycleHaltedResult {
  return 'kind' in result && result.kind === 'halted';
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
  /** Feature-owned warning sink for daemon-dispatched runners. */
  log?: (message: string) => void;
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
  /** Provider-native model defaults. Defaults to Claude for compatibility. */
  modelPolicy?: ProviderModelPolicy;
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
  /** Process-free test-suite-proof seam retained by the public build_review step. */
  buildReviewInputOptions?: BuildReviewInputOptions;
  /**
   * Engine-owned rubric fan-out seam. It receives the single frozen snapshot
   * and resolved policy, and returns only after every branch has settled.
   */
  buildReviewCoordinator?: (
    inputs: BuildReviewFrozenInputs,
    config: ReturnType<typeof resolveBuildReviewConfig>,
  ) => Promise<StepRunResult>;
  /** Shared event spine for engine-owned build-review occurrences. */
  events?: ConductorEventEmitter;
  /** Provider-aware session authority. Omitted by legacy scalar callers. */
  sessionStore?: ProviderSessionStore;
  /** Registry key for the captured provider when sessionStore is present. */
  providerKey?: string;
  /** Provider-aware runtime registry for normal serial step dispatch. */
  providerRuntimes?: ProviderRuntimeSet;
  /** Ordered run-level candidates. Defaults to config.llm_provider. */
  configuredProviders?: readonly string[];
  /** Injectable candidate executor; production uses executeProviderCandidates. */
  providerExecutor?: typeof executeProviderCandidates;
  /** Per-candidate attempt event sink. */
  providerAttempt?: ExecuteProviderCandidatesInput['onAttempt'];
  /** Visible provider-transition warning sink. */
  providerWarn?: ExecuteProviderCandidatesInput['warn'];
  /** Injectable preparation-supervision timer; production uses the system timer. */
  providerLifecycleTimer?: ProviderLifecycleTimer;
  /** Injectable lifecycle episode store; production uses durable filesystem storage. */
  providerLifecycleEpisodeStore?: ProviderLifecycleEpisodeStore;
  /** Shared provider routing state owned by this conductor run. */
  providerExecution?: ProviderExecutionContext;
  /**
   * Legacy test-fixture compatibility. Heartbeats are telemetry only, so
   * these former watchdog controls have no effect on provider dispatch.
   */
  heartbeatWatchdog?: { pollIntervalMs?: number; now?: () => number };
}

type ProviderAwareSkillOneShotStep = 'complexity' | 'remediate' | 'rebase';
type ProviderAwareFreeFormOneShotStep =
  | 'worktree'
  | 'build'
  | 'attribution_verify'
  | 'build_review';

interface ProviderAwareOneShotRequestBase {
  options: ExecuteProviderCandidatesInput['options'];
  tier?: ComplexityTier;
  dispatch?: StepRunOptions;
}

type ProviderAwareOneShotRequest =
  | (ProviderAwareOneShotRequestBase & {
      kind: 'skill';
      step: ProviderAwareSkillOneShotStep;
    })
  | (ProviderAwareOneShotRequestBase & {
      kind: 'free-form';
      step: ProviderAwareFreeFormOneShotStep;
    });

export class DefaultStepRunner implements StepRunner {
  private sessionStarted = false;
  private sessionStartedInitialized = false;
  /**
   * Track whether the session-created marker was found when we first checked it.
   * Used by ensurePipelineDir() to distinguish mid-run (marker was found once)
   * from first-provision (marker was never found).
   * This is set at line 353 when the initialization check runs, and never changes.
   */
  private wasSessionMarkerFoundOnInit = false;
  private featureDesc: string;
  private totalSteps: number;
  private pipelineDir: string | null;
  private stepCooldown: number;
  private sleepFn: (ms: number) => Promise<void>;
  private config?: HarnessConfig;
  private modelPolicy: ProviderModelPolicy;
  private modelOverride?: string;
  private effortOverride?: EffortLevel;
  private mode: RunMode;
  private modelAvailability: ModelAvailability;
  private gitRunner: GitRunner;
  private planPathOverride?: string;
  private buildReviewInputOptions?: BuildReviewInputOptions;
  private buildReviewCoordinator?: StepRunnerOptions['buildReviewCoordinator'];
  private events?: ConductorEventEmitter;
  private sessionStore?: ProviderSessionStore;
  private readonly runId: string;
  private providerKey: string;
  private providerRuntimes?: ProviderRuntimeSet;
  private configuredProviders: readonly string[];
  private providerExecutor: typeof executeProviderCandidates;
  private providerAttempt?: ExecuteProviderCandidatesInput['onAttempt'];
  private providerWarn: NonNullable<ExecuteProviderCandidatesInput['warn']>;
  private providerLifecycleTimer: ProviderLifecycleTimer;
  private providerLifecycleEpisodeStore: ProviderLifecycleEpisodeStore;
  private taskAttribution?: ExecuteProviderCandidatesInput['taskAttribution'];
  /** Shared context remains live because Conductor installs self-host hooks at dispatch time. */
  private providerExecutionContext?: ProviderExecutionContext;
  private withCandidateSafety?: WithCandidateSafety;
  private prepareCandidateSelfHost?: ExecuteProviderCandidatesInput['prepareCandidateSelfHost'];
  private log: (message: string) => void;
  private stepRegistry: ReturnType<typeof buildStepRegistry>;
  private providerLifecycleAttempt = 0;
  callCount = 0;

  constructor(
    private provider: LLMProvider,
    private sessionId: string,
    private projectDir: string,
    options?: StepRunnerOptions,
  ) {
    this.runId = sessionId;
    this.featureDesc = options?.featureDesc ?? '';
    this.totalSteps = options?.totalSteps ?? ALL_STEPS.length;
    this.pipelineDir = options?.pipelineDir ?? null;
    this.stepCooldown = options?.stepCooldown ?? 0;
    this.sleepFn = options?.sleepFn ?? defaultSleep;
    this.config = options?.config;
    this.stepRegistry = this.config ? buildStepRegistry(this.config) : ALL_STEPS;
    this.modelPolicy = options?.modelPolicy ?? CLAUDE_MODEL_POLICY;
    this.modelOverride =
      options?.modelOverride ?? options?.providerExecution?.modelOverride;
    this.effortOverride =
      options?.effortOverride ?? options?.providerExecution?.effortOverride;
    this.mode = options?.mode ?? 'default';
    this.log = options?.log ?? ((message) => console.warn(message));
    this.modelAvailability = new ModelAvailability(
      this.config?.model_fallback_ladder ?? this.modelPolicy.modelFallbackLadder,
      this.log,
    );
    this.gitRunner = options?.gitRunner ?? makeGitRunner(this.projectDir);
    this.planPathOverride = options?.planPath;
    this.buildReviewInputOptions = options?.buildReviewInputOptions;
    this.buildReviewCoordinator = options?.buildReviewCoordinator;
    this.events = options?.events;
    this.sessionStore =
      options?.sessionStore ?? options?.providerExecution?.sessions;
    this.providerKey = options?.providerKey ?? 'claude';
    this.providerRuntimes =
      options?.providerRuntimes ?? options?.providerExecution?.runtimes;
    this.configuredProviders =
      options?.configuredProviders ??
      options?.providerExecution?.configuredProviders ??
      normalizeProviderSelection(this.config?.llm_provider);
    this.providerExecutor =
      options?.providerExecutor ??
      options?.providerExecution?.executor ??
      executeProviderCandidates;
    this.providerLifecycleTimer =
      options?.providerLifecycleTimer ?? systemProviderLifecycleTimer;
    this.providerLifecycleEpisodeStore =
      options?.providerLifecycleEpisodeStore ?? createProviderLifecycleEpisodeStore();
    this.providerAttempt =
      options?.providerAttempt ?? options?.providerExecution?.onAttempt;
    this.taskAttribution = options?.providerExecution?.taskAttribution;
    this.providerExecutionContext = options?.providerExecution;
    this.withCandidateSafety = options?.providerExecution?.withCandidateSafety;
    this.prepareCandidateSelfHost = options?.providerExecution?.prepareCandidateSelfHost;
    this.providerWarn =
      options?.providerWarn ??
      options?.providerExecution?.warn ??
      this.log;
  }

  resolvedConfigFor(step: StepName, tier?: ComplexityTier): ResolvedStepConfig {
    const phase = this.stepRegistry.find((candidate) => candidate.name === step)?.phase
      ?? phaseForStep(step);
    return resolveStepConfig(step, phase, this.modelPolicy, this.config, {
      modelCliOverride: this.modelOverride,
      effortCliOverride: this.effortOverride,
      tier,
    });
  }

  modelForStep(step: StepName): string {
    return this.resolvedConfigFor(step).model;
  }

  selfHostRunId(): string {
    return this.runId;
  }

  escalateForStep(step: StepName, state: ConductState): boolean {
    return this.resolvedConfigFor(step, state.complexity_tier).escalate;
  }

  beginProviderBranch(step: StepName): ProviderSessionScope | undefined {
    if (!this.providerRuntimes || !this.sessionStore) return undefined;
    return this.sessionStore.beginBranch(step);
  }

  /**
   * `run()` is the single dispatch entry point for every step, across every
   * invocation path (autonomous, interactive REPL, provider-aware, streaming,
   * every provider). For the `finish` step in unattended (`auto`) mode, wrap
   * the whole dispatch so `CONDUCT_DAEMON_AUTO_FINISH=1` is set in this
   * process's environment BEFORE any subprocess is spawned — every provider's
   * child process inherits `process.env` by default (see the
   * `CLAUDE_CODE_EFFORT_LEVEL` precedent below), so the marker reaches any
   * shell/CLI command the agent runs regardless of what flags it types.
   * `finish-record-cli.ts` reads this marker to deterministically refuse
   * `--choice keep` when a git remote is configured (Daemon Operations Safety
   * rule 4 — "a manual PR is NOT a harness finish"). This makes PR-forcing
   * machinery, not prompt discipline: the SKILL.md/prompt instructions below
   * are guidance for the happy path, but this env marker is what the CLI
   * actually enforces.
   */
  async run(step: StepName, state: ConductState, opts?: StepRunOptions): Promise<StepRunResult> {
    if (step === 'finish' && this.mode === 'auto') {
      const previous = process.env.CONDUCT_DAEMON_AUTO_FINISH;
      process.env.CONDUCT_DAEMON_AUTO_FINISH = '1';
      try {
        return await this.runDispatch(step, state, opts);
      } finally {
        if (previous === undefined) delete process.env.CONDUCT_DAEMON_AUTO_FINISH;
        else process.env.CONDUCT_DAEMON_AUTO_FINISH = previous;
      }
    }
    return this.runDispatch(step, state, opts);
  }

  private async runDispatch(step: StepName, state: ConductState, opts?: StepRunOptions): Promise<StepRunResult> {
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
    if (step === 'wiring_check') {
      return {
        success: false,
        output: 'wiring_check is retired; build_review owns wiring judgement',
      };
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
      this.wasSessionMarkerFoundOnInit = this.sessionStarted;
      this.sessionStartedInitialized = true;
    }

    // Apply cooldown before steps (skip first step)
    if (this.callCount > 0 && this.stepCooldown > 0) {
      const multiplier = this.callCount >= 20 ? 3 : this.callCount >= 10 ? 2 : 1;
      await this.sleepFn(this.stepCooldown * 1000 * multiplier);
    }

    const skillInvocation = Object.prototype.hasOwnProperty.call(
      STEP_SKILL_INVOCATIONS,
      step,
    )
      ? STEP_SKILL_INVOCATIONS[step]
      : undefined;
    const prompt = skillInvocation
      ? renderSkillInvocation(skillInvocation, this.providerKey)
      : `/${step}`;
    // Concurrent-group branch dispatch (group-core.ts): opts.sessionId, when
    // present, overrides the runner's shared this.sessionId so the branch
    // never touches (reads or mutates) the main conductor session — see
    // adr-2026-07-10-concurrent-group-core.md. opts.resume then drives the
    // dispatch directly instead of being derived from this.sessionStarted.
    const branchSessionId = opts?.sessionId;
    let resume: boolean;
    if (branchSessionId !== undefined) {
      resume = opts?.resume ?? false;
    } else if (this.providerRuntimes) {
      // Provider execution prepares the selected provider inside the
      // caller-owned step scope. Never reset that scope from run(): retries
      // and fallback candidates must share it.
      resume = false;
    } else if (this.sessionStore) {
      const invocation = await this.sessionStore.prepare(this.providerKey);
      this.sessionId = invocation.id;
      resume = invocation.resume;
    } else {
      const { v4: uuidv4 } = await import('uuid');
      this.sessionId = uuidv4();
      resume = false;
    }
    const autonomous = AUTONOMOUS_STEPS.has(step);
    const baseResolved = this.resolvedConfigFor(step, state.complexity_tier);

    // #188 retry-as-escalation: the conductor computes per-attempt model/effort
    // overrides via escalateAttempt(base, attempt, escalate) and passes them
    // here. Layer them over the resolved base without mutating it. The escalated
    // model still flows through modelAvailability.effectiveModel() below (both
    // the autonomous and interactive dispatch paths read resolved.model), so an
    // escalated tier that is dead is substituted by the #186 availability ladder.
    const resolved: ResolvedStepConfig =
      opts?.modelOverride !== undefined || opts?.effortOverride !== undefined
        ? {
            ...baseResolved,
            model: opts.modelOverride ?? baseResolved.model,
            effort: opts.effortOverride ?? baseResolved.effort,
          }
        : baseResolved;

    const systemPrompt = await this.buildSystemPrompt(
      step,
      autonomous,
      opts?.retryReason,
      opts?.finishProsePass,
    );

    // Autonomous steps use invoke() (captured output) so we can detect rate
    // limits and stale sessions. Collaborative steps use invokeInteractive()
    // because the user is actively interacting via REPL.
    if (autonomous) {
      if (this.providerRuntimes && branchSessionId === undefined) {
        if (step === 'remediate') {
          try {
            const result = await this.executeProviderAwareSkillOneShot(
              step,
              {
                prompt,
                systemPrompt,
                cwd: this.projectDir,
                dangerouslySkipPermissions: true,
              },
              state.complexity_tier,
              opts,
            );
            if (result) {
              this.callCount++;
              return this.toStepRunResult(step, result);
            }
          } catch (error) {
            this.callCount++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Session for ${step} exited with error: ${errorMessage}`);
            return {
              success: false,
              output: `Session for ${step} exited with error: ${errorMessage}`,
            };
          }
        }
        return this.runProviderAwareNormal(
          step,
          state,
          opts,
          prompt,
          systemPrompt,
          false,
        );
      }
      return this.runAutonomous(step, prompt, resume, systemPrompt, resolved, branchSessionId);
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

    if (this.providerRuntimes && branchSessionId === undefined) {
      return this.runProviderAwareNormal(
        step,
        state,
        opts,
        prompt,
        systemPrompt,
        true,
        interactive,
      );
    }

    // Consult the availability cache before dispatch so a model already
    // known-dead (e.g. downgraded during an earlier autonomous step) isn't
    // handed to the interactive REPL — effectiveModel() substitutes a live
    // model and fires the substitution warning itself.
    const { model: effectiveModel } = this.modelAvailability.effectiveModel(resolved.model);

    try {
      await this.provider.invokeInteractive({
        prompt,
        sessionId: branchSessionId ?? this.sessionId,
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
      this.callCount++;

      if (branchSessionId === undefined) {
        this.sessionStarted = true;

        // Persist marker and session ID after first success.
        if (this.pipelineDir) {
          await this.ensurePipelineDir();
          await writeFile(join(this.pipelineDir, 'session-created'), '1', 'utf-8');
          // After successful first marker write, we know a session has been established.
          // Mark that for future mid-run detection.
          this.wasSessionMarkerFoundOnInit = true;
        }
      }

      return { success: true };
    } catch (error) {
      this.callCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`Session for ${step} exited with error: ${errorMessage}`);
      return { success: false, output: `Session for ${step} exited with error: ${errorMessage}` };
    }
  }

  private async runProviderAwareNormal(
    step: StepName,
    state: ConductState,
    opts: StepRunOptions | undefined,
    prompt: string,
    systemPrompt: string,
    streaming: boolean,
    interactive = false,
    invocationKind: 'skill' | 'free-form' = 'skill',
  ): Promise<StepRunResult> {
    const sessions = opts?.providerSessions ?? this.sessionStore;
    if (!this.providerRuntimes || !sessions) {
      throw new Error(
        'Provider-aware normal dispatch requires runtimes and a session store',
      );
    }

    const runtimes = streaming
      ? this.streamingProviderRuntimes(this.providerRuntimes)
      : this.providerRuntimes;
    const invocationOptions = this.withFeatureDiagnosticLog({
      prompt,
      systemPrompt,
      cwd: this.projectDir,
      dangerouslySkipPermissions: streaming
        ? this.mode === 'auto'
        : true,
      ...(streaming ? { interactive } : {}),
    });
    const safety = this.candidateSafetyFor(step);
    try {
      const result = await this.dispatchProviderWithLifecycleSupervision(
        step,
        invocationOptions,
        (options) =>
          this.providerExecutor({
            step,
            configuredProviders: this.configuredProviders,
            preferredProvider: this.config?.steps?.[step]?.llm_provider,
            runtimes,
            sessions,
            config: this.config,
            tier: state.complexity_tier,
            attempt: opts?.attempt ?? 1,
            runId: this.runId,
            escalate: opts?.escalate ?? true,
            modelOverride: opts?.modelOverride ?? this.modelOverride,
            effortOverride: opts?.effortOverride ?? this.effortOverride,
            taskAttribution: this.taskAttribution,
            withCandidateSafety: safety?.wrapper ?? this.withCandidateSafety,
            prepareCandidateSelfHost:
              this.providerExecutionContext?.prepareCandidateSelfHost ?? this.prepareCandidateSelfHost,
            onAttempt: this.providerAttempt,
            warn: this.providerWarn,
            options,
            ...(invocationKind === 'skill' && Object.prototype.hasOwnProperty.call(
              STEP_SKILL_INVOCATIONS,
              step,
            )
              ? {
                  optionsForCandidate: (candidateKey: string) => ({
                    ...options,
                    prompt: renderSkillInvocation(
                      STEP_SKILL_INVOCATIONS[step]!,
                      candidateKey,
                    ),
                  }),
                }
              : {}),
          }),
      );
      const verifiedResult = safety?.verify(result) ?? result;
      this.callCount++;
      if (!opts?.providerSessions) {
        await this.persistProviderAwareSuccess(verifiedResult);
      }
      return this.toStepRunResult(step, verifiedResult);
    } catch (error) {
      this.callCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`Session for ${step} exited with error: ${errorMessage}`);
      return { success: false, output: `Session for ${step} exited with error: ${errorMessage}` };
    }
  }

  private async executeProviderAwareOneShot(
    step: ProviderAwareFreeFormOneShotStep,
    options: ExecuteProviderCandidatesInput['options'],
    tier?: ComplexityTier,
    dispatch?: StepRunOptions,
  ): Promise<ProviderExecutionResult | undefined> {
    return this.executeProviderAwareOneShotCore({
      kind: 'free-form',
      step,
      options,
      tier,
      dispatch,
    });
  }

  private async executeProviderAwareSkillOneShot(
    step: ProviderAwareSkillOneShotStep,
    options: ExecuteProviderCandidatesInput['options'],
    tier?: ComplexityTier,
    dispatch?: StepRunOptions,
  ): Promise<ProviderExecutionResult | undefined> {
    return this.executeProviderAwareOneShotCore({
      kind: 'skill',
      step,
      options,
      tier,
      dispatch,
    });
  }

  private async executeProviderAwareOneShotCore(
    request: ProviderAwareOneShotRequest,
  ): Promise<ProviderExecutionResult | undefined> {
    if (!this.providerRuntimes || !this.sessionStore) return undefined;

    const safety = this.candidateSafetyFor(request.step);
    const invocationOptions = this.withFeatureDiagnosticLog(request.options);
    const result = await this.dispatchProviderWithLifecycleSupervision(
      request.step,
      invocationOptions,
      (options) =>
        this.providerExecutor({
          step: request.step,
          configuredProviders: this.configuredProviders,
          preferredProvider: this.config?.steps?.[request.step]?.llm_provider,
          runtimes: this.providerRuntimes!,
          sessions: this.sessionStore!.beginBranch(request.step),
          config: this.config,
          tier: request.tier,
          attempt: request.dispatch?.attempt ?? 1,
          runId: this.runId,
          escalate: request.dispatch?.escalate ?? true,
          modelOverride: request.dispatch?.modelOverride ?? this.modelOverride,
          effortOverride: request.dispatch?.effortOverride ?? this.effortOverride,
          taskAttribution: this.taskAttribution,
          withCandidateSafety: safety?.wrapper ?? this.withCandidateSafety,
          prepareCandidateSelfHost:
            this.providerExecutionContext?.prepareCandidateSelfHost ?? this.prepareCandidateSelfHost,
          onAttempt: this.providerAttempt,
          warn: this.providerWarn,
          options,
          ...(request.kind === 'skill'
            ? {
                optionsForCandidate: (candidateKey: string) => ({
                  ...options,
                  prompt: renderSkillInvocation(
                    STEP_SKILL_INVOCATIONS[request.step]!,
                    candidateKey,
                  ),
                }),
              }
            : {}),
        }),
    );
    return safety?.verify(result) ?? result;
  }

  /**
   * Starts the one provider-neutral preparation supervisor before candidate
   * resolution and carries its synchronous permit through the shared candidate
   * executor. Heartbeat pulses remain observational telemetry only.
   */
  private async dispatchProviderWithLifecycleSupervision(
    step: StepName,
    baseOptions: ExecuteProviderCandidatesInput['options'],
    run: (
      options: ExecuteProviderCandidatesInput['options'],
    ) => Promise<ProviderExecutionResult>,
  ): Promise<ProviderExecutionResult> {
    const pulse = createHeartbeatPulse(this.projectDir, step);
    const nextAttempt = () => ({
      logicalStep: step,
      id: `${this.runId}:${step}:${++this.providerLifecycleAttempt}`,
    });
    const supervisor = createProviderLifecycleSupervisor({
      attempt: nextAttempt(),
      recoveryCount: 0,
      preparationTimeoutMinutes: resolveProviderPreparationTimeoutMinutes(this.config),
      timer: this.providerLifecycleTimer,
      onLifecycleEvent: (event) => {
        void this.providerAttempt?.(event.step, event);
      },
      recovery: {
        projectRoot: this.projectDir,
        episodeStore: this.providerLifecycleEpisodeStore,
        createReplacementAttempt: () => nextAttempt(),
      },
    });
    const result = await supervisor.supervise((lease) =>
      run({
        ...baseOptions,
        onActivity: pulse,
        spawnPermit: lease.spawnPermit,
      }),
    );
    if (isProviderLifecycleHalted(result)) {
      return {
        success: false,
        output: 'Provider preparation timed out twice. See .pipeline/HALT.',
        exitCode: 1,
        preferredProvider: this.configuredProviders[0] ?? 'unknown',
        attempts: [],
      };
    }
    return result;
  }

  private withFeatureDiagnosticLog(
    options: ExecuteProviderCandidatesInput['options'],
  ): ExecuteProviderCandidatesInput['options'] {
    const diagnosticLog = this.providerExecutionContext?.diagnosticLog;
    return diagnosticLog ? { ...options, diagnosticLog } : options;
  }

  /**
   * BUILD/SHIP accepts an executor result only after the Task 14 boundary has
   * actually run. This catches injected executors that silently omit the
   * callback contract while returning a plausible success result.
   */
  private candidateSafetyFor(step: StepName): {
    wrapper: WithCandidateSafety;
    verify: (result: ProviderExecutionResult) => ProviderExecutionResult;
  } | undefined {
    const boundary = this.providerExecutionContext?.withCandidateSafety ?? this.withCandidateSafety;
    if (!boundary || !['BUILD', 'SHIP'].includes(phaseForStep(step))) {
      return undefined;
    }
    let entered = false;
    return {
      wrapper: async (candidate, invoke) => {
        entered = true;
        return boundary(candidate, invoke);
      },
      verify: (result) => {
        if (entered || !result.success) return result;
        return {
          ...result,
          success: false,
          permissionDenied: true,
          output: 'Safety wrapper was not entered for this BUILD/SHIP provider attempt.',
        };
      },
    };
  }

  private providerAttribution(result: ProviderExecutionResult) {
    return {
      preferredProvider: result.preferredProvider,
      ...(result.actualProvider
        ? { actualProvider: result.actualProvider }
        : {}),
      attempts: result.attempts,
      ...(result.authentication
        ? { authentication: result.authentication }
        : {}),
      ...(result.observedIntervals
        ? { observedIntervals: result.observedIntervals }
        : {}),
    };
  }

  private streamingProviderRuntimes(
    runtimes: ProviderRuntimeSet,
  ): ProviderRuntimeSet {
    return new ProviderRuntimeSet(
      runtimes.keys().map((key): ProviderRuntime => {
        const runtime = runtimes.get(key);
        return {
          key: runtime.key,
          policy: runtime.policy,
          builtIn: runtime.builtIn,
          lifecycleCapability: runtime.lifecycleCapability,
          availability: runtime.availability,
          get runWideUnavailable() {
            return runtime.runWideUnavailable;
          },
          set runWideUnavailable(value) {
            runtime.runWideUnavailable = value;
          },
          provider: {
            supportsSessionResume: runtime.provider.supportsSessionResume,
            lifecycleCapability: runtime.provider.lifecycleCapability,
            invoke: async (options) =>
              (await runtime.provider.invokeInteractive(options)) ?? {
                success: true,
                output: '',
                exitCode: 0,
              },
            invokeInteractive: (options) =>
              runtime.provider.invokeInteractive(options),
          },
        };
      }),
    );
  }

  private async persistProviderAwareSuccess(
    result: ProviderExecutionResult,
  ): Promise<void> {
    if (!result.success) return;

    this.sessionStarted = true;
    if (result.actualProvider) {
      const session = this.sessionStore?.current(result.actualProvider);
      if (session) this.sessionId = session.id;
    }
    if (this.pipelineDir) {
      await this.ensurePipelineDir();
      await writeFile(join(this.pipelineDir, 'session-created'), '1', 'utf-8');
      this.wasSessionMarkerFoundOnInit = true;
    }
  }

  private toStepRunResult(
    step: StepName,
    result: ProviderExecutionResult,
  ): StepRunResult {
    const publicationDisposition = step === 'finish' && result.success
      ? parseFinishPrProseJudgment(result.output)
      : undefined;
    return {
      success: result.success,
      ...(result.output ? { output: result.output } : {}),
      ...(publicationDisposition !== undefined ? { publicationDisposition } : {}),
      ...(result.authFailure ? { authFailure: true } : {}),
      ...(result.commandUnresolved
        ? {
            commandUnresolved: true,
            ...(result.commandUnresolvedName
              ? { commandUnresolvedName: result.commandUnresolvedName }
              : {}),
          }
        : {}),
      ...(result.permissionDenied ? { permissionDenied: true } : {}),
      ...(result.rateLimited
        ? {
            rateLimited: true,
            waitSeconds: result.waitSeconds ?? 300,
            ...(result.deadline !== undefined
              ? { deadline: result.deadline }
              : {}),
          }
        : {}),
      ...(result.sessionExpired ? { sessionExpired: true } : {}),
      ...(result.authentication
        ? { authentication: result.authentication }
        : {}),
      ...(result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}),
      ...(result.observedIntervals
        ? { observedIntervals: result.observedIntervals }
        : {}),
      ...(result.resolvedModel ? { model: result.resolvedModel } : {}),
      preferredProvider: result.preferredProvider,
      ...(result.actualProvider
        ? { actualProvider: result.actualProvider }
        : {}),
      attempts: result.attempts,
    };
  }

  private async runAutonomous(
    step: StepName,
    prompt: string,
    resume: boolean,
    systemPrompt: string,
    resolved: ResolvedStepConfig,
    branchSessionId?: string,
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

    // Concurrent-group branch dispatch: use the branch-local session id
    // when provided, and never mutate this.sessionId/this.sessionStarted —
    // those belong exclusively to the shared main conductor session.
    const dispatchSessionId = branchSessionId ?? this.sessionId;

    const result = await this.modelAvailability.invokeWithLadder(trackingProvider, {
      prompt,
      sessionId: dispatchSessionId,
      resume,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: effectiveModel,
      effort: resolved.effort,
      cwd: this.projectDir,
    }, async () => {
      const { v4: uuidv4 } = await import('uuid');
      return { sessionId: uuidv4(), resume: false };
    });
    this.callCount++;
    const observedIntervals = result.observedIntervals
      ? { observedIntervals: result.observedIntervals }
      : {};

    // Auth failure: operator's OAuth token is expired or invalid.
    // Report it — the conductor will halt and report the auth failure.
    if (result.authFailure) {
      return {
        success: false,
        output: result.output,
        authFailure: true,
        ...(result.authentication
          ? { authentication: result.authentication }
          : {}),
        ...observedIntervals,
      };
    }

    if (result.commandUnresolved) {
      return {
        success: false,
        output: result.output,
        commandUnresolved: true,
        ...(result.commandUnresolvedName
          ? { commandUnresolvedName: result.commandUnresolvedName }
          : {}),
        ...observedIntervals,
      };
    }

    if (result.permissionDenied) {
      return {
        success: false,
        output: result.output,
        permissionDenied: true,
        ...(result.authentication
          ? { authentication: result.authentication }
          : {}),
        ...observedIntervals,
      };
    }

    // Rate limit: surface wait seconds (from provider result, else fallback 300s).
    // Task 18: Also surface deadline-first deadline if parsed from message.
    if (result.rateLimited) {
      const waitSeconds = result.waitSeconds ?? 300;
      return {
        success: false,
        output: result.output,
        rateLimited: true,
        waitSeconds,
        deadline: result.deadline,
        ...(result.authentication
          ? { authentication: result.authentication }
          : {}),
        ...observedIntervals,
      };
    }

    // Stale session detected. Report it — the conductor will call resetSession()
    // and retry without burning the retry budget.
    if (result.sessionExpired) {
      return {
        success: false,
        output: result.output,
        sessionExpired: true,
        ...(result.authentication
          ? { authentication: result.authentication }
          : {}),
        ...observedIntervals,
      };
    }

    if (result.success) {
      // Branch dispatches (branchSessionId set) never touch the shared
      // main-conductor session state or its markers — see
      // adr-2026-07-10-concurrent-group-core.md.
      if (branchSessionId === undefined) {
        this.sessionStarted = true;
        if (this.pipelineDir) {
          await this.ensurePipelineDir();
          await writeFile(join(this.pipelineDir, 'session-created'), '1', 'utf-8');
          // After successful first marker write, we know a session has been established.
          // Mark that for future mid-run detection.
          this.wasSessionMarkerFoundOnInit = true;
        }
      }
      return {
        success: true,
        output: result.output,
        tokenUsage: result.tokenUsage,
        model: effectiveModel,
        ...(result.authentication
          ? { authentication: result.authentication }
          : {}),
        ...observedIntervals,
      };
    }

    // Full-ladder exhaustion: every attempted model reported unavailable.
    // Name them all in the output so the eventual HALT (if the conductor's
    // retry budget also exhausts) is diagnosable from daemon.log alone.
    if (result.modelUnavailable && attemptedModels.length > 1) {
      return {
        success: false,
        output: `${result.output} (model fallback ladder exhausted, tried: ${attemptedModels.join(', ')})`,
        model: effectiveModel,
        ...observedIntervals,
      };
    }

    return {
      success: false,
      output: result.output,
      model: effectiveModel,
      ...(result.authentication
        ? { authentication: result.authentication }
        : {}),
      ...observedIntervals,
    };
  }

  async resetSession(step?: StepName, providerKey = this.providerKey): Promise<void> {
    if (this.sessionStore && step !== undefined) {
      await this.sessionStore.beginStep(step);
      if (!this.providerRuntimes) {
        this.sessionId = (
          await this.sessionStore.prepare(this.providerKey)
        ).id;
      }
      this.sessionStarted = false;
      this.sessionStartedInitialized = true;
      return;
    }
    if (this.sessionStore) {
      this.sessionId = (await this.sessionStore.replace(providerKey)).id;
      this.sessionStarted = false;
      this.sessionStartedInitialized = true;
      return;
    }
    const { v4: uuidv4 } = await import('uuid');
    this.sessionId = uuidv4();
    this.sessionStarted = false;
    this.sessionStartedInitialized = true;
    if (this.pipelineDir) {
      await this.ensurePipelineDir();
      const { unlink } = await import('node:fs/promises');
      await unlink(join(this.pipelineDir, 'session-created')).catch(() => {
        // Marker didn't exist — nothing to clear.
      });
    }
  }

  async runInteractive(
    step: StepName,
    failureContext: { reason?: string },
  ): Promise<void> {
    await this.resetSession(step);
    const reason = failureContext.reason?.trim() || 'no reason captured';
    const prompt =
      `Fix issues from the failed ${step} step. ` +
      `Failure reason: ${reason}. Then exit when done.`;
    if (this.providerRuntimes && this.sessionStore) {
      await this.runProviderAwareNormal(
        step,
        {},
        undefined,
        prompt,
        '',
        true,
        true,
        'free-form',
      );
      return;
    }
    const resolved = this.resolvedConfigFor(step);
    await this.provider.invokeInteractive({
      prompt,
      sessionId: this.sessionId,
      resume: false,
      interactive: true,
      dangerouslySkipPermissions: false,
      model: resolved.model,
      effort: resolved.effort,
      cwd: this.projectDir,
    });
  }

  async assessComplexity(): Promise<
    ComplexityTier | ComplexityAssessment | null
  > {
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

    const providerResult = await this.executeProviderAwareSkillOneShot(
      'complexity',
      {
        prompt: '/conduct complexity',
        dangerouslySkipPermissions: true,
        systemPrompt,
        cwd: this.projectDir,
      },
    );
    if (providerResult) {
      const counts = parseSignalCountsFromOutput(providerResult.output);
      return {
        tier: providerResult.success
          ? scoreComplexityFromCounts(counts) ??
            parseTierFromOutput(providerResult.output)
          : null,
        ...this.providerAttribution(providerResult),
      };
    }

    const resolved = this.resolvedConfigFor('complexity');
    const { v4: uuidv4 } = await import('uuid');
    this.sessionId = uuidv4();
    // Walk the fallback ladder so a dead/out-of-credits configured model
    // (e.g. fable) degrades to the next available one instead of failing.
    const result = await this.modelAvailability.invokeWithLadder(this.provider, {
      prompt: '/conduct complexity',
      sessionId: this.sessionId,
      resume: false,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: this.modelAvailability.effectiveModel(resolved.model).model,
      effort: resolved.effort,
      cwd: this.projectDir,
    }, async () => ({ sessionId: uuidv4(), resume: false }));

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
      'Follow the canonical rebase skill workflow: validate the full replay against the ' +
      'captured source intent and upstream intent before continuing. At the first semantic ' +
      'ambiguity, HALT this attempt and return a false result with the missing decision; ' +
      'do not replace that workflow with a condensed procedure.\n' +
      'Your FINAL output line MUST be exactly one of:\n' +
      '{"resolved": true}\n' +
      '{"resolved": false, "reason": "<explanation>"}';

    const providerResult = await this.executeProviderAwareSkillOneShot(
      'rebase',
      {
        prompt: '/rebase',
        dangerouslySkipPermissions: true,
        systemPrompt,
        cwd: ctx.projectRoot,
      },
    );
    if (providerResult) {
      return {
        ...parseRebaseResolutionOutput(providerResult.output),
        ...this.providerAttribution(providerResult),
      };
    }

    const resolved = this.resolvedConfigFor('rebase');

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
    }, async () => ({ sessionId: uuidv4(), resume: false }));

    return parseRebaseResolutionOutput(result.output);
  }

  /**
   * Dispatch a fix-session to attempt to resolve a setup failure. Part of the
   * two-stage setup-failure triage (TS-3). Uses a fresh one-shot session
   * (never resumes the main conductor session) with the output tail in the
   * prompt so Claude can diagnose and fix the root cause.
   *
   * Always returns `{ attempted: true }` — the method's role is to bootstrap
   * the fix session. Whether the fix succeeds is determined by whether the
   * setup step subsequently passes, not by this method's return value.
   *
   * Runs with cwd set to the worktreePath so any cleanup/fix commands operate
   * in the right worktree context.
   */
  async resolveSetupFailure(ctx: SetupFailureContext): Promise<SetupFailureAttempt> {
    const systemPrompt =
      'You are attempting to fix a setup failure in a feature worktree.\n' +
      `Worktree path: ${ctx.worktreePath}\n` +
      `Feature slug: ${ctx.slug}\n\n` +
      'Diagnose the failure and attempt to fix the root cause (e.g., missing dependencies, ' +
      'version conflicts, environment issues). Use the current directory (the worktree) ' +
      'for any diagnostic or remediation commands.\n' +
      'Docker services are shared across worktrees. Do not stop, restart, or tear down Docker ' +
      'or any running containers. If required containers are not running, start them with ' +
      '`docker compose up -d --no-recreate`; leave containers that are already running untouched.\n' +
      'After making fixes, the setup step will be retried automatically.';

    const prompt =
      'The last output from the failed setup step was:\n' +
      '```\n' +
      `${ctx.outputTail}\n` +
      '```\n\n' +
      'Diagnose and fix the setup failure. Explain your diagnosis and the fixes you applied.';

    const providerResult = await this.executeProviderAwareOneShot('worktree', {
      prompt,
      dangerouslySkipPermissions: true,
      systemPrompt,
      cwd: ctx.worktreePath,
    });
    if (providerResult) {
      return {
        attempted: true,
        ...this.providerAttribution(providerResult),
      };
    }

    const resolved = this.resolvedConfigFor('worktree');

    // Use a fresh one-shot session — never contaminate the main conductor session.
    const { v4: uuidv4 } = await import('uuid');
    const sessionId = uuidv4();

    // Walk the fallback ladder so the setup-failure resolver is not blocked by
    // one model's unavailability.
    await this.modelAvailability.invokeWithLadder(this.provider, {
      prompt,
      sessionId,
      resume: false,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: this.modelAvailability.effectiveModel(resolved.model).model,
      effort: resolved.effort,
      cwd: ctx.worktreePath,
    }, async () => ({ sessionId: uuidv4(), resume: false }));

    // Always report attempted: true — the success of the fix is determined by
    // whether the setup step subsequently passes.
    return { attempted: true };
  }

  /**
   * Dispatch a fix-session to attempt to resolve a CI failure on a shipped PR
   * (ci-fix resolver autofix). Uses a fresh one-shot session (never resumes
   * the main conductor session) with the failure hint in the prompt so
   * Claude can diagnose and fix the root cause.
   *
   * Always returns `{ attempted: true }` — the method's role is to bootstrap
   * the fix session. Whether the fix succeeds is determined by whether CI
   * subsequently passes, not by this method's return value.
   *
   * Runs with cwd set to the worktreePath so any diagnostic/remediation
   * commands operate in the right worktree context.
   */
  async resolveCiFailure(ctx: CiFailureContext): Promise<CiFailureAttempt> {
    const systemPrompt =
      'You are attempting to fix a CI failure on a shipped pull request.\n' +
      `Worktree path: ${ctx.worktreePath}\n` +
      `Pull request: ${ctx.prUrl}\n` +
      `Feature slug: ${ctx.slug}\n\n` +
      'Diagnose the failure and attempt to fix the root cause. Use the current ' +
      'directory (the worktree) for any diagnostic or remediation commands.\n' +
      'After making fixes, commit and push so CI can be retried automatically.';

    const prompt =
      'The CI failure hint is:\n' +
      '```\n' +
      `${ctx.hint}\n` +
      '```\n\n' +
      'Diagnose and fix the CI failure. Explain your diagnosis and the fixes you applied.';

    const providerResult = await this.executeProviderAwareOneShot('build', {
      prompt,
      dangerouslySkipPermissions: true,
      systemPrompt,
      cwd: ctx.worktreePath,
    });
    if (providerResult) {
      return {
        attempted: true,
        ...this.providerAttribution(providerResult),
      };
    }

    const resolved = this.resolvedConfigFor('build');

    // Use a fresh one-shot session — never contaminate the main conductor session.
    const { v4: uuidv4 } = await import('uuid');
    const sessionId = uuidv4();

    // Walk the fallback ladder so the CI-failure resolver is not blocked by
    // one model's unavailability.
    await this.modelAvailability.invokeWithLadder(this.provider, {
      prompt,
      sessionId,
      resume: false,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: this.modelAvailability.effectiveModel(resolved.model).model,
      effort: resolved.effort,
      cwd: ctx.worktreePath,
    }, async () => ({ sessionId: uuidv4(), resume: false }));

    // Always report attempted: true — the success of the fix is determined by
    // whether CI subsequently passes.
    return { attempted: true };
  }

  /**
   * Dispatch a semantic attribution verifier session for spot-audit sampling.
   * Runs in a fresh, isolated one-shot session (never resumes the main conductor session).
   * Used by the conductor's build-gate post-green dispatch (Task 15).
   *
   * The verifier collects candidate commits, samples residue tasks, and produces
   * an attribution verdict saved to `.pipeline/attribution-verdict.json`.
   *
   * Follows the same one-shot pattern as resolveSetupFailure: fresh uuid,
   * `resume: false`, walked through the model fallback ladder.
   */
  async dispatchVerifier(opts: {
    residueIds: string[];
    planPath: string;
    projectRoot: string;
  }): Promise<VerifierDispatchResult> {
    const { dispatchAttributionVerifier } = await import('./attribution-lane.js');

    try {
      return await dispatchAttributionVerifier({
        provider: this.provider,
        projectDir: opts.projectRoot,
        planPath: opts.planPath,
        residueIds: opts.residueIds,
        featureWorktreePath: opts.projectRoot,
        config: this.config,
        modelPolicy: this.modelPolicy,
        ...(this.providerRuntimes && this.sessionStore
          ? {
              providerDispatch: async (options) => {
                const result = await this.executeProviderAwareOneShot(
                  'attribution_verify',
                  options,
                );
                if (!result) {
                  throw new Error(
                    'Provider-aware attribution dispatch requires runtimes and a session store',
                  );
                }
                return result;
              },
            }
          : {}),
      });
    } catch (err) {
      return {
        success: false,
        output: String(err),
      };
    }
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
  private async runRubricBuildReview(
    inputs: BuildReviewFrozenInputs,
    config: ReturnType<typeof resolveBuildReviewConfig>,
  ): Promise<StepRunResult> {
    const lapId = parseBuildReviewLapId(`lap-${inputs.sourceSnapshot.headSha}`);
    if (!lapId) return { success: false, output: 'build_review could not create a valid rubric lap identity' };

    const coordination = await coordinateBuildReviewRubrics({
      config,
      inputs,
      lapId,
      preflight: async () => this.runTautologyPreflight(inputs),
      readCache: async (branch) => readBuildReviewCacheEntry(this.projectDir, branch.rubric, {
        readFile: async (path) => readFile(path, 'utf-8'),
        mkdir: async (path) => { await mkdir(path, { recursive: true }); },
        writeFile,
        rename,
      }),
      dispatchModel: async (branch, projection) => this.dispatchBuildReviewRubric(branch, projection),
      writeArtifact: async (artifact) => writeBuildReviewBranchArtifact(this.projectDir, artifact, {
        readFile: async (path) => readFile(path, 'utf-8'),
        mkdir: async (path) => { await mkdir(path, { recursive: true }); },
        writeFile,
        rename,
      }),
      writeCache: async (entry) => writeBuildReviewCacheEntry(this.projectDir, entry, {
        readFile: async (path) => readFile(path, 'utf-8'),
        mkdir: async (path) => { await mkdir(path, { recursive: true }); },
        writeFile,
        rename,
      }),
      emit: async (event) => { await this.events?.emit(event); },
    });

    if (coordination.kind === 'gate-disabled') {
      return { success: true, output: 'build_review disabled' };
    }
    if (coordination.kind === 'refused') {
      return { success: false, output: `build_review refused: ${coordination.reason}` };
    }

    const writeFailure = coordination.branches.find((branch): branch is Extract<typeof branch, { kind: 'infrastructure-failure' }> =>
      branch.kind === 'infrastructure-failure' && /(?:artifact|cache)-write-failed/.test(branch.reason),
    );
    if (writeFailure) {
      return { success: false, output: `build_review evidence write failed for ${writeFailure.rubric}: ${writeFailure.reason}` };
    }

    const results = Object.fromEntries(await Promise.all(coordination.branches.map(async (branch) => {
      if (branch.kind === 'cache-hit' || branch.kind === 'dispatched') {
        const artifact = await readBuildReviewBranchArtifact(
          this.projectDir,
          branch.rubric,
          lapId,
          inputs.sourceSnapshot.digest,
          {
            readFile: async (path) => readFile(path, 'utf-8'),
            mkdir: async (path) => { await mkdir(path, { recursive: true }); },
            writeFile,
            rename,
          },
        );
        return [branch.rubric, artifact?.result ?? {
          kind: 'infrastructure-failure' as const,
          rubric: branch.rubric,
          reason: 'artifact-read-failed' as const,
          detail: 'missing or invalid current-lap branch artifact',
        }];
      }
      return [branch.rubric, branch.kind === 'skipped'
        ? branch
        : {
            kind: 'infrastructure-failure' as const,
            rubric: branch.rubric,
            reason: 'provider-error' as const,
            detail: branch.reason,
          }];
    }))) as Record<BuildReviewRubricResult['rubric'], BuildReviewRubricResult>;
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId,
      snapshotDigest: inputs.sourceSnapshot.digest,
      results,
    });
    const effectivePipelineDir = this.pipelineDir ?? join(this.projectDir, '.pipeline');
    await mkdir(effectivePipelineDir, { recursive: true });
    await writeFile(join(effectivePipelineDir, 'build-review.json'), JSON.stringify(aggregate, null, 2), 'utf-8');
    await this.events?.emit({
      type: 'build_review_outer_verdict',
      lapId,
      rawVerdict: aggregate.verdict,
      effectiveVerdict: aggregate.verdict,
    });
    if (aggregate.verdict === 'PASS') await this.stampBuildReviewVerdict();
    return { success: aggregate.verdict === 'PASS', output: JSON.stringify(aggregate) };
  }

  private async dispatchBuildReviewRubric(
    branch: BuildReviewDispatchableRubric,
    projection: BuildReviewRubricProjection,
  ): Promise<unknown> {
    const label: Record<BuildReviewDispatchableRubric['rubric'], string> = {
      tautology: 'Tautology', scope: 'Scope', rootCause: 'Root Cause', completeness: 'Completeness', wiring: 'Wiring',
    };
    const rubricPrompt = [
        `Build Review ${label[branch.rubric]} rubric.`,
        `Use only this closed projection and return one JSON judged result for rubric ${branch.rubric}.`,
        JSON.stringify(projection),
      ].join('\n\n');
    if (this.providerRuntimes && this.sessionStore) {
      const safety = this.candidateSafetyFor('build_review');
      const result = await this.dispatchProviderWithLifecycleSupervision(
        'build_review',
        this.withFeatureDiagnosticLog({
          prompt: rubricPrompt,
          cwd: this.projectDir,
          dangerouslySkipPermissions: true,
        }),
        (options) => executeAuxiliaryProviderCandidates({
          step: 'build_review',
          memberId: branch.rubric,
          policy: branch.policy,
          runtimes: this.providerRuntimes!,
          sessions: this.sessionStore!.beginBranch(`build-review:${branch.rubric}`),
          config: this.config,
          runId: this.runId,
          taskAttribution: this.taskAttribution,
          withCandidateSafety: safety?.wrapper ?? this.withCandidateSafety,
          prepareCandidateSelfHost:
            this.providerExecutionContext?.prepareCandidateSelfHost ?? this.prepareCandidateSelfHost,
          onAttempt: this.providerAttempt,
          warn: this.providerWarn,
          options,
          optionsForCandidate: (providerKey) => ({
            ...options,
            prompt: `${renderAuxiliarySkillInvocation(branch.skillName, providerKey)}\n\n${rubricPrompt}`,
          }),
        }),
      );
      const verified = safety?.verify(result) ?? result;
      this.callCount++;
      if (!verified.success || typeof verified.output !== 'string') return undefined;
      try {
        return parseBuildReviewJudgedResult(JSON.parse(verified.output));
      } catch {
        return undefined;
      }
    }
    const result = await this.provider.invoke({
      prompt: `${renderAuxiliarySkillInvocation(branch.skillName, this.providerKey)}\n\n${rubricPrompt}`,
      sessionId: randomUUID(),
      resume: false,
      dangerouslySkipPermissions: true,
      cwd: this.projectDir,
      model: branch.policy.model,
      effort: branch.policy.effort,
    });
    this.callCount++;
    if (!result.success || typeof result.output !== 'string') return undefined;
    try {
      return parseBuildReviewJudgedResult(JSON.parse(result.output));
    } catch {
      return undefined;
    }
  }

  private async runTautologyPreflight(inputs: BuildReviewFrozenInputs) {
    const paths = [...inputs.diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map((match) => match[2]!);
    const classified = classifyTautologyPaths(paths);
    // There is no empty selector fallback: a rubric still receives an
    // explicit, engine-authored exception projection and decides whether the
    // absence of changed tests is a concern.
    if (classified.tests.length === 0) {
      return {
        classification: 'approved-exception' as const,
        exception: 'empty-test-set' as const,
        cacheable: true as const,
        cacheProvenance: 'miss' as const,
        changedPaths: paths,
        changedTestSelectors: [],
        revertedProductionPatch: [],
        sourceIdentities: { mergeBase: inputs.sourceSnapshot.mergeBase, headSha: inputs.sourceSnapshot.headSha },
        output: { stdout: '', stderr: '' },
      };
    }
    return materializeTautologyPreflight({
      scopedWorkingDirectory: this.projectDir,
      mergeBase: inputs.sourceSnapshot.mergeBase,
      headSha: inputs.sourceSnapshot.headSha,
      diff: inputs.diff,
      createCheckout: async (path, headSha) => {
        const result = await this.gitRunner(['worktree', 'add', '--detach', path, headSha]);
        if (result.exitCode !== 0) throw new Error(result.stderr);
      },
      readMergeBaseFile: async (path) => {
        const result = await this.gitRunner(['show', `${inputs.sourceSnapshot.mergeBase}:${path}`]);
        return result.exitCode === 0 ? result.stdout : undefined;
      },
      writeFile,
      runScoped: async (cwd, selectors, signal) => this.runScopedTautologyCommand(cwd, selectors, signal),
      removeCheckout: async (path) => {
        await this.gitRunner(['worktree', 'remove', '--force', path]);
      },
    });
  }

  private async runScopedTautologyCommand(cwd: string, selectors: readonly string[], signal: AbortSignal): Promise<TautologyScopedRunResult> {
    const template = this.config?.test_suite?.scoped_command;
    if (!template || selectors.length === 0) return { kind: 'launch-error' as const, stdout: '', stderr: '' };
    const command = template.replace('{selectors}', selectors.map((selector) => JSON.stringify(selector)).join(' '));
    return new Promise<TautologyScopedRunResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const child = spawn('sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      const finish = (value: TautologyScopedRunResult) => {
        if (!settled) { settled = true; resolve(value); }
      };
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.once('error', () => finish({ kind: 'launch-error', stdout, stderr }));
      child.once('close', (code, receivedSignal) => {
        if (receivedSignal) finish({ kind: 'signal', signal: receivedSignal, stdout, stderr });
        else finish({ exitCode: code ?? 1, stdout, stderr });
      });
      signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
    });
  }

  private async runBuildReview(): Promise<StepRunResult> {
    // Resolve the plan for THIS feature — never the unscoped `.docs/plans/*.md`
    // sort()[last] guess (#407): with several features in flight the shared plans
    // directory holds many files, and picking the alphabetically-last one graded
    // the diff against an entirely unrelated feature's plan, so build_review FAILed
    // on a spurious scope/completeness mismatch while the build step (which uses
    // resolveFeaturePlanPath) built the correct feature. Mirror the build step:
    // prefer the caller's override, else the slug-scoped resolver, which fails
    // closed on ambiguity rather than grading someone else's plan.
    let planPath = this.planPathOverride;
    if (!planPath) {
      planPath = await resolveFeaturePlanPath(this.projectDir, this.featureDesc || undefined);
    }
    if (!planPath) {
      const planFiles = await findArtifactFiles(this.projectDir, 'plan');
      const detail =
        planFiles.length === 0
          ? 'no .docs/plans/*.md present'
          : `could not scope this feature's plan among ${planFiles.length} in .docs/plans/ ` +
            `(feature_desc="${this.featureDesc}")`;
      return {
        success: false,
        output: `${detail} — build_review has no plan to grade the diff against`,
      };
    }

    const buildReviewConfig = resolveBuildReviewConfig(this.config, this.modelPolicy, {
      modelCliOverride: this.modelOverride,
      effortCliOverride: this.effortOverride,
    });
    let containmentReport: ContainmentFloorReport | undefined;
    if (buildReviewConfig.perTaskFloor) {
      try {
        containmentReport = await runContainmentFloor({
          projectRoot: this.projectDir,
          planPath,
        });
      } catch {
        // Fail-soft: containment telemetry must never fail build_review.
      }
    }

    let inputs;
    try {
      inputs = {
        ...await assembleBuildReviewInputs(this.gitRunner, planPath, this.buildReviewInputOptions),
        acceptedWidenings: containmentReport?.acceptedWidenings ?? [],
      };
    } catch (err) {
      return {
        success: false,
        output: `build_review input assembly failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Task 4: base-freshness telemetry. Guarded so a malformed/missing field
    // on `inputs` can never throw and never block/fail the build_review
    // step — this is pure fire-and-forget telemetry the conductor turns into
    // a `build_review_base` event after this runner returns.
    let baseFreshness: StepRunResult['baseFreshness'];
    let repairProvenance: StepRunResult['repairProvenance'];
    try {
      baseFreshness = {
        mergeBase: inputs.mergeBase,
        trackingRefSha: inputs.trackingRefSha,
        remoteHeadSha: inputs.remoteHeadSha,
        fresh: inputs.fresh,
      };
      // Task 24: grading provenance rides the same fire-and-forget telemetry
      // path — the conductor emits `build_review_repair_context` from it.
      repairProvenance = inputs.repairProvenance;
    } catch {
      baseFreshness = undefined;
      repairProvenance = undefined;
    }
    const withBaseFreshness = (r: StepRunResult): StepRunResult => {
      const withFreshness = baseFreshness ? { ...r, baseFreshness } : r;
      return repairProvenance ? { ...withFreshness, repairProvenance } : withFreshness;
    };

    // Per-task "work happened at all" floor (#781): purely additive,
    // non-blocking telemetry computed alongside the grader dispatch. It
    // NEVER feeds buildGraderPrompt/inputs, never changes `success`, and
    // never triggers a kickback — it only prepends advisory lines to this
    // step's own `output` and writes a sidecar artifact for observability.
    // Guarded end-to-end: runPerTaskCommitFloor is already fail-soft
    // internally, but the try/catch here ensures literally nothing from this
    // telemetry path can throw and fail the build_review step.
    let floorAdvisoryLines: string[] = [];
    if (buildReviewConfig.perTaskFloor) {
      try {
        // Fall back to the relative `.pipeline` dir when this.pipelineDir is
        // unset (mirrors the finish-record fallback above): the daemon always
        // passes the worktree's absolute pipelineDir, but callers that don't
        // (e.g. direct/test invocation) still get a usable artifact path.
        const effectivePipelineDir = this.pipelineDir ?? join(this.projectDir, '.pipeline');
        const floorReport = await runPerTaskCommitFloor({
          projectRoot: this.projectDir,
          planPath,
          taskStatusPath: join(effectivePipelineDir, 'task-status.json'),
        });
        if (this.pipelineDir) {
          await this.ensurePipelineDir();
        } else {
          await mkdir(effectivePipelineDir, { recursive: true });
        }
        await writeFile(
          join(effectivePipelineDir, 'per-task-floor.json'),
          JSON.stringify(floorReport, null, 2),
          'utf-8',
        );
        containmentReport ??= await runContainmentFloor({
          projectRoot: this.projectDir,
          planPath,
        });
        await writeFile(
          join(effectivePipelineDir, 'containment-floor.json'),
          JSON.stringify(containmentReport, null, 2),
          'utf-8',
        );
        floorAdvisoryLines = [
          ...renderPerTaskFloorReport(floorReport),
          ...renderContainmentFloorReport(containmentReport),
        ];
        if (floorAdvisoryLines.length > 0) {
          for (const line of floorAdvisoryLines) {
            this.log(`WARNING: ${line}`);
          }
        }
      } catch {
        // Fail-soft: telemetry must never fail the build_review step.
      }
    }

    // A declared replication is mechanically verified at the build_review
    // gate. Unlike the advisory floors above, a mismatch is a blocking gate
    // result and is never used to derive RED evidence.
    const planSource = await resolvePlanPatternSource(
      relative(this.projectDir, planPath).replaceAll('\\', '/'),
      await readFile(planPath, 'utf-8'),
      async (path) => {
        try {
          await access(join(this.projectDir, path));
          return true;
        } catch {
          return false;
        }
      },
    );
    if (planSource.kind === 'malformed') {
      return withBaseFreshness({
        success: false,
        output: planSource.message,
      });
    }
    if (planSource.kind === 'resolved') {
      const targetPath = planSource.renameMap.reduce(
        (path, pair) => path.replaceAll(pair.source, pair.target),
        planSource.sourcePath,
      );
      const equivalence = await runCopyEquivalence(
        planSource,
        targetPath,
        async (path) => readFile(join(this.projectDir, path), 'utf-8'),
      );
      if (!equivalence.success) return withBaseFreshness(equivalence);
    }

    // The deterministic floor and declared-copy checks deliberately precede
    // this dispatch: they are gate-owned preconditions, and must remain
    // observable even when configuration activates the rubric fan-out.
    // An explicit whole-gate opt-out is the only route that avoids the
    // coordinator. The resolved config defaults an absent raw block to
    // enabled, so raw config shape can never select the retired scalar grader.
    if (!buildReviewConfig.enabled) {
      return withBaseFreshness({ success: true, output: 'build_review disabled' });
    }

    // The lifecycle still exposes one public build_review step. Its
    // coordinator owns the bounded auxiliary fan-out and receives the one
    // frozen snapshot. The injectable coordinator remains a narrow test seam.
    const withFloorAdvisory = (result: StepRunResult): StepRunResult => ({
      ...result,
      ...(typeof result.output === 'string' && floorAdvisoryLines.length > 0
        ? { output: `${floorAdvisoryLines.join('\n')}\n\n${result.output}` }
        : {}),
    });
    if (this.buildReviewCoordinator) {
      return withBaseFreshness(withFloorAdvisory(
        await this.buildReviewCoordinator(inputs, buildReviewConfig),
      ));
    }

    return withBaseFreshness(withFloorAdvisory(
      await this.runRubricBuildReview(inputs, buildReviewConfig),
    ));
  }

  private async stampBuildReviewVerdict(): Promise<void> {
    if (!resolveGateCodeValidityConfig(this.config).enabled) {
      // gate_code_validity disabled: restore pre-feature behavior exactly —
      // no read-back, no codeStamp field, no git-diff calls.
      return;
    }
    const verdictPath = join(this.projectDir, BUILD_REVIEW_VERDICT);
    let parsed: unknown;
    try {
      const raw = await readFile(verdictPath, 'utf-8');
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return;
    }
    const codeStamp = await currentCommitSha(this.projectDir).catch(() => null);
    const stamped = { ...(parsed as Record<string, unknown>), codeStamp };
    try {
      await writeFile(verdictPath, JSON.stringify(stamped, null, 2), 'utf-8');
    } catch {
      // Best-effort augmentation only — never fail the step over a write error.
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the .pipeline directory exists before marker writes.
   * Handles mid-run wipes gracefully: if the directory was deleted, it will be
   * recreated (and a WARNING is logged for observability). Other errors (EACCES, etc.)
   * are rethrown.
   *
   * Mid-run detection: Use wasSessionMarkerFoundOnInit, which is set at the first
   * lazy-init check (line ~355). If that check found the session-created marker,
   * wasSessionMarkerFoundOnInit = true, indicating a prior session. On subsequent
   * runs, if the directory is missing, it's a mid-run wipe and we warn.
   *
   * If the directory already exists, this is a no-op.
   */
  private async ensurePipelineDir(): Promise<void> {
    if (!this.pipelineDir) return;

    // Check if directory exists BEFORE trying to create it.
    // This allows us to detect a mid-run wipe vs. first-provision.
    const dirExists = await this.fileExists(this.pipelineDir);

    // If directory is absent AND we found a session-created marker on the initial check,
    // then this is a mid-run wipe. Warn with greppable text.
    // If wasSessionMarkerFoundOnInit is false, we're in first-provision (no prior session).
    if (!dirExists && this.wasSessionMarkerFoundOnInit) {
      this.log(
        'WARNING: .pipeline root was missing mid-run and had to be recreated ' +
        '(the directory was likely deleted by concurrent cleanup or an unscoped deleter)',
      );
    }

    // Create the directory with recursive flag. Since we already checked existence,
    // this handles both the missing case (creates it) and the present case (no-op).
    try {
      await mkdir(this.pipelineDir, { recursive: true });
      const runIdPath = join(this.pipelineDir, 'conduct-session-id');
      if (!(await this.fileExists(runIdPath))) {
        await writeFile(runIdPath, this.runId, 'utf-8');
      }
    } catch (error) {
      // Only allow ENOENT to pass through silently (recursive mkdir shouldn't throw it,
      // but if it does, the directory wasn't creatable anyway). Re-throw any other errors
      // (EACCES, EPERM, etc.) because those are real failures we must surface.
      if (error instanceof Error && 'code' in error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          // Silently allow — the directory still couldn't be created, but we already warned
          return;
        }
      }
      // Non-ENOENT errors must not be swallowed (fail-closed gate).
      throw error;
    }
  }

  private async buildSystemPrompt(
    step: StepName,
    autonomous: boolean,
    retryReason?: string,
    finishProsePass?: 'author' | 'judge',
  ): Promise<string> {
    const stepDef = this.stepRegistry.find((candidate) => candidate.name === step)
      ?? getStepDefinition(step);
    // Out-of-band steps (e.g. `remediate`) have no position in the linear
    // sequence, so present them by label instead of an "N/total" index rather
    // than throwing "Unknown step".
    const registryIdx = this.stepRegistry.findIndex((candidate) => candidate.name === step);
    const stepIdx = registryIdx >= 0 ? registryIdx : tryGetStepIndex(step);
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

    // Task 14: Include quarantine context if a .pipeline/QUARANTINE sentinel exists.
    // This surfaces the quarantine ref and preserved paths to the resuming build dispatch.
    if (step === 'build' && this.pipelineDir) {
      const quarantineContent = await this.readQuarantineSentinel();
      if (quarantineContent) {
        prompt += `\n\n--- SETUP QUARANTINE CONTEXT ---\n${quarantineContent}\n--- END QUARANTINE CONTEXT ---`;
      }
    }

    // The engine observed the retained PR's body as still unauthored (its own
    // body-floor marker / "not yet authored" sections). Authoring reader-facing
    // prose needs a provider; deciding that it must happen does not — the
    // coordinator selected this pass deterministically. The judgment pass is
    // never asked to author, and this pass is never asked to grade.
    if (step === 'finish' && finishProsePass === 'author') {
      prompt +=
        '\n\nFINISH PR PROSE AUTHORING — the retained pull request still carries the engine-seeded ' +
        'placeholder body, so there is no prose to judge yet. Write it. Read the full diff of this ' +
        'feature branch against its base branch, plus the feature specification, plan, and story ' +
        'artifacts, then rewrite the retained PR title and body in place following this repository\'s ' +
        'PR authoring contract — the `pr` skill (Claude Code invokes it as `/pr`; Codex invokes it as ' +
        '`$pr`). Keep the template section shape (`## Why`, `## What Changed`, `## Testing`, and the ' +
        '`Closes` reference), replace every "not yet authored" marker and the body-floor marker with ' +
        'specific reader-facing content, and preserve any release metadata already present. Change ' +
        'nothing else: do not create, push, merge, or ready a pull request, do not alter labels, ' +
        'shipment evidence, or completion files, and do not commit. The publication coordinator ' +
        're-reads the pull request afterwards and judges the prose in a separate pass; it owns every ' +
        'mechanical transition and records the final outcome.';
      if (retryReason) prompt = `RETRY: ${retryReason}\n${prompt}`;
      return prompt;
    }

    // FINISH publication mechanics are engine-owned. The provider crosses this
    // boundary only for one reader-facing PR-prose judgment and may repair
    // only that retained PR's title/body; it must never create/push/merge/ready
    // a PR or write completion state itself.
    if (step === 'finish' && this.mode === 'auto') {
      prompt +=
        '\n\nUNATTENDED FINISH JUDGMENT — inspect only the retained PR title and body for reader-facing quality. ' +
        'You may repair only that title/body, at most once, then return exactly one JSON object: ' +
        '{"kind":"accepted"}, {"kind":"revision_required","reason":"placeholder|halt|structurally_incomplete"}, ' +
        '{"kind":"timed_out"}, {"kind":"provider_unavailable"}, or {"kind":"refused"}. ' +
        'Do not create, push, merge, or ready a PR; do not alter labels, shipment evidence, or completion files. ' +
        'If the body is unauthored placeholder text, return revision_required with reason placeholder and stop: ' +
        'the coordinator owns a separate authoring pass for that, so you are never asked to write prose here. ' +
        'The publication coordinator owns every other mechanical transition and records the final outcome.';
    }

    // Interactive/default Finish preserves operator authority. The coordinator
    // consumes the resulting intent and owns all mechanics.
    if (step === 'finish' && this.mode !== 'auto') {
      prompt +=
        '\n\nINTERACTIVE FINISH — gather the operator publication intent (PR or keep) and, when a PR is present, ' +
        'inspect only its title/body quality. For the bounded prose judgment you may repair only that retained PR title/body once, ' +
        'then return exactly one JSON object using accepted, revision_required (placeholder|halt|structurally_incomplete), timed_out, ' +
        'provider_unavailable, or refused. If the body is unauthored placeholder text, return revision_required with ' +
        'reason placeholder and stop — the coordinator owns a separate authoring pass for that. Do not create, push, ' +
        'merge, or ready a PR; do not alter labels, shipment evidence, ' +
        'or completion files; the publication coordinator performs every other authorized transition.';
    }

    if (retryReason) {
      prompt = `RETRY: ${retryReason}\n${prompt}`;
    }

    return prompt;
  }

  /**
   * Read the `.pipeline/QUARANTINE` sentinel if it exists.
   * Returns the content of the sentinel, or null if it doesn't exist or can't be read.
   * If the sentinel exists but the ref has been deleted, includes a notice about the missing ref.
   */
  private async readQuarantineSentinel(): Promise<string | null> {
    if (!this.pipelineDir) return null;

    try {
      const sentinelPath = join(this.pipelineDir, 'QUARANTINE');
      const content = await readFile(sentinelPath, 'utf-8');

      // Check if the quarantine ref mentioned in the sentinel still exists.
      // If not, add a notice that it's missing.
      const refMatch = content.match(/Quarantine ref: ([\w\/\-]+)/);
      if (refMatch) {
        const ref = refMatch[1];
        try {
          const git = makeGitRunner(this.projectDir);
          const result = await git(['rev-parse', '--verify', ref]);
          if (result.exitCode !== 0) {
            // Ref was deleted externally
            return `${content}\n\nNOTE: Quarantine ref ${ref} is no longer present in the repository (may have been deleted externally). Dispatch proceeds; the preserved paths may still be reviewed via reflog.`;
          }
        } catch {
          // Git check failed, but return content anyway (best-effort)
        }
      }

      return content;
    } catch {
      // Sentinel doesn't exist or can't be read — return null (not an error)
      return null;
    }
  }
}
