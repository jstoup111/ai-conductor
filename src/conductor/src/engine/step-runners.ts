import type { LLMProvider } from '../execution/llm-provider.js';
import type { StepName, ConductState } from '../types/index.js';
import type { StepRunner, StepRunResult } from './conductor.js';

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

export class DefaultStepRunner implements StepRunner {
  private sessionStarted = false;

  constructor(
    private provider: LLMProvider,
    private sessionId: string,
    private projectDir: string,
  ) {}

  async run(step: StepName, state: ConductState): Promise<StepRunResult> {
    const prompt = STEP_PROMPTS[step];
    const resume = this.sessionStarted;
    const autonomous = AUTONOMOUS_STEPS.has(step);

    try {
      await this.provider.invokeInteractive({
        prompt,
        sessionId: this.sessionId,
        resume,
        dangerouslySkipPermissions: autonomous,
      });
      this.sessionStarted = true;
      return { success: true };
    } catch {
      return { success: false, output: `Session for ${step} exited with error` };
    }
  }
}
