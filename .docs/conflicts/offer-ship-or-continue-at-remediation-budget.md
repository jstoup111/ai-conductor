# Conflict Check: offer-ship-or-continue-at-remediation-budget (#2185)

**Date:** 2026-09-24
**Stories checked:** `.docs/stories/offer-ship-or-continue-at-remediation-budget.md` (Stories 1–3)
against all 481 existing story files.
**ADR corpus:** `repo_wide` (config `conflict_check.adr_corpus`). 317 `adr-*.md` screened; 9 fully
superseded excluded (adr-2026-07-03-gated-writeback-announcements, adr-2026-07-04-operator-park-marker,
adr-2026-07-21-completeness-as-build-review-rubric, adr-2026-07-30-finish-only-mergeability-gate,
adr-2026-08-12-removal-anchored-tautology-exemption, adr-2026-08-15-verify-only-anchored-tautology-exemption,
adr-2026-08-16-preservation-anchored-completeness-exemption, adr-2026-08-29-build-review-remediate-case-adjudication,
adr-2026-08-29-operator-authorized-kickback-budget-recovery — its D1–D8 were still read as carried forward
by the successor's D4); 36 narrowed in and compared in both directions; 272 narrowed out as unrelated to
the kickback ledger, remediation budgets, cap halts, the budget CLI, or their status and event surfaces.
Borderline exclusions: adr-2026-06-30-halt-based-release-gates and adr-2026-07-29-ship-start-draft-pr
(release hold and draft ship are out of scope), adr-2026-08-28-test-suite-drift-budget-and-verification-mode
(different budget), adr-2026-07-06-manual-test-fail-routing (FAIL path untouched),
adr-2026-07-04-park-unpark-cli-verbs (park reused only), adr-014-otel-observability-exporter (one added
field on an existing event).
**Result:** passed after resolution — 1 blocking resolved, 4 degrading accepted, 0 ADR conflicts.

## Conflict: an impossible growth record is recomputed, but a malformed raised cap fails closed (C1)

**Stories involved:** #1805 Story 14 vs Story 2 (this feature)
**Files:** `.docs/stories/build-review-re-judges-what-the-plan-architecture-.md` vs `.docs/stories/offer-ship-or-continue-at-remediation-budget.md`
**Type:** contradiction
**Severity:** blocking

**Description:** #1805 Story 14: "Given a growth record that has been hand-edited into an impossible
state, when it is read, then the counts are recomputed from the plan and the discrepancy is logged".
As first authored, Story 2 stored the raised growth cap inside that record and required a malformed
cap to fail closed. A record holding an invalid raised cap would then have to be both recomputed and
failed closed.

**Resolution Options:**
1. Hold the raised cap in its own kickback-ledger field beside `growth`, so the recompute covers only
   the counts and the cap follows adr-2026-08-31 decision 4 (never repaired).
2. Keep the cap inside the record and supersede #1805 Story 14 for that field through a companion PR.
3. Let a malformed raised cap be recomputed back to the config cap.

**Recommendation and resolution (operator, 2026-09-24):** Option 1. D5 item 2 of
adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class, the architecture diagram, the
architecture review, and Story 2 were updated in this DECIDE pass. #1805 Story 14 is unchanged.

## Conflict: the growth-count recompute would drop a raised cap (C2)

**Stories involved:** #1805 Story 14 vs Story 2 and Story 3 (this feature)
**Type:** state-conflict
**Severity:** degrading → resolved by C1 option 1

**Description:** `readGrowth`'s recompute branches rewrite `growth` as authored, added, and byGate
only. With the cap inside the record, a recompute would silently fall back to the config cap. With
the cap in its own field, it survives. Story 2 now asserts this with a dedicated happy-path
criterion.

## Accepted degrading overlaps

- **C3 — #2119 Stories 5 and 6** (`plan-growth-allowance-is-spent-on-work-existing-ta.md`): "halts on
  the shared growth allowance exactly as today" and "reports the growth figures exactly as today".
  The shared growth halt still fires with the same figure format. This feature adds evidence, a
  generation line, the allowance name, and the recovery command. The asserting tests use substring
  matching. Accepted.
- **C4 — #2190 Story 6** (`a-halted-feature-only-re-runs-when-a-human-clears-.md`): reset and raise
  refusals share one validation helper. The new reset-on-growth-evidence refusal is reset-only, so it
  sits outside the shared refusal set. Accepted as a plan note.
- **C5 — pre-existing** (`gate-kickback-counter-resets-every-dispatch-so-no-.md`): a corrupt ledger
  "is treated as absent … and the run proceeds with a fresh budget". This already contradicts
  adr-2026-08-31 decision 1 and #2190 Story 7 independently of this feature, which only reinforces
  the fail-closed direction. Out of scope; no change here.

## ADR tensions checked and settled (no conflict)

- adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback D5 ("converts to a needs-human
  HALT") and adr-2026-07-28-total-halt-classification-legacy-boundary D1, compared with Story 1's
  `kickback-cap`. Settled by the successor ADR's 2026-09-01 amendment: the remediation cap terminals
  keep `kickback-cap`.
- Successor ADR D2 ("live needs-human marker"), compared with Story 2's raise on a `kickback-cap`
  halt. Settled by the same amendment and by D5 item 2.
- adr-2026-08-25 D7 (a malformed growth record invalidates the whole ledger) and adr-2026-08-31 D3
  (gate-scoped rejection). Story 2's malformed-cap criterion holds under either reading.
