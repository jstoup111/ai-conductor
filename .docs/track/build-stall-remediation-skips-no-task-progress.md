# Track: Build-stall auto-remediation must also fire for no_task_progress stalls (#569)

Track: technical

Internal engine bug fix to the build-step stall circuit breaker in
`src/conductor/src/engine/conductor.ts`. The `/remediate` auto-remediation dispatch
added for build stalls is gated entirely on `effectiveQuestion`, which is only populated
for `halt_marker` stalls — so a `no_task_progress` (zero-work) stall skips remediation
entirely. No user-facing product behavior or requirements — acceptance criteria live
directly in stories. Chosen fix: Approach A (synthesize a remediation prompt from the
run's own context for `no_task_progress` stalls and route it through the SAME
`planRemediation`/`/remediate` dispatch that `halt_marker` stalls use, bounded by the
shared `MAX_KICKBACKS_PER_GATE` budget, while preserving the durable no-evidence
counter as the owner of the terminal HALT decision for this condition).
