# Conflict Check: Measured feature active duration always reaches OTEL

**Date:** 2026-10-26
**Stories checked:** `.docs/stories/feature-active-duration-is-dropped-from-otel-whene.md` (Stories 1 to 4)
against every file in `.docs/stories/`, including the two on-main stories amended for this spec
(`no-daemon-level-metrics-queue-depth-halts-and-gate.md` Story 6,
`feature-cost-and-shipment-metrics-cannot-be-groupe.md` Story 3).
**Result:** Passed. Zero blocking conflicts; two degrading overlaps resolved in the new stories.

## ADR corpus

Examined (subject overlaps these stories): `adr-014-otel-observability-exporter` (Decision 9 as
amended 2026-10-26, Decision 10, the closed label vocabulary),
`adr-2026-07-29-engine-observed-provider-time-partition`,
`adr-2026-08-12-execution-lifecycle-completeness-for-timing`,
`adr-2026-10-23-slice-topology-from-sealed-plan` (Decision 6),
`adr-2026-10-21-remediation-closure-judgement`.

Narrowed out: every other APPROVED ADR in `.docs/decisions/`; none governs metric recording, the
timing rollup, provider attempt invocation, or the remediation-closure dispatch.

## Conflict: An unreadable ledger would add a sixth route to the shipped record's Time block

**Stories involved:** Story 1 (unreadable ledger negative path) vs the shipped-record reason story
**Files:** `.docs/stories/feature-active-duration-is-dropped-from-otel-whene.md` vs `.docs/stories/shipped-record-timing-never-reaches-measured-the-l.md`
**Type:** overlap
**Severity:** degrading

**Description:** The shipped-record story names exactly five degrade routes in the `## Time` block,
and an unreadable ledger renders today as a reason-free `partial`. Computing `ledger-unreadable`
inside the timing rollup would change every such shipped record.

**Resolution Options:**
1. Derive `ledger-unreadable` only where `feature_shipped` is emitted, when the rollup is `partial`
   with no reason; the rollup and shipped records are unchanged.
2. Add the route to the rollup and amend the shipped-record story to six routes.

**Recommendation and resolution:** Option 1 (operator-selected). Story 1 now asserts the shipped
record's Time block is unchanged for an unreadable ledger.

## Conflict: A scratch-home failure must end the closure judgement the same way as any failed dispatch

**Stories involved:** Story 4 (scratch-home acquisition failure) vs the remediation-closure retry story
**Files:** `.docs/stories/feature-active-duration-is-dropped-from-otel-whene.md` vs `.docs/stories/remediation-tasks-close-on-a-reported-commit-that-.md`
**Type:** overlap
**Severity:** degrading

**Description:** The remediation-closure story ends a twice-failed dispatch `unjudged` and its test
counts provider invocations. Story 4's draft said the judgement "reports the scratch failure as its
cause", which left the terminal outcome ambiguous and implied provider invocations that never occur.

**Resolution Options:**
1. Story 4 asserts that no provider subprocess starts, both attempts are recorded not invoked, and
   the judgement ends `unjudged` like any twice-failed dispatch.
2. Introduce a distinct outcome for setup failures.

**Recommendation and resolution:** Option 1 (operator-selected).

## Examined pairs with no conflict

- Story 3 vs `usage-exhaustion-re-dispatches-the-exhausted-provi.md` ("an admitted candidate, when
  invoked, carries invoked true"): a pre-spawn failure is never invoked, so both hold in both
  directions.
- Story 3 vs `export-the-telemetry-dimensions-the-engine-already.md` ("invoked false is never counted
  as a dispatch"): pre-spawn failures stop being counted in `conductor.step.dispatches` and the
  dashboard, which is that story's own rule applied consistently.
- Story 2 vs `adr-2026-10-23-slice-topology-from-sealed-plan` Decision 6: Story 2 implements that
  decision's "never block" rule for retired-step leftovers.
- Story 1 vs the two amended on-main stories: both now omit the active point only when no active
  total exists; satisfying either keeps the other true.
- Story 1 vs `adr-014` Decision 10 and the closed label vocabulary: only `state` and `reason` are
  used, both already in the vocabulary.
- No oscillating pair: no two stories gate the same artifact in opposite directions.
