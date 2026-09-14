/** Bounded, record-specific recovery text for PRD widening failures. */
export type PrdWideningRecoveryReason =
  | 'malformed-history' | 'unsupported-history' | 'foreign-feature' | 'missing-operator'
  | 'persistence-failed' | 'invalid-provider-result' | 'stale-relation' | 'context-overflow'
  | 'projection-failed' | 'uncertain-relation' | 'provider-timeout'
  | 'provider-unavailable' | 'attempts-exhausted';

const ACTIONS: Record<PrdWideningRecoveryReason, string> = {
  'malformed-history': 'restore the original .pipeline widening history from a known-good copy, then resume.',
  'unsupported-history': 'preserve the original history and upgrade with a supported conductor version before resuming.',
  'foreign-feature': 'use the worktree that owns the widening history; do not copy it between features.',
  'missing-operator': 'configure the machine owner and re-submit the explicit decision.',
  'persistence-failed': 'resolve the store or lease failure, verify the durable records, then resume.',
  'invalid-provider-result': 'retry only after the selected provider supports the required native output schema.',
  'provider-timeout': 'retry after the provider timeout is resolved; no BUILD or plan-growth allowance was charged.',
  'provider-unavailable': 'select or restore a provider with native output-schema support, then resume.',
  'attempts-exhausted': 'the configured reconciliation allowance is exhausted; preserve the decision history and obtain operator direction.',
  'stale-relation': 'keep the recorded decision and re-run reconciliation against the current report.',
  'context-overflow': 'reduce the reported input at its source; no history was pruned.',
  'projection-failed': 'repair the named stored evidence or renderer, then resume without re-deciding valid authority.',
  'uncertain-relation': 'review the preserved original and current evidence and submit a new explicit decision if desired.',
};

export function renderPrdWideningRecovery(
  reason: PrdWideningRecoveryReason,
  records: readonly string[],
): string {
  const named = records.length === 0 ? 'no specific record' : records.slice(0, 5).join(', ');
  const more = records.length > 5 ? ` (+${records.length - 5} more)` : '';
  return `PRD widening recovery (${reason}): affected ${named}${more}. Recovery: ${ACTIONS[reason]}`;
}

/**
 * The serial PRD tail and the validation-group join halt on the same durable
 * scope authority. Keep their operator text identical so a retry cannot
 * obscure a record-specific recovery behind a different execution shape.
 */
export function renderPrdAuditScopeHalt(detail: string, decisionBlock: string): string {
  return `prd-audit halted: user-visible scope requires operator acceptance — ${detail}` +
    `\n\n${decisionBlock}`;
}

/** A failed verdict projection is a widening-state recovery, not a generic error. */
export function renderPrdAuditProjectionHalt(
  detail: string,
  records: readonly string[] = ['.pipeline/prd-audit.md'],
): string {
  return `prd-audit halted: ${renderPrdWideningRecovery('projection-failed', records)} Detail: ${detail}`;
}
