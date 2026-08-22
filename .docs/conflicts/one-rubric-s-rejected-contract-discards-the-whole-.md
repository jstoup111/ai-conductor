# Conflict Check: one-rubric-s-rejected-contract-discards-the-whole- (#1740)

**Date:** 2026-08-21
**Corpus:** `conflict_check.adr_corpus` unset → `change_set` (no new ADR; the review's cited APPROVED ADRs: adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane, adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence, adr-2026-07-22-gate-evidence-code-validity-on-redispatch, adr-2026-07-13-retry-classify-rerun-vs-route, adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch). Neighbouring stories examined: `review-infrastructure-failures-are-operator-unreco` (#1734, shipped), `one-build-review-pass-clears-the-convergence-cap-s` (shipped), `clean-rubric-judgements-rejected-as-invalid-provid`, `cached-rubric-verdicts-survive-an-engine-change-so`, `rubric-cache-identity-is-sha-anchored-so-a-rebase-`, `build-review-rubric-dispositions-and-fan-out`.
**Result:** 0 blocking, 0 degrading. One story corrected in place before the scan closed (Story 3, see below). All pairs tested in both directions.

## Examined pairs — cleared

- **Story 3 vs shipped `one-build-review-pass…` Story 5 ("the clear and the credit operate on every lap-counting field … that allowance is credited with the others").** Verified in code: `creditKickbackGateLaps` (`kickback-ledger.ts`) zeroes numeric fields outside `NON_LAP_COUNTING_GATE_ENTRY_FIELDS`; an object-valued `lastMechanicalFault` would be left standing after the allowance was credited — a dangling record naming a fault whose allowance no longer counts it. Story 3's draft said no credit path existed; that was wrong (confidence 95%, verified). **Resolved in place:** Story 3 now requires `creditKickbackGateLaps` to clear `lastMechanicalFault` with `mechanicalFaults`, and the PASS path to leave both untouched — satisfying both stories in both directions.
- **Story 1 vs #1734 Story 4 negative path ("a previous lap's outcome is still present … the stale outcome is not treated as this lap's result").** Same direction. #1734 discharged it via the conductor's mechanical re-run lane, which bypasses completion; no change to the completion predicate was shipped (verified: `8df6a6685` touches `conductor.ts`/`step-runners.ts`, not `artifacts.ts`). Story 1 adds the completion-level guard for every non-publishing exit. Satisfying Story 1 keeps #1734 Story 4 true; satisfying #1734 Story 4 does not break Story 1. Not an oscillation.
- **Story 2 vs #1734 Story 4 / adr-2026-08-18 D3 ("publishes **no** aggregate").** Story 2 restates D3 and adds the at-cap and mixed (judged finding + rejection) cases, both of which D3/the existing lap join already publish. Compatible.
- **Story 3 vs #1734 Story 6 ("A review with full coverage produces byte-identical report output to today").** Story 3's "Last mechanical fault" line renders only when `lastMechanicalFault` is set; a full-coverage review never sets it. Both hold.
- **Story 3 vs #1734 Story 13 ("Pre-change … ledgers both parse and behave unchanged").** Story 3's legacy-absent negative path is the same assertion.
- **Story 1 vs adr-2026-07-22 (code-stamp preservation of a PASS with moved HEAD).** Story 1 scopes the guard to non-PASS aggregates and has an explicit negative path preserving the stamped PASS. Both hold.
- **Story 1 vs adr-2026-08-19 (tree-attesting gate set is ADR-gated).** Story 1 reads HEAD inside the existing completion predicate only; build_review does not join the pre-dispatch re-check set. No ADR change.
- **Story 1 vs adr-2026-07-26 (sink totality).** Story 1 requires the member/field be declared in `EVENT_SINKS`; the compile-time totality check enforces it.
- **Story 2 vs `build-review-rubric-dispositions-and-fan-out` Story 16 ("a stale aggregate verdict is replaced during recovery … dispositions survive").** Story 1 leaves the stale file untouched and Story 2 writes none; dispositions are unaffected.
- **Stories 1–3 vs `clean-rubric-…` / `cached-rubric-…` / `rubric-cache-identity-…`.** Those govern the judged-result envelope, cache identity, and rejection diagnosis upstream of the lap join; nothing here reads or changes a provider envelope, cache key, or diagnosis string. No shared field or gate.

## Verdict

Conflict check passed — 0 blocking, 0 degrading. Proceed to `/plan`.
