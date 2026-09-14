# Track: Gate satisfied without dispatch leaves no state key, so FINISH invalidates forever

Track: technical

Scope boundary: Narrowed to the production-evidenced defects only, after a 170-feature telemetry
validation showed the issue's stated "invalidates forever" deadlock has not occurred.

IN SCOPE:
- FINISH's implementation-evidence observation consults the gate-verdict layer through the SAME
  `gateSatisfied` predicate the loop already uses, so the loop and FINISH cannot disagree about a
  gate the loop has already resolved.
- The block/kickback diagnostic names WHICH step's predicate is unsatisfied, carried as a typed
  facet on the result value rather than derived from message text.

EXPLICITLY EXCLUDED:
- Persisting a step status when a gate resolves without dispatch (the issue's first desired
  outcome and filer hypothesis). Refused by `adr-2026-07-11-verdict-aware-resume-entry`'s rejected
  Option C, `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` D3, and
  `adr-2026-08-03-build-repair-member-reuse-validity`. The durable record already exists as the
  gate verdict; a second copy in step state is the reconciliation-by-copy those decisions refuse.
- A cumulative bound on the `finish` kickback gate. Refused by
  `adr-2026-08-16-restore-the-current-head-publication-fence` D5 ("Bounding is inherited, not
  invented. No new counter, allowance, or cap is introduced") and out of scope of
  `adr-2026-08-12-cumulative-build-review-convergence-bound` D6. The cycle it would guard is not
  evidenced in 170 features; all 5 observed blocks self-recovered in one lap.
- Changing `bumpKickbackGate`'s tree-hash reset, which is deliberate per
  `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` D3.

Engine-internal correctness on the FINISH publication seam: no user-facing capability or product
requirement, so acceptance criteria live directly in stories rather than a PRD.
