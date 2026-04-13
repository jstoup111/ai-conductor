import type { ConductState } from '../types/index.js';
import type { StepName, StepStatus, Phase, RunMode } from '../types/index.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { readState, writeState, saveStepStatus, getStepStatus, markDownstreamStale } from './state.js';
import { ALL_STEPS, getStepIndex, shouldSkipForTier, isCheckpointStep } from './steps.js';
import { checkGate } from './gates.js';

export type CheckpointResponse = 'continue' | 'back' | 'quit';

export interface NavigableStep {
  name: StepName;
  label: string;
  status: StepStatus;
  phase: Phase;
}

export function navigateBack(
  state: ConductState,
  target: StepName,
): { state: ConductState; index: number } {
  const allStepNames = ALL_STEPS.map((s) => s.name);
  let updated = markDownstreamStale(state, target, allStepNames);
  (updated as Record<string, unknown>)[target] = 'pending';
  const index = getStepIndex(target);
  return { state: updated, index };
}

export function getNavigableSteps(state: ConductState): NavigableStep[] {
  return ALL_STEPS
    .filter((step) => {
      const status = state[step.name];
      return status === 'done' || status === 'stale';
    })
    .map((step) => ({
      name: step.name,
      label: step.label,
      status: state[step.name] as StepStatus,
      phase: step.phase,
    }));
}

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
  mode?: RunMode;
  onCheckpoint?: (step: StepName) => Promise<CheckpointResponse>;
  onNavigate?: (steps: NavigableStep[]) => Promise<StepName | null>;
}

export class Conductor {
  private stateFilePath: string;
  private stepRunner: StepRunner;
  private events: ConductorEventEmitter;
  private resume: boolean;
  private fromStep?: StepName;
  private mode: RunMode;
  private onCheckpoint: (step: StepName) => Promise<CheckpointResponse>;
  private onNavigate: (steps: NavigableStep[]) => Promise<StepName | null>;

  constructor(opts: ConductorOptions) {
    this.stateFilePath = opts.stateFilePath;
    this.stepRunner = opts.stepRunner;
    this.events = opts.events;
    this.resume = opts.resume ?? false;
    this.fromStep = opts.fromStep;
    this.mode = opts.mode ?? 'default';
    this.onCheckpoint = opts.onCheckpoint ?? (async () => 'continue' as const);
    this.onNavigate = opts.onNavigate ?? (async () => null);
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

      // Check gate: all prerequisites must be satisfied
      const gate = checkGate(step.name, state);
      if (!gate.passed) {
        this.events.emit({ type: 'gate_blocked', step: step.name, reason: gate.reason });
        await writeState(this.stateFilePath, state);
        process.off('SIGINT', sigintHandler);
        return;
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

        // Checkpoint handling
        if (isCheckpointStep(step.name) && this.mode !== 'auto') {
          this.events.emit({ type: 'checkpoint_reached', step: step.name });
          const response = await this.onCheckpoint(step.name);
          if (response === 'quit') {
            await writeState(this.stateFilePath, state);
            process.off('SIGINT', sigintHandler);
            return;
          }
          if (response === 'back') {
            const navigable = getNavigableSteps(state);
            const target = await this.onNavigate(navigable);
            if (target) {
              const nav = navigateBack(state, target);
              this.events.emit({ type: 'navigation_back', from: step.name, to: target });
              state = nav.state;
              await writeState(this.stateFilePath, state);
              i = nav.index - 1; // for loop will i++
              continue;
            }
          }
          // 'continue' proceeds normally
        }
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
