import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ConductState, StepName } from '../types/index.js';
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
    id: options.operationId ?? randomUUID(),
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
    }));
  const result = mutations.length === 0
    ? { kind: 'idempotent' as const }
    : await options.stateStore.applyBatch({ name: `apply rebase operation ${operation.id}`, mutations });
  if ('message' in result) return { operation, invalidated: options.invalidated, preserved: options.preserved, stateResult: 'refused' };

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
