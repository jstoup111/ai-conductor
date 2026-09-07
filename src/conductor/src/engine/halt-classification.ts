/** A remediation request exceeded its bounded, operator-owned allowance. */
export const KICKBACK_CAP_HALT_CLASS = 'kickback-cap' as const;
/** A user-visible change lies outside the approved product intent. */
export const OVER_SCOPE_HALT_CLASS = 'over-scope' as const;

/** Halt classification carried by cap enforcement before the caller writes its marker. */
export type KickbackCapHaltClass = typeof KICKBACK_CAP_HALT_CLASS;
export type OverScopeHaltClass = typeof OVER_SCOPE_HALT_CLASS;

/**
 * The halt class each recovery-eligible cap terminal actually writes.
 *
 * adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D1 covers
 * the cumulative `build_review` convergence cap only; its 2026-09-05 amendment
 * scopes D1 explicitly so the two remediation-append cap terminals of
 * adr-2026-08-25 decision 4 keep writing `kickback-cap`. A recovery command
 * that accepted only `needs-human` therefore made both remediation gates'
 * advertised recovery path unreachable.
 */
export const RECOVERABLE_CAP_HALT_CLASS_BY_GATE: Readonly<Record<string, string>> = Object.freeze({
  build_review: 'needs-human',
  prd_audit: KICKBACK_CAP_HALT_CLASS,
  architecture_review_as_built: KICKBACK_CAP_HALT_CLASS,
});
