import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ConductState, StateMutation, StepName } from '../types/index.js';
import type { ConductStateStore } from './conduct-state-store.js';
import type { PreservedJudgeIdentity, ReplayEvidence, RebaseOperationRecord } from './gate-verdicts.js';
import { readVerdict, writeVerdict } from './gate-verdicts.js';
import { readState } from './state.js';
import { creditKickbackGateLaps, updateKickbackLedger } from './kickback-ledger.js';

/** The durable result consumed by the conductor and the re-kick path. */
export interface AppliedRebaseTransition {
  operation: RebaseOperationRecord;
  invalidated: readonly StepName[];
  preserved: readonly StepName[];
  stateResult: 'applied' | 'already-applied' | 'refused';
  convergenceCredit?: { gate: 'build_review' };
}

/**
 * Credit a rebase invalidation once, using the durable operation id as receipt.
 * Returns the credit only for the call that actually mutated the ledger.
 */
async function creditBuildReviewConvergence(projectRoot: string, operationId: string, invalidated: readonly StepName[]): Promise<{ gate: 'build_review' } | undefined> {
  if (!invalidated.includes('build_review')) return undefined;
  return updateKickbackLedger(projectRoot, (ledger) => {
    // A receipt means the refund already happened. Claiming it again would
    // make the credit-bearing kickback event disagree with the ledger.
    if (ledger.convergenceCreditReceipts?.[operationId]) return { result: undefined };
    const entry = ledger.gates.build_review;
    if (!entry) return { result: undefined };
    return {
      ledger: {
        ...ledger,
        gates: { ...ledger.gates, build_review: creditKickbackGateLaps(entry) },
        convergenceCreditReceipts: {
          ...ledger.convergenceCreditReceipts,
          [operationId]: { gate: 'build_review' },
        },
      },
      result: { gate: 'build_review' } as const,
    };
  }, 'build_review');
}

/**
 * The preservation candidate captured while applying the replay decision.
 * It is intentionally a snapshot, rather than a gate name that this service
 * re-discovers after writes have begun: a later ordinary verdict must never be
 * retroactively claimed as the original replayed PASS.
 */
export interface RebasePreservedCandidate {
  gate: StepName;
  original: PreservedJudgeIdentity;
  originalVerdictDigest: string;
  relevantInputIdentities: readonly string[];
}

export interface ApplyRebaseTransitionOptions {
  projectRoot: string;
  /**
   * The same state file owned by the caller's ConductStateStore.  Production
   * uses `.pipeline/conduct-state.json`, while isolated callers may inject a
   * different path; reading a second, derived path would turn that valid
   * configuration into a false transition conflict.
   */
  stateFilePath?: string;
  stateStore: ConductStateStore<ConductState>;
  replay: ReplayEvidence;
  invalidated: readonly StepName[];
  preserved: readonly StepName[];
  preservedCandidates: readonly RebasePreservedCandidate[];
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
  const statePath = options.stateFilePath ?? join(options.projectRoot, '.pipeline', 'conduct-state.json');
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
    const complete = await Promise.all(options.preserved.map(async (gate) =>
      (await readVerdict(options.projectRoot, gate))?.preservation?.operationId === operation.id));
    if (complete.every(Boolean)) {
      const convergenceCredit = await creditBuildReviewConvergence(options.projectRoot, operation.id, options.invalidated);
      return { operation: priorRebase.rebaseOperation, invalidated: options.invalidated, preserved: options.preserved, stateResult: 'already-applied', ...(convergenceCredit ? { convergenceCredit } : {}) };
    }
    // A prior process exposed an applied descriptor before writing every
    // preservation effect. Re-open its fence and reconcile below; publication
    // remains blocked throughout.
  }

  // Preservation is authority for the verdict that existed when this replay
  // transition began.  Do not discover that verdict after applying the state
  // batch: another writer may have recorded a genuine later judgement in the
  // meantime, and attaching this replay to that newer authority would make it
  // look as though the old judgement survived it.
  const preservationCandidates = new Map(
    options.preservedCandidates.map((candidate) => [candidate.gate, candidate]),
  );
  // A named preservation without its immutable original authority is not an
  // incomplete optimization; it is an inconsistent transition.  Refuse
  // before writing `applying` so no reader can publish a bare old PASS.
  if (options.preserved.some((gate) => !preservationCandidates.has(gate))) {
    return {
      operation: {
        id: options.operationId ?? createHash('sha256').update(JSON.stringify(options.replay)).digest('hex'),
        status: 'applying',
        transition: { preserved: [...options.preserved], invalidated: [...options.invalidated], reverified: [...(options.reverified ?? [])] },
        replay: options.replay,
      },
      invalidated: options.invalidated,
      preserved: options.preserved,
      stateResult: 'refused',
    };
  }
  const originalPreserved = new Map<StepName, RebasePreservedCandidate>();
  for (const gate of options.preserved) {
    const candidate = preservationCandidates.get(gate);
    if (!candidate) continue;
    const verdict = await readVerdict(options.projectRoot, gate);
    if (!verdict?.satisfied || verdict.kickback || !options.replay.expectedTree ||
      createHash('sha256').update(JSON.stringify(verdict)).digest('hex') !== candidate.originalVerdictDigest) continue;
    originalPreserved.set(gate, candidate);
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
  const effectiveInvalidated = options.invalidated;
  const verdictsAgree = await Promise.all(effectiveInvalidated.map(async (gate) => {
    const verdict = await readVerdict(options.projectRoot, gate);
    return verdict?.satisfied === false && verdict.kickback?.from === 'rebase';
  }));
  if (!settled.ok || effectiveInvalidated.some((gate) => settled.value[gate] !== 'pending') || verdictsAgree.some((ok) => !ok)) {
    return { operation, invalidated: options.invalidated, preserved: options.preserved, stateResult: 'refused' };
  }

  // Preserve the original verdict rather than minting a second judge result.
  // The operation id makes this authority usable only with this exact applied
  // replay; an ordinary later verdict replaces this whole record naturally.
  for (const gate of options.preserved) {
    const original = originalPreserved.get(gate);
    if (!original) continue;
    const verdict = await readVerdict(options.projectRoot, gate);
    // A newer ordinary verdict wins.  Do not overwrite it and do not add this
    // operation's preservation metadata to it.
    if (!verdict?.satisfied || verdict.kickback ||
      createHash('sha256').update(JSON.stringify(verdict)).digest('hex') !== original.originalVerdictDigest) continue;
    await writeVerdict(options.projectRoot, gate, {
      ...verdict,
      preservation: {
        gate,
        original: original.original,
        replay: options.replay,
        relevantInputIdentities: original.relevantInputIdentities,
        operationId: operation.id,
      },
    });
  }
  const preservationRecordsAgree = await Promise.all(options.preserved.map(async (gate) => {
    const verdict = await readVerdict(options.projectRoot, gate);
    return verdict?.satisfied === true && verdict.preservation?.gate === gate &&
      verdict.preservation.operationId === operation.id;
  }));
  if (preservationRecordsAgree.some((ok) => !ok)) {
    return { operation, invalidated: options.invalidated, preserved: options.preserved, stateResult: 'refused' };
  }
  // Applied is the commit marker: every preservation effect precedes it, so a
  // restart can safely distinguish a completed operation from an interrupted
  // one without publishing a half-written pair.
  const applied: RebaseOperationRecord = { ...operation, status: 'applied' };
  const convergenceCredit = await creditBuildReviewConvergence(options.projectRoot, operation.id, options.invalidated);
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
    ...(convergenceCredit ? { convergenceCredit } : {}),
  };
}
