import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ConductState, StateMutation, StepName } from '../types/index.js';
import type { ConductStateStore } from './conduct-state-store.js';
import type { ReplayEvidence, RebaseOperationRecord } from './gate-verdicts.js';
import { readVerdict, writeVerdict } from './gate-verdicts.js';
import { readState } from './state.js';

/** The durable result consumed by the conductor and the re-kick path. */
export interface AppliedRebaseTransition {
  operation: RebaseOperationRecord;
  invalidated: readonly StepName[];
  preserved: readonly StepName[];
  stateResult: 'applied' | 'already-applied' | 'refused';
}

export interface ApplyRebaseTransitionOptions {
  projectRoot: string;
  stateStore: ConductStateStore<ConductState>;
  replay: ReplayEvidence;
  invalidated: readonly StepName[];
  preserved: readonly StepName[];
  reverified?: readonly StepName[];
  operationId?: string;
}

/**
 * Apply the state half of a replay decision through the sole state mutation
 * port. Gate records are deliberately written around it: their `applying`
 * descriptor makes an interrupted cross-file operation non-publishable until
 * this function (or its retry) has observed the exact completed result.
 */
export async function applyRebaseTransition(
  options: ApplyRebaseTransitionOptions,
): Promise<AppliedRebaseTransition> {
  const statePath = join(options.projectRoot, '.pipeline', 'conduct-state.json');
  const operation: RebaseOperationRecord = {
    // The replay tuple is immutable. Its digest makes a resumed application
    // identify the same cross-file operation instead of reopening gates again.
    id: options.operationId ?? createHash('sha256').update(JSON.stringify({
      replay: options.replay,
      invalidated: [...options.invalidated].sort(),
      preserved: [...options.preserved].sort(),
      reverified: [...(options.reverified ?? [])].sort(),
    })).digest('hex'),
    status: 'applying',
    transition: {
      preserved: [...options.preserved],
      invalidated: [...options.invalidated],
      reverified: [...(options.reverified ?? [])],
    },
    replay: options.replay,
  };
  const priorRebase = await readVerdict(options.projectRoot, 'rebase');
  if (priorRebase?.rebaseOperation?.id === operation.id && priorRebase.rebaseOperation.status === 'applied') {
    return { operation: priorRebase.rebaseOperation, invalidated: options.invalidated, preserved: options.preserved, stateResult: 'already-applied' };
  }

  await writeVerdict(options.projectRoot, 'rebase', {
    satisfied: true,
    checkedAt: Date.now(),
    ...(priorRebase?.reason ? { reason: priorRebase.reason } : {}),
    rebaseOperation: operation,
  });

  const snapshot = await readState(statePath);
  if (!snapshot.ok) return { operation, invalidated: options.invalidated, preserved: options.preserved, stateResult: 'refused' };
  const mutations = [...new Set(options.invalidated)]
    .filter((gate) => snapshot.value[gate] !== 'skipped')
    .map((gate) => ({
      field: gate,
      expected: snapshot.value[gate],
      next: 'pending' as const,
      intent: `apply rebase operation ${operation.id}`,
    }) as StateMutation<ConductState>);
  const result = mutations.length === 0
    ? { kind: 'idempotent' as const }
    : await options.stateStore.applyBatch({ name: `apply rebase operation ${operation.id}`, mutations });
  if ('message' in result) return { operation, invalidated: options.invalidated, preserved: options.preserved, stateResult: 'refused' };

  // Do not turn the cross-file descriptor into publication authority until
  // both durable halves agree. A successful state-store response alone is not
  // enough: another writer could have changed a gate record while the batch
  // was applying.
  const settled = await readState(statePath);
  const effectiveInvalidated = options.invalidated.filter((gate) => snapshot.value[gate] !== 'skipped');
  const verdictsAgree = await Promise.all(effectiveInvalidated.map(async (gate) => {
    const verdict = await readVerdict(options.projectRoot, gate);
    return verdict?.satisfied === false && verdict.kickback?.from === 'rebase';
  }));
  if (!settled.ok || effectiveInvalidated.some((gate) => settled.value[gate] !== 'pending') || verdictsAgree.some((ok) => !ok)) {
    return { operation, invalidated: options.invalidated, preserved: options.preserved, stateResult: 'refused' };
  }

  const applied: RebaseOperationRecord = { ...operation, status: 'applied' };
  await writeVerdict(options.projectRoot, 'rebase', {
    satisfied: true,
    checkedAt: Date.now(),
    ...(priorRebase?.reason ? { reason: priorRebase.reason } : {}),
    rebaseOperation: applied,
  });
  return {
    operation: applied,
    invalidated: options.invalidated,
    preserved: options.preserved,
    stateResult: result.kind === 'idempotent' ? 'already-applied' : 'applied',
  };
}
