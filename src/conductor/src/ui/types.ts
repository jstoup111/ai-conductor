import type {
  ConductorEvent,
  StepName,
  StepStatus,
  Phase,
  ComplexityTier,
  RecoveryOption,
  RecoveryContext,
} from '../types/index.js';
import type { ArtifactPatternStatus } from '../engine/artifacts.js';
import type {
  CheckpointResponse,
  NavigableStep,
  ArtifactReviewResult,
} from '../engine/conductor.js';
import type { ConductorEventEmitter } from './events.js';

export interface UIRenderer {
  handle(event: ConductorEvent): Promise<void>;
  stop(): void;
}

export interface UISubscriber {
  start(): void;
  stop(): void;
  /**
   * Optional post-discovery hook: binds this subscriber to the live event
   * bus before start() is called. Plugin-discovered subscribers (e.g. a
   * ui_renderer loaded via discoverPlugins) don't receive the emitter at
   * construction time, so index.ts calls bind() generically on whatever
   * was selected, right before start().
   */
  bind?(events: ConductorEventEmitter): void;
}

export type UIEventHandler = (event: ConductorEvent) => void | Promise<void>;

export interface StepSnapshot {
  name: StepName;
  label: string;
  phase: Phase;
  status: StepStatus;
  artifacts?: ArtifactPatternStatus[];
}

export interface DashboardSnapshot {
  featureName?: string;
  complexityTier?: ComplexityTier;
  steps: StepSnapshot[];
  /** Step currently running. Set by the renderer on step_started,
   *  cleared on step_completed / step_failed / skip / gate_blocked. */
  currentStep?: { name: StepName; label: string; startedAtMs: number };
  /** Tail of the most recently completed step's captured stdout. */
  lastStepTail?: { step: StepName; lines: string[] };
}

export type ViewMode = 'full' | 'focus' | 'log';

export type RenderPayload =
  | { kind: 'dashboard'; snapshot: DashboardSnapshot }
  | { kind: 'log'; level: 'info' | 'error'; message: string }
  | { kind: 'transient'; message: string };

export interface UIPromptHost {
  checkpoint(step: StepName): Promise<CheckpointResponse>;
  recovery(
    step: StepName,
    isGating: boolean,
    context?: RecoveryContext,
  ): Promise<RecoveryOption>;
  reviewArtifacts(step: StepName, files: string[]): Promise<ArtifactReviewResult>;
  complexityAssessment(recommended: ComplexityTier | null): Promise<ComplexityTier>;
  navigate(steps: NavigableStep[]): Promise<StepName | null>;
}
