# Conflict Check: A recurring concern at a resolved anchor escapes its prior case's retry limits

**Date:** 2026-10-23
**New stories:** `.docs/stories/a-recurring-concern-at-a-resolved-anchor-escapes-i.md` (Stories 1–4)
**Result:** PASSED. Zero blocking conflicts. One degrading overlap was accepted by the operator.

## Inventory

All 618 files in `.docs/stories/` were inventoried. The scan narrowed to the stories that assert
behavior for build_review remediation cases, re-raises, reuse halts, the kickback budget, or the
`build-review findings` output. Each was compared with Stories 1–4 in both directions:

- `build-review-halts-when-a-judgement-re-raises-a-so.md` (#3292), Stories 1–5
- `operator-acceptance-survives-a-build-review-re-rai.md` (#3271), all stories
- `refuted-build-review-finding-cycles-to-a-needs-hum.md` (#2409), Stories 1–4
- `a-rejected-case-transition-halts-as-corrupt-case-h.md`
- `build-review-findings-carry-a-severity-with-a-per-.md` (#3298)
- `equivalent-re-worded-findings-escape-their-accepte.md`
- `repeated-build-review-semantic-failures-can-churn-.md` and
  `one-build-review-pass-clears-the-convergence-cap-s.md` (cumulative bound counters)

The remaining stories assert nothing about remediation case identity, reuse, or lineage. Their
`remediat*`/`kickback` matches concern gap-plan remediation, kickback routing, or ledger rendering.

### ADRs

Examined (subject overlaps the stories):

- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` (amended here, D5.8–D5.11)
- `adr-2026-08-29-build-review-remediate-case-adjudication` (amended here, D4, D5, D7). It is
  superseded by the mixed-laps ADR but adopted by reference, so it is retained.
- `adr-2026-10-20-operator-acceptance-is-durable-case-state` (D3 carry, D9 scope boundaries)
- `adr-2026-10-19-build-review-finding-severity-advisory-threshold` (advisory dispositions)
- `adr-2026-09-10-portable-build-review-policy` (D9 decision stops)
- `adr-2026-08-12-cumulative-build-review-convergence-bound`

Narrowed out: every other ADR. None decides build_review case identity, reuse, or attempt limits.

## Compatible pairs (checked both directions)

- **#3292 Story 3 vs Story 2/3.** #3292's fixtures admit an unbound re-raise over R whose effect
  `failed`, or over an applied R in a lineage of one. Under this spec both fixtures count at most
  one applied attempt, so they are still admitted and charged. Fully satisfying either story
  leaves the other true. The explicit-rebind regression halt and the open-owner refusal appear
  unchanged in both files.
- **#3292 Story 4 vs this spec.** Decision stops are excluded here (Story 2 negative path), so
  they are unaffected.
- **#2409 refutation.** That lane is bound by `existingCaseId`, and a refuted case is settled by
  exact id before the judge sees it, so the two do not interact.
- **#3298 severity.** Advisory cases are non-`act`, so Story 2's negative path keeps them
  unchanged. The `build-review findings` additions in both specs are separate sections.
- **Cumulative bound counters.** The lineage limit is an independent cap checked before
  reservation, and the cumulative cap still applies after it (Story 3 negative path). Neither
  resets the other. No oscillation.

## Conflict: An unbound re-raise of a carry-eligible case at the lineage limit

**Stories involved:** Story 4 ("Carry never widens past the adjudicator binding and the origin's authority") of `operator-acceptance-survives-a-build-review-re-rai.md` vs
Story 3 of this spec
**Files:** `.docs/stories/operator-acceptance-survives-a-build-review-re-rai.md` vs
`.docs/stories/a-recurring-concern-at-a-resolved-anchor-escapes-i.md`
**Type:** overlap
**Severity:** degrading

**Description:** The #3271 criterion "Given carry-eligible case C, when a later lap raises a
finding with C's rubric, path and summary that the judgement proposes as an unbound case, then the
finding is not carried and is admitted as a new case, with a new action charged against the
kickback budget, as #3292's D5.6 prescribes" does not constrain C's lineage. When C's lineage
already counts three applied attempts, this spec's Story 3 halts with the recurrence limit instead
of admitting. Both stories agree that the finding is not carried. They differ only in that at-limit
edge, which #3271's fixture (one applied attempt) never reaches.
adr-2026-10-20-operator-acceptance-is-durable-case-state decision 9's "an unbound look-alike
finding routes exactly as today" is about carry ("Carry is never decided by mechanical matching"),
and this spec keeps that rule.

**Resolution Options:**
1. Leave #3271's story unchanged. This spec's Story 3 and D5.10 govern the at-limit edge. #3271's
   implementation (PR #3310) is in flight, and editing its accepted story would move its
   acceptance target mid-build.
2. Replace the #3271 criterion in place, adding "while C's recurrence lineage is under the limit".
3. Exempt carry-eligible owners from the lineage limit.

**Recommendation:** Option 1. The overlap is limited to an edge that the #3271 fixture cannot
reach. Option 3 would let an accepted case's unbound look-alikes loop without a bound, which is
the defect #3124 exists to close.

**Operator decision (2026-10-23):** Option 1 accepted.
