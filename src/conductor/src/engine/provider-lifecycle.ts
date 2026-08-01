/** Identifies one provider attempt within a logical conductor step. */
export interface ProviderAttemptIdentity {
  logicalStep: string;
  id: string;
}

/** The only lifecycle phases with authority over provider preparation. */
export type ProviderLifecyclePhase = 'preparing' | 'running' | 'recovering' | 'settled';

export interface PreparingProviderLifecycle {
  phase: 'preparing';
  attempt: ProviderAttemptIdentity;
  recoveryCount: number;
}

export interface RunningProviderLifecycle {
  phase: 'running';
  attempt: ProviderAttemptIdentity;
  recoveryCount: number;
}

export interface RecoveringProviderLifecycle {
  phase: 'recovering';
  attempt: ProviderAttemptIdentity;
  recoveryCount: number;
  reason: 'preparation-timeout';
}

export interface SettledProviderLifecycle {
  phase: 'settled';
  attempt: ProviderAttemptIdentity;
  recoveryCount: number;
  outcome: 'completed' | 'failed';
}

/** A provider attempt's authoritative lifecycle state. */
export type ProviderLifecycleState =
  | PreparingProviderLifecycle
  | RunningProviderLifecycle
  | RecoveringProviderLifecycle
  | SettledProviderLifecycle;

/** A requested state change; the attempt identity is always derived from current state. */
export type ProviderLifecycleTransition =
  | { phase: 'running' }
  | { phase: 'recovering'; reason: 'preparation-timeout' }
  | { phase: 'settled'; outcome: 'completed' | 'failed' };

export type ProviderLifecycleTransitionResult =
  | { accepted: true; state: ProviderLifecycleState }
  | {
      accepted: false;
      state: ProviderLifecycleState;
      reason: 'illegal-transition' | 'stale-attempt';
    };

/** Starts a provider attempt before candidate resolution or other preparation work. */
export function createPreparingProviderLifecycle(
  attempt: ProviderAttemptIdentity,
  recoveryCount: number,
): PreparingProviderLifecycle {
  return {
    phase: 'preparing',
    attempt: { ...attempt },
    recoveryCount,
  };
}

/**
 * Applies a legal lifecycle change only for the authoritative attempt. The
 * transition itself cannot supply an identity, preventing it from replacing
 * the active attempt while moving between phases.
 */
export function transitionProviderLifecycle(
  current: ProviderLifecycleState,
  transition: ProviderLifecycleTransition,
  authoritativeAttempt: ProviderAttemptIdentity = current.attempt,
): ProviderLifecycleTransitionResult {
  if (!sameAttempt(current.attempt, authoritativeAttempt)) {
    return { accepted: false, state: current, reason: 'stale-attempt' };
  }

  switch (current.phase) {
    case 'preparing':
      return transitionFromPreparing(current, transition);
    case 'running':
      return transitionFromRunning(current, transition);
    case 'recovering':
      return transitionFromRecovering(current, transition);
    case 'settled':
      return { accepted: false, state: current, reason: 'illegal-transition' };
    default:
      return assertNever(current);
  }
}

function transitionFromPreparing(
  current: PreparingProviderLifecycle,
  transition: ProviderLifecycleTransition,
): ProviderLifecycleTransitionResult {
  switch (transition.phase) {
    case 'running':
      return accepted({ ...current, phase: 'running' });
    case 'recovering':
      return accepted({
        ...current,
        phase: 'recovering',
        recoveryCount: current.recoveryCount + 1,
        reason: transition.reason,
      });
    case 'settled':
      return accepted({ ...current, phase: 'settled', outcome: transition.outcome });
    default:
      return assertNever(transition);
  }
}

function transitionFromRunning(
  current: RunningProviderLifecycle,
  transition: ProviderLifecycleTransition,
): ProviderLifecycleTransitionResult {
  if (transition.phase !== 'settled') {
    return { accepted: false, state: current, reason: 'illegal-transition' };
  }
  return accepted({ ...current, phase: 'settled', outcome: transition.outcome });
}

function transitionFromRecovering(
  current: RecoveringProviderLifecycle,
  transition: ProviderLifecycleTransition,
): ProviderLifecycleTransitionResult {
  if (transition.phase !== 'settled') {
    return { accepted: false, state: current, reason: 'illegal-transition' };
  }
  return accepted({ ...current, phase: 'settled', outcome: transition.outcome });
}

function accepted(state: ProviderLifecycleState): ProviderLifecycleTransitionResult {
  return { accepted: true, state };
}

function sameAttempt(left: ProviderAttemptIdentity, right: ProviderAttemptIdentity): boolean {
  return left.logicalStep === right.logicalStep && left.id === right.id;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected provider lifecycle value: ${JSON.stringify(value)}`);
}
