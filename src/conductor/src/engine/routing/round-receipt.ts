import type { ChildId } from '../child-context.js';
import { updateKickbackLedger } from '../kickback-ledger.js';
import type { RoundId } from './route-types.js';

export interface RoutedRepairCreditInput {
  readonly projectRoot: string;
  readonly child: ChildId;
  readonly roundId: RoundId;
}

type GrantRoutedRepairCreditResult =
  | { readonly kind: 'granted' }
  | { readonly kind: 'already-granted' }
  | { readonly kind: 'refused'; readonly detail: string };

/** Persist the single cumulative-bound allowance attached to a routed repair. */
export async function grantRoutedRepairCredit(
  input: RoutedRepairCreditInput,
): Promise<{ readonly kind: 'granted' | 'already-granted' | 'refused'; readonly detail?: string }> {
  return updateKickbackLedger<GrantRoutedRepairCreditResult>(input.projectRoot, (ledger) => {
    const existing = ledger.routedRepairCredit;
    if (existing?.roundId === input.roundId) {
      return { result: existing.consumed ? { kind: 'refused', detail: `routed repair credit for ${input.roundId} is already consumed` } : { kind: 'already-granted' } };
    }
    if (existing !== undefined && existing.consumed !== true) {
      return { result: { kind: 'refused', detail: `routed repair credit for ${existing.roundId} is still unused` } };
    }
    return {
      ledger: { ...ledger, routedRepairCredit: { roundId: input.roundId } },
      result: { kind: 'granted' },
    };
  }, undefined, input.child);
}

/** Spend the routed repair's single extra cumulative build-review lap. */
export async function consumeRoutedRepairCredit(input: RoutedRepairCreditInput): Promise<boolean> {
  return updateKickbackLedger(input.projectRoot, (ledger) => {
    const credit = ledger.routedRepairCredit;
    if (credit?.roundId !== input.roundId || credit.consumed === true) return { result: false };
    return {
      ledger: { ...ledger, routedRepairCredit: { ...credit, consumed: true } },
      result: true,
    };
  }, undefined, input.child);
}
