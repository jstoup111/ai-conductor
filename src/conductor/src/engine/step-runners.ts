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
}

export class DefaultStepRunner implements StepRunner {
  private sessionStarted = false;
  private featureDesc: string;
  private totalSteps: number;

  constructor(
    private provider: LLMProvider,
    private sessionId: string,
    private projectDir: string,
    options?: StepRunnerOptions,
  ) {
    this.featureDesc = options?.featureDesc ?? '';
    this.totalSteps = options?.totalSteps ?? ALL_STEPS.length;
  }

  async run(step: StepName, state: ConductState): Promise<StepRunResult> {
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
      return { success: true };
    } catch {
      return { success: false, output: `Session for ${step} exited with error` };
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
