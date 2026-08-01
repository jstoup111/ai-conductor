/** Identifies one provider attempt within a logical conductor step. */
export interface ProviderAttemptIdentity {
  logicalStep: string;
  id: string;
}

/** Injectable time boundary for deterministic provider-preparation supervision. */
export interface ProviderLifecycleTimer {
  now(): number;
  schedule(callback: () => void, delayMilliseconds: number): ProviderLifecycleTimerHandle;
  cancel(handle: ProviderLifecycleTimerHandle): void;
}

export type ProviderLifecycleTimerHandle = number | object;

/** Authority held by pre-spawn provider preparation work. */
export interface ProviderPreparationLease {
  deadlineAt: number | undefined;
  isCurrent(): boolean;
}

export interface ProviderLifecycleSupervisorOptions {
  attempt: ProviderAttemptIdentity;
  recoveryCount: number;
  preparationTimeoutMinutes: number;
  timer: ProviderLifecycleTimer;
  onStateChange?(state: ProviderLifecycleState): void;
}

export interface ProviderLifecycleSupervisor {
  supervise<T>(candidate: (lease: ProviderPreparationLease) => Promise<T> | T): Promise<T>;
}

/** Raised when preparation loses its authority before it can start a provider. */
export class ProviderPreparationTimeoutError extends Error {
  readonly attempt: ProviderAttemptIdentity;

  constructor(attempt: ProviderAttemptIdentity) {
    super(`Provider preparation timed out for ${attempt.logicalStep} (${attempt.id})`);
    this.name = 'ProviderPreparationTimeoutError';
    this.attempt = { ...attempt };
  }
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
 * Begins preparation supervision before invoking candidate resolution or any
 * other pre-spawn work. Expiration revokes the lease before publishing
 * recovery and rejects without awaiting any stale preparation result.
 */
export function createProviderLifecycleSupervisor(
  options: ProviderLifecycleSupervisorOptions,
): ProviderLifecycleSupervisor {
  return {
    async supervise<T>(candidate: (lease: ProviderPreparationLease) => Promise<T> | T): Promise<T> {
      let state: ProviderLifecycleState = createPreparingProviderLifecycle(
        options.attempt,
        options.recoveryCount,
      );
      const deadlineDelayMilliseconds = preparationDeadlineDelay(options.preparationTimeoutMinutes);
      const deadlineAt = deadlineDelayMilliseconds === undefined
        ? undefined
        : options.timer.now() + deadlineDelayMilliseconds;
      let current = true;
      options.onStateChange?.(state);
      let timeout: ProviderLifecycleTimerHandle | undefined;
      const deadline = deadlineDelayMilliseconds === undefined
        ? undefined
        : new Promise<never>((_, reject) => {
          timeout = options.timer.schedule(() => {
            if (!current) return;
            current = false;
            const recovering = transitionProviderLifecycle(state, {
              phase: 'recovering',
              reason: 'preparation-timeout',
            });
            if (recovering.accepted) {
              state = recovering.state;
              options.onStateChange?.(state);
            }
            reject(new ProviderPreparationTimeoutError(options.attempt));
          }, deadlineDelayMilliseconds);
        });

      const lease: ProviderPreparationLease = {
        deadlineAt,
        isCurrent: () => current,
      };

      let candidateResult: Promise<T>;
      try {
        candidateResult = Promise.resolve(candidate(lease));
      } catch (error) {
        candidateResult = Promise.reject(error);
      }

      try {
        return await (deadline === undefined
          ? candidateResult
          : Promise.race([candidateResult, deadline]));
      } finally {
        current = false;
        if (timeout !== undefined) options.timer.cancel(timeout);
      }
    },
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

function preparationDeadlineDelay(preparationTimeoutMinutes: number): number | undefined {
  return preparationTimeoutMinutes > 0 ? preparationTimeoutMinutes * 60_000 : undefined;
}

function sameAttempt(left: ProviderAttemptIdentity, right: ProviderAttemptIdentity): boolean {
  return left.logicalStep === right.logicalStep && left.id === right.id;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected provider lifecycle value: ${JSON.stringify(value)}`);
}
