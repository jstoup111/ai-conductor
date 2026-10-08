# Conflict Check: Per-child BUILD region for stacked features (#2942)

**Date:** 2026-10-07
**Stories checked:** `.docs/stories/build-loop-cannot-complete-a-feature-child-by-chil.md` (17)
against all 556 story files, and against approved ADRs (`conflict_check.adr_corpus: repo_wide`).
**ADR corpus:**
- 339 ADRs.
- 10 fully superseded ADRs excluded.
- About 45 overlapping ADRs examined: stacked/slice, acceptance RED, trailers and stall, hooks,
  kickback ledger and caps, recovery CLIs, halt records, rebase and re-kick, full suite,
  build_review, event spine, state port, resume, write fence, decomposition.
- Narrowed out: memory, intake, provider/model, release, cost, docs, PRD/coherence authoring, and
  owner/auth ADRs. None of them touches these behaviors.

**Result:** passed. 0 blocking conflicts remain. 17 conflicts were found (3 blocking), and every one
was resolved under the operator's delegation of DECIDE decisions to this session.

## Resolved: story vs story

| # | Stories | Type | Severity | Resolution |
|---|---|---|---|---|
| S1 | #2940 S9 "raise/reset --child falls through" vs new S12 | contradiction | blocking | #2940 S9 updated in place: `raise`/`reset --child` are accepted; a child with no state is refused |
| S2 | #2940 S7 full-region rewind on all-done children vs new S12 closed-child refusal | contradiction | blocking | #2940 S7 fixture now states the children are not closed. New S12 owns the closed-child refusal |
| S3 | #2940 S7–S9 "any invocation without `--child` is byte-identical" vs new S12 active-child default | contradiction | blocking | Byte-identity scoped to features with no children in #2940 S7–S9 |
| S4 | #2940 S6 flat probes exclude `children/` vs new S4/S8 child reads | contradiction | degrading | New S4 gains a criterion: the flat lister and probes stay flat, and only the overlay reads child state. ADR decision 13 states it |
| S5 | build-step-completes TI-2 "any plan task" vs new S6 | contradiction | degrading | TI-2 updated in place: in a stacked feature, the active child's task set |
| S6 | acceptance-specs-red-evidence / writing-system-tests-red-exit-gate root marker path vs new S5 | contradiction | degrading | Both updated in place with the per-child path |
| S7 | grade-the-diff-for-security S1 vs new S10 | contradiction | degrading | Updated in place: leaf only, non-leaf skip reason `leaf-only`. New S10 asserts the reason |
| S8 | demote-task-stamping "stamps never block" vs new S7 | contradiction | degrading | Updated in place: the child-branch membership check is the one exception, and it is not attribution |
| S9 | plans-cannot-declare-ordered-slices S2 "no build step reads the flag" vs new S17 | overlap | degrading | Updated in place: the BUILD cursor reads the flag only to decide child creation |
| S10 | a-halt-leaves-no-committed-pushed-record S2 "pushes the current branch" vs new S13 | overlap | degrading | Updated in place: a stacked child branch is never pushed |
| S11 | full-suite-verification-gate-940 S4 evidence reuse vs new S8 | overlap | degrading | No change. Reuse operates within one child's evidence, and new S8 already states that child 1's PASS never satisfies the leaf |
| S12 | decompose-conductor-ts (top-level statements only imports/class) vs #2942 conductor.ts edits | resource contention | degrading | Accepted. Plan tasks name symbols, and new helpers go in topical modules (`child-cursor.ts`, `child-lifecycle.ts`), never at the top level of `conductor.ts` |

## Resolved: ADR vs story

| # | ADR | Story | Type | Severity | Resolution |
|---|---|---|---|---|---|
| A1 | `adr-2026-08-23-committed-halt-record` decision 1 (pre-region halt commits on the leaf) | S2, S3 | state-conflict | blocking in practice | ADR `adr-2026-10-07-per-child-build-region` decision 3 revised in place: child p1 is created at the leaf's tip at region entry, not its creation tip. S2 gains a criterion for a pre-region halt record |
| A2 | `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D4 (feature-scoped counter) | S11 | contradiction | degrading | Amendment note: per child |
| A3 | `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` D1/D2 | S11, S4 | overlap | degrading | Amendment notes: counters and refund on the active child's entry |
| A4 | `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` D1/D3, umbrella D13 | S12 | contradiction | degrading | Amendment notes: active-child default, closed-child refusal |
| A5 | `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` D4 | S12 | contradiction | degrading | Amendment note: the invariant is scoped to features with no children |
| A6 | `adr-2026-08-09-recorded-red-exception-for-remediation` (single `remediation` kind) | S5 | overlap | degrading | New `prior-child-green` kind attributed to the parent closure tip (ADR decision 5). Amendment note. S5 gains accept and refuse criteria |
| A7 | `adr-2026-07-21-demote-task-stamping-to-telemetry` D2/D3 | S7 | contradiction | degrading | Amendment note: a branch-membership check on child branches only |
| A8 | `adr-2026-07-23-commit-movement-liveness-floor` D1 | S6 | wording | degrading | S6 now requires that HEAD did not move. A moved-HEAD negative was added |
| A9 | `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility` D6 | S1 | overlap | degrading | Amendment note: a missing envelope is a re-run condition under the immutability guard |

Every amended ADR is also listed in `adr-2026-10-07-per-child-build-region` under "Amendments made by
this decision".

## Pairs examined and clean

- #2941 ownership, `max_slices` and envelope byte-identity vs S2, S5, S16.
- #2940 golden suite vs S17.
- #2940 identity and PR/park attribution vs S2, S3, S13.
- #2940 whole-feature flat steps vs S4.
- #2940 ledger clear vs S11.
- #2940 events and rollups vs S15.
- Re-kick and rebase stories vs S14.
- Verdict-aware resume vs S4.
- Trailer-union vs S6.
- Judgement-gate `MAX_GATE_SELECTIONS` vs S11.
- Typed rubric findings vs S10.
- Halted-feature re-run vs S12.
- ADRs: ship-start draft PR, one-PR-per-branch, finish-mergeability D5 (amended), protected-artifact
  seal, durable base-advance attribution, write fence, engine git guard, reopened-task resolution,
  plan-slice-manifest D3, fresh-base disposition.

No oscillating pair was found.
