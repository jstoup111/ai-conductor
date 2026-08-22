/** A remediation request exceeded its bounded, operator-owned allowance. */
export const KICKBACK_CAP_HALT_CLASS = 'kickback-cap' as const;
/** A user-visible change lies outside the approved product intent. */
export const OVER_SCOPE_HALT_CLASS = 'over-scope' as const;

/** Halt classification carried by cap enforcement before the caller writes its marker. */
export type KickbackCapHaltClass = typeof KICKBACK_CAP_HALT_CLASS;
export type OverScopeHaltClass = typeof OVER_SCOPE_HALT_CLASS;
