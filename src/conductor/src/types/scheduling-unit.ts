import type { StepName } from './steps.js';

export type SchedulingUnitRef =
  | { kind: 'step'; name: StepName }
  | { kind: 'group'; name: string }
  | { kind: 'pre-first-unit' };
