import type { ConductState } from '../types/index.js';
import type { StepName } from '../types/index.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { readState, writeState, saveStepStatus } from './state.js';
import { ALL_STEPS } from './steps.js';

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
}

export class Conductor {
  private stateFilePath: string;
  private stepRunner: StepRunner;
  private events: ConductorEventEmitter;

  constructor(opts: ConductorOptions) {
    this.stateFilePath = opts.stateFilePath;
    this.stepRunner = opts.stepRunner;
    this.events = opts.events;
  }

  async run(): Promise<void> {
    const stateResult = await readState(this.stateFilePath);
    let state: ConductState = stateResult.ok ? stateResult.value : {};

    for (let i = 0; i < ALL_STEPS.length; i++) {
      const step = ALL_STEPS[i];

      // Mark in_progress before running
      await saveStepStatus(this.stateFilePath, step.name, 'in_progress');
      state[step.name] = 'in_progress';

      this.events.emit({ type: 'step_started', step: step.name, index: i });

      const result = await this.stepRunner.run(step.name, state);

      if (result.success) {
        await saveStepStatus(this.stateFilePath, step.name, 'done');
        state[step.name] = 'done';
        this.events.emit({ type: 'step_completed', step: step.name, status: 'done' });
      }
    }

    // All steps completed successfully
    state.feature_status = 'complete';
    await writeState(this.stateFilePath, state);
  }
}
