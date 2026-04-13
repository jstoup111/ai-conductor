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

export class DefaultStepRunner implements StepRunner {
  constructor(
    private provider: LLMProvider,
    private sessionId: string,
    private projectDir: string,
  ) {}

  async run(step: StepName, state: ConductState): Promise<StepRunResult> {
    const prompt = STEP_PROMPTS[step];
    const result = await this.provider.invoke({
      prompt,
      sessionId: this.sessionId,
      resume: true,
      dangerouslySkipPermissions: true,
    });
    return {
      success: result.success,
      output: result.output,
    };
  }
}
