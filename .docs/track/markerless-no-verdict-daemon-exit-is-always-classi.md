# Track: Markerless no-verdict daemon exit is always classified needs-human

Track: technical

Scope boundary: Narrow — only the gate-block return path in
`src/conductor/src/engine/conductor.ts`, and within it only the shape whose unsatisfied
prerequisites include one that is both `pending` and resolvable to an earlier index in the
resolved step registry. That is the same condition the resume clamp uses to decide it can move,
so a re-dispatch provably reaches the prerequisite. That one exit shape earns the `mechanical`
HALT class; a `pending` prerequisite the registry cannot locate, or one at or after the blocked
step's own index, stays `needs-human`, and every other markerless exit keeps the catch-all's
conservative `needs-human` default, unchanged.

Operator confirmed the refined predicate on 2026-09-18 after explore found that "pending" alone
covers an unreachable registry-anomaly shape that no re-dispatch can fix.

Excluded: the catch-all classifier at `conductor.ts:13459` itself (its default stands), any new
HALT read disposition (ADR `adr-2026-07-28` D2 fixes exactly four), any new retry timer or
backoff state (`adr-2026-07-27`; retry bounding is already owned by the daemon's
`progressReKickDispatchCeiling`), and any change to the `classifyRetryDecision` seam owned by
`adr-2026-07-13` D2/D6. The three already-shipped outcomes of the source issue
(`clampToRunnablePrerequisite`, prerequisite-and-state naming in the block reason, and terminal
conditions still halting) are preserved, not re-implemented.

Daemon-internal HALT classification with no user-facing capability and no product requirements,
so no PRD; acceptance criteria live directly in stories.
