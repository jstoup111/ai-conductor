# Conflict Report: coverage binding batched judge (#2493)

**Date:** 2026-09-18
**Stories checked:** `.docs/stories/coverage-binding-serializes-judgments-and-loses-pa.md` (S1–S4) against
every file in `.docs/stories/` sharing the `coverage_binding` step, envelope, or judge
(`a-coverage-claim-can-name-a-task-whose-done-when-d.md` #2088, `coverage-binding-retries-past-its-3-3-budget-when-.md` #2371),
and against the change-set ADR `adr-2026-08-31-coverage-binding-judge-step` (D1–D15).
**ADR corpus:** `change_set` (config key unset).

## Conflict: #2088 Story 5 asserts one dispatch per claim; S1 asserts one dispatch per batch

**Stories involved:** Story 1 (pending claims judged per bounded batch) vs #2088 Story 5 (The judge sees one scoped pair per claim and returns a closed verdict)
**Files:** [.docs/stories/coverage-binding-serializes-judgments-and-loses-pa.md] vs [.docs/stories/a-coverage-claim-can-name-a-task-whose-done-when-d.md]
**Type:** contradiction
**Severity:** degrading
**Story opposing sentence (verbatim, #2088 S5 Done When):** "A `runCoverageBinding` branch in `src/conductor/src/engine/step-runners.ts` dispatches per claim through `executeAuxiliaryProviderCandidates` with a fresh session and `resume: false`"
**Story opposing sentence (verbatim, S1):** "Given `coverage_binding.judge.enabled` is true, `batch_size` is 8, and the spec assembles 20 judgeable claims with no previous envelope, when the step runs, then exactly 3 provider sessions are dispatched, in claim order, carrying 8, 8, and 4 claims respectively"

**Description:** #2088 S5 describes the shipped per-claim dispatch that D5 originally required. The
governing ADR was amended in this pass (D12) so the unit of dispatch is a bounded batch; the older
story's mechanism sentence is now superseded. Both directions checked: S1 satisfied → #2088 S5's
per-claim dispatch no longer holds (one "no"); #2088 S5 satisfied → S1 fails. One-directional, so
a plain contradiction, not an oscillation. Confidence 95% (verified from both texts).

**Resolution Options:**
1. Leave #2088 S5 as historical (it describes the behavior at its own ship time) and let the amended ADR D12 plus S1 govern going forward; replace S5's per-claim sentences in a companion main-based PR (the land stem gate rejects foreign-stem story edits on this branch).
2. Edit #2088 S5 in this spec branch — rejected by the land gate.
3. Supersede adr-2026-08-31 wholesale — disproportionate; D1–D4, D6–D11 are unchanged.

**Recommendation:** Option 1. Accepted as a degrading conflict: the shipped #2088 story stays
readable as history; the amended ADR is the authority and S1 carries the new behavior.

## Pairs examined and found compatible

- S1–S4 vs #2088 S4 (registered step, default off), S6 (does-not-assert halts), S7 (no `Done when` → not-applicable), S8 (`coverage_binding_judged` per claim): compatible in both directions — batching keeps the per-claim event, the `needs-human` refusal, and D8 tolerance (S1, S3 restate them).
- S1–S4 vs #2088 S5 cache-hit criterion ("envelope is still rewritten so the completion artifact is fresh"): compatible — S3 rewrites the envelope on every run, `partial` then `done`.
- S2 vs #2371 S3 ("`coverage-binding judge infrastructure failure: <reason>`" rendering of `CoverageBindingPayloadError`): compatible — S2 keeps the same typed error, only the reason text widens.
- S2 vs #2371 S1 ("exactly one `coverage_binding` step dispatch occurs for that lap" on refusal): compatible — counts step dispatches, not provider sessions.
- S3 vs adr-2026-08-31 D5 ("envelope is rewritten on every run"): compatible with D14; `partial` is an additional rewrite, and `done`/`failed`/`refused` remain terminal.
- S3 vs adr-2026-08-31 D7 (`disabled` envelope): compatible — the disabled path is untouched.
- S4 vs adr-2026-08-31 D7/D15 (config registry): compatible.
- S1 vs S3 (both directions): batching and checkpointing compose — a checkpoint happens after each accepted batch; neither re-breaks the other.
- S2 vs S3: a rejected batch writes `failed` with earlier entries retained — S3 negative path states it; no oscillation.

## Result

Blocking: 0. Degrading accepted: 1 (historical #2088 S5 mechanism sentence; companion PR to replace it).
