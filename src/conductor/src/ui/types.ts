import type {
  ConductorEvent,
  StepName,
  StepStatus,
  Phase,
  ComplexityTier,
  RecoveryOption,
} from '../types/index.js';
import type { ArtifactPatternStatus } from '../engine/artifacts.js';
import type {
  CheckpointResponse,
  NavigableStep,
  ArtifactReviewResult,
} from '../engine/conductor.js';

export interface UISubscriber {
  start(): void;
  stop(): void;
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
}

export type RenderPayload =
  | { kind: 'dashboard'; snapshot: DashboardSnapshot }
  | { kind: 'log'; level: 'info' | 'error'; message: string }
  | { kind: 'transient'; message: string };

export interface UIPromptHost {
  checkpoint(step: StepName): Promise<CheckpointResponse>;
  recovery(step: StepName, isGating: boolean): Promise<RecoveryOption>;
  reviewArtifacts(step: StepName, files: string[]): Promise<ArtifactReviewResult>;
  complexityAssessment(recommended: ComplexityTier | null): Promise<ComplexityTier>;
  navigate(steps: NavigableStep[]): Promise<StepName | null>;
}
