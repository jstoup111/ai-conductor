/** A remediation request exceeded its bounded, operator-owned allowance. */
export const KICKBACK_CAP_HALT_CLASS = 'kickback-cap' as const;

/** Halt classification carried by cap enforcement before the caller writes its marker. */
export type KickbackCapHaltClass = typeof KICKBACK_CAP_HALT_CLASS;
