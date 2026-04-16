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

// Steps where the engineer works WITH Claude interactively
const INTERACTIVE_STEPS: Set<StepName> = new Set([
  'brainstorm',
  'complexity',
  'stories',
  'conflict_check',
  'plan',
  'architecture_diagram',
  'architecture_review',
  'manual_test',
  'retro',
  'finish',
]);

// Steps that run autonomously with --print (no human interaction)
// worktree, memory, acceptance_specs, build

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
    const interactive = INTERACTIVE_STEPS.has(step);

    if (interactive) {
      // Interactive: hand control to Claude, engineer collaborates in terminal
      try {
        await this.provider.invokeInteractive({
          prompt,
          sessionId: this.sessionId,
          resume,
          dangerouslySkipPermissions: false, // interactive needs permissions
        });
        this.sessionStarted = true;
        return { success: true };
      } catch {
        return { success: false, output: `Interactive session for ${step} exited with error` };
      }
    }

    // Non-interactive: --print mode, capture output
    let result = await this.provider.invoke({
      prompt,
      sessionId: this.sessionId,
      resume,
      dangerouslySkipPermissions: true,
    });

    // If resume failed because session doesn't exist, retry without resume
    if (!result.success && result.sessionExpired && resume) {
      result = await this.provider.invoke({
        prompt,
        sessionId: this.sessionId,
        resume: false,
        dangerouslySkipPermissions: true,
      });
    }

    if (result.success) {
      this.sessionStarted = true;
    }

    return {
      success: result.success,
      output: result.output,
    };
  }
}
