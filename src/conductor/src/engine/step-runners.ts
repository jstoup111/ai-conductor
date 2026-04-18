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

    const systemPrompt =
      'You are assessing complexity for the current feature based on its brainstorm design doc. ' +
      'Read .docs/specs/*.md (most recent) and classify complexity as S, M, or L per the /conduct complexity skill. ' +
      'Output a short rationale, then on the FINAL line output exactly one of: TIER: S / TIER: M / TIER: L';

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
