import { readdir } from 'fs/promises';
import { join } from 'path';
import type { ConductState } from '../types/index.js';
import type { StepName, StepStatus, Phase, RunMode, ComplexityTier, RecoveryOption } from '../types/index.js';
import type { HarnessConfig } from '../types/config.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { readState, writeState, saveStepStatus, getStepStatus, markDownstreamStale } from './state.js';
import { ALL_STEPS, getStepIndex, shouldSkipForTier, isCheckpointStep } from './steps.js';
import { checkGate, isGatingStep } from './gates.js';

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
  runInteractive?(step: StepName): Promise<void>;
}

export type ArtifactReviewResult = 'approved' | 'rejected' | 'skip';

export interface ConductorOptions {
  stateFilePath: string;
  stepRunner: StepRunner;
  events: ConductorEventEmitter;
  resume?: boolean;
  fromStep?: StepName;
  mode?: RunMode;
  config?: HarnessConfig;
  projectRoot?: string;
  onCheckpoint?: (step: StepName) => Promise<CheckpointResponse>;
  onNavigate?: (steps: NavigableStep[]) => Promise<StepName | null>;
  onReviewArtifacts?: (step: StepName, files: string[]) => Promise<ArtifactReviewResult>;
  onRecovery?: (step: StepName, isGating: boolean) => Promise<RecoveryOption>;
  onComplexityAssessment?: () => Promise<ComplexityTier>;
}

// Steps that require artifact review after completion
const ARTIFACT_REVIEW_STEPS: Set<StepName> = new Set([
  'brainstorm',
  'stories',
  'plan',
  'architecture_diagram',
  'architecture_review',
]);

// Glob patterns for artifacts produced by each reviewable step
const ARTIFACT_GLOBS: Record<string, string[]> = {
  brainstorm: ['.docs/specs/*.md'],
  stories: ['.docs/stories/**/*.md'],
  plan: ['.docs/plans/*.md'],
  architecture_diagram: ['.docs/architecture/*.md'],
  architecture_review: ['.docs/decisions/architecture-review-*.md', '.docs/decisions/adr-*.md'],
};

export class Conductor {
  private stateFilePath: string;
  private stepRunner: StepRunner;
  private events: ConductorEventEmitter;
  private resume: boolean;
  private fromStep?: StepName;
  private mode: RunMode;
  private config: HarnessConfig;
  private projectRoot: string;
  private onCheckpoint: (step: StepName) => Promise<CheckpointResponse>;
  private onNavigate: (steps: NavigableStep[]) => Promise<StepName | null>;
  private onReviewArtifacts: (step: StepName, files: string[]) => Promise<ArtifactReviewResult>;
  private onRecovery?: (step: StepName, isGating: boolean) => Promise<RecoveryOption>;
  private onComplexityAssessment?: () => Promise<ComplexityTier>;

  constructor(opts: ConductorOptions) {
    this.stateFilePath = opts.stateFilePath;
    this.stepRunner = opts.stepRunner;
    this.events = opts.events;
    this.resume = opts.resume ?? false;
    this.fromStep = opts.fromStep;
    this.mode = opts.mode ?? 'default';
    this.config = opts.config ?? {};
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.onCheckpoint = opts.onCheckpoint ?? (async () => 'continue' as const);
    this.onNavigate = opts.onNavigate ?? (async () => null);
    this.onReviewArtifacts = opts.onReviewArtifacts ?? (async () => 'approved' as const);
    this.onRecovery = opts.onRecovery;
    this.onComplexityAssessment = opts.onComplexityAssessment;
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
      process.exit(130); // 128 + SIGINT(2) — standard Unix convention
    };
    process.on('SIGINT', sigintHandler);

