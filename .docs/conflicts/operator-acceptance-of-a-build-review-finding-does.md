# Conflict Check: Operator acceptance of a build_review finding survives a re-raise

**Date:** 2026-10-19
**Stories checked:** `.docs/stories/operator-acceptance-of-a-build-review-finding-does.md` (Stories 1–8)
against every file in `.docs/stories/`
**Result:** PASSED after resolution. 8 blocking conflicts were found and all were resolved with
operator approval on 2026-10-19; 0 remain and no degrading conflicts were accepted.

## ADR Corpus

**Examined (subject overlaps accepted risk, remediation cases, or build_review routing):**
`adr-2026-08-29-build-review-remediate-case-adjudication` (superseded only in part, so retained),
`adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`,
`adr-2026-08-13-stable-build-review-finding-dispositions`,
`adr-2026-08-16-closed-build-review-finding-vocabularies`,
`adr-2026-09-10-portable-build-review-policy`,
`adr-2026-08-12-cumulative-build-review-convergence-bound`,
`adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`.

**Narrowed out (no overlap with accepted risk or case reuse):** every other APPROVED ADR in
`.docs/decisions/`, including the build_review cache-key, fresh-base, opt-in container, wiring
retirement, diff-locality, and rubric-branch ADRs.

## Conflict 1: An autonomous case cannot broaden an operator disposition

**Stories involved:** post-join adjudicator operator-authority negative path vs Story 1
**Files:** `.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md` vs this feature's stories
**Type:** contradiction
**Severity:** blocking
**Description:** The existing criterion forbids an autonomous case from marking a distinct finding
accepted, while Story 1 carries acceptance through the adjudicator's binding.
**Resolution:** Qualify the existing criterion in place to except carried acceptance (D2.1–D2.5).

## Conflict 2: Resolved action case re-raise halts as a regression

**Stories involved:** post-join adjudicator regression negative path vs Story 1
**Files:** `.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md` vs this feature's stories
**Type:** contradiction
**Severity:** blocking
**Description:** A re-raise bound to a resolved action case must halt under the existing story and
must settle under Story 1 when the case is accepted.
**Resolution:** Limit the regression criterion in place to cases holding no operator-accepted source.

## Conflict 3: Only the exact accepted identity is non-blocking

**Stories involved:** rubric dispositions exact-identity criterion vs Stories 1 and 3
**Files:** `.docs/stories/build-review-rubric-dispositions-and-fan-out.md` vs this feature's stories
**Type:** contradiction
**Severity:** blocking
**Resolution:** Qualify in place: carried acceptance is the only exception.

## Conflict 4: No suppression broader than one exact identity

**Stories involved:** #1611 Story 2 negative path and Done When vs Story 1
**Files:** `.docs/stories/equivalent-re-worded-findings-escape-their-accepte.md` vs this feature's stories
**Type:** contradiction
**Severity:** blocking
**Resolution:** Qualify both assertions in place to except carried acceptance.

## Conflict 5: Unrefuted recurrence follows the repeated-case stop

**Stories involved:** portable policy recurrence negative path vs Story 1
**Files:** `.docs/stories/projects-cannot-add-portable-non-competing-build-r.md` vs this feature's stories
**Type:** contradiction
**Severity:** blocking
**Resolution:** Qualify in place: a recurrence on an operator-accepted case settles as carried.

## Conflict 6: Automated escalation cannot broaden accepted risk

**Stories involved:** portable policy authority negative path vs Story 2
**Files:** `.docs/stories/projects-cannot-add-portable-non-competing-build-r.md` vs this feature's stories
**Type:** contradiction
**Severity:** blocking
**Resolution:** Qualify in place: carried acceptance through an adjudicator binding is the only extension.

## Conflict 7: Repeated or regressed semantic case still halts

**Stories involved:** ADR vs Story 1
**Files:** `.docs/decisions/adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md` vs this feature's stories
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "A repeated attempted/regressed semantic case still halts without a second charge or a free route."
**Story opposing sentence (verbatim):** "then the finding is operator-resolved as carried, no `semantic remediation case regression` or `semantic remediation case repeat` halt occurs, no BUILD work order is published, and no kickback is charged."
**Resolution:** Amendment note on D3 (#3271), routed to architecture in amendment mode.

## Conflict 8: Any escalation produces a durable decision stop; repeat stops are preserved

**Stories involved:** ADR vs Stories 1 and 2
**Files:** `.docs/decisions/adr-2026-09-10-portable-build-review-policy.md` vs this feature's stories
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-09-10-portable-build-review-policy
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "A `blocked` consistency result, any escalation, invalid output, or missing required admission evidence prevents all action effects for that adjudication and produces a durable decision stop."
**Story opposing sentence (verbatim):** "then the finding settles as carried and the lap does not halt with `decision stop conflicting-case-id`."
**Resolution:** Amendment notes on D9 and on D11's preserved repeat stop (#3271), routed to architecture in amendment mode.

## Re-check

After the resolutions, every pair sharing accepted risk, case reuse, repeat or regression halts, or
decision stops was re-checked in both directions:

- **Story 1 vs Story 3 (carry vs no widening):** both hold. Carry requires a later-lap binding to an
  accepted case, and Story 3 governs everything else.
- **Story 2 vs the portable "any escalation prevents actions" criterion:** both hold. A carried
  escalation delivers no action, and other escalations still stop.
- **Story 1 vs the refutation stories:** both hold. Refutation and carry are disjoint settlements of
  a rebinding.
- **Story 8 vs the fail-closed disposition-store criteria:** both hold. An unreadable store carries
  nothing.

No oscillation was found: satisfying either side of each pair does not break the other.
