import type { RecoveryOption } from '../types/index.js';
import type { StepName } from '../types/index.js';

export type RecoveryResult =
  | { action: 'retry' }
  | { action: 'skip' }
  | { action: 'back' }
  | { action: 'interactive' }
  | { action: 'quit' }
  | { action: 'blocked'; reason: string };

const NON_GATING_OPTIONS: RecoveryOption[] = [
  'retry',
  'interactive',
  'back',
  'skip',
  'quit',
];

const GATING_OPTIONS: RecoveryOption[] = [
  'retry',
  'interactive',
  'back',
  'quit',
];

export function getRecoveryOptions(
  _step: StepName,
  isGating: boolean,
): RecoveryOption[] {
  return isGating ? [...GATING_OPTIONS] : [...NON_GATING_OPTIONS];
}

export function handleRecoveryChoice(
  choice: RecoveryOption,
  isGating: boolean,
): RecoveryResult {
  if (choice === 'skip' && isGating) {
    return {
      action: 'blocked',
      reason: 'Cannot skip a gating step — it must pass before proceeding.',
    };
  }
  return { action: choice };
}

export function shouldRetry(
  retryCount: number,
  maxRetries: number = 3,
): boolean {
  return retryCount < maxRetries;
}

const RATE_LIMIT_RE = /rate limit|429|overloaded|usage limit/i;

export function isRateLimitError(output: string): boolean {
  return RATE_LIMIT_RE.test(output);
}