    for (let i = startIndex; i < ALL_STEPS.length; i++) {
      const step = ALL_STEPS[i];

      // Read complexity tier from state each iteration (may change after complexity step)
      const tier = state.complexity_tier ?? 'L';

      // Check if step should be skipped for this complexity tier
      if (shouldSkipForTier(step.name, tier)) {
        await saveStepStatus(this.stateFilePath, step.name, 'skipped');
        state[step.name] = 'skipped';
        this.events.emit({ type: 'tier_skip', step: step.name, tier });
        continue;
      }

      // Check if step is disabled via config
      const disabledSteps = this.config.steps?.disable ?? [];
      if (disabledSteps.includes(step.name)) {
        await saveStepStatus(this.stateFilePath, step.name, 'skipped');
        state[step.name] = 'skipped';
        this.events.emit({ type: 'config_skip', step: step.name });
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
        // Artifact review gate — show artifacts for approval before marking done
        if (ARTIFACT_REVIEW_STEPS.has(step.name) && this.mode !== 'auto') {
          const files = await this.findArtifactFiles(step.name);
          if (files.length > 0) {
            const reviewResult = await this.onReviewArtifacts(step.name, files);
            if (reviewResult === 'rejected') {
              // Re-run the step — user rejected artifacts
              i--; // for loop will i++, so we stay on the same step
              continue;
            }
          }
        }

        await saveStepStatus(this.stateFilePath, step.name, 'done');
        state[step.name] = 'done';
        this.events.emit({ type: 'step_completed', step: step.name, status: 'done' });

        // Complexity assessment after complexity step
        if (step.name === 'complexity' && this.mode !== 'auto' && !state.complexity_tier && this.onComplexityAssessment) {
          const assessedTier = await this.onComplexityAssessment();
          state.complexity_tier = assessedTier;
          await writeState(this.stateFilePath, state);
        }

        // Store PR URL from finish step output
        if (step.name === 'finish' && result.output) {
          const urlMatch = result.output.match(/https?:\/\/[^\s]+\/pull\/\d+/);
          if (urlMatch) {
            state.pr_url = urlMatch[0];
          }
        }

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
        // Step failed — invoke recovery menu if available
        await saveStepStatus(this.stateFilePath, step.name, 'failed');
        state[step.name] = 'failed';
        this.events.emit({
          type: 'step_failed',
          step: step.name,
          error: result.output ?? 'Step failed',
          retryCount: 0,
        });

        if (this.onRecovery) {
          const gating = isGatingStep(step.name);
          const action = await this.onRecovery(step.name, gating);

          if (action === 'retry') {
            i--; // for loop will i++, staying on same step
            continue;
          }
          if (action === 'skip' && !gating) {
            await saveStepStatus(this.stateFilePath, step.name, 'skipped');
            state[step.name] = 'skipped';
            continue;
          }
          if (action === 'back') {
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
          if (action === 'interactive') {
            if (this.stepRunner.runInteractive) {
              await this.stepRunner.runInteractive(step.name);
            }
            i--; // re-run the step after interactive fix
            continue;
          }
        }

        // quit (default) — save state and return
        await writeState(this.stateFilePath, state);
        process.off('SIGINT', sigintHandler);
        return;
      }
    }

    // Clean up SIGINT handler
    process.off('SIGINT', sigintHandler);

    // All steps completed successfully
    this.events.emit({ type: 'feature_complete', prUrl: state.pr_url });
    state.feature_status = 'complete';
    await writeState(this.stateFilePath, state);
  }

  /**
   * Find the index to resume from: first in_progress step,
   * or first pending step after the last done step.
   */
  private findResumeIndex(state: ConductState): number {
    // If feature is already complete, treat as new feature (start from 0)
    if (state.feature_status === 'complete') {
      return 0;
    }

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

  /**
   * Find artifact files produced by a step for review.
   * Uses the glob patterns defined in ARTIFACT_GLOBS.
   */
  private async findArtifactFiles(step: StepName): Promise<string[]> {
    const patterns = ARTIFACT_GLOBS[step];
    if (!patterns) return [];

    const files: string[] = [];
    for (const pattern of patterns) {
      // Simple glob: support dir/*.md and dir/**/*.md
      const parts = pattern.split('/');
      const isRecursive = parts.includes('**');

      if (isRecursive) {
        // e.g., .docs/stories/**/*.md — walk subdirectories
        const baseDir = join(this.projectRoot, parts.slice(0, parts.indexOf('**')).join('/'));
        const ext = parts[parts.length - 1]; // e.g., *.md
        const collected = await this.walkDir(baseDir, ext.replace('*', ''));
        files.push(...collected);
      } else {
        // e.g., .docs/specs/*.md — single directory
        const dir = join(this.projectRoot, parts.slice(0, -1).join('/'));
        const ext = parts[parts.length - 1].replace('*', ''); // .md
        try {
          const entries = await readdir(dir);
          for (const entry of entries) {
            if (entry.endsWith(ext)) {
              files.push(join(dir, entry));
            }
          }
        } catch {
          // Directory doesn't exist — no artifacts
        }
      }
    }
    return files;
  }

  private async walkDir(dir: string, ext: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...await this.walkDir(fullPath, ext));
        } else if (entry.name.endsWith(ext)) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist
    }
    return files;
  }
}
