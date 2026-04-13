import type { ConductState } from '../types/index.js';
import type { StepName } from '../types/index.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { readState, writeState, saveStepStatus, getStepStatus } from './state.js';
import { ALL_STEPS, getStepIndex, shouldSkipForTier } from './steps.js';

export interface StepRunResult {
  success: boolean;
  output?: string;
}

export interface StepRunner {
  run(step: StepName, state: ConductState): Promise<StepRunResult>;
}

export interface ConductorOptions {
  stateFilePath: string;
  stepRunner: StepRunner;
  events: ConductorEventEmitter;
  resume?: boolean;
  fromStep?: StepName;
}

export class Conductor {
  private stateFilePath: string;
  private stepRunner: StepRunner;
  private events: ConductorEventEmitter;
  private resume: boolean;
  private fromStep?: StepName;

  constructor(opts: ConductorOptions) {
    this.stateFilePath = opts.stateFilePath;
    this.stepRunner = opts.stepRunner;
    this.events = opts.events;
    this.resume = opts.resume ?? false;
    this.fromStep = opts.fromStep;
  }

  async run(): Promise<void> {
    const stateResult = await readState(this.stateFilePath);
    let state: ConductState = stateResult.ok ? stateResult.value : {};

    // Determine starting index
    let startIndex = 0;
    if (this.fromStep) {
      startIndex = getStepIndex(this.fromStep);
    } else if (this.resume) {
      startIndex = this.findResumeIndex(state);
    }

    // Save state on SIGINT before exit
    const sigintHandler = async () => {
      await writeState(this.stateFilePath, state);
    };
    process.on('SIGINT', sigintHandler);

    // Read complexity tier from state, default to 'L' (no skips)
    const tier = state.complexity_tier ?? 'L';

    for (let i = startIndex; i < ALL_STEPS.length; i++) {
      const step = ALL_STEPS[i];

      // Check if step should be skipped for this complexity tier
      if (shouldSkipForTier(step.name, tier)) {
        await saveStepStatus(this.stateFilePath, step.name, 'skipped');
        state[step.name] = 'skipped';
        this.events.emit({ type: 'tier_skip', step: step.name, tier });
        continue;
      }

      // Mark in_progress before running
      await saveStepStatus(this.stateFilePath, step.name, 'in_progress');
      state[step.name] = 'in_progress';

      this.events.emit({ type: 'step_started', step: step.name, index: i });

      const result = await this.stepRunner.run(step.name, state);

      if (result.success) {
        await saveStepStatus(this.stateFilePath, step.name, 'done');
        state[step.name] = 'done';
        this.events.emit({ type: 'step_completed', step: step.name, status: 'done' });
      } else {
        // Mark step as failed, emit event, save state, and stop
        await saveStepStatus(this.stateFilePath, step.name, 'failed');
        state[step.name] = 'failed';
        this.events.emit({
          type: 'step_failed',
          step: step.name,
          error: result.output ?? 'Step failed',
          retryCount: 0,
        });
        await writeState(this.stateFilePath, state);
        process.off('SIGINT', sigintHandler);
        return;
      }
    }

    // Clean up SIGINT handler
    process.off('SIGINT', sigintHandler);

    // All steps completed successfully
    state.feature_status = 'complete';
    await writeState(this.stateFilePath, state);
  }

  /**
   * Find the index to resume from: first in_progress step,
   * or first pending step after the last done step.
   */
  private findResumeIndex(state: ConductState): number {
    // First, look for an in_progress step
    for (let i = 0; i < ALL_STEPS.length; i++) {
      if (getStepStatus(state, ALL_STEPS[i].name) === 'in_progress') {
        return i;
      }
    }

    // Otherwise, find the first pending step after the last done step
    let lastDoneIndex = -1;
    for (let i = 0; i < ALL_STEPS.length; i++) {
      if (getStepStatus(state, ALL_STEPS[i].name) === 'done') {
        lastDoneIndex = i;
      }
    }

    return lastDoneIndex + 1;
  }
}
