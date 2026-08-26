# Conflict Check: PRD-audit no-owner OVER_SCOPE findings
**Date:** 2026-08-25
**Stories checked:** .docs/stories/prd-audit-has-no-criterion-key-for-an-over-scope-f.md (Stories 1-6)
**ADR corpus:** change_set — adr-2026-08-24-over-scope-decision-block-and-durable-refusals (as amended 2026-08-25 by #1848), adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback (as amended 2026-08-25 by #1848)
**Result:** PASS — zero blocking conflicts; one overlap resolved in stories during the check

## Pairs examined (both directions)

- Story 1 vs Story 3 (legacy behavior vs per-row salvage) — one overlap found and resolved
  (below). After the resolution, satisfying either fully leaves the other holding.
- Story 2 vs Story 4 (duplicate rejection vs criterion-only decision matching) — complementary,
  not conflicting: per-row duplicate rejection is what makes criterion-only matching
  unambiguous (a criterion key in a parsed result is unique by Story 2). Both directions hold.
- Story 3 vs Story 5 (rejected rows block vs within/outside-harmless findings do not block) —
  disjoint row populations (rejected rows never reach classification); both directions hold.
- Story 4 vs Story 5 (mismatch → re-ask vs refused → rework-required halt) — refusal semantics
  apply only to a MATCHED identity; a mismatch re-asks fresh. No oscillation: a refused NC
  finding whose next-lap summary matches shows as refused; one that drifts is re-asked, and a
  fresh refuse converges (last-decision-wins per matched identity). Both directions hold.
- Story 6 vs Story 1/3 (old-guidance rows reject per-row, not whole-report) — consistent with
  Story 3's salvage contract; both directions hold.
- Each story vs adr-2026-08-24 (amended D4) and adr-2026-08-22 (amended D3) — the stories were
  derived from the amended text in the same DECIDE pass; no opposing sentences exist. The
  un-amended originals would oppose Stories 1/3 (D3: "a finding naming neither is rejected as
  malformed... and never becomes work" as whole-report behavior), which is exactly what the
  in-place amendment notes resolve — recorded here for traceability, not as an open conflict.
- Sibling shipped behavior (#1873 batch decisions, #1854 accepted-widening gate) — Stories 4/5
  extend the same machinery; refusal, pending-inert, and accepted-not-blocking semantics are
  restated unchanged, not contradicted.

## Conflict (resolved): legacy-report scope in Story 1 vs salvage in Story 3

**Stories involved:** Story 1 (no-owner section parses) vs Story 3 (salvage + still block)
**Files:** .docs/stories/prd-audit-has-no-criterion-key-for-an-over-scope-f.md (both)
**Type:** overlap
**Severity:** degrading (ambiguity, not mutual exclusion)

**Description:** Story 1's negative path originally required a sectionless report to behave
"exactly as before this change" — readable as demanding today's whole-report mechanical fault
for a sectionless report containing an invalid row, which Story 3 changes to per-row salvage.

**Resolution:** Story 1's negative path was narrowed in place to a *well-formed* sectionless
report (every row a valid, unique criterion key), which is the population whose behavior is
byte-identical before and after. Malformed-row behavior is owned solely by Story 3.

## Re-check

Re-ran all pairs after the Story 1 edit: zero blocking, zero remaining degrading conflicts.
