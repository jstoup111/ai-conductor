# Architecture Review: a-kickback-restages-a-skipped-manual-test-as-stale (#1987)
**Date:** 2026-08-27
**Mode:** pre-stories, lightweight (Tier M, technical track)
**Stories reviewed:** none yet (pre-stories input: explore output + approved approach C)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

All three parts verified against current source (confidence: verified unless noted).

1. **Skip-preserving restage helper.** The four in-scope sites
   (`conductor.ts:5824`, `:7376`, `:7524`, `:10192`) each build an explicit stale-changes
   record and call `commitStateChanges`. A helper that filters out any field whose current
   status is `skipped` (mirroring `markDownstreamStale`'s existing guard shape,
   `state.ts:290` — which is already skip-safe and stays unchanged) is a mechanical routing
   change. The incident's firing site is `:10192` (build_review kickback hard-codes
   `manual_test: 'stale'` with no ran-check) — verified against the #1985 timeline.
2. **Write-time invariant.** `commitStateChanges` (`conductor.ts:2838`) already computes
   per-field `expected → next` mutations and rides the conduct-state mutation port
   (adr-2026-08-01). The port's sanctioned extension point — conflict rule 3 ("a registered
   domain rule proves one value more accurate") plus rule 4's refuse-and-log — is where the
   invariant lives: a registered domain rule that a `skipped` step status is more accurate
   than a requested `stale`, refusing the write and reporting field/expected/requested/intent.
   Not an ad-hoc assert in `state.ts`, and no generic status ordering (both explicitly
   refused by adr-2026-08-01 / adr-2026-08-24).
3. **`--diagnose` skip-awareness.** `verifyCompleteState` (`complete-verifier.ts`) runs
   artifact-presence predicates for `SHIP_GATING_STEPS` unconditionally; short-circuiting a
   step whose state status is `skipped` as satisfied-for-reporting is contained to that
   module. This stays on the reporting side of the deferred `stepDone`/`stepSatisfied`
   unification (ai-conductor#1587, ruled out of scope by adr-2026-08-16) and does not loosen
   the fail-closed complete-verifier contract (adr-2026-07-25 decision 2).

No new packages, schema, migration, or external surface. Single repo, engine-only.

## Alignment

Repo-wide ADR sweep (all 523 files in `.docs/decisions/`) found no violated ADR and no
uncovered structural decision — **no new ADR is created**; the design is conformance to
already-approved decisions:

- **adr-2026-08-19-operator-step-rewind-through-the-mutation-port D3** — states the exact
  rule ("steps already `skipped` … keep that status; a rewind is not a re-decision of what
  applies to the feature"). This change is the kickback-side application of that decided rule.
- **adr-2026-07-26-rebase-tail-current-branch-before-publication D3/D5** — the finish fence
  already excludes validly-skipped members from staling; the kickback sites are the
  non-conforming siblings.
- **adr-2026-08-01-conduct-state-mutation-port** — owns where the invariant belongs (rule 3
  domain rule + rule 4 refuse-and-log); currently holds one domain rule (terminal
  `feature_status: complete`), so this is a natural second entry.
- **adr-2026-08-24-refused-step-status** — status vocabulary is closed; no new status member,
  no second satisfaction predicate.
- **Amendments made in this review (additive, per adr-2026-08-04):**
  - `adr-2026-07-06-manual-test-fail-routing` D2 — narrowed to non-skipped manual_test.
  - `adr-2026-07-10-validation-group-join` D1 — kickback restage honors member skip rules.
- **Event spine:** the invariant's divergence report is a `ConductorEvent` on the existing
  emitter, declared in the compile-time-exhaustive sink registry
  (adr-2026-07-26-event-sink-registry-exhaustiveness) — no sidecar log, no new channel.
- **Operator lever (adr-2026-08-05) + durability (adr-2026-07-11):** the refusal is loud
  (event + rendered line naming field/expected/requested/intent) but never throws out of
  `Conductor.run()`; the run continues with the skipped status preserved — which is the
  correct state, so no halt is needed and no lever is owed beyond the report.
- **Kickback bounding (adr-2026-07-26-cross-dispatch-kickback-livelock-bound,
  adr-2026-07-13):** preserving `skipped` does not touch the kickback ledger, grant fresh
  budget, or change the kickback's routing target — the helper only filters the stale set.

**Known sibling sites (recorded, in scope for the invariant, out of scope for helper
routing):** `conductor.ts:6771` (BUILD verification members), `:7682` (self-host finish
gate), `:9973` (test_suite), `:10701` (post-remediation) share the restage shape. Under the
scope boundary (four named sites) they are protected by the port invariant — a
`skipped → stale` write from any of them is refused and reported rather than silently
corrupting state, which satisfies the desired outcomes without widening the helper routing.
Stories may route them through the helper only if the operator widens scope.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Invariant refusal masks a legitimate future skipped→stale need (e.g. a rewind that re-decides applicability) | Technical | Low | Medium | adr-2026-08-19 D3 already rules rewinds keep `skipped`; the refusal event names intent, so a future legitimate case surfaces loudly with evidence |
| A sibling restage site trips the invariant in production (refuse-and-log noise) | Technical | Medium | Low | Refusal is non-fatal and state stays correct; the event pinpoints the site for a follow-up |
| `--diagnose` change accidentally treats `skipped` as satisfying the fail-closed terminal boundary | Data | Low | High | Change is reporting-only in `verifyCompleteState`; acceptance test pins the fail-closed path for a genuinely missing artifact |

## Wiring Surface

- **Restage helper** (new function, likely `state.ts` or a conductor-private method) —
  invoked from the four kickback handlers in `conductor.ts` (:5824, :7376, :7524, :10192)
  in place of their inline stale-changes construction.
- **Port domain rule** — registered in the conduct-state mutation port's existing rule table
  (adr-2026-08-01 rule-3 slot, beside the `feature_status: complete` rule), evaluated on
  every `applyStateBatch` in production.
- **Divergence event** (new `ConductorEvent` member) — emitted by the port refusal path,
  consumed by the existing render/persist/audit sinks via the exhaustive sink registry.
- **`--diagnose` skip-awareness** — inside `verifyCompleteState`, reached from the existing
  `conduct-ts inline --diagnose` dispatch in `cli.ts` and the resume recovery prompt.

## ADRs Created

None — governed by existing APPROVED ADRs (see Alignment). Two additive amendments made:
`adr-2026-07-06-manual-test-fail-routing`, `adr-2026-07-10-validation-group-join`.

## Conditions

1. The invariant is implemented as a registered domain rule + rule-4 refuse-and-log on the
   mutation port — not an assert, not a status ranking, not a new status member.
2. The divergence report travels the event spine (declared in the sink registry); no
   sidecar file or log.
3. `--diagnose` skip-awareness is reporting-only; the fail-closed complete-verifier
   contract for genuinely missing evidence is preserved and pinned by a test.
4. The helper does not alter kickback routing targets, budgets, or the kickback ledger.
