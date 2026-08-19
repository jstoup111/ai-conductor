# Conflict Check: One build_review PASS clears the convergence cap (#1694)

**Date:** 2026-08-18
**ADR corpus:** `change_set` (the `conflict_check.adr_corpus` default). The change set's approved ADR
is `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`. Because it supersedes
`adr-2026-08-12` D2 and constrains `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`, both
were compared in full, as were `adr-2026-08-17` and `adr-2026-07-20`.
**Inventory:** all 5 stories in `.docs/stories/one-build-review-pass-clears-the-convergence-cap-s.md`;
the approved ADR and review report above; every `.docs/plans/` entry referencing the kickback ledger,
the kickback event, `advanceTail`, or `classifyGateInvalidation`, each checked against its
`.docs/shipped/` status; all 5 open pull requests.
**Result:** **PASS — zero blocking conflicts.** Two conflicts found: one ordering-only and
self-resolving, one a direct contradiction **resolved by operator decision** (scope widened; see
Conflict 2). No degrading conflict remains accepted-but-unresolved.

## Scan method

The production surface is small and enumerable, so the external scan was exhaustive rather than
sampled.

| File this change touches | Open PR touching it | Unshipped plan touching it |
|---|---|---|
| `src/conductor/src/engine/kickback-ledger.ts` | #1724 (spec only, no code) | `the-engine-cannot-detect-its-own-spinning-operator` |
| `src/conductor/src/engine/conductor.ts` (step-done path, rebase-outcome block) | #1724 (spec only, no code) | `the-engine-cannot-detect-its-own-spinning-operator` |
| `src/conductor/src/types/events.ts` (`kickback` member) | none | `the-engine-cannot-detect-its-own-spinning-operator` |
| `docs/reference/configuration.md` | none | none |

Open PRs #1720, #1687, #1581 and #1168 were each checked with `gh pr diff --name-only`; none touches
any of these files. #1687 is the bot-owned release PR and is excluded by construction — this branch
writes neither `VERSION` nor `CHANGELOG.md`. #1724 is a spec PR: it adds `.docs/` artifacts only and
touches no source file, but its **design** conflicts, which is Conflict 2.

Plans referencing the kickback surface were checked for unshipped status; all are shipped except
`the-engine-cannot-detect-its-own-spinning-operator`, which is Conflict 1.

## Conflict 1 — ordering with #1652's per-rubric tally (resolved, no scope change)

**Type:** overlap / sequencing. **Severity:** degrading, self-resolving.

`adr-2026-08-17-build-review-rubric-repetition-short-circuit` is APPROVED and its spec is merged, but
`rubricFailures` is absent from `kickback-ledger.ts` at base `9b5ae42cc` — verified by grep, and by
the absence of a `.docs/shipped/` record, an open PR, or a worktree. Its D5 keeps the PASS reset that
this feature deletes, and both features edit the same type and the same two conductor sites.

**Resolution.** No amendment to either spec. This feature's Story 5 requires the clear and the credit
to operate on whichever lap-counting fields the entry actually carries, so it is correct in either
landing order, and `adr-2026-08-17` D5's reset is subsumed rather than contradicted — that ADR
explicitly parks the question here ("Whether `cumulative` should also carry a never-reset floor is
`adr-2026-08-12`'s question and is left to it"). Whichever feature builds second re-reads
`kickback-ledger.ts` as current rather than as described in its own plan.

## Conflict 2 — #1629's allowance resets on PASS "matching how `cumulative` resets"

**Type:** contradiction. **Severity:** degrading → **resolved by operator decision, with scope
widened.**

`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` (#1629, spec PR #1724, open and unmerged)
adds a bounded mechanical-fault allowance to this same `KickbackGateEntry`. Its plan task-6 step 3
instructs its build to "Implement the advance, the declared ceiling constant, and the PASS reset
beside the existing cumulative reset", and its step 1 justifies the reset as "matching how
`cumulative` resets". This feature deletes that reset, so the instruction describes code that will
not exist and the rationale is falsified either way.

**Options presented to the operator:** (a) record it and let #1724 amend its own task-6 before merge;
(b) serialize this spec behind #1629's build; (c) widen this feature to settle the rule for the whole
entry; (d) accept unresolved and let the second build remediate.

**Operator decision (2026-08-18): (c) — widen.** The ADR gains **D6**, which states D1 and D2 over
every lap-counting field on the entry rather than over `cumulative` and `rubricFailures` by name, and
Story 5 was rewritten to the entry-wide rule.

**Recorded dissent, per the operator's own instruction to state it rather than bury it.** A
mechanical-fault allowance is a retry budget, not a convergence bound; its faults are transient by
construction and a later PASS is real evidence they cleared. Under D6 a feature can carry
mechanical-fault laps across a PASS that resolved them and halt for infrastructure trouble it
recovered from. The operator weighed this and chose one rule for the entry. It is carried in ADR D6's
own text as a named consequence, with #1629's ceiling and a possible lane-specific credit trigger as
the remedies if it bites — not a restored PASS reset.

**Precondition this creates, outside this feature's diff.** #1724's plan task-6 must be amended
before #1629 builds. This feature does not edit another feature's spec artifacts; the obligation is
recorded here and in the stories' plan notes.

## Consistency pass

- **Story 1 vs Story 2.** Story 1 forbids a PASS from clearing the counters; Story 2 requires a rebase
  to credit them. Not oscillating: the triggers are disjoint, and Story 2's negative path asserts a
  PASS with no rebase issues no credit.
- **Story 2 vs `adr-2026-07-20`.** Story 2 reads that ADR's preserve/invalidate partition and never
  recomputes it. The review report's condition §4.1 makes inheritance of the existing verdict
  predicate binding, so the two cannot drift apart.
- **Story 2 negative path vs fail-closed fallback.** They agree deliberately: when the delta cannot be
  computed every gate is invalidated and the credit is issued, which is fail-open for the budget.
- **Story 3 vs `adr-2026-07-26-event-sink-registry-exhaustiveness`.** Story 3's negative path asserts
  no new event type and no changed sink declaration, which is what keeps that ADR's totality
  requirement out of scope.
- **Story 4 vs Story 5.** Story 4 removes the reset helper entirely; Story 5 forbids reintroducing a
  PASS reset for any later counter. Complementary, not contradictory.
- **Story 5 vs `count`.** Explicitly excluded in the negative path, so the entry-wide rule cannot be
  read as touching `adr-2026-07-26`'s per-tree reset.

## Assumptions surfaced

| Assumption | Confidence | Basis | Impact if wrong | How to confirm |
|---|---|---|---|---|
| Rebase-origin invalidation of `build_review` is rare (1 in 95 kickbacks over 15 features) | 90% | verified over `.daemon/evals-raw` persisted ledgers | The refund's trigger approaches the PASS reset's breadth and the fix degrades toward today's behavior — ineffective, not incorrect | re-run the count at BUILD; the plan's first task does |
| `rubricFailures` is genuinely unimplemented at this base | 95% | verified — grep of `kickback-ledger.ts`, no shipped record, no open PR, no worktree | Conflict 1's ordering note is unnecessary but harmless | re-read `kickback-ledger.ts` at BUILD |
| #1724 remains unmerged when this spec merges | 70% | inferred — open at 2026-08-18, operator-gated | If it merges and builds first, its PASS reset exists and this feature deletes it too; D6 already covers that shape | check PR #1724 state at BUILD |
