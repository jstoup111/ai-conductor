import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider } from '../execution/llm-provider.js';
import type { StepName, ConductState } from '../types/index.js';
import type { StepRunner, StepRunResult } from './conductor.js';
import { ALL_STEPS, getStepIndex, getStepDefinition } from './steps.js';

const STEP_PROMPTS: Record<StepName, string> = {
  worktree: '/conduct worktree',
  memory: '/memory',
  brainstorm: '/brainstorm',
  complexity: '/conduct complexity',
  stories: '/stories',
  conflict_check: '/conflict-check',
  plan: '/plan',
  architecture_diagram: '/architecture-diagram',
  architecture_review: '/architecture-review',
  acceptance_specs: '/writing-system-tests',
  build: '/pipeline',
  manual_test: '/manual-test',
  retro: '/retro',
  finish: '/finish',
};

// Autonomous steps run with --dangerously-skip-permissions (no user prompts).
// All other steps are collaborative — user interacts with Claude.
const AUTONOMOUS_STEPS: Set<StepName> = new Set([
  'worktree',
  'memory',
  'acceptance_specs',
  'build',
]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface StepRunnerOptions {
  featureDesc?: string;
  totalSteps?: number;
  pipelineDir?: string;
  stepCooldown?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export class DefaultStepRunner implements StepRunner {
  private sessionStarted = false;
  private sessionStartedInitialized = false;
  private featureDesc: string;
  private totalSteps: number;
  private pipelineDir: string | null;
  private stepCooldown: number;
  private sleepFn: (ms: number) => Promise<void>;
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
  }

  async run(step: StepName, state: ConductState): Promise<StepRunResult> {
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

    const systemPrompt = this.buildSystemPrompt(step, autonomous);

    try {
      await this.provider.invokeInteractive({
        prompt,
        sessionId: this.sessionId,
        resume,
        dangerouslySkipPermissions: autonomous,
        systemPrompt,
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

  async runInteractive(step: StepName): Promise<void> {
    await this.provider.invokeInteractive({
      prompt: `Fix issues from the failed ${step} step, then exit when done.`,
      sessionId: this.sessionId,
      resume: true,
      interactive: true,
      dangerouslySkipPermissions: false,
    });
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private buildSystemPrompt(step: StepName, autonomous: boolean): string {
    const stepIndex = getStepIndex(step) + 1; // 1-based for display
    const stepDef = getStepDefinition(step);
    const featurePart = this.featureDesc ? ` Feature: ${this.featureDesc}` : '';

    let prompt = `[Conduct step ${stepIndex}/${this.totalSteps}]${featurePart}`;

    if (!autonomous) {
      prompt = `You are running step: ${stepDef.label}. Complete ONLY this step, then stop and let the user /quit to return to the conductor.\n${prompt}`;
    }

    return prompt;
  }
}
