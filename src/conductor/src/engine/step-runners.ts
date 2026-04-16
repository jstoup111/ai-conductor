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

export interface StepRunnerOptions {
  featureDesc?: string;
  totalSteps?: number;
  pipelineDir?: string;
}

export class DefaultStepRunner implements StepRunner {
  private sessionStarted = false;
  private sessionStartedInitialized = false;
  private featureDesc: string;
  private totalSteps: number;
  private pipelineDir: string | null;

  constructor(
    private provider: LLMProvider,
    private sessionId: string,
    private projectDir: string,
    options?: StepRunnerOptions,
  ) {
    this.featureDesc = options?.featureDesc ?? '';
    this.totalSteps = options?.totalSteps ?? ALL_STEPS.length;
    this.pipelineDir = options?.pipelineDir ?? null;
  }

  async run(step: StepName, state: ConductState): Promise<StepRunResult> {
    // Lazy-init: check marker file on first run
    if (!this.sessionStartedInitialized && this.pipelineDir) {
      this.sessionStarted = await this.fileExists(join(this.pipelineDir, 'session-created'));
      this.sessionStartedInitialized = true;
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

      // Persist marker and session ID after first success
      if (this.pipelineDir) {
        await writeFile(join(this.pipelineDir, 'session-created'), '1', 'utf-8');
        await writeFile(join(this.pipelineDir, 'conduct-session-id'), this.sessionId, 'utf-8');
      }

      return { success: true };
    } catch {
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
