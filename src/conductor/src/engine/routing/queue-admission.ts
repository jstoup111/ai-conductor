import type { GitRunner } from '../rebase.js';
import { consumeLowestQueued } from './revalidation-queue.js';
import { reconcileRounds, type ReconcileRoundsResult } from './round-admission.js';
import { drainRoutingOutboxes, type PersistOutboxEvent } from './route-record-store.js';
import type { ChildId, RoundId } from './route-types.js';

type ContinuingReconciliation = Extract<ReconcileRoundsResult, {
  readonly kind: 'navigate-host' | 'navigate-leaf-to-build' | 'resume-exit';
}>;

type ReconciledStall = Extract<ReconcileRoundsResult, { readonly kind: 'stalled' }>;

/** The bounded outcomes callers must handle before entering a child BUILD region. */
export type QueueAdmissionResult =
  | { readonly kind: 'continue'; readonly reconciled: ContinuingReconciliation }
  | { readonly kind: 'admitted'; readonly roundId: RoundId; readonly host: ChildId }
  | { readonly kind: 'none' }
  | { readonly kind: 'busy'; readonly detail?: string }
  | ReconciledStall
  | { readonly kind: 'stalled'; readonly detail: string; readonly haltClass: 'mechanical' }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface AdmitQueuedRevalidationInput {
  readonly worktree: string;
  readonly slug: string;
  /** A preceding continuation may already have reconciled the durable rounds. */
  readonly reconciled?: ReconcileRoundsResult;
  /** Required to drain the canonical event outbox before fresh reconciliation. */
  readonly persist?: PersistOutboxEvent;
  readonly git?: GitRunner;
}

/**
 * Admit the next queued revalidation only after durable rounds have yielded
 * control. A fresh entry drains the canonical outbox before reconciliation.
 */
export async function admitQueuedRevalidation(input: AdmitQueuedRevalidationInput): Promise<QueueAdmissionResult> {
  const dependencies = input.git === undefined ? {} : { git: input.git };
  let reconciled = input.reconciled;
  if (reconciled === undefined) {
    if (input.persist === undefined) {
      return { kind: 'unavailable', detail: 'cannot drain routing outbox: no persister' };
    }
    const drained = await drainRoutingOutboxes(input.worktree, input.slug, input.persist, dependencies);
    if (drained.kind !== 'drained') {
      return { kind: 'unavailable', detail: `cannot drain routing outbox: ${drained.kind}` };
    }
    reconciled = await reconcileRounds(input.worktree, input.slug, dependencies);
  }

  switch (reconciled.kind) {
    case 'navigate-host':
    case 'navigate-leaf-to-build':
    case 'resume-exit':
      return { kind: 'continue', reconciled };
    case 'unavailable':
      return reconciled;
    case 'stalled':
      return reconciled;
    case 'none':
    case 'aborted':
    case 'deferred':
    case 'leaf-returned':
    case 'quiescent':
      break;
  }

  const consumed = await consumeLowestQueued(input.worktree, input.slug, dependencies);
  switch (consumed.kind) {
    case 'admitted':
      return consumed;
    case 'none':
      return consumed;
    case 'busy':
      return consumed;
    case 'unavailable':
      return { kind: 'unavailable', detail: consumed.detail ?? 'cannot consume routed revalidation queue' };
    case 'stalled': {
      const stalled = await reconcileRounds(input.worktree, input.slug, dependencies);
      if (stalled.kind === 'stalled') return stalled;
      return {
        kind: 'stalled',
        detail: consumed.detail ?? 'routing queue consumption stalled',
        haltClass: 'mechanical',
      };
    }
  }
}
