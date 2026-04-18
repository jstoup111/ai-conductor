import type { StepName, StepStatus, ComplexityTier } from './steps.js';
import type { BootstrapMode } from './state.js';

export type RecoveryOption = 'retry' | 'interactive' | 'back' | 'skip' | 'quit';

/**
 * Extra state threaded into onRecovery so the UI can adapt its menu
 * without the engine dictating the layout.
 *
 * - `recoveryCount` — how many times the user has entered the recovery
 *   menu for this step in the current session (0 on first entry).
 * - `retriesExhausted` — `true` when the per-step recovery-retry budget
 *   has been hit. The UI SHOULD drop `retry` from the offered options
 *   when this is set; the engine will loop back to the menu if it
 *   receives `retry` anyway (so the worst case is the user sees the
 *   same menu twice, not an infinite retry storm).
 */
export interface RecoveryContext {
  recoveryCount: number;
  retriesExhausted: boolean;
}

export type ConductorEvent =
  | { type: 'step_started'; step: StepName; index: number }
  | { type: 'step_completed'; step: StepName; status: StepStatus; tail?: string[] }
  | { type: 'step_failed'; step: StepName; error: string; retryCount: number }
  | {
      type: 'step_retry';
      step: StepName;
      attempt: number; // 1-based: "attempt 2 of 3"
      maxAttempts: number;
      reason: string;
    }
  | { type: 'checkpoint_reached'; step: StepName }
  | { type: 'recovery_needed'; step: StepName; options: RecoveryOption[] }
  | { type: 'gate_blocked'; step: StepName; reason: string }
  | { type: 'tier_skip'; step: StepName; tier: ComplexityTier }
  | { type: 'config_skip'; step: StepName }
  | { type: 'navigation_back'; from: StepName; to: StepName }
  | { type: 'rate_limit'; waitSeconds: number }
  | { type: 'session_reset'; reason: string }
  | { type: 'feature_complete'; prUrl?: string }
  | { type: 'dashboard_refresh' }
  | { type: 'auto_heal'; step: StepName; healed: number; skipped: number }
  | { type: 'mode_skip'; step: StepName; mode: BootstrapMode; reason: string };
