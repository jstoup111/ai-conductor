import type { StepName, StepStatus, ComplexityTier } from './steps.js';

export type RecoveryOption = 'retry' | 'interactive' | 'back' | 'skip' | 'quit';

export type ConductorEvent =
  | { type: 'step_started'; step: StepName; index: number }
  | { type: 'step_completed'; step: StepName; status: StepStatus }
  | { type: 'step_failed'; step: StepName; error: string; retryCount: number }
  | { type: 'checkpoint_reached'; step: StepName }
  | { type: 'recovery_needed'; step: StepName; options: RecoveryOption[] }
  | { type: 'gate_blocked'; step: StepName; reason: string }
  | { type: 'tier_skip'; step: StepName; tier: ComplexityTier }
  | { type: 'navigation_back'; from: StepName; to: StepName }
  | { type: 'rate_limit'; waitSeconds: number }
  | { type: 'session_reset'; reason: string }
  | { type: 'feature_complete'; prUrl?: string }
  | { type: 'dashboard_refresh' };
