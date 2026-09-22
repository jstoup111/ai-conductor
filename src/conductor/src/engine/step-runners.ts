import { writeFile, access, readFile, readdir, mkdir, rename, rm, symlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { basename, dirname, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { execa } from 'execa';
import { fileURLToPath } from 'node:url';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
  ProviderStreamCandidateObserver,
  ProviderStreamObservation,
} from '../execution/llm-provider.js';
import { ModelAvailability } from './model-availability.js';
import { redactSafetyText } from './safety-diagnostics.js';
import type { WorktreeLifecycleQueue } from './worktree.js';
import type { StepName, ConductState, ComplexityTier, ExecutionContext, RunMode } from '../types/index.js';
import { admitBuildReviewCustomSourceRegions } from './build-review-source-region-admission.js';
import { BuildReviewScopeSource } from './build-review-scope-source.js';
import type { HarnessConfig, EffortLevel, BuildReviewRubricId } from '../types/config.js';
import { prdAuditScopeProjection } from './conductor.js';
import type {
  ComplexityAssessment,
  StepRunner,
  StepRunResult,
  StepRunOptions,
} from './conductor.js';
import { listCommitsWithTrailers } from './autoheal.js';
import { readOperatorReseals } from './protected-artifact-seal.js';
import { parseScopeTrailers } from './scope-trailer.js';
import { ALL_STEPS, buildStepRegistry, getStepDefinition, tryGetStepIndex } from './steps.js';
import {
  resolveStepConfig,
  resolveCoverageBindingConfig,
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
import type { CiRepairDiagnosticReason } from '../types/events.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import {
  resolveFeaturePlanPath,
  selectFeaturePlan,
  BUILD_REVIEW_VERDICT,
} from './artifacts.js';
import {
  parseJudgeBatchPayload,
  readCoverageBindingEnvelope,
  writeCoverageBindingCodeStamp,
  writeCoverageBindingEnvelope,
  type CoverageBindingEnvelopeEntry,
  type CoverageBindingEnvelopeFilesystem,
} from './coverage-binding-envelope.js';
import { assembleCoverageBindingClaims } from './coverage-binding-inputs.js';
import { planCoverageBindingBatches } from './coverage-binding-batches.js';
import { engineContentStamp } from './engine-version-id.js';
import { resolveHarnessRoot } from './install-freshness.js';
import { BUILD_REVIEW_RUBRIC_IDS, fingerprintBuildReviewRubricPolicy, getBuildReviewRubricDescriptor } from './build-review-registry.js';
import { currentCommitSha } from './project-prelude.js';
import { resolveGateCodeValidityConfig } from './config.js';
import {
  assembleBuildReviewInputs,
  TestSuiteProofError,
  type BuildReviewFrozenInputs,
  type BuildReviewInputOptions,
  type BuildReviewRepairProvenance,
} from './build-review-inputs.js';
import {
  composeContainmentAdvisoryOutput,
  runContainmentFloor,
  renderContainmentFloorReport,
  type ContainmentFloorReport,
} from './per-task-commit-floor.js';
import {
  DEFAULT_TEST_QUALITY_MAX_PROJECTION_BYTES,
  resolveBuildReviewConfig,
  type ResolvedBuildReviewRubricPolicy,
} from './resolved-config.js';
import type { ResolvedBuildReviewCatalogEntry, ResolvedBuildReviewCustomCatalogEntry } from './resolved-config.js';
import { fingerprintBuildReviewPolicyDeclaration, type InstalledReviewSkill } from './build-review-policy.js';
import { resolveInstalledReviewPolicyCatalog, ReviewPolicyCatalogError } from './build-review-policy-resolver.js';
import { renderRubricContractShape, type RubricContractDescriptor } from './build-review-contract.js';
import { captureInstalledReviewPolicyBundle, resolveReviewPolicyPackageReference, type CapturedReviewPolicyBundle } from './build-review-policy-bundle.js';
import {
  evaluateBuildReviewPolicyPreflight,
  parseBuildReviewPolicyRuntimeUnsupportedResponse,
  renderBuildReviewPolicyContract,
  renderBuildReviewPolicyUnsupportedDiagnostic,
} from './build-review-policy-contract.js';
import {
  classifyBuildReviewPolicyIncompatibility,
  type BuildReviewLapId,
} from './build-review-domain.js';
import { discoverClaudeReviewPolicies, type ClaudeMetadataCommand, type ClaudeReviewPolicyFilesystem } from './build-review-policy-claude.js';
import { createCodexAppServerTransport, listCodexInstalledReviewSkills, type CodexAppServerTransport } from './build-review-policy-codex.js';
import { buildReviewFrozenInputPaths, prepareBuildReviewContainment, prepareBuildReviewEvidencePaths, renderBuildReviewFrozenInputScope, writeReviewHostStateSentinel } from './build-review-containment.js';
import { acquireReviewScratchHome } from './self-host/provider-scratch.js';
import { copySelectedCodexLogin } from '../execution/codex-self-host-auth.js';
import { stampBuildReviewCustomJudgedResult } from './build-review-finding-identity.js';
import {
  coordinateBuildReviewRubrics,
  emitBuildReviewCacheDiscard,
  type BuildReviewCoordinationEngineIdentity,
  type BuildReviewRubricSkillDigest,
  describeBuildReviewDispatchedResultRejection,
  buildReviewCandidateScopeResolutionContext,
  stampBuildReviewDispatchedCandidate,
  validateBuildReviewDispatchedResult,
  type BuildReviewDispatchableRubric,
} from './build-review-coordinator.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import { classifyBuildReviewCacheLookup, readBuildReviewCacheEntry, tryWriteBuildReviewCacheEntry, writeBuildReviewCacheEntry, type BuildReviewCacheSemanticIdentity } from './build-review-cache.js';
import {
  parseBuildReviewCustomArtifactMember,
  readBuildReviewBranchArtifact,
  writeBuildReviewBranchArtifact,
  type BuildReviewBranchProvenance,
  type BuildReviewCustomArtifactMember,
} from './build-review-artifacts.js';
import { joinBuildReviewRubricOutcomes, type BuildReviewAggregate } from './build-review-aggregate.js';
import { BuildReviewDispositionStore } from './build-review-dispositions.js';
import {
  buildReviewConfidenceFloors,
  resolveEffectiveBuildReviewVerdict,
  type BuildReviewEffectiveResolution,
} from './build-review-effective.js';
import { persistBuildReviewSuppressions, projectBuildReviewSuppressionEntries } from './build-review-suppression-history.js';
import {
  bumpMechanicalFaultsInLedger,
  MAX_MECHANICAL_FAULTS_BUILD_REVIEW,
} from './kickback-ledger.js';

import {
  deriveBuildReviewInfrastructureFailureReason,
  deriveBuildReviewScopeIncompleteFault,
  makeBuildReviewDispatchFailure,
  parseBuildReviewLapId,
  parseBuildReviewRubricResult,
  renderBuildReviewUnresolvedSkillRemedy,
  type BuildReviewRubricResult,
} from './build-review-domain.js';
import { buildReviewRubricPromptView, type BuildReviewRubricProjection } from './build-review-projections.js';
import { boundedHeadTailExcerpt, classifyTautologyPaths, deriveRemovalMaintenanceSelectors, materializeTautologyPreflight, type TautologyScopedRunResult } from './build-review-test-quality-preflight.js';
import {
  defaultBuildReviewScopedLauncher,
  runBuildReviewScopedCommand,
  type BuildReviewScopedLauncher,
} from './build-review-scoped-run.js';
import {
  CLAUDE_MODEL_POLICY,
  type ProviderModelPolicy,
} from './provider-model-policy.js';
import type {
  ProviderSessionScope,
  ProviderSessionStore,
} from './provider-session.js';
import {
  buildProviderAttemptMetadata,
  executeProviderCandidates,
  executeAuxiliaryProviderCandidates,
  type ExecuteProviderCandidatesInput,
  type ProviderExecutionResult,
  type ProviderExecutionContext,
  type WithCandidateSafety,
} from './provider-execution.js';
import { runAuxiliaryGroupBranches } from './group-core.js';
import {
  ProviderRuntimeSet,
} from './provider-runtime.js';
import { normalizeProviderSelection } from './provider-selection.js';
import type { VerifierDispatchResult } from './attribution-lane.js';
import {
  renderSkillInvocation,
  renderAuxiliarySkillInvocation,
  STEP_SKILL_INVOCATIONS,
} from './skill-invocation.js';
import { resolveCustomStepSkill } from './skill-resolver.js';
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
import { DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS as CONFIGURED_PROVIDER_STREAM_MIN_INTERVAL_MS } from './config.js';
import { parseFinishPrProseJudgment } from './finish-pr-prose-judgment.js';
import { resolvePlanPatternSource } from './plan-pattern-source.js';
import { runCopyEquivalence } from './copy-equivalence.js';
import {
  renderAsBuiltPolicyPrompt,
  resolveAsBuiltPolicy,
  type AsBuiltPolicyConfig,
} from './as-built-policy.js';

/** A closed coverage-binding payload that cannot be treated as a verdict. */
export class CoverageBindingPayloadError extends Error {
  readonly kind = 'coverage-binding-payload' as const;

  constructor(readonly reason: string) {
    super(`coverage_binding invalid judge payload: ${reason}`);
    this.name = 'CoverageBindingPayloadError';
  }
}

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

/** Default hard floor for live provider-stream observation emission. */
export const DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS = CONFIGURED_PROVIDER_STREAM_MIN_INTERVAL_MS;

/** Slow cadence for unchanged provider-stream observations. */
export const DEFAULT_PROVIDER_STREAM_HEARTBEAT_MS = 5 * 60_000;

/** Resolve the optional provider-stream cadence, rejecting non-positive values. */
export function resolveProviderStreamMinIntervalMs(config: HarnessConfig | undefined): number {
  const value = config?.provider_stream?.min_interval_ms;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS;
}

export function createProviderStreamThrottle<T>(
  emit: (observation: T) => void,
  options: { minIntervalMs: number; heartbeatMs?: number; now?: () => number },
): ((observation: T) => void) & { flush: () => void; heartbeat: () => void } {
  const now = options.now ?? Date.now;
  const minIntervalMs = options.minIntervalMs > 0
    ? options.minIntervalMs
    : DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS;
  const heartbeatMs = options.heartbeatMs ?? minIntervalMs;
  let lastEmissionMs = Number.NEGATIVE_INFINITY;
  let lastObservation: string | undefined;
  let latestObservation: T | undefined;
  let pendingFlush = false;
  let flushed = false;
  let wakeUp: ReturnType<typeof setTimeout> | undefined;
  const clearWakeUp = () => {
    if (wakeUp === undefined) return;
    clearTimeout(wakeUp);
    wakeUp = undefined;
  };
  const scheduleWakeUp = () => {
    if (wakeUp !== undefined || flushed) return;
    const remainingMs = Math.max(0, minIntervalMs - (now() - lastEmissionMs));
    wakeUp = setTimeout(() => {
      wakeUp = undefined;
      if (latestObservation !== undefined) emitIfAdmissible(latestObservation);
    }, remainingMs);
    wakeUp.unref?.(); // portability-ok: candidate-owned wake-up is cleared at candidate close
  };
  const emitIfAdmissible = (observation: T) => {
    if (flushed) return;
    const current = now();
    const serialized = JSON.stringify(observation);
    const changed = serialized !== lastObservation;
    if (current - lastEmissionMs < minIntervalMs) {
      if (changed) scheduleWakeUp();
      else clearWakeUp();
      return;
    }
    if (!changed && current - lastEmissionMs < heartbeatMs) return;
    clearWakeUp();
    lastEmissionMs = current;
    lastObservation = serialized;
    emit(observation);
    pendingFlush = false;
  };
  const throttle = (observation: T) => {
    if (flushed) return;
    latestObservation = observation;
    pendingFlush = true;
    emitIfAdmissible(observation);
  };
  throttle.heartbeat = () => {
    if (latestObservation !== undefined) emitIfAdmissible(latestObservation);
  };
  throttle.flush = () => {
    if (flushed || !pendingFlush || latestObservation === undefined) return;
    flushed = true;
    clearWakeUp();
    try {
      emit(latestObservation);
    } catch {
      // Close-boundary telemetry never changes dispatch completion.
    }
  };
  return throttle;
}

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
// rebase) are one-shot by design: they generate an artifact from existing
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

/** Preserve an exhausted lifecycle's durable-marker outcome for provider callers. */
function mapProviderLifecycleHalt(
  result: ProviderLifecycleHaltedResult,
  preferredProvider: string,
): ProviderExecutionResult {
  const markerMessage = result.haltMarkerWrite.status === 'written'
    ? ' See .pipeline/HALT.'
    : result.haltMarkerWrite.status === 'partial'
      ? ` HALT was written, but HALT.class write failed at ${result.haltMarkerWrite.path}: ${result.haltMarkerWrite.reason}.`
      : ` Halt marker write failed at ${result.haltMarkerWrite.path}: ${result.haltMarkerWrite.reason}.`;
  return {
    success: false,
    output: `Provider preparation timed out twice.${markerMessage}`,
    exitCode: 1,
    preferredProvider,
    attempts: [],
    haltMarkerWrite: result.haltMarkerWrite,
  };
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
  /**
   * Dispatcher-owned worktree lifecycle queue. The `build_review` test-quality
   * preflight materializes a detached checkout with `git worktree add/remove`
   * against the shared `.git`; the daemon injects its single queue so those
   * mutations never overlap another slug's lifecycle operations.
   */
  worktreeLifecycle?: WorktreeLifecycleQueue;
  /** Process-free test-suite-proof seam retained by the public build_review step. */
  buildReviewInputOptions?: BuildReviewInputOptions;
  /** Test seam for the counterfactual scoped-command launcher. */
  buildReviewScopedLauncher?: BuildReviewScopedLauncher;
  /**
   * Engine-owned rubric fan-out seam. It receives the single frozen snapshot
   * and resolved policy, and returns only after every branch has settled.
   */
  buildReviewCoordinator?: (
    inputs: BuildReviewFrozenInputs,
    config: ReturnType<typeof resolveBuildReviewConfig>,
  ) => Promise<StepRunResult>;
  /** Shared raw-aggregate/disposition join. Tests inject a bounded fake store. */
  buildReviewEffectiveResolver?: typeof resolveEffectiveBuildReviewVerdict;
  /** Test seam for a missing or malformed current-lap branch artifact. */
  buildReviewArtifactReader?: (
    projectRoot: string,
    rubric: string,
    lapId: BuildReviewLapId,
    snapshotDigest: string,
    fs: import('./build-review-artifacts.js').BuildReviewArtifactFilesystem,
  ) => Promise<unknown>;
  /** Candidate-local installed-policy catalog. Tests supply a faithful host fake. */
  buildReviewPolicyCatalog?: (input: {
    readonly provider: string;
    readonly entry: ResolvedBuildReviewCatalogEntry;
    /** The policy reference this candidate resolves; discovery reads no other standalone skill. */
    readonly skill: string;
    readonly preparedEnv?: NodeJS.ProcessEnv;
    readonly preparedExecutable?: string;
    /** Leading arguments of the prepared invocation (for example a containment wrap). */
    readonly preparedArgs?: readonly string[];
    /** The provider home preparation replaced, mapped explicitly for installed-catalog discovery. */
    readonly originalCatalogHome?: string;
    /** Owning candidate's cancellation joined with its deadline; aborts in-flight discovery. */
    readonly signal?: AbortSignal;
    /** Owning candidate's absolute deadline, in epoch milliseconds. */
    readonly deadlineAt?: number;
  }) => Promise<readonly InstalledReviewSkill[]>;
  /** Candidate-local package capture seam; production retains the filesystem capture. */
  buildReviewPolicyCapture?: typeof captureInstalledReviewPolicyBundle;
  /** Shared event spine for engine-owned build-review occurrences. */
  events?: ConductorEventEmitter;
  /** Test-only envelope filesystem seam for coverage-binding checkpoints. */
  coverageBindingFilesystem?: CoverageBindingEnvelopeFilesystem;
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

/**
 * Production catalog composition intentionally lives at the runner boundary:
 * discovery occurs in the selected candidate's prepared environment, never in
 * the parent process that happens to start the conductor.
 */
export function productionBuildReviewPolicyCatalog(
  projectDir: string,
  deps: {
    readonly codexTransport?: CodexAppServerTransport;
    readonly claudeCommand?: ClaudeMetadataCommand;
    readonly claudeFilesystem?: ClaudeReviewPolicyFilesystem;
  } = {},
): NonNullable<StepRunnerOptions['buildReviewPolicyCatalog']> {
  const codexTransport = deps.codexTransport ?? createCodexAppServerTransport();
  return async ({ provider, skill, preparedEnv, preparedExecutable, preparedArgs, originalCatalogHome, signal }) => {
    const env = preparedEnv ?? process.env;
    if (provider !== 'claude' && provider !== 'codex') {
      throw new Error(`Build-review custom policies are unsupported for provider ${provider}`);
    }
    const homeVariable = provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
    const discover = (home: string, catalogEnv: NodeJS.ProcessEnv, includeProject: boolean): Promise<readonly InstalledReviewSkill[]> => provider === 'claude'
      ? discoverClaudeReviewPolicies({
          candidate: {
            cwd: projectDir,
            env: catalogEnv,
            projectSkillRoots: includeProject ? [join(projectDir, '.claude', 'skills'), join(projectDir, '.agents', 'skills')] : [],
            userSkillRoots: [join(home, 'skills')],
            skill,
            ...(signal === undefined ? {} : { signal }),
          },
          ...(deps.claudeCommand === undefined ? {} : { command: deps.claudeCommand }),
          ...(deps.claudeFilesystem === undefined ? {} : { filesystem: deps.claudeFilesystem }),
        })
      : listCodexInstalledReviewSkills(codexTransport, {
          cwd: projectDir,
          home,
          env: catalogEnv,
          ...(preparedExecutable === undefined ? {} : { executable: preparedExecutable }),
          ...(preparedArgs === undefined ? {} : { executableArgs: preparedArgs }),
          ...(signal === undefined ? {} : { signal }),
        });
    const preparedHome = env[homeVariable] ?? join(homedir(), provider === 'claude' ? '.claude' : '.codex');
    const prepared = await discover(preparedHome, env, true);
    // Self-host preparation replaces the provider home. The operator's
    // installed global and plugin catalogs are reachable only through the
    // root preparation mapped explicitly; nothing here consults the engine's
    // ambient home.  What preparation placed in the candidate home keeps
    // precedence, because that is the definition the candidate would load.
    if (originalCatalogHome === undefined || originalCatalogHome === preparedHome) return prepared;
    const key = (skill: InstalledReviewSkill) => `${skill.source}\0${skill.plugin?.id ?? ''}\0${skill.semanticName}`;
    const preparedKeys = new Set(prepared.map(key));
    const original = await discover(originalCatalogHome, { ...env, [homeVariable]: originalCatalogHome }, false);
    return [...prepared, ...original.filter((skill) => skill.source !== 'project' && !preparedKeys.has(key(skill)))];
  };
}

/** The command a review member launches, so containment proves the mounts that command gets. */
function reviewLaunchCommand(
  provider: 'claude' | 'codex',
  prepared: { readonly executable: string; readonly args: readonly string[] } | undefined,
): { readonly executable: string; readonly args: readonly string[] } {
  if (prepared !== undefined) return { executable: prepared.executable, args: prepared.args };
  return { executable: provider === 'codex' ? process.env.CODEX_EXECUTABLE ?? 'codex' : 'claude', args: [] };
}

/** Capabilities belong to the prepared provider role, never the policy declaration. */
function establishedBuildReviewTools(provider: 'claude' | 'codex'): readonly string[] {
  // Both supported read-only profiles expose git for frozen-input inspection.
  return provider === 'claude' || provider === 'codex' ? ['git'] : [];
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


/**
 * Extracts the judged-result JSON object from a rubric session's output.
 * Sessions intermittently wrap the JSON in prose or markdown fences; a strict
 * whole-output parse turned that wrapping into `invalid-provider-result`
 * infrastructure failures. Parsing tries the raw output first, then a fenced
 * block, then the outermost balanced object. Returns undefined when no
 * candidate parses — validation of the parsed shape stays with the caller.
 */
/** Byte cap for the previous-output excerpt embedded in a rubric repair prompt. */
export const RUBRIC_REPAIR_PROMPT_EXCERPT_CAP_BYTES = 8_192;
/** Byte cap for the raw-output diagnostic detail on a final rubric shape failure. */
export const RUBRIC_FAILURE_DETAIL_CAP_BYTES = 2_048;

export function extractJudgedResultCandidate(output: string): unknown {
  const candidates: string[] = [output.trim()];
  const fence = output.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fence) candidates.push(fence[1].trim());
  const first = output.indexOf('{');
  const last = output.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(output.slice(first, last + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* try next shape */ }
  }
  return undefined;
}

export type RubricContractDispatch<Output = unknown> =
  | { readonly kind: 'structured'; readonly invocation: InvokeResult; readonly structuredResult: Record<string, unknown>; readonly parsed: Output | undefined }
  | { readonly kind: 'root-rejection'; readonly invocation: InvokeResult; readonly rejection: { readonly field: 'root'; readonly problem: 'a structured result is required' } }
  | { readonly kind: 'provider-failure'; readonly invocation: InvokeResult };

type RubricContractInvokeOptions = Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort' | 'nativeSchema'>;

/** Native-schema invocation boundary shared by built-in and custom rubrics. */
export async function dispatchRubricContract<Output>(input: {
  readonly descriptor: Pick<RubricContractDescriptor<unknown, unknown, Output>, 'output'>;
  readonly options: RubricContractInvokeOptions;
  readonly invoke: (options: RubricContractInvokeOptions & Pick<InvokeOptions, 'nativeSchema'>) => Promise<InvokeResult>;
  /** Built-in payloads are stamped before their descriptor parser accepts them. */
  readonly prepareStructured?: (value: Record<string, unknown>) => unknown;
}): Promise<RubricContractDispatch<Output>> {
  const invocation = await input.invoke({ ...input.options, nativeSchema: input.descriptor.output.jsonSchema });
  if (!invocation.success) return { kind: 'provider-failure', invocation };
  const structuredResult = invocation.finalStructuredResult;
  if (structuredResult === null || typeof structuredResult !== 'object' || Array.isArray(structuredResult)) {
    return { kind: 'root-rejection', invocation, rejection: { field: 'root', problem: 'a structured result is required' } };
  }
  const raw = structuredResult as Record<string, unknown>;
  return {
    kind: 'structured',
    invocation,
    structuredResult: raw,
    parsed: input.descriptor.output.parse(input.prepareStructured?.(raw) ?? raw),
  };
}

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
  /** Fixtures with a synthetic Git runner cannot create detached worktrees. */
  private readonly usesInjectedBuildReviewGit: boolean;
  private buildReviewScopedLauncher: BuildReviewScopedLauncher;
  private buildReviewCoordinator?: StepRunnerOptions['buildReviewCoordinator'];
  private buildReviewEffectiveResolver: typeof resolveEffectiveBuildReviewVerdict;
  private buildReviewArtifactReader: NonNullable<StepRunnerOptions['buildReviewArtifactReader']>;
  private buildReviewPolicyCatalog?: StepRunnerOptions['buildReviewPolicyCatalog'];
  private buildReviewPolicyCapture: typeof captureInstalledReviewPolicyBundle;
  private events?: ConductorEventEmitter;
  private coverageBindingFilesystem?: CoverageBindingEnvelopeFilesystem;
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
  /** Bounded per-run evidence cache; failed preflights never enter it. */
  private readonly tautologyPreflightCache = new Map<string, import('./build-review-test-quality-preflight.js').TautologyCompletedPreflight>();
  private readonly worktreeLifecycle: WorktreeLifecycleQueue | undefined;
  callCount = 0;

  /** Route a shared-`.git` worktree mutation through the dispatcher queue when one is injected. */
  private mutateWorktree<T>(work: () => Promise<T>): Promise<T> {
    return this.worktreeLifecycle ? this.worktreeLifecycle.run(work) : work();
  }

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
    this.usesInjectedBuildReviewGit = options?.gitRunner !== undefined;
    this.worktreeLifecycle = options?.worktreeLifecycle;
    this.planPathOverride = options?.planPath;
    this.buildReviewInputOptions = options?.buildReviewInputOptions;
    this.buildReviewScopedLauncher = options?.buildReviewScopedLauncher ?? defaultBuildReviewScopedLauncher;
    this.buildReviewCoordinator = options?.buildReviewCoordinator;
    this.buildReviewEffectiveResolver = options?.buildReviewEffectiveResolver ?? resolveEffectiveBuildReviewVerdict;
    this.buildReviewArtifactReader = options?.buildReviewArtifactReader ?? readBuildReviewBranchArtifact;
    this.buildReviewPolicyCatalog = options?.buildReviewPolicyCatalog
      ?? productionBuildReviewPolicyCatalog(this.projectDir);
    this.buildReviewPolicyCapture = options?.buildReviewPolicyCapture ?? captureInstalledReviewPolicyBundle;
    this.events = options?.events;
    this.coverageBindingFilesystem = options?.coverageBindingFilesystem;
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
    // build_review is a one-shot grader dispatch — never resumes the main
    // conductor session (see runBuildReview() for the resolveRebaseConflict
    // fresh-uuid/resume:false pattern).
    if (step === 'build_review') {
      return this.runBuildReview(state.complexity_tier, opts?.executionContext);
    }
    if (step === 'coverage_binding') {
      return this.runCoverageBinding(state, opts?.executionContext);
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
    const configuredSkillPath = this.config?.steps?.[step]?.skill;
    const customSkill = skillInvocation || configuredSkillPath === undefined
      ? undefined
      : resolveCustomStepSkill(step, configuredSkillPath, this.projectDir);
    if (typeof customSkill !== 'string' && customSkill !== undefined) {
      return {
        success: false,
        output: `Cannot dispatch custom step ${customSkill.stepKey}: configured skill ${customSkill.configuredPath} is ${customSkill.kind}.`,
      };
    }
    const prompt = skillInvocation
      ? renderSkillInvocation(skillInvocation, this.providerKey)
      : customSkill === undefined
        ? `/${step}`
        : renderAuxiliarySkillInvocation(customSkill, this.providerKey);
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
      opts?.revisionGuidance,
      state.complexity_tier,
      opts?.prdWideningReviewContext,
    );

    // Every dispatch reaches the provider through invoke(). `interactive`
    // selects the REPL; non-REPL collaborative steps still receive the
    // machine envelope and streaming observations.
    if (autonomous) {
      if (this.providerRuntimes && branchSessionId === undefined) {
        if (step === 'remediate') {
          try {
            const reconciliation = opts?.remediationRequest;
            const reconciliationInput = reconciliation === undefined
              ? undefined
              : `PRD WIDENING RECONCILIATION INPUT (engine-owned):\n${reconciliation.projection}`;
            const result = await this.executeProviderAwareSkillOneShot(
              step,
              {
                // executeProviderAwareSkillOneShot prepends the selected
                // provider's skill invocation for a schema request. Keep the
                // supplied projection separate so that command appears once.
                prompt: reconciliationInput ?? prompt,
                systemPrompt: reconciliation
                  ? `${systemPrompt}\n\nJudge only semantic same/different/uncertain relations. Do not grant authority or create BUILD work.`
                  : systemPrompt,
                cwd: this.projectDir,
                dangerouslySkipPermissions: true,
                ...(reconciliation ? { nativeSchema: reconciliation.nativeSchema } : {}),
              },
              state.complexity_tier,
              opts,
            );
            if (result) {
              this.callCount++;
              if (reconciliation && result.success && result.finalStructuredResult === undefined) {
                return { success: false, output: 'PRD widening reconciliation returned no native structured result.' };
              }
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
          undefined,
          customSkill,
        );
      }
      return this.runAutonomous(
        step,
        prompt,
        resume,
        systemPrompt,
        resolved,
        branchSessionId,
        state.complexity_tier,
        opts?.executionContext,
      );
    }

    // Open a REPL when the step is designed for user conversation AND we're
    // not in auto mode (auto = unattended, must still one-shot so the flow
    // advances). In interactive mode, open REPL for all conversational steps
    // except one-shot analysis steps. Otherwise dispatch print mode.
    let interactive: boolean;
    if (this.mode === 'interactive') {
      // In interactive mode, open REPL for all conversational steps except
      // one-shot steps that generate artifacts without user input
      const oneShotSteps = new Set(['complexity', 'conflict_check', 'architecture_diagram', 'rebase']);
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
        customSkill,
      );
    }

    // Consult the availability cache before dispatch so a model already
    // known-dead is not handed to the unified dispatch entry —
    // effectiveModel() substitutes a live model and fires its warning.
    const { model: effectiveModel } = this.modelAvailability.effectiveModel(resolved.model);
    if (effectiveModel === resolved.model && this.modelAvailability.dead.has(resolved.model)) {
      return {
        success: false,
        output: `Model fallback ladder exhausted: no live model remains after ${resolved.model}.`,
      };
    }
    const streamConsumer = interactive
      ? undefined
      : this.createProviderStreamConsumer(step, this.providerKey);

    try {
      const result = await this.provider.invoke({
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
        ...(streamConsumer ? { streamConsumer } : {}),
      });
      await this.emitScalarProviderAttempt(
        step,
        result,
        effectiveModel,
        resolved.effort,
        state.complexity_tier,
        opts?.executionContext,
      );
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
    } finally {
      streamConsumer?.close();
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
    customSkill?: string,
    invocationKind: 'skill' | 'free-form' = 'skill',
  ): Promise<StepRunResult> {
    const sessions = opts?.providerSessions ?? this.sessionStore;
    if (!this.providerRuntimes || !sessions) {
      throw new Error(
        'Provider-aware normal dispatch requires runtimes and a session store',
      );
    }

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
            runtimes: this.providerRuntimes!,
            sessions,
            config: this.config,
            tier: state.complexity_tier,
            attempt: opts?.attempt ?? 1,
            runId: this.runId,
            nativeSchemaScratch: {
              worktreeRoot: this.projectDir,
              repository: this.projectDir,
              featureSlug: this.featureDesc || basename(this.projectDir),
            },
            executionContext: opts?.executionContext,
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
            ...(invocationKind === 'skill' && (Object.prototype.hasOwnProperty.call(
              STEP_SKILL_INVOCATIONS,
              step,
            ) || customSkill !== undefined)
              ? {
                  optionsForCandidate: (candidateKey: string) => ({
                    ...options,
                    prompt: customSkill === undefined
                      ? renderSkillInvocation(STEP_SKILL_INVOCATIONS[step]!, candidateKey)
                      : renderAuxiliarySkillInvocation(customSkill, candidateKey),
                  }),
                }
              : {}),
          }),
        opts?.runId,
        opts?.executionContext,
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
          nativeSchemaScratch: {
            worktreeRoot: this.projectDir,
            repository: this.projectDir,
            featureSlug: this.featureDesc || basename(this.projectDir),
          },
          executionContext: request.dispatch?.executionContext,
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
                  prompt: options.nativeSchema === undefined
                    ? renderSkillInvocation(STEP_SKILL_INVOCATIONS[request.step]!, candidateKey)
                    : `${renderSkillInvocation(STEP_SKILL_INVOCATIONS[request.step]!, candidateKey)}\n\n${options.prompt}`,
                }),
              }
            : {}),
        }),
      request.dispatch?.runId,
      request.dispatch?.executionContext,
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
    dispatchRunId?: string,
    executionContext?: ExecutionContext,
  ): Promise<ProviderExecutionResult> {
    const pulse = createHeartbeatPulse(this.projectDir, step);
    const providerStreamIntervalMs = resolveProviderStreamMinIntervalMs(this.config);
    // adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity D1: when the
    // engine supplies this dispatch's run identity, the provider-lifecycle
    // `attempt.id` IS that value — the id this dispatch logs and the id stamped
    // into the verdict sidecar are one value, so there is a single identity
    // authority per dispatch rather than two independently minted ids. A
    // recovery replacement attempt derives from the same identity (`#2`, `#3`)
    // so it stays attributable to the dispatch that owns it. Callers outside
    // the identity seam supply nothing and keep the run-scoped id format.
    let dispatchAttempt = 0;
    const nextAttempt = () => {
      const sequence = ++this.providerLifecycleAttempt;
      dispatchAttempt += 1;
      return {
        logicalStep: step,
        id: dispatchRunId
          ? (dispatchAttempt === 1 ? dispatchRunId : `${dispatchRunId}#${dispatchAttempt}`)
          : `${this.runId}:${step}:${sequence}`,
      };
    };
    const supervisor = createProviderLifecycleSupervisor({
      attempt: nextAttempt(),
      recoveryCount: 0,
      preparationTimeoutMinutes: resolveProviderPreparationTimeoutMinutes(this.config),
      timer: this.providerLifecycleTimer,
      onLifecycleEvent: (event) => {
        void this.providerAttempt?.(
          event.step,
          executionContext ? { ...event, executionContext } : event,
        );
      },
      recovery: {
        projectRoot: this.projectDir,
        episodeStore: this.providerLifecycleEpisodeStore,
        createReplacementAttempt: () => nextAttempt(),
      },
    });
    try {
      const result = await supervisor.supervise((lease) =>
        run({
          ...baseOptions,
          onActivity: pulse,
          providerStreamObserverForCandidate: (provider) => {
            const throttle = createProviderStreamThrottle<ProviderStreamObservation>(
              (observation) => {
                void this.events?.emit({
                  type: 'provider_stream_progress', step, provider, ...observation,
                  ts: new Date().toISOString(),
                }).catch(() => {});
              },
              { minIntervalMs: providerStreamIntervalMs },
            );
            const heartbeat = setInterval(throttle.heartbeat, DEFAULT_PROVIDER_STREAM_HEARTBEAT_MS);
            heartbeat.unref(); // portability-ok: candidate-owned telemetry heartbeat is cleared at candidate close
            return { onProviderStream: throttle, close: () => { clearInterval(heartbeat); throttle.flush(); } };
          },
          spawnPermit: lease.spawnPermit,
        }),
      );
      if (isProviderLifecycleHalted(result)) {
        return mapProviderLifecycleHalt(result, this.configuredProviders[0] ?? 'unknown');
      }
      return result;
    } finally {
    }
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
      ...(result.providerSetupExhaustion
        ? { providerSetupExhaustion: result.providerSetupExhaustion }
        : {}),
    };
  }

  /** Translate untrusted provider output into the closed root-bus vocabulary. */
  private ciFailureReason(result: Pick<InvokeResult, 'output' | 'commandUnresolved' | 'permissionDenied' | 'providerUnavailable' | 'executionDisposition'>): CiRepairDiagnosticReason {
    const text = `${result.output ?? ''}`.toLowerCase();
    if (result.commandUnresolved) return 'flag-invalid';
    if (result.permissionDenied || /permission|forbidden|\b403\b/.test(text)) return 'permission';
    if (/auth|unauthor|\b401\b/.test(text)) return 'auth';
    if (/timeout|timed out/.test(text)) return 'timeout';
    if (result.providerUnavailable) return 'provider-unavailable';
    if (/spawn|enoent|environment/.test(text)) return 'spawn-env';
    return result.executionDisposition === 'not-started' ? 'readiness-degraded' : 'unknown';
  }

  private createProviderStreamConsumer(
    step: StepName,
    provider: string,
  ): ProviderStreamCandidateObserver {
    const throttle = createProviderStreamThrottle<ProviderStreamObservation>(
      (observation) => {
        void this.events?.emit({
          type: 'provider_stream_progress', step, provider, ...observation,
          ts: new Date().toISOString(),
        }).catch(() => {});
      },
      { minIntervalMs: resolveProviderStreamMinIntervalMs(this.config) },
    );
    const heartbeat = setInterval(throttle.heartbeat, DEFAULT_PROVIDER_STREAM_HEARTBEAT_MS);
    heartbeat.unref(); // portability-ok: consumer-owned heartbeat is cleared at dispatch close
    return {
      onProviderStream: throttle,
      close: () => { clearInterval(heartbeat); throttle.flush(); },
    };
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
      ...(result.finalStructuredResult === undefined
        ? {}
        : { finalStructuredResult: result.finalStructuredResult }),
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
      ...(result.providerSetupExhaustion
        ? { providerSetupExhaustion: result.providerSetupExhaustion }
        : {}),
      ...(result.rateLimited
        ? {
            rateLimited: true,
            ...(result.usageExhausted ? { usageExhausted: true } : {}),
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
      ...(result.resolvedEffort !== undefined ? { effort: result.resolvedEffort } : {}),
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
    tier?: ComplexityTier,
    executionContext?: ExecutionContext,
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
    await this.emitScalarProviderAttempt(
      step,
      result,
      attemptedModels.at(-1) || effectiveModel,
      resolved.effort,
      tier,
      executionContext,
    );
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
        ...(result.usageExhausted ? { usageExhausted: true } : {}),
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

  /** Emits scalar-provider telemetry without retaining invocation state on the runner. */
  private async emitScalarProviderAttempt(
    step: StepName,
    result: InvokeResult,
    model: string,
    effort: EffortLevel,
    tier: ComplexityTier | undefined,
    executionContext: ExecutionContext | undefined,
  ): Promise<void> {
    try {
      await this.providerAttempt?.(
        step,
        buildProviderAttemptMetadata({
          providerKey: this.providerKey,
          executionContext,
          result,
          preferredProvider: this.providerKey,
          resolvedModel: model,
          resolvedEffort: effort,
          tier,
        }),
      );
    } catch {
      // Attempt metadata is observational and must not alter scalar dispatch.
    }
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
        undefined,
        'free-form',
      );
      return;
    }
    const resolved = this.resolvedConfigFor(step);
    await this.provider.invoke({
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
      'Use the supplied CI logs to diagnose and repair the failure, then commit your changes.\n' +
      'Do not run tests, test suites, validation scripts, or test-suite/scoped-run commands. ' +
      'The daemon owns all test execution for this repair and will run the configured verifier after you return.\n' +
      'Do not push. The daemon publishes with lease protection only after its guards and verification pass. ' +
      'These repair-session instructions override repository instructions to run tests or publish changes.';

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
        kind: providerResult.success
          ? 'session-completed'
          : providerResult.executionDisposition === 'not-started'
            ? 'not-started'
            : 'failed',
        reason: this.ciFailureReason(providerResult),
        ...this.providerAttribution(providerResult),
      };
    }

    const resolved = this.resolvedConfigFor('build');

    // Use a fresh one-shot session — never contaminate the main conductor session.
    const { v4: uuidv4 } = await import('uuid');
    const sessionId = uuidv4();

    // Walk the fallback ladder so the CI-failure resolver is not blocked by
    // one model's unavailability.
    const result = await this.modelAvailability.invokeWithLadder(this.provider, {
      prompt,
      sessionId,
      resume: false,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: this.modelAvailability.effectiveModel(resolved.model).model,
      effort: resolved.effort,
      cwd: ctx.worktreePath,
    }, async () => ({ sessionId: uuidv4(), resume: false }));

    return {
      kind: result.success ? 'session-completed' : result.executionDisposition === 'not-started' ? 'not-started' : 'failed',
      reason: this.ciFailureReason(result),
      preferredProvider: this.providerKey,
    };
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
   * The judging engine's cache identity (adr-2026-08-21 D2/D3/D6), resolved
   * once per build_review dispatch and injected into the coordinator: the
   * 12-hex engine content stamp (or the `dev` sentinel for an unpublished
   * run) plus a `sha256:` digest over the raw bytes of each registered
   * rubric's installed SKILL.md under the harness root. This map is legacy
   * coordinator-only evidence; candidate paths load the actual installed
   * policy. engineStamp remains the per-run stamp on both paths.
   */
  private async resolveBuildReviewEngineIdentity(): Promise<BuildReviewCoordinationEngineIdentity> {
    const engineStamp = engineContentStamp(dirname(fileURLToPath(import.meta.url)));
    const harnessRoot = await resolveHarnessRoot();
    const skillDigests: Partial<Record<BuildReviewRubricId, BuildReviewRubricSkillDigest>> = {};
    for (const registeredRubric of BUILD_REVIEW_RUBRIC_IDS) {
      const rubric = registeredRubric as BuildReviewRubricId;
      const skillName = getBuildReviewRubricDescriptor(registeredRubric).skillName;
      const path = join(harnessRoot ?? '', 'skills', skillName, 'SKILL.md');
      if (harnessRoot === null) {
        skillDigests[rubric] = { kind: 'unavailable', path: `skills/${skillName}/SKILL.md` };
        continue;
      }
      try {
        skillDigests[rubric] = {
          kind: 'resolved',
          digest: `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`,
        };
      } catch {
        skillDigests[rubric] = { kind: 'unavailable', path };
      }
    }
    return { engineStamp, skillDigests };
  }

  /**
   * Dispatch the build_review grader: a fresh, isolated one-shot session
   * (never resumes the main conductor session), fed strictly the diff since
   * the default branch plus the plan body (assembleBuildReviewInputs — no
   * task-status, transcript, or maker-summary access).
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
    tier: ConductState['complexity_tier'],
    executionContext?: ExecutionContext,
  ): Promise<StepRunResult> {
    try {
      return await this.runRubricBuildReviewInner(inputs, config, tier, executionContext);
    } finally {
      // A custom lap owns one source view for every catalog member. Some
      // built-in paths settle before dispatch (for example a deterministic
      // preflight refusal), so its own candidate callback never runs. Close
      // every member here after the complete lap outcome is known; repeated
      // member settlement is deliberately idempotent in the materialization.
      await Promise.all(config.catalog.map(async (entry) => {
        await inputs.sourceMaterialization?.settle(entry.id);
      }));
    }
  }

  private async runRubricBuildReviewInner(
    inputs: BuildReviewFrozenInputs,
    config: ReturnType<typeof resolveBuildReviewConfig>,
    tier: ConductState['complexity_tier'],
    executionContext?: ExecutionContext,
  ): Promise<StepRunResult> {
    const lapId = parseBuildReviewLapId(`lap-${inputs.sourceSnapshot.headSha}`);
    if (!lapId) return { success: false, output: 'build_review could not create a valid rubric lap identity' };

    // A prior lap's aggregate cannot represent this lap. Invalidate it before
    // dispatch so a mechanical early return leaves no stale semantic FAIL for
    // the conductor to route back to build.
    const effectivePipelineDir = this.pipelineDir ?? join(this.projectDir, '.pipeline');
    await rm(join(effectivePipelineDir, 'build-review.json'), { force: true });

    const engineIdentity = await this.resolveBuildReviewEngineIdentity();

    // Custom policies are loaded only inside the prepared provider candidate.
    // The fixed coordinator still owns the legacy testQuality branch; dynamic
    // artifact/aggregate persistence is deliberately introduced by its own
    // later boundary.  This narrow branch establishes the config -> actual
    // candidate judgement hand-off without borrowing a host installation.
    const customEntries = config.catalog.filter(
      (entry): entry is ResolvedBuildReviewCustomCatalogEntry => entry.kind === 'custom',
    );
    let customResults: Readonly<Record<string, BuildReviewCustomArtifactMember>> | undefined;
    if (customEntries.length > 0) {
      const outcomes = await runAuxiliaryGroupBranches(
        customEntries.map((entry) => ({ memberId: entry.id, policy: entry })),
        config.maxParallel,
        async (_id, entry) => this.dispatchInstalledBuildReviewPolicy(entry, inputs, lapId, tier),
      );
      if (outcomes.some((outcome) => !outcome.success)) {
        return {
          success: false,
          output: outcomes.filter((outcome) => !outcome.success).map((outcome) => outcome.output).join('\n'),
        };
      }
      const members = outcomes.map((outcome) => [outcome.id, outcome.member] as const);
      if (members.some((member) => member[1] === undefined)) {
        return { success: false, output: 'build_review custom policy produced no durable result' };
      }
      customResults = Object.freeze(Object.fromEntries(members) as Record<string, BuildReviewCustomArtifactMember>);
      await this.emitBuildReviewCustomMemberResults(lapId, customResults);
      // A custom-only lap still has a complete aggregate.  Do not use one
      // built-in's enabled flag as a proxy for the complete catalog: security
      // (and every future built-in) must share this lap's frozen input and
      // candidate path whenever it is enabled beside a custom policy.
      if (!config.catalog.some((entry) => entry.kind === 'builtin')) {
        return this.publishCustomOnlyBuildReview({
          lapId,
          inputs,
          customResults,
          currentCustomRubrics: customEntries.map((entry) => entry.id),
          config,
        });
      }
    }

    const coordination = await coordinateBuildReviewRubrics({
      config,
      inputs,
      lapId,
      engineIdentity,
      useCandidateCache: true,
      preflight: async () => this.runTautologyPreflight(inputs),
      readCache: async (branch, _projection, _policyFingerprint, semanticIdentity) => readBuildReviewCacheEntry(this.projectDir, branch.rubric, {
        readFile: async (path) => readFile(path, 'utf-8'), readdir,
        mkdir: async (path) => { await mkdir(path, { recursive: true }); },
        writeFile,
        rename,
      }, semanticIdentity),
      dispatchModel: async (branch, projection) => this.dispatchBuildReviewRubric(branch, projection, tier, executionContext, inputs, engineIdentity),
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
    if (coordination.kind === 'passed') {
      return this.publishBuildReviewPass(coordination.reason);
    }
    if (coordination.kind === 'refused') {
      return { success: false, output: `build_review refused: ${coordination.reason}` };
    }

    const results = Object.fromEntries(await Promise.all(coordination.branches.map(async (branch) => {
      if (branch.kind === 'cache-hit' || branch.kind === 'dispatched') {
        const rawArtifact = await this.buildReviewArtifactReader(
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
        const artifact = rawArtifact as import('./build-review-artifacts.js').BuildReviewBranchArtifact | undefined;
        if (rawArtifact !== undefined && (typeof rawArtifact !== 'object' || rawArtifact === null || !artifact)) {
          return [branch.rubric, { kind: 'malformed' as const, rubric: branch.rubric }];
        }
        if (artifact && !parseBuildReviewRubricResult(artifact.result)) {
          return [branch.rubric, { kind: 'malformed' as const, rubric: branch.rubric }];
        }
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
            reason: deriveBuildReviewInfrastructureFailureReason({ reason: branch.reason }),
            detail: branch.detail === undefined ? branch.reason : `${branch.reason}: ${branch.detail}`,
            ...(branch.providerSetupExhaustion ? { providerSetupExhaustion: branch.providerSetupExhaustion } : {}),
          }];
    }))) as Record<BuildReviewRubricResult['rubric'], BuildReviewRubricResult | {
      readonly kind: 'malformed';
      readonly rubric: BuildReviewRubricResult['rubric'];
    }>;

    const malformedResult = Object.values(results).find((result): result is Extract<typeof result, { kind: 'malformed' }> =>
      result.kind === 'malformed',
    );
    if (malformedResult) {
      // Branch evidence which cannot be parsed is a mechanical failure, not a
      // reviewer verdict.  It must still join the current lap's aggregate:
      // the bounded mechanical lane and its operator recovery both depend on
      // that aggregate being present.  Returning here would leave neither
      // diagnostic nor recoverable state after consuming an allowance.
      results[malformedResult.rubric] = {
        kind: 'infrastructure-failure',
        rubric: malformedResult.rubric,
        reason: 'malformed-artifact',
        detail: 'current-lap branch artifact is malformed',
      };
    }
    const validResults = results as Record<BuildReviewRubricResult['rubric'], BuildReviewRubricResult>;

    // An infrastructure result is not a reviewer decision about the diff.
    // Do not publish it as a fresh FAIL aggregate: completion deliberately
    // classifies a missing verdict as `absent`, which re-dispatches this
    // rubric without consuming the build_review kickback budget.
    const scopeIncompleteFault = Object.values(validResults).flatMap((result) =>
      result.kind === 'judged' ? [deriveBuildReviewScopeIncompleteFault(result)] : [],
    ).find((fault): fault is NonNullable<typeof fault> => fault !== undefined);
    const lapResults = [
      ...Object.values(validResults),
      ...Object.values(customResults ?? {}).map((member) => member.result),
    ];
    const infrastructureFailure = lapResults.find((result): result is Extract<BuildReviewRubricResult, { kind: 'infrastructure-failure' }> =>
      result.kind === 'infrastructure-failure',
    );
    // A semantically valid indeterminate candidate is a non-judgment fault,
    // not a malformed result. It consumes the existing durable allowance but
    // never gets an in-session repair turn, and its judged findings remain in
    // the branch artifact for the terminal aggregate.
    if (scopeIncompleteFault) {
      const mechanicalFaults = await bumpMechanicalFaultsInLedger(this.projectDir, 'build_review', {
        rubric: scopeIncompleteFault.rubric,
        reason: scopeIncompleteFault.reason,
        detail: scopeIncompleteFault.detail,
        lapId,
      });
      if (mechanicalFaults.mechanicalFaults! < MAX_MECHANICAL_FAULTS_BUILD_REVIEW) {
        return {
          success: false,
          output: `build_review mechanical fault in ${scopeIncompleteFault.rubric} (${scopeIncompleteFault.reason}): ${scopeIncompleteFault.detail}`,
          currentLapMechanicalFault: true,
        };
      }
    }
    if (infrastructureFailure) {
      if (infrastructureFailure.providerSetupExhaustion) {
        return {
          success: false,
          output: `build_review infrastructure failure in ${infrastructureFailure.rubric} (${infrastructureFailure.reason}): ${infrastructureFailure.detail}`,
          providerSetupExhaustion: infrastructureFailure.providerSetupExhaustion,
        };
      }
      const hasJudgedFinding = lapResults.some(
        (result) => result.kind === 'judged' && result.findings.length > 0,
      );
      if (!hasJudgedFinding && infrastructureFailure.reason !== 'projection-oversized') {
        const mechanicalFaults = await bumpMechanicalFaultsInLedger(this.projectDir, 'build_review', {
          rubric: infrastructureFailure.rubric,
          reason: infrastructureFailure.reason,
          detail: infrastructureFailure.detail,
          lapId,
        });
        if (mechanicalFaults.mechanicalFaults! < MAX_MECHANICAL_FAULTS_BUILD_REVIEW) {
          return {
            success: false,
            output: `build_review mechanical fault in ${infrastructureFailure.rubric} (${infrastructureFailure.reason}): ${infrastructureFailure.detail}`,
            currentLapMechanicalFault: true,
          };
        }
      }
    }

    const aggregate = joinBuildReviewRubricOutcomes({
      lapId,
      snapshotDigest: inputs.sourceSnapshot.digest,
      results: validResults,
      ...(customResults === undefined ? {} : {
        customResults,
        currentCustomRubrics: customEntries.map((entry) => entry.id),
      }),
    });
    const aggregatePath = join(effectivePipelineDir, 'build-review.json');
    const effective = await this.buildReviewEffectiveResolver(this.projectDir, aggregate, {
      emit: (event) => this.events?.emit(event),
      minConfidence: buildReviewConfidenceFloors(config),
    });
    const stampedAggregate = effective.ok && effective.reducedCoverageEvidence !== undefined
      ? { ...aggregate, reducedCoverageEvidence: effective.reducedCoverageEvidence }
      : aggregate;
    const publication = await new BuildReviewDispositionStore(this.projectDir).withLease(async () => {
      await mkdir(effectivePipelineDir, { recursive: true });
      const temporaryPath = `${aggregatePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(stampedAggregate, null, 2)}\n`, 'utf-8');
      await rename(temporaryPath, aggregatePath);
    });
    if (!publication.ok) {
      return { success: false, output: `build_review aggregate publication failed: ${publication.message}` };
    }
    // adr-2026-08-29 D4.6: the one projection of this lap's sub-floor findings
    // is shared by the visibility event (D4.5) and the durable-history seam below.
    const suppressionEntries = await this.emitBuildReviewOuterVerdict(lapId, aggregate, effective, config);
    if (!effective.ok) {
      return { success: false, output: `${JSON.stringify(aggregate)}\n\nbuild_review disposition resolution failed: ${effective.reason}` };
    }
    // adr-2026-08-29 D4.6: durable suppression history is written HERE, before
    // the pass/fail fork below, because D4.4 keeps a fully suppressed lap out
    // of post-join judgement entirely — such a lap returns success and never
    // reaches the adjudication coordinator. The coordinator reuses this same
    // idempotent seam on the failing route, so there is exactly one writer.
    const persistedSuppressions = await persistBuildReviewSuppressions({
      projectRoot: this.projectDir,
      feature: effective.feature,
      suppressions: suppressionEntries,
    });
    if (!persistedSuppressions.ok) {
      return { success: false, output: `build_review suppression history persistence failed: ${persistedSuppressions.reason}` };
    }
    if (infrastructureFailure?.reason === 'projection-oversized' &&
      effective.effective.uncoveredInfrastructureFailureRubrics.includes(infrastructureFailure.rubric)) {
      const measurements = /measured=(\d+)\s+bytes\s+limit=(\d+)\s+bytes/.exec(infrastructureFailure.detail);
      const reason = measurements
        ? `build_review requires human action: ${infrastructureFailure.rubric} projection-oversized (measured ${measurements[1]} bytes; limit ${measurements[2]} bytes).`
        : `build_review requires human action: ${infrastructureFailure.rubric} projection-oversized.`;
      return { success: false, output: reason, refusal: { kind: 'needs-human', reason } };
    }
    if (effective.effective.verdict === 'PASS') await this.stampBuildReviewVerdict();
    // A judged finding is a completed review, even when another rubric had a
    // mechanical fault. Let the conductor route that semantic failure through
    // its ordinary kickback budget; only a pure mechanical lap retries here.
    const hasJudgedFinding = lapResults.some(
      (result) => result.kind === 'judged' && result.findings.length > 0,
    );
    return {
      success: effective.effective.verdict === 'PASS' || hasJudgedFinding,
      output: JSON.stringify(aggregate),
      // A mixed lap publishes and routes its judged finding as semantic
      // rework. Only a pure infrastructure lap owns the mechanical lane.
      ...(infrastructureFailure === undefined || hasJudgedFinding ? {} : { currentLapMechanicalFault: true }),
    };
  }

  /**
   * Resolve, capture, and deliver one installed policy from the environment
   * prepared for its actual provider candidate.  The operation deliberately
   * returns a failed candidate result for policy load errors: those errors are
   * review coverage failures, never a reason to select another installation.
   */
  private async dispatchInstalledBuildReviewPolicy(
    entry: ResolvedBuildReviewCustomCatalogEntry,
    inputs: BuildReviewFrozenInputs,
    lapId: BuildReviewLapId,
    tier: ConductState['complexity_tier'],
  ): Promise<{ readonly id: string; readonly success: boolean; readonly output: string; readonly member?: BuildReviewCustomArtifactMember }> {
    const declaration = {
      version: 'v1' as const, rubricId: entry.id, semanticSkill: entry.skill,
      question: entry.question,
      ...(entry.source === undefined ? {} : { source: entry.source as 'project' | 'global' | 'plugin' }),
      resources: entry.resources,
    };
    const failedMember = (reason: import('./build-review-artifacts.js').BuildReviewCustomInfrastructureFailureReason, detail: string): BuildReviewCustomArtifactMember => ({
      declaration,
      result: { kind: 'infrastructure-failure', rubric: entry.id, reason, detail },
    });
    if (!this.providerRuntimes || !this.sessionStore || !this.buildReviewPolicyCatalog) {
      const output = `build_review custom policy ${entry.id} requires a candidate policy catalog adapter`;
      return { id: entry.id, success: true, output, member: failedMember('policy-load-failed', output) };
    }
    const source = inputs.sourceMaterialization?.contextFor(entry.id).source;
    if (!source && !this.usesInjectedBuildReviewGit) {
      const output = `build_review custom policy ${entry.id} has no frozen source materialization`;
      return { id: entry.id, success: true, output, member: failedMember('preflight-failed', output) };
    }
    const options: Omit<InvokeOptions, 'sessionId' | 'resume' | 'model' | 'effort'> = {
      prompt: `Build-review custom policy ${entry.id}: the candidate will supply the selected immutable policy contract before judgment. Return only the custom findings payload.`,
      cwd: source?.headPath ?? this.projectDir,
    };
    let failure: { reason: import('./build-review-artifacts.js').BuildReviewCustomInfrastructureFailureReason; detail: string } = {
      reason: 'provider-error', detail: `custom policy ${entry.id} did not produce a judgment`,
    };
    let cacheProvenance: Extract<BuildReviewBranchProvenance, { kind: 'cache-hit' }> | undefined;
    let coverageFailure = false;
    const controller = new AbortController();
    const deadlineAt = Date.now() + (this.config?.test_suite?.timeout_seconds ?? 300) * 1_000;
    // The outer deadline timer is registered before discovery's own timer.
    // Preserve its cause so that an in-flight catalog operation reports a
    // deadline rather than a generic cancellation when this timer fires first.
    const deadlineAbortReason = 'build-review-candidate-deadline';
    const timeout = setTimeout(() => controller.abort(deadlineAbortReason), Math.max(0, deadlineAt - Date.now()));
    let result: ProviderExecutionResult;
    try {
      result = await executeAuxiliaryProviderCandidates({
      step: 'build_review', memberId: entry.id, policy: entry.policy,
      runtimes: this.providerRuntimes, sessions: this.sessionStore.beginBranch(`build-review:${entry.id}`),
      config: this.config, runId: this.runId, tier,
      taskAttribution: this.taskAttribution,
      withCandidateSafety: this.candidateSafetyFor('build_review')?.wrapper ?? this.withCandidateSafety,
      prepareCandidateSelfHost: this.providerExecutionContext?.prepareCandidateSelfHost ?? this.prepareCandidateSelfHost,
      onAttempt: this.providerAttempt, warn: this.providerWarn, options,
      abortSignal: controller.signal, deadlineAt,
      preparedCandidateOperation: async (context) => {
        const emitPolicyFailure = async (
          stage: 'catalog' | 'capture' | 'preflight' | 'containment' | 'runtime',
          reason: string,
          candidate = context.candidate,
        ) => this.events?.emit({
          type: 'build_review_policy_failed', rubric: entry.id, lapId,
          provider: candidate.providerKey, stage, reason,
          provenance: { inputDigest: inputs.sourceSnapshot.contentDigest, candidate: {
            provider: candidate.providerKey, model: candidate.model, effort: candidate.effort ?? 'default',
          } },
        });
        const catalogProvider = context.candidate.providerKey === 'claude' || context.candidate.providerKey === 'codex'
          ? context.candidate.providerKey
          : undefined;
        if (!catalogProvider) {
          coverageFailure = true;
          failure = { reason: 'policy-load-failed', detail: `Installed build-review policy ${entry.skill} has no catalog adapter for provider ${context.candidate.providerKey}` };
          await emitPolicyFailure('catalog', failure.detail);
          return { kind: 'failure' as const, result: { success: false, exitCode: 1, output: failure.detail } };
        }
        let catalog: readonly InstalledReviewSkill[] | ReviewPolicyCatalogError;
        let releaseDiscoveryAuthority: (() => void) | undefined;
        try {
          if (context.abortSignal?.aborted) throw new ReviewPolicyCatalogError(catalogProvider, 'cancelled', 'candidate cancelled before policy catalog discovery');
          if (context.deadlineAt !== undefined && Date.now() >= context.deadlineAt) throw new ReviewPolicyCatalogError(catalogProvider, 'timeout', 'candidate deadline elapsed before policy catalog discovery');
          // One discovery signal: the candidate's cancellation joined with a
          // timer for its deadline, so an in-flight request cannot outlive it.
          const discovery = new AbortController();
          let deadlineElapsed = false;
          const cancelDiscovery = () => {
            deadlineElapsed ||= context.abortSignal?.reason === deadlineAbortReason;
            discovery.abort();
          };
          context.abortSignal?.addEventListener('abort', cancelDiscovery, { once: true });
          const deadlineTimer = context.deadlineAt === undefined ? undefined : setTimeout(() => {
            deadlineElapsed = true;
            discovery.abort();
          }, Math.max(0, context.deadlineAt - Date.now()));
          releaseDiscoveryAuthority = () => {
            if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
            context.abortSignal?.removeEventListener('abort', cancelDiscovery);
          };
          context.onTeardown(async () => releaseDiscoveryAuthority?.());
          const request = this.buildReviewPolicyCatalog!({
            provider: context.candidate.providerKey,
            entry,
            skill: entry.skill,
            ...(context.prepared === undefined ? {} : { preparedEnv: context.prepared.env }),
            ...(context.prepared === undefined ? {} : { preparedExecutable: context.prepared.executable, preparedArgs: context.prepared.args }),
            ...(context.prepared?.originalCatalogHome === undefined ? {} : { originalCatalogHome: context.prepared.originalCatalogHome }),
            signal: discovery.signal,
            ...(context.deadlineAt === undefined ? {} : { deadlineAt: context.deadlineAt }),
          });
          // The owning candidate does not wait on a host that ignores the signal.
          const aborted = new Promise<never>((_resolve, reject) => {
            const refuse = () => reject(new Error('policy catalog discovery aborted'));
            if (discovery.signal.aborted) refuse();
            else discovery.signal.addEventListener('abort', refuse, { once: true });
          });
          request.catch(() => undefined);
          aborted.catch(() => undefined);
          try {
            catalog = await Promise.race([request, aborted]);
          } catch (error) {
            // Whatever the host threw on abort, the owning authority names the reason.
            if (!discovery.signal.aborted) throw error;
            throw deadlineElapsed || (context.deadlineAt !== undefined && Date.now() >= context.deadlineAt)
              ? new ReviewPolicyCatalogError(catalogProvider, 'timeout', 'candidate deadline elapsed during policy catalog discovery')
              : new ReviewPolicyCatalogError(catalogProvider, 'cancelled', 'candidate cancelled during policy catalog discovery');
          }
        } catch (error) {
          catalog = error instanceof ReviewPolicyCatalogError
            ? error
            : new ReviewPolicyCatalogError(catalogProvider, 'error', error instanceof Error ? error.message : String(error));
        } finally {
          releaseDiscoveryAuthority?.();
        }
        const resolved = resolveInstalledReviewPolicyCatalog({
          skill: entry.skill,
          ...(entry.source === undefined ? {} : { source: entry.source as InstalledReviewSkill['source'] }),
        }, catalog);
        if (resolved.kind === 'failure') {
          const resolutionDetail = 'origins' in resolved.failure && resolved.failure.origins !== undefined
            ? `conflicting installed sources: ${resolved.failure.origins.join(', ')}; choose one source explicitly`
            : 'source' in resolved.failure && resolved.failure.source !== undefined
              ? `requested source: ${resolved.failure.source}`
              : 'message' in resolved.failure
                ? resolved.failure.message
                : 'no source was selected';
          const detail = `Installed build-review policy ${entry.skill} is unavailable: ${resolved.failure.code}; ${resolutionDetail}`;
          failure = { reason: 'policy-load-failed', detail };
          coverageFailure = true;
          await emitPolicyFailure('catalog', detail);
          return { kind: 'failure' as const, result: {
            success: false, exitCode: 1,
            output: failure.detail,
          } };
        }
        const policy = {
          ...resolved.policy,
          declaredDependencies: [...new Set([...resolved.policy.declaredDependencies, ...entry.resources])],
        };
        let bundle: CapturedReviewPolicyBundle;
        try {
          bundle = await this.buildReviewPolicyCapture(policy, {
            materialParent: join(this.projectDir, '.pipeline', 'build-review', 'policy-material'),
          });
        } catch (error) {
          coverageFailure = true;
          failure = { reason: 'policy-load-failed', detail: `Installed build-review policy ${entry.skill} could not be loaded: ${error instanceof Error ? error.message : String(error)}` };
          await emitPolicyFailure('capture', failure.detail);
          return { kind: 'failure' as const, result: {
            success: false, exitCode: 1,
            output: failure.detail,
          } };
        }
        const candidateEngine = await this.resolveBuildReviewEngineIdentity();
        const policyProvenance = {
          inputDigest: inputs.sourceSnapshot.contentDigest,
          candidate: { provider: context.candidate.providerKey, model: context.candidate.model, effort: context.candidate.effort ?? 'default' },
          ...(policy.plugin === undefined ? {} : { plugin: policy.plugin }),
        };
        const policyFingerprint = fingerprintBuildReviewPolicyDeclaration({ rubric: entry.id, skill: entry.skill, question: entry.question, ...(entry.source === undefined ? {} : { source: entry.source as 'project' | 'global' | 'plugin' }), resources: entry.resources });
        const semanticIdentityFor = (model: string): BuildReviewCacheSemanticIdentity => ({
          declarationFingerprint: policyFingerprint, effectiveBundleDigest: bundle.digest, contractVersion: 'v3', projectionVersion: 'v3',
          semanticInputDigest: inputs.sourceSnapshot.contentDigest, executionPolicyFingerprint: fingerprintBuildReviewRubricPolicy(entry.policy),
          engineStamp: candidateEngine.engineStamp, provider: context.candidate.providerKey, model, effort: context.candidate.effort ?? 'default',
        });
        const provider = context.candidate.providerKey === 'claude' || context.candidate.providerKey === 'codex'
          ? context.candidate.providerKey
          : undefined;
        if (!provider) {
          coverageFailure = true;
          failure = { reason: 'preflight-failed', detail: `Installed build-review policy ${entry.skill} has no read-only profile for provider ${context.candidate.providerKey}` };
          await emitPolicyFailure('preflight', failure.detail);
          return { kind: 'failure' as const, result: { success: false, exitCode: 1, output: failure.detail } };
        }
        const preflight = evaluateBuildReviewPolicyPreflight({
          profile: {
            provider,
            admittedActions: ['read-frozen-input', 'read-policy-material'],
            admittedCapabilities: ['frozen-input', 'policy-material'],
            admittedTools: establishedBuildReviewTools(provider),
            // Bundle capture independently establishes the readable package resources.
            admittedDependencies: bundle.manifest.map((file) => file.relativePath),
          },
          requirements: [
            { kind: 'action', action: 'read-frozen-input' },
            { kind: 'action', action: 'read-policy-material' },
            ...(policy.requiredTools ?? []).map((tool) => ({ kind: 'tool' as const, tool })),
            ...policy.declaredDependencies.map((dependency) => ({ kind: 'dependency' as const, dependency: resolveReviewPolicyPackageReference(dependency), source: 'host' as const })),
          ],
        });
        if (preflight.kind !== 'admitted') {
          coverageFailure = true;
          const classification = classifyBuildReviewPolicyIncompatibility(preflight);
          failure = { reason: classification.reason, detail: renderBuildReviewPolicyUnsupportedDiagnostic(preflight) };
          await emitPolicyFailure('preflight', failure.detail);
          return { kind: 'failure' as const, result: { success: false, exitCode: 1, output: failure.detail } };
        }
        // The prepared-candidate callback is the only route that can bind a
        // frozen cwd and proved access profile to this actual provider.
        let reviewAccess: InvokeOptions['reviewAccess'];
        if (source) {
          const cachedLoginSource = provider === 'codex' && context.prepared?.env.CODEX_HOME !== undefined && context.prepared.env.CODEX_API_KEY === undefined
            ? join(context.prepared.env.CODEX_HOME, 'auth.json')
            : undefined;
          const scratchLease = await acquireReviewScratchHome({
            worktreeRoot: this.projectDir, runId: this.runId, attempt: 0, provider, memberId: entry.id,
            ...(cachedLoginSource === undefined ? {} : {
              seed: async (home) => { await copySelectedCodexLogin({ source: cachedLoginSource, homeDir: join(home, 'codex-home') }); },
            }),
          });
          context.onTeardown(() => scratchLease.release());
          const scratch = scratchLease.home;
          const evidencePaths = await prepareBuildReviewEvidencePaths(this.projectDir);
          const hostStateProbe = await writeReviewHostStateSentinel();
          context.onTeardown(() => rm(hostStateProbe, { force: true }));
          const containment = await prepareBuildReviewContainment({
            provider,
            launch: reviewLaunchCommand(provider, context.prepared),
            paths: {
              ...buildReviewFrozenInputPaths(source), policyMaterial: bundle.materialPath,
              originalCheckout: this.projectDir, originalInstallation: policy.packageRoot,
              ...evidencePaths, scratch,
              installationWriteProbe: join(policy.packageRoot, '.build-review-write-probe'),
              scratchWriteProbe: join(scratch, '.build-review-write-probe'),
              hostStateProbe,
            },
            runProcess: async (executable, args) => {
              const result = await execa(executable, args, { reject: false });
              return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
            },
          });
          if (containment.kind === 'unsupported') {
            coverageFailure = true;
            failure = { reason: 'preflight-failed', detail: `Installed build-review policy ${entry.skill} cannot establish read-only containment: ${containment.reason}. Recovery: ${containment.recovery}.` };
            await emitPolicyFailure('containment', containment.reason);
            return { kind: 'failure' as const, result: { success: false, exitCode: 1, output: failure.detail } };
          }
          reviewAccess = containment;
        }
        let cacheHit = false;
        const dispatched = await dispatchRubricContract({
          descriptor: entry.contract,
          options: {
            prompt: `${renderBuildReviewPolicyContract({
            bundle, question: entry.question,
            scope: renderBuildReviewFrozenInputScope({
              contentDigest: inputs.sourceSnapshot.contentDigest, mergeBase: inputs.sourceSnapshot.mergeBase, headSha: inputs.sourceSnapshot.headSha,
              changes: inputs.sourceSnapshot.sourceChanges ?? [], ...(source === undefined ? {} : { view: source }),
            }),
            })}\n\n${renderAuxiliarySkillInvocation(entry.skill, context.candidate.providerKey)}`,
            cwd: source?.headPath ?? this.projectDir,
            ...(reviewAccess === undefined ? {} : { reviewAccess }),
          },
          invoke: (options) => context.invoke(options, async (rung, invoke) => {
          const semanticIdentity = semanticIdentityFor(rung.model);
          const cached = await readBuildReviewCacheEntry(this.projectDir, entry.id, { readFile: async (path) => readFile(path, 'utf-8'), readdir, mkdir: async (path) => { await mkdir(path, { recursive: true }); }, writeFile, rename }, semanticIdentity);
          const cache = classifyBuildReviewCacheLookup(cached, {
            rubric: entry.id, contractVersion: 'v3', projectionVersion: 'v3', projectionDigest: inputs.sourceSnapshot.contentDigest,
            policyFingerprint, engineIdentity: { engineStamp: candidateEngine.engineStamp, skillDigest: bundle.digest }, semanticIdentity, lapId, snapshotDigest: inputs.sourceSnapshot.digest,
          });
          await emitBuildReviewCacheDiscard(async (event) => { await this.events?.emit(event); }, cache, entry.id, lapId, candidateEngine.engineStamp);
          if (cache.kind === 'hit' && 'result' in cache.hit.result && parseBuildReviewCustomArtifactMember(cache.hit.result)) {
            cacheHit = true;
            cacheProvenance = cache.hit.provenance;
            await this.events?.emit({ type: 'build_review_cache_hit', rubric: entry.id, lapId, customReuse: {
              source: policy.source, bundleDigest: bundle.digest, ...policyProvenance,
              originalLapId: cache.hit.provenance.cachedLapId, originalSnapshotDigest: cache.hit.provenance.cachedSnapshotDigest,
            } });
            return { success: true, exitCode: 0, output: JSON.stringify(cache.hit.result), providerInvocationSkipped: true };
          }
          return invoke();
          }),
        });
        const invoked = dispatched.invocation;
        if (cacheHit) return { kind: 'hit' as const, result: invoked };
        if (!invoked.success) {
          coverageFailure = true;
          failure = { reason: 'provider-error', detail: invoked.output ?? `Installed build-review policy ${entry.skill} provider failed` };
          await emitPolicyFailure('runtime', failure.detail);
          return { kind: 'failure' as const, result: invoked };
        }
        const actualModel = context.invokedModel() ?? context.candidate.model;
        const actualSemanticIdentity = semanticIdentityFor(actualModel);
        const actualPolicyProvenance = {
          ...policyProvenance,
          candidate: { provider: context.candidate.providerKey, model: actualModel, effort: context.candidate.effort ?? 'default' },
        };
        await this.events?.emit({
          type: 'build_review_policy_resolved', rubric: entry.id, lapId,
          provider: context.candidate.providerKey, source: policy.source,
          ...(policy.plugin === undefined ? {} : { pluginId: policy.plugin.id }),
          bundleDigest: bundle.digest,
          provenance: actualPolicyProvenance,
        });
        if (dispatched.kind === 'root-rejection') {
          coverageFailure = true;
          failure = { reason: 'malformed-artifact', detail: `Installed build-review policy ${entry.skill} ${dispatched.rejection.field}: ${dispatched.rejection.problem}` };
          await emitPolicyFailure('runtime', failure.detail, { ...context.candidate, model: actualModel });
          return { kind: 'failure' as const, result: { success: false, exitCode: 1, output: failure.detail } };
        }
        const parsed = dispatched.kind === 'structured' ? dispatched.parsed : undefined;
        const runtimeUnsupported = parseBuildReviewPolicyRuntimeUnsupportedResponse(parsed, provider);
        if (runtimeUnsupported) {
          coverageFailure = true;
          const classification = classifyBuildReviewPolicyIncompatibility(runtimeUnsupported);
          failure = { reason: classification.reason, detail: renderBuildReviewPolicyUnsupportedDiagnostic(runtimeUnsupported) };
          await emitPolicyFailure('runtime', failure.detail, { ...context.candidate, model: actualModel });
          return { kind: 'failure' as const, result: { success: false, exitCode: 1, output: failure.detail } };
        }
        if (!parsed || parsed.kind === 'unsupported-policy' || parsed.kind !== 'custom-findings') {
          coverageFailure = true;
          failure = {
            reason: parsed?.kind === 'unsupported-policy' ? 'preflight-failed' : 'malformed-artifact',
            detail: parsed?.kind === 'unsupported-policy'
              ? `Installed build-review policy ${entry.skill} is unsupported: ${parsed.requirement}`
              : 'Installed build-review policy returned an invalid custom findings payload',
          };
          await emitPolicyFailure('runtime', failure.detail, { ...context.candidate, model: actualModel });
          return { kind: 'failure' as const, result: {
            success: false, exitCode: 1,
            output: failure.detail,
          } };
        }
        // The admitted reference set is derived by the engine from the frozen
        // baseline/head commits: each claimed region is re-read and re-hashed
        // from pinned blobs before the identity stamper may bind it.
        const frozenBlobs = new BuildReviewScopeSource(this.gitRunner, inputs.sourceSnapshot.headSha);
        const admission = await admitBuildReviewCustomSourceRegions(
          parsed.findings.flatMap((finding) => finding.sourceRegions),
          inputs.sourceSnapshot.sourceChanges ?? [],
          { read: (side, path) => frozenBlobs.readAtOptional(side === 'head' ? inputs.sourceSnapshot.headSha : inputs.sourceSnapshot.mergeBase, path) },
        );
        if (admission.kind === 'rejected') {
          coverageFailure = true;
          failure = { reason: 'malformed-artifact', detail: `Installed build-review policy cited unverifiable source evidence (${admission.reason}): ${admission.detail}` };
          await emitPolicyFailure('runtime', failure.detail, { ...context.candidate, model: actualModel });
          return { kind: 'failure' as const, result: {
            success: false, exitCode: 1,
            output: failure.detail,
          } };
        }
        const sourceRegions = admission.sourceRegions;
        const stamped = stampBuildReviewCustomJudgedResult(parsed, {
          rubric: entry.id,
          lapId,
          declaration: {
            version: 'v1', rubricId: entry.id, semanticSkill: entry.skill,
            question: entry.question,
            ...(entry.source === undefined ? {} : { source: entry.source as 'project' | 'global' | 'plugin' }),
            resources: entry.resources,
          },
          policy: { version: 'v1', bundleDigest: bundle.digest },
          candidate: {
            provider: context.candidate.providerKey,
            model: actualModel,
            effort: context.candidate.effort ?? 'default',
          },
          reviewedInput: { version: 'v1', contentDigest: inputs.sourceSnapshot.contentDigest },
        }, { sourceRegions });
        if (!stamped) {
          coverageFailure = true;
          failure = { reason: 'malformed-artifact', detail: 'Installed build-review policy returned findings that could not be stamped against the frozen input' };
          await emitPolicyFailure('runtime', failure.detail, { ...context.candidate, model: actualModel });
          return { kind: 'failure' as const, result: {
            success: false, exitCode: 1,
            output: failure.detail,
          } };
        }
        const member: BuildReviewCustomArtifactMember = {
          descriptor: {
            version: 'v1', semanticSkill: entry.skill,
            declaration: stamped.declaration,
            installation: {
              source: policy.source,
              ...(policy.plugin === undefined ? {} : { plugin: policy.plugin }),
            },
          effectivePolicy: stamped.policy,
            // No `criteria`: a captured package file is reviewer instruction
            // text (and, for a plugin, sibling skills too), not an adjudication
            // criterion. The adjudicator falls back to the short declared
            // `resources` references; the bundle digest binds every byte.
            reviewedInput: stamped.reviewedInput,
            producer: stamped.candidate,
          },
          result: stamped,
        };
        const cacheWrite = await tryWriteBuildReviewCacheEntry(this.projectDir, {
            version: 2, rubric: entry.id, contractVersion: 'v3', projectionVersion: 'v3', projectionDigest: inputs.sourceSnapshot.contentDigest,
            policyFingerprint, engineIdentity: { engineStamp: candidateEngine.engineStamp, skillDigest: bundle.digest }, semanticIdentity: actualSemanticIdentity, result: member,
          }, { readFile: async (path) => readFile(path, 'utf-8'), mkdir: async (path) => { await mkdir(path, { recursive: true }); }, writeFile, rename });
        if (!cacheWrite.ok) {
          coverageFailure = true;
          failure = { reason: 'artifact-write-failed', detail: `Installed build-review policy ${entry.skill} could not persist its cache: ${cacheWrite.error instanceof Error ? cacheWrite.error.message : String(cacheWrite.error)}` };
          await emitPolicyFailure('runtime', failure.detail, { ...context.candidate, model: actualModel });
          return { kind: 'failure' as const, result: { success: false, exitCode: 1, output: failure.detail } };
        }
        return { kind: 'judged' as const, result: {
          ...invoked,
          output: JSON.stringify(member),
        } };
      },
      });
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
    await inputs.sourceMaterialization?.settle(entry.id);
    this.callCount++;
    const member = result.success ? (() => {
      try { return parseBuildReviewCustomArtifactMember(JSON.parse(result.output)); } catch { return undefined; }
    })() : undefined;
    const durableMember = member ?? (coverageFailure ? failedMember(failure.reason, failure.detail) : undefined);
    if (durableMember !== undefined) {
      try {
        const artifactProvenance: BuildReviewBranchProvenance = cacheProvenance ?? { kind: 'fresh' };
        await writeBuildReviewBranchArtifact(this.projectDir, {
          rubric: entry.id,
          lapId,
          snapshotDigest: inputs.sourceSnapshot.digest,
          result: durableMember.result,
          provenance: artifactProvenance,
          ...(durableMember.descriptor === undefined ? {} : { descriptor: durableMember.descriptor }),
          ...(durableMember.declaration === undefined ? {} : { declaration: durableMember.declaration }),
          ...(cacheProvenance === undefined ? {} : {
            reuse: { sourceLapId: cacheProvenance.cachedLapId, sourceSnapshotDigest: cacheProvenance.cachedSnapshotDigest },
          }),
        }, {
          readFile: async (path) => readFile(path, 'utf-8'),
          mkdir: async (path) => { await mkdir(path, { recursive: true }); }, writeFile, rename,
        });
      } catch (error) {
        return { id: entry.id, success: false, output: `Installed build-review policy ${entry.skill} could not persist its branch artifact: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    if (!result.success) {
      if (!coverageFailure) return { id: entry.id, success: false, output: result.output ?? failure.detail };
      return { id: entry.id, success: true, output: result.output ?? failure.detail, member: failedMember(failure.reason, failure.detail) };
    }
    return {
      id: entry.id,
      success: result.success && member !== undefined,
      output: member === undefined && result.success
        ? `Installed build-review policy ${entry.skill} produced an invalid durable result`
        : result.output,
      ...(member === undefined ? {} : { member }),
    };
  }

  /** Publish a complete aggregate when custom policies are the only members. */
  private async publishCustomOnlyBuildReview(input: {
    readonly lapId: BuildReviewLapId;
    readonly inputs: BuildReviewFrozenInputs;
    readonly customResults: Readonly<Record<string, BuildReviewCustomArtifactMember>>;
    readonly currentCustomRubrics: readonly string[];
    readonly config: ReturnType<typeof resolveBuildReviewConfig>;
  }): Promise<StepRunResult> {
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId: input.lapId,
      snapshotDigest: input.inputs.sourceSnapshot.digest,
      results: { testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' } },
      customResults: input.customResults,
      currentCustomRubrics: input.currentCustomRubrics,
    });
    // An infrastructure-only lap belongs to the mechanical retry lane: below
    // the allowance no aggregate, effective resolution, or verdict may exist,
    // so completion stays absent and no semantic route can observe the lap.
    const lapResults = Object.values(input.customResults).map((member) => member.result);
    const infrastructureFailure = lapResults.find((result): result is Extract<BuildReviewRubricResult, { kind: 'infrastructure-failure' }> =>
      result.kind === 'infrastructure-failure',
    );
    const hasFinding = lapResults.some((result) => result.kind === 'judged' && result.findings.length > 0);
    if (infrastructureFailure && !hasFinding) {
      const mechanicalFaults = await bumpMechanicalFaultsInLedger(this.projectDir, 'build_review', {
        rubric: infrastructureFailure.rubric,
        reason: infrastructureFailure.reason,
        detail: infrastructureFailure.detail,
        lapId: input.lapId,
      });
      if (mechanicalFaults.mechanicalFaults! < MAX_MECHANICAL_FAULTS_BUILD_REVIEW) {
        return {
          success: false,
          output: `build_review mechanical fault in ${infrastructureFailure.rubric} (${infrastructureFailure.reason}): ${infrastructureFailure.detail}`,
          currentLapMechanicalFault: true,
        };
      }
    }
    const pipelineDir = this.pipelineDir ?? join(this.projectDir, '.pipeline');
    const aggregatePath = join(pipelineDir, 'build-review.json');
    // adr-2026-08-18 D9: effective state resolves BEFORE publication so a
    // reduced-coverage lap's evidence is stamped into the one aggregate that
    // is persisted; an unrenderable record fails resolution, so no PASS can
    // be published without it.
    const effective = await this.buildReviewEffectiveResolver(this.projectDir, aggregate, {
      emit: (event) => this.events?.emit(event),
      minConfidence: buildReviewConfidenceFloors(input.config),
    });
    const stampedAggregate = effective.ok && effective.reducedCoverageEvidence !== undefined
      ? { ...aggregate, reducedCoverageEvidence: effective.reducedCoverageEvidence }
      : aggregate;
    try {
      await mkdir(pipelineDir, { recursive: true });
      const temporaryPath = `${aggregatePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(stampedAggregate, null, 2)}\n`, 'utf-8');
      await rename(temporaryPath, aggregatePath);
    } catch (error) {
      return { success: false, output: `build_review aggregate publication failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    // adr-2026-08-29 D4.6: one projection feeds both the visibility event and
    // the durable-history seam below.
    const suppressionEntries = await this.emitBuildReviewOuterVerdict(input.lapId, aggregate, effective, input.config);
    if (!effective.ok) {
      // A failed custom policy has already crossed its authoritative boundary:
      // preserve its typed, candidate-local diagnostic even when the later
      // feature-scoped disposition reader is unavailable.  Otherwise an
      // ambiguous/missing catalog is incorrectly reported as an unrelated
      // disposition-identity fault, violating the terminal loading contract.
      const policyFailure = Object.values(input.customResults).find((member) =>
        member.result.kind === 'infrastructure-failure',
      );
      if (policyFailure?.result.kind === 'infrastructure-failure') {
        return { success: false, output: `${JSON.stringify(aggregate)}\n\n${policyFailure.result.detail}` };
      }
      return { success: false, output: `build_review disposition resolution failed: ${effective.reason}` };
    }
    // Written before the pass/fail fork: a fully suppressed lap is an effective
    // PASS that never reaches the adjudication coordinator (D4.4), and the
    // seam is the same idempotent single writer the mixed path uses.
    const persistedSuppressions = await persistBuildReviewSuppressions({
      projectRoot: this.projectDir,
      feature: effective.feature,
      suppressions: suppressionEntries,
    });
    if (!persistedSuppressions.ok) {
      return { success: false, output: `build_review suppression history persistence failed: ${persistedSuppressions.reason}` };
    }
    if (effective.effective.verdict === 'PASS') await this.stampBuildReviewVerdict();
    return {
      success: effective.effective.verdict === 'PASS' || hasFinding,
      output: JSON.stringify(aggregate),
      ...(infrastructureFailure === undefined || hasFinding ? {} : { currentLapMechanicalFault: true }),
    };
  }

  /** Emits exactly one validated custom judgement per current-lap member. */
  private async emitBuildReviewCustomMemberResults(
    lapId: BuildReviewLapId,
    customResults: Readonly<Record<string, BuildReviewCustomArtifactMember>>,
  ): Promise<void> {
    for (const member of Object.values(customResults)) {
      if (member.result.kind !== 'judged') continue;
      await this.events?.emit({
        type: 'build_review_rubric_result',
        rubric: member.result.declaration.rubricId,
        lapId,
        verdict: member.result.verdict,
      });
    }
  }

  /** Shares the verdict occurrence and suppression projection across lap shapes. */
  private async emitBuildReviewOuterVerdict(
    lapId: BuildReviewLapId,
    aggregate: BuildReviewAggregate,
    effective: BuildReviewEffectiveResolution,
    config: ReturnType<typeof resolveBuildReviewConfig>,
  ): Promise<ReturnType<typeof projectBuildReviewSuppressionEntries>> {
    // adr-2026-08-29 D4.6: one projection of this lap's sub-floor findings,
    // shared by the visibility event (D4.5) and the durable-history seam.
    const suppressionEntries = effective.ok
      ? projectBuildReviewSuppressionEntries({
          aggregate,
          suppressedFindingIds: effective.effective.suppressedFindingIds ?? [],
          floors: buildReviewConfidenceFloors(config),
        })
      : [];
    await this.events?.emit({
      type: 'build_review_outer_verdict',
      lapId,
      rawVerdict: aggregate.verdict,
      effectiveVerdict: effective.ok ? effective.effective.verdict : 'FAIL',
      ...(suppressionEntries.length > 0
        ? { suppressedFindings: suppressionEntries.map(({ findingId, rubric, confidence, floor }) => ({ findingId, rubric, confidence, floor })) }
        : {}),
    });
    return suppressionEntries;
  }

  private async dispatchBuildReviewRubric(
    branch: BuildReviewDispatchableRubric,
    projection: BuildReviewRubricProjection,
    tier?: ConductState['complexity_tier'],
    executionContext?: ExecutionContext,
    inputs?: BuildReviewFrozenInputs,
    engineIdentity?: BuildReviewCoordinationEngineIdentity,
  ): Promise<unknown> {
    const materialized = inputs?.sourceMaterialization?.contextFor(branch.rubric).source;
    const candidateIdentity = (candidate: { providerKey: string; model: string; effort?: string }, effectiveBundleDigest?: string): BuildReviewCacheSemanticIdentity | undefined => {
      const skillDigest = engineIdentity?.skillDigests[branch.rubric];
      const digest = effectiveBundleDigest ?? (skillDigest?.kind === 'resolved' ? skillDigest.digest : undefined);
      if (!engineIdentity || !digest) return undefined;
      return {
        declarationFingerprint: `sha256:${createHash('sha256').update(JSON.stringify({ rubric: branch.rubric, contractVersion: projection.contractVersion, projectionVersion: projection.projectionVersion })).digest('hex')}`,
        effectiveBundleDigest: digest,
        contractVersion: projection.contractVersion,
        projectionVersion: projection.projectionVersion,
        semanticInputDigest: projection.digest,
        executionPolicyFingerprint: fingerprintBuildReviewRubricPolicy(branch.policy),
        engineStamp: engineIdentity.engineStamp,
        provider: candidate.providerKey,
        model: candidate.model,
        effort: candidate.effort ?? 'default',
      };
    };
    const label: Record<BuildReviewDispatchableRubric['rubric'], string> = {
      testQuality: 'Test Quality',
      security: 'Security',
    };
    const contractShape = renderRubricContractShape(getBuildReviewRubricDescriptor(branch.rubric).contract);
    const payloadInstruction: Record<BuildReviewDispatchableRubric['rubric'], string> = {
      testQuality: '`findings` is an array; `scopeResolutions` has exactly one entry per supplied candidate (or [] when no candidates); and `counterfactualSensitivity` is optional.',
      security: '`findings` is an array using only the Security concern kinds. Do not return scope resolutions or counterfactual sensitivity.',
    };
    const rubricPrompt = [
        `Build Review ${label[branch.rubric]} rubric.`,
        'You are running inside the feature worktree. The closed projection below identifies the implementation diff BY REFERENCE instead of embedding it: changedFiles lists each changed file\'s path, change kind, and hunk line ranges (oldStart,oldCount -> newStart,newCount) from the graded diff. Read the working-tree files and run git yourself for any content you need — for example `git diff <mergeBase>..HEAD -- <path>` for one file\'s diff, or `git show <mergeBase>:<path>` for its pre-change form — using the mergeBase and headSha fields of the projection. Judge only the referenced changes; treat the projection as the complete list of what changed.',
        `Return only the provider payload shape below: ${payloadInstruction[branch.rubric]} The engine stamps the judged envelope identity afterward. Every finding must include a non-empty actionable summary and one or more concrete evidenceLocations in path:line or path:line:column form.`,
        ...(branch.rubric === 'testQuality'
          ? [
              'For each testScope.evidence record, re-read its region at the pinned ref instead of the mutable working tree: use `git show <mergeBase>:<path>` for a base-side region or `git show <headSha>:<path>` for a head-side region, and verify `contentHash` as sha256 of the raw bytes from `byteRegion.start` (inclusive) to `byteRegion.end` (exclusive) of that exact output. `byteRegion` is in UTF-8 bytes; `region`, `startLine`, and `endLine` are character positions for identity and orientation only and must not be used as byte offsets. The evidence record for a candidate is the one whose `id` equals its `candidateId`. A hash-mismatched or unreadable region is not judged; return its fallback candidate as `indeterminate` with a non-empty `missingEvidenceReason`.',
              `Candidate-resolution authority (use only these ids, regions, and obligations):\n${JSON.stringify(buildReviewCandidateScopeResolutionContext(projection))}`,
            ]
          : []),
        `Your final message MUST end with a JSON object of exactly this shape (an empty findings array means no concern; anchor values follow the schema below exactly — content-region fields (\`changedTest\`, \`locus\`) are structured \`{path, contentHash, display, occurrence?}\` objects; \`occurrence\` is the 0-based ordinal among equal-content regions in one path and is omitted for a unique or first region; every other anchor value is a plain string, all nested under \`anchor\` — never flattened to the finding's top level and never renamed):\n${contractShape}`,
        JSON.stringify(buildReviewRubricPromptView(projection)),
      ].join('\n\n');
    // Regression visibility for prompt bloat (#projection-size): record the
    // serialized rubric-prompt byte size on the event spine, per dispatch.
    await this.events?.emit({
      type: 'build_review_rubric_prompt',
      rubric: branch.rubric,
      lapId: projection.lapId,
      promptBytes: Buffer.byteLength(rubricPrompt, 'utf8'),
    });
    let cacheWriteFailureDetail: string | undefined;
    const invokeOnce = async (prompt: string): Promise<{
      success: boolean;
      output?: string;
      finalStructuredResult?: unknown;
      commandUnresolved?: boolean;
      commandUnresolvedName?: string;
      providerSetupExhaustion?: ProviderExecutionResult['providerSetupExhaustion'];
    }> => {
      const preserveInvocationFailure = (result: {
        success: boolean;
        output?: string;
        finalStructuredResult?: unknown;
        commandUnresolved?: boolean;
        commandUnresolvedName?: string;
        providerSetupExhaustion?: ProviderExecutionResult['providerSetupExhaustion'];
      }) => ({
        success: result.success,
        ...(typeof result.output === 'string' ? { output: result.output } : {}),
        ...(result.finalStructuredResult === undefined ? {} : { finalStructuredResult: result.finalStructuredResult }),
        ...(result.commandUnresolved ? {
          commandUnresolved: true,
          ...(result.commandUnresolvedName ? { commandUnresolvedName: result.commandUnresolvedName } : {}),
        } : {}),
        ...(result.providerSetupExhaustion
          ? { providerSetupExhaustion: result.providerSetupExhaustion }
          : {}),
      });
      if (this.providerRuntimes && this.sessionStore) {
        const safety = this.candidateSafetyFor('build_review');
        const controller = new AbortController();
        const deadlineAt = Date.now() + (this.config?.test_suite?.timeout_seconds ?? 300) * 1_000;
        const timeout = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - Date.now()));
        let result: ProviderExecutionResult;
        try {
          result = await this.dispatchProviderWithLifecycleSupervision(
          'build_review',
          this.withFeatureDiagnosticLog({
            prompt,
            cwd: materialized?.headPath ?? this.projectDir,
            dangerouslySkipPermissions: true,
          }),
          (options) => executeAuxiliaryProviderCandidates({
            step: 'build_review',
            executionContext,
            memberId: branch.rubric,
            policy: branch.policy,
            runtimes: this.providerRuntimes!,
            sessions: this.sessionStore!.beginBranch(`build-review:${branch.rubric}`),
            config: this.config,
            runId: this.runId,
            taskAttribution: this.taskAttribution,
            tier,
            withCandidateSafety: safety?.wrapper ?? this.withCandidateSafety,
            prepareCandidateSelfHost:
              this.providerExecutionContext?.prepareCandidateSelfHost ?? this.prepareCandidateSelfHost,
            onAttempt: this.providerAttempt,
            warn: this.providerWarn,
            abortSignal: controller.signal,
            deadlineAt,
            options,
            optionsForCandidate: (providerKey) => ({
              ...options,
              prompt: `${renderAuxiliarySkillInvocation(branch.skillName, providerKey)}\n\n${prompt}`,
            }),
            preparedCandidateOperation: async (context) => {
              // Direct rubric-dispatch callers retain the historic lifecycle:
              // they have no frozen inputs or run-level engine identity from
              // which a candidate-bound cache key could be derived.
              if (!inputs || !engineIdentity) {
                const dispatched = await dispatchRubricContract({
                  descriptor: getBuildReviewRubricDescriptor(branch.rubric).contract,
                  prepareStructured: (value) => stampBuildReviewDispatchedCandidate(value, branch.rubric, projection),
                  options: {
                    prompt: `${renderAuxiliarySkillInvocation(branch.skillName, context.candidate.providerKey)}\n\n${prompt}`,
                    cwd: materialized?.headPath ?? this.projectDir,
                    dangerouslySkipPermissions: true,
                  },
                  invoke: (options) => context.invoke(options),
                });
                return {
                  kind: 'judged' as const,
                  result: dispatched.kind === 'structured'
                    ? { ...dispatched.invocation, finalStructuredResult: dispatched.parsed }
                    : dispatched.invocation,
                };
              }
              // Built-ins use the same candidate-local installed definition
              // contract as custom policies. The old harness-root digest was
              // only an approximation of what the provider actually loaded.
              const builtinEntry = { id: branch.rubric, kind: 'builtin' as const, policy: branch.policy };
              let builtinPolicy: InstalledReviewSkill;
              let builtinBundle: CapturedReviewPolicyBundle;
              try {
                const catalog = await this.buildReviewPolicyCatalog!({
                  provider: context.candidate.providerKey,
                  entry: builtinEntry,
                  skill: branch.skillName,
                  ...(context.prepared === undefined ? {} : { preparedEnv: context.prepared.env }),
                  ...(context.prepared === undefined ? {} : { preparedExecutable: context.prepared.executable, preparedArgs: context.prepared.args }),
            ...(context.prepared?.originalCatalogHome === undefined ? {} : { originalCatalogHome: context.prepared.originalCatalogHome }),
                  ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
                  ...(context.deadlineAt === undefined ? {} : { deadlineAt: context.deadlineAt }),
                });
                const resolved = resolveInstalledReviewPolicyCatalog({ skill: branch.skillName }, catalog);
                if (resolved.kind === 'failure') throw new Error(`installed ${branch.skillName} policy is unavailable: ${resolved.failure.code}`);
                builtinPolicy = resolved.policy;
                builtinBundle = await this.buildReviewPolicyCapture(builtinPolicy, {
                  materialParent: join(this.projectDir, '.pipeline', 'build-review', 'policy-material'),
                });
              } catch (error) {
                return { kind: 'failure' as const, result: { success: false, exitCode: 1, output: `build_review candidate policy load failed: ${error instanceof Error ? error.message : String(error)}` } };
              }
              const containmentProvider = context.candidate.providerKey === 'claude' || context.candidate.providerKey === 'codex'
                ? context.candidate.providerKey : undefined;
              let reviewAccess: InvokeOptions['reviewAccess'];
              if (materialized && containmentProvider) {
                const cachedLoginSource = containmentProvider === 'codex' && context.prepared?.env.CODEX_HOME !== undefined && context.prepared.env.CODEX_API_KEY === undefined
                  ? join(context.prepared.env.CODEX_HOME, 'auth.json')
                  : undefined;
                const scratchLease = await acquireReviewScratchHome({
                  worktreeRoot: this.projectDir, runId: this.runId, attempt: 0, provider: containmentProvider, memberId: branch.rubric,
                  ...(cachedLoginSource === undefined ? {} : {
                    seed: async (home) => { await copySelectedCodexLogin({ source: cachedLoginSource, homeDir: join(home, 'codex-home') }); },
                  }),
                });
                context.onTeardown(() => scratchLease.release());
                const scratch = scratchLease.home;
                const evidencePaths = await prepareBuildReviewEvidencePaths(this.projectDir);
                const hostStateProbe = await writeReviewHostStateSentinel();
          context.onTeardown(() => rm(hostStateProbe, { force: true }));
                const containment = await prepareBuildReviewContainment({ provider: containmentProvider, launch: reviewLaunchCommand(containmentProvider, context.prepared), paths: {
                  hostStateProbe,
                  ...buildReviewFrozenInputPaths(materialized), policyMaterial: builtinBundle.materialPath, originalCheckout: this.projectDir, originalInstallation: builtinPolicy.packageRoot,
                  ...evidencePaths, scratch,
                  installationWriteProbe: join(builtinPolicy.packageRoot, '.build-review-write-probe'),
                  scratchWriteProbe: join(scratch, '.build-review-write-probe'),
                }, runProcess: async (executable, args) => { const result = await execa(executable, args, { reject: false }); return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr }; } });
                if (containment.kind === 'unsupported') return { kind: 'failure' as const, result: { success: false, exitCode: 1, output: `build_review cannot establish built-in read-only containment: ${containment.reason}` } };
                reviewAccess = containment;
              }
              let cacheHit = false;
              const dispatched = await dispatchRubricContract({
                descriptor: getBuildReviewRubricDescriptor(branch.rubric).contract,
                prepareStructured: (value) => stampBuildReviewDispatchedCandidate(value, branch.rubric, projection),
                options: {
                cwd: materialized?.headPath ?? this.projectDir,
                // Built-in peers of a custom-policy lap inspect the same frozen
                // baseline/head input the custom reviewers are bound to.
                prompt: `${builtinBundle.manifest.filter((file) => isUtf8(file.bytes)).map((file) => file.bytes.toString('utf8')).join('\n\n')}\n\n${rubricPrompt}${materialized === undefined ? '' : `\n\n${renderBuildReviewFrozenInputScope({
                  contentDigest: inputs.sourceSnapshot.contentDigest, mergeBase: inputs.sourceSnapshot.mergeBase, headSha: inputs.sourceSnapshot.headSha,
                  changes: inputs.sourceSnapshot.sourceChanges ?? [], view: materialized,
                })}`}`,
                ...(reviewAccess === undefined ? {} : { reviewAccess }),
                },
                invoke: (options) => context.invoke(options, async (rung, invoke) => {
                const semanticIdentity = candidateIdentity(rung, builtinBundle.digest);
                if (!semanticIdentity) return { success: false, exitCode: 1, output: 'build_review candidate cache identity is unavailable' };
                const cached = await readBuildReviewCacheEntry(this.projectDir, branch.rubric, {
                  readFile: async (path) => readFile(path, 'utf-8'), readdir, mkdir: async (path) => { await mkdir(path, { recursive: true }); }, writeFile, rename,
                }, semanticIdentity);
                const cache = classifyBuildReviewCacheLookup(cached, {
                  rubric: branch.rubric, contractVersion: projection.contractVersion, projectionVersion: projection.projectionVersion,
                  projectionDigest: projection.digest, policyFingerprint: fingerprintBuildReviewRubricPolicy(branch.policy),
                  engineIdentity: { engineStamp: engineIdentity.engineStamp, skillDigest: builtinBundle.digest }, semanticIdentity,
                  lapId: projection.lapId, snapshotDigest: projection.snapshotDigest,
                });
                await emitBuildReviewCacheDiscard(async (event) => { await this.events?.emit(event); }, cache, branch.rubric, projection.lapId, engineIdentity.engineStamp);
                if (cache.kind === 'hit' && validateBuildReviewDispatchedResult(cache.hit.result, branch.rubric, projection)) {
                  cacheHit = true;
                  await this.events?.emit({ type: 'build_review_cache_hit', rubric: branch.rubric, lapId: projection.lapId });
                  return { success: true, exitCode: 0, output: JSON.stringify(cache.hit.result), providerInvocationSkipped: true };
                }
                return invoke();
                }),
              });
              const invoked = dispatched.invocation;
              if (cacheHit) {
                await inputs?.sourceMaterialization?.settle(branch.rubric);
                return { kind: 'hit' as const, result: invoked };
              }
              if (!invoked.success) {
                await inputs?.sourceMaterialization?.settle(branch.rubric);
                return { kind: 'judged' as const, result: invoked };
              }
              const candidate = dispatched.kind === 'structured' ? dispatched.parsed : undefined;
              const judged = candidate === undefined ? undefined : validateBuildReviewDispatchedResult(candidate, branch.rubric, projection);
              if (judged) {
                const semanticIdentity = candidateIdentity({ ...context.candidate, model: context.invokedModel() ?? context.candidate.model }, builtinBundle.digest);
                if (!semanticIdentity) return { kind: 'failure' as const, result: { success: false, exitCode: 1, output: 'build_review candidate cache identity is unavailable' } };
                const cacheWrite = await tryWriteBuildReviewCacheEntry(this.projectDir, {
                version: 2, rubric: branch.rubric, contractVersion: projection.contractVersion, projectionVersion: projection.projectionVersion,
                projectionDigest: projection.digest, policyFingerprint: fingerprintBuildReviewRubricPolicy(branch.policy),
                engineIdentity: { engineStamp: engineIdentity.engineStamp, skillDigest: builtinBundle.digest }, semanticIdentity, result: judged,
                }, { readFile: async (path) => readFile(path, 'utf-8'), readdir, mkdir: async (path) => { await mkdir(path, { recursive: true }); }, writeFile, rename });
                if (!cacheWrite.ok) {
                  cacheWriteFailureDetail = cacheWrite.error instanceof Error ? cacheWrite.error.message : String(cacheWrite.error);
                  await inputs?.sourceMaterialization?.settle(branch.rubric);
                  return {
                    kind: 'failure' as const,
                    result: {
                      success: false,
                      exitCode: 1,
                      output: `build_review ${branch.rubric} cache-write-failed: ${cacheWriteFailureDetail}`,
                    },
                  };
                }
              }
              await inputs?.sourceMaterialization?.settle(branch.rubric);
              return { kind: 'judged' as const, result: judged ? { ...invoked, output: JSON.stringify(judged), finalStructuredResult: judged } : invoked };
            },
          }),
            undefined,
            executionContext,
          );
        } finally {
          clearTimeout(timeout);
          controller.abort();
        }
        const verified = safety?.verify(result) ?? result;
        this.callCount++;
        return preserveInvocationFailure(verified);
      }
      const dispatched = await dispatchRubricContract({
        descriptor: getBuildReviewRubricDescriptor(branch.rubric).contract,
        prepareStructured: (value) => stampBuildReviewDispatchedCandidate(value, branch.rubric, projection),
        options: {
          prompt: `${renderAuxiliarySkillInvocation(branch.skillName, this.providerKey)}\n\n${prompt}`,
          dangerouslySkipPermissions: true,
          cwd: this.projectDir,
        },
        invoke: (options) => this.provider.invoke({
          ...options,
          sessionId: randomUUID(),
          resume: false,
          model: branch.policy.model,
          effort: branch.policy.effort,
        }),
      });
      this.callCount++;
      return preserveInvocationFailure(dispatched.kind === 'structured'
        ? { ...dispatched.invocation, finalStructuredResult: dispatched.parsed }
        : dispatched.invocation);
    };

    // Validate-and-repair loop (deterministic shape enforcement): a session
    // that answered but missed the judged contract gets exactly ONE bounded
    // repair invocation — a pure re-emit task carrying the rejection
    // diagnosis, the exact contract shape, and a bounded excerpt of its own
    // previous output — instead of burning the whole dispatch as an
    // infrastructure failure. Provider-agnostic by construction: both the
    // runtime-candidates path and the legacy provider path share invokeOnce.
    const initial = await invokeOnce(rubricPrompt);
    if (cacheWriteFailureDetail !== undefined) {
      return { kind: 'cache-write-failed', detail: cacheWriteFailureDetail };
    }
    if (initial.providerSetupExhaustion) {
      return makeBuildReviewDispatchFailure(
        `All configured providers were unavailable during setup: ${initial.providerSetupExhaustion.candidates.map(
          ({ provider, reason, recoveryAction }) => `${provider}: ${redactSafetyText(reason)} Recovery: ${redactSafetyText(recoveryAction)}`,
        ).join('; ')}`,
        initial.providerSetupExhaustion,
      );
    }
    if (initial.commandUnresolved) {
      return makeBuildReviewDispatchFailure(renderBuildReviewUnresolvedSkillRemedy(
        branch.skillName,
        initial.commandUnresolvedName ?? '',
      ));
    }
    if (!initial.success) return undefined;
    if (initial.finalStructuredResult === undefined || initial.finalStructuredResult === null || typeof initial.finalStructuredResult !== 'object' || Array.isArray(initial.finalStructuredResult)) {
      return makeBuildReviewDispatchFailure('root: a structured result is required');
    }
    const initialResult = validateBuildReviewDispatchedResult(initial.finalStructuredResult, branch.rubric, projection);
    const validated = initialResult ? { result: initialResult, rejection: '' } : { rejection: 'the structured result did not satisfy the judged contract' };
    if (validated.result) return validated.result;
    const repairPrompt = [
      `Your previous response for the Build Review ${label[branch.rubric]} rubric did not satisfy the judged-result contract: ${validated.rejection}.`,
      `Re-emit your judgement as ONLY one JSON object — no prose, no markdown fences, no other text — of exactly this shape:\n${contractShape}`,
      'Preserve the semantic content of your previous findings; change only the shape.',
      `Your previous response (bounded excerpt):\n${boundedHeadTailExcerpt(initial.output ?? '', RUBRIC_REPAIR_PROMPT_EXCERPT_CAP_BYTES)}`,
    ].join('\n\n');
    const repair = await invokeOnce(repairPrompt);
    if (repair.providerSetupExhaustion) {
      return makeBuildReviewDispatchFailure(
        `All configured providers were unavailable during setup: ${repair.providerSetupExhaustion.candidates.map(
          ({ provider, reason, recoveryAction }) => `${provider}: ${redactSafetyText(reason)} Recovery: ${redactSafetyText(recoveryAction)}`,
        ).join('; ')}`,
        repair.providerSetupExhaustion,
      );
    }
    if (repair.success && repair.output !== undefined) {
      if (repair.output === initial.output) {
        return makeBuildReviewDispatchFailure(
          'judged-result repair was byte-identical to the rejected output; no further retry can act on the same payload',
        );
      }
      const repaired = this.validateRubricOutput(repair.output, branch.rubric, projection);
      if (repaired.result) return repaired.result;
      return makeBuildReviewDispatchFailure(boundedHeadTailExcerpt(
        `judged-result contract not satisfied after one repair turn: ${repaired.rejection}. Raw output excerpt: ${repair.output}`,
        RUBRIC_FAILURE_DETAIL_CAP_BYTES,
      ));
    }
    return makeBuildReviewDispatchFailure(boundedHeadTailExcerpt(
      `judged-result contract not satisfied: ${validated.rejection}; the repair invocation failed. Raw output excerpt: ${initial.output}`,
      RUBRIC_FAILURE_DETAIL_CAP_BYTES,
    ));
  }

  /** Shared accept/reject predicate for rubric outputs — identical to the coordinator's settlement check. */
  private validateRubricOutput(
    output: string,
    rubric: BuildReviewDispatchableRubric['rubric'],
    projection: BuildReviewRubricProjection,
  ): { result?: ReturnType<typeof validateBuildReviewDispatchedResult>; rejection: string } {
    const candidate = extractJudgedResultCandidate(output);
    if (candidate === undefined) {
      return { rejection: 'no parseable JSON object was found in the response' };
    }
    const stampedCandidate = stampBuildReviewDispatchedCandidate(candidate, rubric, projection);
    const result = validateBuildReviewDispatchedResult(stampedCandidate, rubric, projection);
    if (result) return { result, rejection: '' };
    try {
      return {
        rejection: describeBuildReviewDispatchedResultRejection(stampedCandidate, rubric, projection),
      };
    } catch {
      // Diagnosis must never turn a repairable shape failure into a thrown
      // provider-error that burns the dispatch.
      return { rejection: 'the result did not satisfy the judged contract' };
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
        revertedProductionManifest: [],
        sourceIdentities: { mergeBase: inputs.sourceSnapshot.mergeBase, headSha: inputs.sourceSnapshot.headSha },
      };
    }
    const controller = new AbortController();
    const timeoutMs = (this.config?.test_suite?.timeout_seconds ?? 300) * 1_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
    const removalMaintenanceSelectors = deriveRemovalMaintenanceSelectors(
      inputs.diff,
      classified.tests,
      inputs.sourceSnapshot.removalContext,
    );
    const counterfactualFileSelectors = inputs.sourceSnapshot.testQuality?.counterfactualFileSelectors
      ?? classified.tests;
    return await materializeTautologyPreflight({
      scopedWorkingDirectory: this.projectDir,
      mergeBase: inputs.sourceSnapshot.mergeBase,
      headSha: inputs.sourceSnapshot.headSha,
      diff: inputs.diff,
      scopedCommand: this.config?.test_suite?.scoped_command ?? null,
      counterfactualFileSelectors,
      currentGreenProofIdentity: `${inputs.testSuiteProof.provenanceHeadSha}:${inputs.testSuiteProof.fingerprint}`,
      ...(removalMaintenanceSelectors.length > 0
        ? { approvedException: 'removal-maintenance' as const, removalMaintenanceSelectors }
        : {}),
      createCheckout: async (path, headSha) => {
        const result = await this.mutateWorktree(() => this.gitRunner(['worktree', 'add', '--detach', path, headSha]));
        if (result.exitCode !== 0) throw new Error(result.stderr);
        // A detached worktree contains tracked files only.  The source
        // worktree's dependency installation is deliberately ignored by git,
        // so expose it by reference rather than copying or tracking it.
        try {
          const sourceDependencies = join(this.projectDir, 'src', 'conductor', 'node_modules');
          const detachedDependencies = join(path, 'src', 'conductor', 'node_modules');
          await access(sourceDependencies);
          await mkdir(join(path, 'src', 'conductor'), { recursive: true });
          await Promise.all([
            symlink(sourceDependencies, detachedDependencies, 'dir'),
            symlink(sourceDependencies, join(path, 'node_modules'), 'dir'),
          ]);
        } catch (error: unknown) {
          // Missing dependencies remain the scoped command's ordinary
          // launch/runtime concern.  Do not make projects without a local
          // node_modules directory fail materialization merely for this aid.
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      },
      readMergeBaseFile: async (path) => {
        const result = await this.gitRunner(['show', `${inputs.sourceSnapshot.mergeBase}:${path}`]);
        return result.exitCode === 0 ? result.stdout : undefined;
      },
      writeFile,
      removeFile: async (path) => { await rm(path, { force: true }); },
      runScoped: async (cwd, selectors, signal) => this.runScopedTautologyCommand(cwd, selectors, signal),
      removeCheckout: async (path) => {
        await this.mutateWorktree(() => this.gitRunner(['worktree', 'remove', '--force', path]));
      },
      abortSignal: controller.signal,
      readCache: async (key) => this.tautologyPreflightCache.get(key),
      writeCache: async (key, evidence) => {
        if (this.tautologyPreflightCache.size >= 32) this.tautologyPreflightCache.delete(this.tautologyPreflightCache.keys().next().value!);
        this.tautologyPreflightCache.set(key, evidence);
      },
    });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async runScopedTautologyCommand(cwd: string, selectors: readonly string[], signal: AbortSignal): Promise<TautologyScopedRunResult> {
    return runBuildReviewScopedCommand({
      template: this.config?.test_suite?.scoped_command,
      selectors,
      cwd,
      signal,
      launcher: this.buildReviewScopedLauncher,
    });
  }

  private async runCoverageBinding(state: ConductState, executionContext?: ExecutionContext): Promise<StepRunResult> {
    const { judgeEnabled, batchSize } = resolveCoverageBindingConfig(this.config);
    const filesystem = this.coverageBindingFilesystem ?? {
      readFile: (path: string) => readFile(path, 'utf8'),
      mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
      writeFile,
      rename,
    };
    const writeEnvelope = async (
      status: 'disabled' | 'done' | 'failed' | 'partial' | 'refused',
      entries: readonly CoverageBindingEnvelopeEntry[],
    ) => {
      await writeCoverageBindingEnvelope(this.projectDir, {
        version: 1,
        slug: this.featureDesc || 'unknown-feature',
        runId: this.runId,
        status,
        entries,
      }, filesystem);
      // Rebase preservation needs to know which HEAD this run judged. Without
      // a resolvable HEAD there is no stamp, and preservation stays refused.
      if (judgedHead) {
        await writeCoverageBindingCodeStamp(this.projectDir, { runId: this.runId, codeStamp: judgedHead }, filesystem);
      }
    };
    const judgedHead = await this.gitRunner(['rev-parse', 'HEAD'])
      .then((result) => (result.exitCode === 0 ? result.stdout.trim() : ''))
      .catch(() => '');

    if (!judgeEnabled) {
      await writeEnvelope('disabled', []);
      await this.events?.emit({ type: 'coverage_binding_disabled', step: 'coverage_binding' });
      return { success: true, output: 'coverage_binding judge disabled' };
    }

    const planPath = this.planPathOverride
      ?? await resolveFeaturePlanPath(this.projectDir, this.featureDesc || undefined);
    if (!planPath) return { success: false, output: 'coverage_binding could not resolve the feature plan' };

    let planText: string;
    try {
      planText = await readFile(planPath, 'utf8');
    } catch (error) {
      return { success: false, output: `coverage_binding could not read plan: ${error instanceof Error ? error.message : String(error)}` };
    }
    const coherencePath = join(this.projectDir, '.docs', 'coherence', `${this.featureDesc}.md`);
    const coherenceText = await readFile(coherencePath, 'utf8').catch(() => null);
    const claims = assembleCoverageBindingClaims({
      tier: state.complexity_tier ?? 'M',
      coherenceText,
      planText,
    });
    const previous = await readCoverageBindingEnvelope(this.projectDir, filesystem);
    const planned = planCoverageBindingBatches({ claims, previous, batchSize });
    const entries: CoverageBindingEnvelopeEntry[] = [...planned.entries];
    const refused: CoverageBindingEnvelopeEntry[] = [];
    const resolved = this.resolvedConfigFor('coverage_binding');
    const auxiliaryPolicy: ResolvedBuildReviewRubricPolicy = {
      enabled: true,
      max_projection_bytes: DEFAULT_TEST_QUALITY_MAX_PROJECTION_BYTES,
      llm_provider: this.config?.steps?.coverage_binding?.llm_provider ?? this.config?.llm_provider ?? 'claude',
      model: resolved.model,
      effort: resolved.effort,
      model_fallback_ladder: this.modelPolicy.modelFallbackLadder,
      max_retries: resolved.max_retries,
      escalate: resolved.escalate,
      min_confidence: 0,
    };
    for (const entry of entries) {
      await this.events?.emit({ type: 'coverage_binding_judged', step: 'coverage_binding', verdict: entry.verdict, digest: entry.digest, taskIds: [...entry.taskIds] });
      if (entry.verdict === 'does-not-assert') refused.push(entry);
    }
    await writeEnvelope('partial', entries);
    for (const [batchIndex, batch] of planned.batches.entries()) {
      const batchDigests = batch.map(({ claimDigest: digest }) => digest);
      const memberId = batchDigests[0]!;
      const prompt = [
        'Judge each supplied claim independently against only its cited Done when checks. Do not read files, inspect a diff, or use any transcript.',
        'Return exactly one JSON object with a verdicts array containing one verdict for every supplied digest.',
        JSON.stringify({ claims: batch.map(({ claim, claimDigest: digest }) => ({
          digest,
          criterion: claim.criterion,
          taskIds: claim.taskIds,
          doneWhen: claim.doneWhen,
        })) }),
      ].join('\n\n');
      let result: { success: boolean; output?: string; providerSetupExhaustion?: ProviderExecutionResult['providerSetupExhaustion'] };
      if (this.providerRuntimes && this.sessionStore) {
        const dispatched = await this.dispatchProviderWithLifecycleSupervision(
          'coverage_binding',
          { prompt, cwd: this.projectDir, dangerouslySkipPermissions: true },
          (options) => executeAuxiliaryProviderCandidates({
            step: 'coverage_binding', memberId, policy: auxiliaryPolicy, executionContext,
            runtimes: this.providerRuntimes!, sessions: this.sessionStore!.beginBranch(`coverage-binding:${memberId}`),
            config: this.config, runId: this.runId, taskAttribution: this.taskAttribution,
            tier: state.complexity_tier,
            withCandidateSafety: this.withCandidateSafety, prepareCandidateSelfHost: this.prepareCandidateSelfHost,
            onAttempt: this.providerAttempt, warn: this.providerWarn,
            options,
            optionsForCandidate: (providerKey) => ({ ...options, prompt: `${renderAuxiliarySkillInvocation('coverage-binding', providerKey)}\n\n${prompt}` }),
          }),
          undefined,
          executionContext,
        );
        this.callCount++;
        result = { success: dispatched.success, output: dispatched.output, providerSetupExhaustion: dispatched.providerSetupExhaustion };
      } else {
        const dispatched = await this.provider.invoke({
          prompt: `${renderAuxiliarySkillInvocation('coverage-binding', this.providerKey)}\n\n${prompt}`,
          sessionId: randomUUID(), resume: false, dangerouslySkipPermissions: true, cwd: this.projectDir,
          model: auxiliaryPolicy.model, effort: auxiliaryPolicy.effort,
        });
        this.callCount++;
        result = dispatched;
      }
      if (!result.success || typeof result.output !== 'string') {
        await writeEnvelope('failed', entries);
        const infrastructureFailure = new CoverageBindingPayloadError(
          `provider failed for batch ${batchIndex + 1} of ${planned.batches.length}: ${result.output ?? memberId}`,
        );
        return {
          success: false,
          output: infrastructureFailure.message,
          infrastructureFailure,
          ...(result.providerSetupExhaustion ? { providerSetupExhaustion: result.providerSetupExhaustion } : {}),
        };
      }
      const parsed = parseJudgeBatchPayload(result.output, batchDigests);
      if (!parsed.ok) {
        await writeEnvelope('failed', entries);
        const infrastructureFailure = new CoverageBindingPayloadError(parsed.reason);
        return {
          success: false,
          output: infrastructureFailure.message,
          infrastructureFailure,
        };
      }
      for (const { claim, claimDigest: digest } of batch) {
        const verdict = parsed.verdicts.get(digest)!;
        const entry: CoverageBindingEnvelopeEntry = {
          digest,
          criterion: claim.criterion,
          taskIds: claim.taskIds,
          doneWhen: claim.doneWhen,
          verdict: verdict.verdict,
          ...(verdict.missingAssertion === undefined ? {} : { missingAssertion: verdict.missingAssertion }),
        };
        entries.push(entry);
        await this.events?.emit({ type: 'coverage_binding_judged', step: 'coverage_binding', verdict: entry.verdict, digest, taskIds: [...entry.taskIds] });
        if (entry.verdict === 'does-not-assert') refused.push(entry);
      }
      await writeEnvelope('partial', entries);
    }

    if (refused.length > 0) {
      await writeEnvelope('refused', entries);
      const detail = refused.map((entry) => [
        `Criterion: ${entry.criterion}`,
        `Task ids: ${entry.taskIds.join(', ')}`,
        `Done when checks: ${entry.doneWhen.flat().join(' | ')}`,
        `Missing assertion: ${entry.missingAssertion}`,
      ].join('\n')).join('\n\n');
      const reason = `coverage_binding refused: cited Done when checks do not assert the criterion.\n\n${detail}`;
      return { success: false, output: reason, refusal: { kind: 'needs-human', reason } };
    }
    await writeEnvelope('done', entries);
    return { success: true, output: `coverage_binding judged ${entries.length} claim(s)` };
  }

  private async runBuildReview(tier?: ConductState['complexity_tier'], executionContext?: ExecutionContext): Promise<StepRunResult> {
    // Resolve the plan for THIS feature — never the unscoped `.docs/plans/*.md`
    // sort()[last] guess (#407): with several features in flight the shared plans
    // directory holds many files, and picking the alphabetically-last one graded
    // the diff against an entirely unrelated feature's plan, so build_review FAILed
    // on a spurious scope/completeness mismatch while the build step (which uses
    // resolveFeaturePlanPath) built the correct feature. Mirror the build step:
    // prefer the caller's override, else the slug-scoped resolver, which fails
    // closed on ambiguity rather than grading someone else's plan.
    const buildReviewConfig = resolveBuildReviewConfig(this.config, this.modelPolicy, {
      modelCliOverride: this.modelOverride,
      effortCliOverride: this.effortOverride,
    });
    let planPath = this.planPathOverride;
    if (!planPath) {
      const selection = await selectFeaturePlan(this.projectDir, this.featureDesc || undefined);
      if (selection.kind === 'unresolvable') {
        const feature = this.featureDesc || '(no feature description)';
        const candidates = selection.candidates
          .map((candidate) => basename(candidate, '.md'))
          .join(', ');
        return {
          success: false,
          refusal: {
            kind: 'needs-human',
            reason: `build_review cannot resolve a plan for feature "${feature}" among candidates: ${candidates}`,
          },
        };
      }
      if (selection.kind === 'resolved') planPath = selection.path;
    }
    if (!planPath) {
      return this.publishBuildReviewPass(
        buildReviewConfig.rubrics.testQuality.enabled
          ? 'test_quality_empty_scope'
          : 'build_review_no_rubrics',
      );
    }

    let containmentReport: ContainmentFloorReport | undefined;
    let inputs;
    try {
      // A custom member changes the lap's source authority from by-reference
      // to a detached, immutable view shared by every member in the lap.
      const lapMembers = this.usesInjectedBuildReviewGit && this.buildReviewInputOptions?.materialization === undefined
        ? undefined
        : buildReviewConfig.catalog.some((entry) => entry.kind === 'custom')
          ? buildReviewConfig.catalog.map((entry) => ({
              id: entry.id,
              kind: entry.kind,
            })) as BuildReviewInputOptions['lapMembers']
          : undefined;
      inputs = {
        ...await assembleBuildReviewInputs(this.gitRunner, planPath, {
          ...this.buildReviewInputOptions,
          lapMembers,
          materialization: this.buildReviewInputOptions?.materialization ?? { projectRoot: this.projectDir },
        }),
      };
    } catch (err) {
      return {
        success: false,
        output: `build_review input assembly failed: ${err instanceof Error ? err.message : String(err)}`,
        ...(err instanceof TestSuiteProofError
          ? { unretryableInputs: { retryAfterStep: 'test_suite' as const } }
          : {}),
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
        ...(inputs.patchEquivalentExclusion === undefined ? {} : {
          filteredCommits: inputs.patchEquivalentExclusion.filteredCommits,
          excludedPaths: inputs.patchEquivalentExclusion.excludedPaths,
        }),
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

    // Containment telemetry is non-blocking: it never changes `success` or
    // triggers a kickback. Guard it so an observability failure cannot fail
    // build_review.
    let containmentAdvisoryLines: string[] = [];
    if (buildReviewConfig.scopeContainmentEnforced) {
      try {
        // Fall back to the relative `.pipeline` dir when this.pipelineDir is
        // unset (mirrors the finish-record fallback above): the daemon always
        // passes the worktree's absolute pipelineDir, but callers that don't
        // (e.g. direct/test invocation) still get a usable artifact path.
        const effectivePipelineDir = this.pipelineDir ?? join(this.projectDir, '.pipeline');
        if (this.pipelineDir) {
          await this.ensurePipelineDir();
        } else {
          await mkdir(effectivePipelineDir, { recursive: true });
        }
        containmentReport ??= await runContainmentFloor({
          projectRoot: this.projectDir,
          planPath,
          scopeContainmentEnforced: buildReviewConfig.scopeContainmentEnforced,
        });
        await writeFile(
          join(effectivePipelineDir, 'containment-floor.json'),
          JSON.stringify(containmentReport, null, 2),
          'utf-8',
        );
        containmentAdvisoryLines = renderContainmentFloorReport(containmentReport);
        if (containmentAdvisoryLines.length > 0) {
          for (const line of containmentAdvisoryLines) {
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
    const withContainmentAdvisory = (result: StepRunResult): StepRunResult => ({
      ...result,
      ...(typeof result.output === 'string' && containmentAdvisoryLines.length > 0
        ? { output: composeContainmentAdvisoryOutput(result.output, containmentAdvisoryLines, result.success) }
        : {}),
    });
    if (this.buildReviewCoordinator) {
      return withBaseFreshness(withContainmentAdvisory(
        await this.buildReviewCoordinator(inputs, buildReviewConfig),
      ));
    }

    return withBaseFreshness(withContainmentAdvisory(
      await this.runRubricBuildReview(inputs, buildReviewConfig, tier, executionContext),
    ));
  }

  private async publishBuildReviewPass(
    reason: 'build_review_no_rubrics' | 'test_quality_empty_scope',
  ): Promise<StepRunResult> {
    const verdict = {
      verdict: 'PASS' as const,
      reason,
      rubric: { testQuality: false },
    };
    const effectivePipelineDir = this.pipelineDir ?? join(this.projectDir, '.pipeline');
    const verdictPath = join(effectivePipelineDir, 'build-review.json');
    try {
      await mkdir(effectivePipelineDir, { recursive: true });
      const temporaryPath = `${verdictPath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(verdict, null, 2)}\n`, 'utf-8');
      await rename(temporaryPath, verdictPath);
    } catch (error) {
      return {
        success: false,
        output: `build_review empty-set PASS publication failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    await this.stampBuildReviewVerdict();
    return { success: true, output: JSON.stringify(verdict) };
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
    revisionGuidance?: string,
    tier?: ComplexityTier,
    prdWideningReviewContext?: StepRunOptions['prdWideningReviewContext'],
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

    if (step === 'architecture_review_as_built') {
      const policy = await resolveAsBuiltPolicy({
        projectRoot: this.projectDir,
        tier,
        // The runtime config validator already owns this accepted block. Its
        // public HarnessConfig declaration is widened by the config task, so
        // keep this task's prompt seam scoped to the validated policy shape.
        config: this.config as unknown as AsBuiltPolicyConfig | undefined,
      });
      prompt += `\n\n${renderAsBuiltPolicyPrompt(policy)}`;
    }

    if (step === 'prd_audit') {
      const [operatorReseals, featureCommits] = await Promise.all([
        readOperatorReseals(this.projectDir),
        listCommitsWithTrailers(this.projectDir),
      ]);
      const scopeTrailers = featureCommits.flatMap((commit) =>
        (commit.trailers.Scope ?? []).flatMap((trailer) =>
          parseScopeTrailers(`Scope: ${trailer}`),
        ),
      );
      const scopeEvidence = prdAuditScopeProjection({
        resealEvidence: operatorReseals.flatMap((reseal) =>
          reseal.paths.map((path) => ({ path, reason: reseal.reason })),
        ),
        scopeTrailers,
      });
      prompt +=
        '\n\nPRD-AUDIT SCOPE EVIDENCE — judge operator reseal rationales and feature-commit Scope: '
        + 'trailer rationales only as OVER_SCOPE intent evidence. This evidence is immutable; do not invent '
        + 'a widening rationale.\n```json\n'
        + `${JSON.stringify(scopeEvidence, null, 2)}\n` + '```';
      if (prdWideningReviewContext) {
        prompt +=
          '\n\nPRD WIDENING DECISION HISTORY (engine-rendered) — use this only as original authority '
          + 'and evidence when judging a current finding. Report current evidence in your own words; do not '
          + 'copy a stored summary or claim it proves the same behavior. The engine alone reconciles and routes.\n```json\n'
          + `${JSON.stringify(prdWideningReviewContext, null, 2)}\n` + '```';
      }
    }

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
      if (revisionGuidance !== undefined) {
        prompt +=
          '\n\nFINISH PR PROSE REVISION — the retained pull request needs a focused reader-facing prose revision. ' +
          `The prior prose judge's objection is:\n> ${revisionGuidance}\n\n` +
          'Revise the retained PR title and body in place to address that objection. Read the full diff of this ' +
          'feature branch against its base branch, plus the feature specification, plan, and story artifacts, then ' +
          'follow this repository\'s PR authoring contract — the `pr` skill (Claude Code invokes it as `/pr`; Codex ' +
          'invokes it as `$pr`). Keep the template section shape (`## Why`, `## What Changed`, `## Testing`, and the ' +
          '`Closes` reference), preserve any release metadata already present, and make the prose specific to the ' +
          'delivered behavior. Change nothing else: do not create, push, merge, or ready a pull request, do not alter ' +
          'labels, shipment evidence, or completion files, and do not commit. The publication coordinator re-reads ' +
          'the pull request afterwards and judges the prose in a separate pass; it owns every mechanical transition ' +
          'and records the final outcome.';
        if (retryReason) prompt = `RETRY: ${retryReason}\n${prompt}`;
        return prompt;
      }
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
        'For every revision_required verdict, include a concrete `detail` describing what is deficient. ' +
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
