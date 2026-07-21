# Conflict check: no-diff-task-evidence-stamp

**Stem:** `no-diff-task-evidence-stamp` · **Issue:** #733 · **Tier:** M

## Method

Cross-referenced this spec's touched surfaces (`autoheal.ts` `deriveCompletionInternal`
skip branch + `parsePlanTaskVerifyOnly`) against the shipped evidence-gate ADRs and the
recent stall-fix batch (#707, #677, #188, #463), checking for file-set overlap and
decision-level contradiction.

## Reconciliation with #677 (verify-only judged-closure, `adr-2026-07-17`) — EXTENDS, no contradiction

#677 introduced the `**Verify-only:** yes` marker and the judged-closure lane, scoping
the lane to *marked* tasks so unmarked residue is never widened into the verifier (its
whitewash concern). This spec **adds a second recognized signal** (`**Type:**
verification`) to the *same* eligibility predicate — it does not remove the marker path,
weaken any citation/whitewash validation, or widen judging to *unmarked, non-verification*
residue. #677's guarantee ("forged and non-ancestor citations are still refused; judging
is never widened to unmarked residue") holds verbatim: a `Type: verification` task is a
*declared* no-diff task, and its citations still run the full validation. No contradiction.

## Reconciliation with #463 (evidenceStamps is the only currency) — HONORED

#463 retired the `migrationGrandfather` escape hatch and made a real, git-derived
`evidenceStamps` entry the sole completion currency. This spec does not add a new
escape hatch: both new stamps are still **git-derived** — Decision 1 stamps against a
real `Evidence: skipped` commit, Decision 2 stamps only after the verifier's
ancestor-validated citations pass. A wiped/forged task-status row still resolves nothing.

## Reconciliation with #707 (bounded-dirname corroboration) — DISJOINT

#707 tightened path corroboration for *own-diff* trailered commits (the `matchingCommits`
block, `autoheal.ts:786-872`). This spec touches the `Evidence: skipped` branch and the
verify-only parser — neither overlaps the corroboration path. Own-diff tasks continue to
resolve exactly as #707 defines.

## Reconciliation with #188 (retry escalation) — COMPLEMENTARY

#188's escalation ladder re-runs a build that has work left. For a no-diff residue task
there is *nothing left to build*, so #188 escalates into a dead loop that ends in
auto-park — the observed #733 symptom. This spec removes the dead loop's cause; #188's
ladder is unchanged and still governs genuinely-incomplete builds.

## File-set overlap

None with any in-flight spec. The two edits are localized to `autoheal.ts`; the
consumers (`conductor.ts`, `attribution-lane.ts`, `artifacts.ts`) are read, not edited.
No overlap with the #718/#726 batch plans (those are the *inputs* that exposed the bug,
not code this spec changes).

## Verdict

No collisions. This spec is an additive, fail-closed extension of the #677/#463 evidence
gate that closes the no-diff-task hole without weakening any existing guard.
