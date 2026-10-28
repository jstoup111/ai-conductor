# Conflict Check: one corrected re-judgement for an inadmissible build_review case binding (#3461)

**Date:** 2026-10-28
**Stories checked:** `.docs/stories/build-review-halts-needs-human-when-the-judge-reje.md` (Stories 1–3). They were checked against every story file that mentions remediate dispatch counts, the expansion round, `existingCaseId` bindings, refutation, carry, escalation bindings, or invalid-judgement halts:
- read in full: `build-review-remediate-context-grows-with-the-whol` (#3291), `refuted-build-review-finding-cycles-to-a-needs-hum` (#2409), `build-review-rubrics-need-a-post-join-adjudicator-` (#2033, also edited by the in-flight #3491 hotfix in a different story);
- read where they overlapped: `operator-acceptance-survives-a-build-review-re-rai`, `build-review-halts-when-a-judgement-re-raises-a-so`, `a-recurring-concern-at-a-resolved-anchor-escapes-i`, `build-review-re-raises-already-decided-findings-ev`, `projects-cannot-add-portable-non-competing-build-r`, `equivalent-re-worded-findings-escape-their-accepte`, `build-review-rubric-dispositions-and-fan-out`.

**Result:** clean after resolution. No blocking conflicts. Two contradictions on judge-dispatch counts were found and resolved by replacing the superseded assertions in place in the two on-main story files (committed before land). One degrading overlap was examined and needs no change.

## ADR corpus

- **Examined:**
  - `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` (D2, D3; amended 2026-10-28 by this spec);
  - `adr-2026-09-10-portable-build-review-policy` (D8, D9, D11, D12; D9 amended 2026-10-28 by this spec);
  - `adr-2026-08-29-build-review-remediate-case-adjudication` (D4, D7 and its D7.1–D7.6 amendment). It is superseded only in part: its non-conflicting decisions remain adopted by the successor, so it was retained for comparison;
  - `adr-2026-10-20-operator-acceptance-is-durable-case-state` (D3, carry classification);
  - `adr-2026-10-24-lap-monotonic-build-review-scope` (D7, D8: provenance and prior-source digests in the context).
- **Narrowed out (no overlap with case bindings, the validator or the judge round loop):** the remaining approved ADRs, including restack, routing, release, OTEL, model-policy, prd-audit, tmux and intake decisions.
- **Excluded as fully superseded:** none.

## Contradictions (resolved)

### Conflict: #3291 Story 3 halts every invalid expansion-round or case-v1 judgement with no further dispatch
**Stories involved:** Story 2 (negative paths 1 and 3) vs `build-review-remediate-context-grows-with-the-whol` Story 3.
**Files:** `.docs/stories/build-review-halts-needs-human-when-the-judge-reje.md` vs `.docs/stories/build-review-remediate-context-grows-with-the-whol.md`
**Type:** contradiction. **Severity:** blocking until resolved.
**Description:** #3291 Story 3 said an expansion-round judgement that fails validation "for any other reason" halts with no further dispatch, and that an invalid case-v1 judgement halts "exactly as before this change". This spec gives a judgement whose only defect is an inadmissible binding one correction round, including after an expansion round and in case-v1. Both cannot hold for an inadmissible binding.
**Resolution:** Both #3291 criteria now exclude an inadmissible case binding, and the expansion-round criterion names the correction round as what happens instead. Every other invalid reason still halts with no further dispatch, so #3291's index-only and absent-task criteria are unchanged.

### Conflict: the post-join adjudicator story caps a lap at two judge dispatches
**Stories involved:** Story 2 (negative path 3) vs `build-review-rubrics-need-a-post-join-adjudicator-` Story 1 (three happy paths).
**Files:** `.docs/stories/build-review-halts-needs-human-when-the-judge-reje.md` vs `.docs/stories/build-review-rubrics-need-a-post-join-adjudicator-.md`
**Type:** contradiction. **Severity:** blocking until resolved.
**Description:** Story 1 stated "one dispatch, or two when the single mixed-laps D2 expansion round runs". This spec allows a third dispatch when both an expansion round and a correction round run in one lap.
**Resolution:** The three parentheticals now read "one dispatch, plus at most one mixed-laps D2 expansion round and at most one binding correction round". It is still exactly one authoritative judgement per lap. The in-flight #3491 hotfix edits a different story in this file (its semantic repeat recovery criteria), so the edits do not overlap.

## Degrading (no change needed)

### Overlap: refutation-lane rejections of illegal refute bindings
**Stories involved:** Story 1 negative path 1 and Story 3 negative path 3 vs `refuted-build-review-finding-cycles-to-a-needs-hum` Story 2 (refute bound to an unattempted act case, to a reserved or failed effect, or to a non-carry-eligible defer or reject case).
**Type:** overlap. **Severity:** degrading.
**Description:** Those criteria say the judgement "is rejected as an illegal disposition transition" when it is reconciled. Under this spec such a binding is first refused by the validator as `inadmissible-case-binding` and gets one correction round, so a lap-level halt now names that reason instead. The reconciler still rejects the same binding as `illegal-disposition-transition` when it is reconciled, which Story 3 negative path 3 keeps as the backstop.
**Resolution:** None needed. The #2409 criteria are stated at the reconciliation layer and remain true there. The refutation-repeat halt (that story's Story 3) is unchanged, which this spec's Story 3 negative path 2 asserts. The two-direction check passes: satisfying this spec leaves every #2409 criterion true, and satisfying #2409 leaves every criterion here true.

## Pairs checked with no conflict
- `operator-acceptance-survives-a-build-review-re-rai`: a carry-eligible case admits every disposition, matching carry being decided first; an `escalate` binding to a carry-eligible case still settles as carried.
- `build-review-halts-when-a-judgement-re-raises-a-so` and `a-recurring-concern-at-a-resolved-anchor-escapes-i`: their halts concern `act` rebinding of resolved cases, which stays bindable (same disposition) and halts as a regression as before; escalation rows remain outside the bindable check.
- `build-review-re-raises-already-decided-findings-ev`: provenance stamping and prior-source digests are untouched; the new context field sits beside them under the same ceiling.
- `projects-cannot-add-portable-non-competing-build-r`: invalid case-v2 output still stops, except the bounded correction round recorded in the portable-policy D9 amendment.
