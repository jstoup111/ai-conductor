# Conflict Check: build_review remediate context scoped to the findings

**Date:** 2026-10-23
**New stories:** `.docs/stories/build-review-remediate-context-grows-with-the-whol.md`, Stories 1–4
**Result:** passed clean after resolution. Zero blocking conflicts remain.

## Scope

- **Existing stories scanned.** Accepted story files that mention admission, the adjudication
  context, the remediate judgement, prior cases or `case-v2`. The 15 densest in the subject were
  compared criterion by criterion: post-join adjudicator, portable policy, severity (#3298),
  operator-acceptance carry (#3271), remediation dispositions, gap ids, owning-task halts, routed
  and stacked fixes, and usage-exhaustion admission. Each pair was checked in both directions.
- **ADRs examined:**
  - `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` (D2 amended 2026-10-23)
  - `adr-2026-09-10-portable-build-review-policy` (D8 amended 2026-10-23)
  - `adr-2026-08-29-build-review-remediate-case-adjudication` (superseded with incorporation, so it
    is retained; its D3 single dispatch is carried by mixed-laps D2)
  - `adr-2026-10-19-build-review-finding-severity-advisory-threshold`
  - `adr-2026-10-20-operator-acceptance-is-durable-case-state`
  - `adr-2026-08-12-cumulative-build-review-convergence-bound`
- **ADRs narrowed out:** the other build_review ADRs (rubric container, wiring retirement, cache
  key, finding vocabularies, fresh-base disposition, rubric branches, completeness rubric, rebase
  refund) and the acceptance-red ADRs. None of them governs the remediate context, admission or
  the judge dispatch count.

## Conflict: "exactly one remediate session" vs the expansion round

**Stories involved:** post-join adjudicator Story 1 (S1.1, S1.3, S1.4) vs this spec's Story 3
**Files:** `.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md` vs
`.docs/stories/build-review-remediate-context-grows-with-the-whol.md`
**Type:** contradiction
**Severity:** blocking

**Description:** The existing criteria said "exactly one `remediate` session receives every
operator-unresolved finding from that lap". Story 3 re-dispatches the same judgement once when the
round-1 judgement's only defect is an index-only admission, so two sessions receive the findings on
such a lap. The root was the design, and it was already resolved upstream by the operator-approved
mixed-laps D2 amendment (2026-10-23). Only the older story's wording was stale.

**Resolution Options:**
1. Reword the three criteria to say exactly one authoritative judgement, one dispatch or two when
   the single D2 expansion round runs.
2. Narrow Story 3 to exclude multi-rubric laps.

**Resolution (operator, 2026-10-23):** Option 1, applied in place. The Done-When items are
unchanged: their fixtures make no index-only admission, so they still observe one dispatch.

## Pairs checked and clean

- Severity Story (advisory entries in non-blocking history, not current sources) vs Story 1's
  exclusion of threshold-advisory sources from selection: consistent.
- Operator-acceptance `operatorAccepted` marker on prior cases vs Story 1's complete prior-case
  list: consistent.
- Post-join overflow halt ("dispatches no partial history") vs Stories 1 and 3's overflow
  negatives: consistent. Prior history is never trimmed.
- Portable-policy Story 14 "an action cites a nonexistent task … no action from that adjudication is
  delivered" vs Story 3: consistent. Round 1 delivers nothing, and an absent-from-plan id halts
  without expansion.
- Portable-policy "exactly one content decision and one resulting route" vs Story 3: consistent,
  because round 1 is discarded and only one judgement is authoritative.
- Cumulative convergence bound vs Story 3's "same kickback charge": consistent. The expansion
  charges nothing.
