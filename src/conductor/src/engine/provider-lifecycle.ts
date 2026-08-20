import { writeHaltMarker, type HaltMarkerWriteResult } from './halt-marker.js';
import type { ProviderLifecycleEpisodeStore } from './provider-lifecycle-store.js';
import type { SpawnPermit, SpawnPermitPurpose } from '../execution/llm-provider.js';
import type { ProviderAttemptEvent } from '../types/events.js';
import type { StepName } from '../types/steps.js';

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

/** Production timer boundary; tests inject a deterministic timer into the supervisor. */
export const systemProviderLifecycleTimer: ProviderLifecycleTimer = {
  now: () => Date.now(),
  schedule: (callback, delayMilliseconds) => setTimeout(callback, delayMilliseconds),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Authority held by pre-spawn provider preparation work. */
export interface ProviderPreparationLease {
  attempt: ProviderAttemptIdentity;
  deadlineAt: number | undefined;
  isCurrent(): boolean;
  /** Acknowledges spawn while atomically ending preparation-timeout authority. */
  spawnPermit: SpawnPermit;
}

/** Durable authority required to replace one timed-out preparation attempt. */
export interface ProviderLifecycleRecoveryOptions {
  projectRoot: string;
  episodeStore: ProviderLifecycleEpisodeStore;
  createReplacementAttempt(expiredAttempt: ProviderAttemptIdentity): ProviderAttemptIdentity;
}

export interface ProviderLifecycleSupervisorOptions {
  attempt: ProviderAttemptIdentity;
  recoveryCount: number;
  preparationTimeoutMinutes: number;
  timer: ProviderLifecycleTimer;
  recovery?: ProviderLifecycleRecoveryOptions;
  onStateChange?(state: ProviderLifecycleState): void;
  onLifecycleEvent?(event: ProviderAttemptEvent): void;
}

export interface ProviderLifecycleSupervisor {
  supervise<T>(
    candidate: (lease: ProviderPreparationLease) => Promise<T> | T,
  ): Promise<T | ProviderLifecycleHaltedResult>;
}

/** Terminal outcome when the single automatic preparation recovery is exhausted. */
export interface ProviderLifecycleHaltedResult {
  kind: 'halted';
  reason: 'preparation-timeout-exhausted';
  attempt: ProviderAttemptIdentity;
  elapsedMilliseconds: number;
  recoveryCount: number;
  /** Marker outcome is retained so emitter-less supervisors never discard it. */
  haltMarkerWrite: HaltMarkerWriteResult;
}

/** Raised when preparation loses its authority before it can start a provider. */
class ProviderPreparationTimeoutError extends Error {
  readonly attempt: ProviderAttemptIdentity;
  readonly elapsedMilliseconds: number;

  constructor(attempt: ProviderAttemptIdentity, elapsedMilliseconds: number) {
    super(`Provider preparation timed out for ${attempt.logicalStep} (${attempt.id})`);
    this.name = 'ProviderPreparationTimeoutError';
    this.attempt = { ...attempt };
    this.elapsedMilliseconds = elapsedMilliseconds;
  }
}

/** Raised when durable evidence cannot safely establish replacement authority. */
class ProviderLifecycleRecoveryEvidenceError extends Error {
  constructor(logicalStep: string) {
    super(`Provider lifecycle recovery evidence is unavailable for ${logicalStep}`);
    this.name = 'ProviderLifecycleRecoveryEvidenceError';
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
function createPreparingProviderLifecycle(
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
    async supervise<T>(
      candidate: (lease: ProviderPreparationLease) => Promise<T> | T,
    ): Promise<T | ProviderLifecycleHaltedResult> {
      const recoveryCount = await loadRecoveryCount(options);
      let attempt = options.attempt;
      let currentRecoveryCount = recoveryCount;

      while (true) {
        try {
          return await superviseAttempt(options, attempt, currentRecoveryCount, candidate);
        } catch (error) {
          if (!(error instanceof ProviderPreparationTimeoutError) || options.recovery === undefined) {
            throw error;
          }

          if (currentRecoveryCount !== 0) {
            return haltAfterExhaustedRecovery(options, error, currentRecoveryCount);
          }

          const recovering: RecoveringProviderLifecycle = {
            phase: 'recovering',
            attempt: error.attempt,
            recoveryCount: 1,
            reason: 'preparation-timeout',
          };
          await options.recovery.episodeStore.writeProviderLifecycleEpisode(
            options.recovery.projectRoot,
            recovering,
          );
          attempt = options.recovery.createReplacementAttempt(error.attempt);
          currentRecoveryCount = recovering.recoveryCount;
        }
      }
    },
  };
}

async function haltAfterExhaustedRecovery(
  options: ProviderLifecycleSupervisorOptions,
  error: ProviderPreparationTimeoutError,
  recoveryCount: number,
): Promise<ProviderLifecycleHaltedResult> {
  const haltMarkerWrite = await writeHaltMarker(
    options.recovery!.projectRoot,
    [
      'Provider preparation exhausted.',
      `step: ${error.attempt.logicalStep}`,
      'phase: preparing',
      `attempt: ${error.attempt.id}`,
      `elapsed_ms: ${error.elapsedMilliseconds}`,
      `recovery_count: ${recoveryCount}`,
      '',
    ].join('\n'),
    'needs-human',
  );
  emitLifecycleEvent(options, {
    phase: 'exhausted',
    attempt: error.attempt,
    recoveryCount,
    reason: 'preparation-timeout-exhausted',
  });

  return {
    kind: 'halted',
    reason: 'preparation-timeout-exhausted',
    attempt: error.attempt,
    elapsedMilliseconds: error.elapsedMilliseconds,
    recoveryCount,
    haltMarkerWrite,
  };
}

async function loadRecoveryCount(options: ProviderLifecycleSupervisorOptions): Promise<number> {
  if (options.recovery === undefined) return options.recoveryCount;

  const episode = await options.recovery.episodeStore.readProviderLifecycleEpisode(
    options.recovery.projectRoot,
    options.attempt.logicalStep,
  );
  if (episode.recoveryAuthority === 'fresh') return options.recoveryCount;
  if (episode.recoveryAuthority === 'denied') {
    throw new ProviderLifecycleRecoveryEvidenceError(options.attempt.logicalStep);
  }
  return episode.lifecycle.recoveryCount;
}

async function superviseAttempt<T>(
  options: ProviderLifecycleSupervisorOptions,
  attempt: ProviderAttemptIdentity,
  recoveryCount: number,
  candidate: (lease: ProviderPreparationLease) => Promise<T> | T,
): Promise<T> {
  let state: ProviderLifecycleState = createPreparingProviderLifecycle(attempt, recoveryCount);
  const deadlineDelayMilliseconds = preparationDeadlineDelay(options.preparationTimeoutMinutes);
  const preparationStartedAt = deadlineDelayMilliseconds === undefined
    ? undefined
    : options.timer.now();
  const deadlineAt = preparationStartedAt === undefined
    ? undefined
    : preparationStartedAt + deadlineDelayMilliseconds!;
  let current = true;
  publishLifecycleState(options, state);
  let timeout: ProviderLifecycleTimerHandle | undefined;
  const deadline = deadlineDelayMilliseconds === undefined
    ? undefined
    : new Promise<never>((_, reject) => {
      timeout = options.timer.schedule(() => {
        if (!current) return;
        current = false;
        if (recoveryCount === 0) {
          const recovering = transitionProviderLifecycle(state, {
            phase: 'recovering',
            reason: 'preparation-timeout',
          });
          if (recovering.accepted) {
            state = recovering.state;
            publishLifecycleState(options, state);
          }
        }
        reject(new ProviderPreparationTimeoutError(
          attempt,
          options.timer.now() - preparationStartedAt!,
        ));
      }, deadlineDelayMilliseconds);
    });

  const lease: ProviderPreparationLease = {
    attempt: { ...attempt },
    deadlineAt,
    isCurrent: () => current,
    spawnPermit: (purpose: SpawnPermitPurpose = 'worker-spawn') => {
      if (!current) {
        return { permitted: false, reason: 'revoked' };
      }
      if (purpose === 'preparation') return { permitted: true };
      if (state.phase === 'running') return { permitted: true };
      if (state.phase !== 'preparing') {
        return { permitted: false, reason: 'revoked' };
      }
      const running = transitionProviderLifecycle(state, { phase: 'running' });
      if (!running.accepted) {
        return { permitted: false, reason: 'revoked' };
      }
      state = running.state;
      if (timeout !== undefined) options.timer.cancel(timeout);
      publishLifecycleState(options, state);
      return { permitted: true };
    },
  };

  let candidateResult: Promise<T>;
  try {
    candidateResult = Promise.resolve(candidate(lease));
  } catch (error) {
    candidateResult = Promise.reject(error);
  }

  try {
    const result = await (deadline === undefined
      ? candidateResult
      : Promise.race([candidateResult, deadline]));
    if (current) {
      current = false;
      await settleCurrentAttempt(options, state, attempt, timeout, 'completed');
    }
    return result;
  } catch (error) {
    if (error instanceof ProviderPreparationTimeoutError && !current) throw error;

    if (current) {
      current = false;
      await settleCurrentAttempt(options, state, attempt, timeout, 'failed');
    }
    throw error;
  } finally {
    current = false;
    if (timeout !== undefined) options.timer.cancel(timeout);
  }
}

async function settleCurrentAttempt(
  options: ProviderLifecycleSupervisorOptions,
  state: ProviderLifecycleState,
  attempt: ProviderAttemptIdentity,
  timeout: ProviderLifecycleTimerHandle | undefined,
  outcome: SettledProviderLifecycle['outcome'],
): Promise<void> {
  const settled = transitionProviderLifecycle(state, { phase: 'settled', outcome }, attempt);
  if (!settled.accepted) return;

  if (timeout !== undefined) options.timer.cancel(timeout);
  emitLifecycleEvent(options, settled.state);
  await options.recovery?.episodeStore.clearProviderLifecycleEpisode?.(
    options.recovery.projectRoot,
    attempt.logicalStep,
  );
}

function publishLifecycleState(
  options: ProviderLifecycleSupervisorOptions,
  state: ProviderLifecycleState,
): void {
  options.onStateChange?.(state);
  emitLifecycleEvent(options, state);
}

function emitLifecycleEvent(
  options: ProviderLifecycleSupervisorOptions,
  lifecycle: {
    phase: NonNullable<ProviderAttemptEvent['lifecycle']>['phase'];
    attempt: ProviderAttemptIdentity;
    recoveryCount: number;
    reason?: 'preparation-timeout' | 'preparation-timeout-exhausted';
    outcome?: 'completed' | 'failed';
  },
): void {
  options.onLifecycleEvent?.({
    type: 'provider_attempt',
    step: lifecycle.attempt.logicalStep as StepName,
    provider: 'provider-lifecycle',
    outcome: 'success',
    invoked: false,
    lifecycle: {
      phase: lifecycle.phase,
      attemptId: lifecycle.attempt.id,
      recoveryCount: lifecycle.recoveryCount,
      ...(lifecycle.reason ? { reason: lifecycle.reason } : {}),
      ...(lifecycle.outcome ? { outcome: lifecycle.outcome } : {}),
    },
  });
}

/**
 * Applies a legal lifecycle change only for the authoritative attempt. The
 * transition itself cannot supply an identity, preventing it from replacing
 * the active attempt while moving between phases.
 */
function transitionProviderLifecycle(
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
