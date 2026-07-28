# Coherence Waiver: staleness-decisions-invisible-in-daemon-log

Waives: outcome-1, outcome-2, outcome-3, outcome-4, outcome-6

Rationale: Issue jstoup111/ai-conductor#982 was filed with six desired-outcome bullets, and
the operator explicitly narrowed this spec to outcome 5 ("the log distinguishes which of the
two classes applied") because the other five are already satisfied on `main`. Claiming them as
covered here would be a false traceability claim, so they are waived rather than asserted.

Outcomes 1 and 2 — "evidence found stale is invalidated on first detection rather than
re-evaluated against the same unchanged artifact", holding "for every step whose completion
check can reject on staleness" — are satisfied by `8c12993b` (in `main`, verified via
`git merge-base --is-ancestor`). It gives engine-computed steps a retry budget of 1 via
`isEngineComputedStep` (`conductor.ts:308-314`, applied at `:3570`), so `wiring_check` and
`test_suite` no longer spend attempts 2 and 3 re-running a deterministic in-process
computation over an unchanged tree. The remaining staleness-gated predicates
(`manual_test`, `prd_audit`, `architecture_review_as_built`, `build_review`) are *dispatched*
steps whose retry genuinely re-runs an agent that can rewrite the artifact, so their budget of
3 is not wasted work and is correct as-is.

Outcomes 3 and 4 — "staleness that does not invalidate the verdict does not force a full
re-run" and "staleness that does invalidate the verdict is still rejected and recomputed" —
are satisfied by the diff-based preserve overlay `gateVerdictStillValid`
(`gate-code-validity.ts:82-113`), which compares `codeStamp..HEAD` against a per-gate
`GATE_SURFACE` and returns `preserve` on a surface miss and `rerun` otherwise. It is consulted
by all four dispatched verdict predicates. This spec deliberately does not change that
decision — only how it is reported.

Outcome 6 — "a run in which a step writes evidence and a later commit advances HEAD completes
without a terminal staleness failure and without a kickback to build" — is satisfied for the
step that produced the incident by `3efb0e63` (#897 re-land, in `main`), which re-derives
stale wiring evidence via `deriveAndPersistWiringEvidence` (`artifacts.ts:1288-1304`, stale
branch at `:2095-2107`) instead of hard-rejecting it. The issue comment asserting that fix was
unmerged predates the re-land and is out of date.

The residual gap after those merges is outcome 5 alone, which this spec covers via story-1 and
story-2. Extending the preserve overlay to `retro`, `finish` and the generic
`completion_artifact` path, and the separate empty-commit finding from the issue comment
("record checked-nothing-to-change without producing a commit"), were both explicitly placed
out of scope by the operator and belong in their own tickets.
