import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider } from '../execution/llm-provider.js';
import type { StepName, ConductState, ComplexityTier, RunMode } from '../types/index.js';
import type { HarnessConfig, EffortLevel } from '../types/config.js';
import type { StepRunner, StepRunResult, StepRunOptions } from './conductor.js';
import { ALL_STEPS, getStepIndex, getStepDefinition } from './steps.js';
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

const STEP_PROMPTS: Record<StepName, string> = {
  bootstrap: '/bootstrap',
  memory: '/memory',
  assess: '/assess',
  brainstorm: '/brainstorm',
  complexity: '/conduct complexity',
  stories: '/stories',
  conflict_check: '/conflict-check',
  plan: '/plan',
  architecture_diagram: '/architecture-diagram',
  architecture_review: '/architecture-review',
  worktree: '/conduct worktree',
  acceptance_specs: '/writing-system-tests',
  build: '/pipeline',
  manual_test: '/manual-test',
  retro: '/retro',
  finish: '/finish',
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
]);

// Steps where the skill design requires a back-and-forth conversation (the
// user refines scope with Claude), not a single one-shot response. These are
// dispatched as Claude REPL sessions (positional prompt, no -p flag) so the
// session stays open until the user /quits. In auto mode this set is
// ignored — the step still runs but through print mode, because auto mode
// explicitly trades the Socratic flow for unattended execution.
//
// Other non-autonomous steps (complexity, conflict_check, architecture_diagram,
// retro, finish) are one-shot by design: they generate an artifact from
// existing context without needing user input, so print mode is the right
// dispatch for them even outside auto mode.
const INTERACTIVE_STEPS: Set<StepName> = new Set([
  'brainstorm',
  'stories',
  'plan',
  'architecture_review',
  'manual_test',
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
    // advances). Otherwise dispatch print mode — Claude answers once and exits.
    const interactive = this.mode !== 'auto' && INTERACTIVE_STEPS.has(step);

    try {
      await this.provider.invokeInteractive({
        prompt,
        sessionId: this.sessionId,
        resume,
        interactive,
        dangerouslySkipPermissions: false,
        systemPrompt,
        model: resolved.model,
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
    const result = await this.provider.invoke({
      prompt,
      sessionId: this.sessionId,
      resume,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: resolved.model,
      effort: resolved.effort,
    });
    this.callCount++;

    // Rate limit: surface wait seconds (from marker file if present, else
    // default 300s — matches bin/conduct handle_rate_limit).
    if (result.rateLimited) {
      const waitSeconds = await this.readRateLimitWait();
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

    return { success: false, output: result.output };
  }

  /**
   * Read a pending rate-limit wait-seconds value. Mirrors bin/conduct:2252–2258:
   * `${PIPELINE_DIR}/rate-limit-hit` has the wait seconds on line 2. Returns
   * 300 (the bash default) when the marker is absent or unparseable.
   */
  private async readRateLimitWait(): Promise<number> {
    const DEFAULT = 300;
    if (!this.pipelineDir) return DEFAULT;
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(join(this.pipelineDir, 'rate-limit-hit'), 'utf-8');
      const line2 = raw.split('\n')[1]?.trim();
      const n = Number.parseInt(line2 ?? '', 10);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT;
    } catch {
      return DEFAULT;
    }
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
    const result = await this.provider.invoke({
      prompt: '/conduct complexity',
      sessionId: this.sessionId,
      resume: this.sessionStarted,
      dangerouslySkipPermissions: true,
      systemPrompt,
      model: resolved.model,
      effort: resolved.effort,
    });

    if (!result.success) return null;

    // Prefer deterministic scoring over Claude's letter. Only fall back to the
    // letter when we can't extract enough signal counts to score confidently.
    const counts = parseSignalCountsFromOutput(result.output);
    const scored = scoreComplexityFromCounts(counts);
    if (scored) return scored;
    return parseTierFromOutput(result.output);
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
    const stepIndex = getStepIndex(step) + 1; // 1-based for display
    const stepDef = getStepDefinition(step);
    const featurePart = this.featureDesc ? ` Feature: ${this.featureDesc}` : '';

    let prompt = `[Conduct step ${stepIndex}/${this.totalSteps}]${featurePart}`;

    if (!autonomous) {
      prompt = `You are running step: ${stepDef.label}. Complete ONLY this step, then stop and let the user /quit to return to the conductor.\n${prompt}`;
    }

    // Effort is now controlled via CLAUDE_CODE_EFFORT_LEVEL env var (Claude's
    // native reasoning knob) — no prose hint needed in the system prompt.

    if (retryReason) {
      prompt = `RETRY: ${retryReason}\n${prompt}`;
    }

    return prompt;
  }
}
