# Conflict Check: cached-rubric-verdicts-survive-an-engine-change-so (#1759)

**Date:** 2026-08-21
**Corpus:** `conflict_check.adr_corpus` unset → `change_set` (adr-2026-08-21-engine-identity-in-build-review-cache-key; amended adr-2026-08-13-engine-managed-build-review-rubric-branches §7). Neighbouring shipped stories also examined: `rubric-cache-identity-is-sha-anchored-so-a-rebase-`, `clean-rubric-judgements-rejected-as-invalid-provid` (both in `.docs/shipped/`), and in-flight PR #1734 (`review-infrastructure-failures-are-operator-unreco`).
**Result:** 0 blocking, 1 degrading (resolved in place), 2 examined pairs cleared.

## Conflict: New infrastructure reason collides with #1734's total fault-class map

**Stories involved:** Story 2 (skill text changed) vs PR #1734 / shipped clean-rubric Story "no member is added to the closed infrastructure-failure reason vocabulary"
**Files:** `.docs/stories/cached-rubric-verdicts-survive-an-engine-change-so.md` vs `.docs/stories/clean-rubric-judgements-rejected-as-invalid-provid.md`, PR #1734 diff (`BuildReviewInfrastructureReason` → fault-class record)
**Type:** resource-contention (closed vocabulary) / sequencing (merge order with #1734)
**Severity:** degrading

**Description:** Story 2 originally introduced `skill-digest-unavailable`. #1734 makes the reason→class mapping a total record, so a new member lands as a compile error on whichever branch merges second, and the shipped clean-rubric rule keeps the vocabulary closed. Confidence 90% (verified against the #1734 diff lines 896–933).

**Resolution Options:**
1. Reuse the existing `cache-read-failed` reason with a detail naming the SKILL.md path — no vocabulary growth.
2. Add the member and a mapping entry, coordinating merge order with #1734.
3. Model unreadable skill text as a skip rather than a failure.

**Resolution applied:** Option 1. Story 2 amended in place; ADR D3 carries an additive amendment note; review Wiring Surface updated. Behavior (never a hit, never a write) unchanged.

## Examined pairs — cleared

- **Story 3/4 vs shipped clean-rubric story "a rubric cache entry written before this change … is served as a cache hit and no fresh dispatch occurs."** That assertion is about *that* change's at-rest compatibility and shipped already; this feature knowingly spends one cold lap per warm feature, recorded in the ADR (Consequences / adr-2026-08-19 D3 reversal) and accepted by the operator. Both directions examined: satisfying Story 4 does not re-break any live gate of the shipped feature. Not an oscillation.
- **Story 1 vs rubric-cache-identity Story 1 ("identity derived only from judged content") and the 2026-08-15 operator ruling.** Engine stamp is a sibling component outside `projectionDigest`, is not rebase- or rerun-volatile, and excludes the timestamp half. Cleared in the ADR's Context. Both directions hold.
- **Story 2 vs Story 1 (two reasons, one lookup).** Ordering fixed: engine stamp before skill digest; exactly one reason reported. No oscillation.
- **Story 5 vs adr-2026-07-26 sink totality.** Complies; the negative path asserts the compile failure.

## Verdict

Conflict check passed. Proceed to `/plan`.
