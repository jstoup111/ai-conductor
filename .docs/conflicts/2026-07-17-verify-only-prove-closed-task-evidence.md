# Conflict Check: verify-only-prove-closed-task-evidence
**Date:** 2026-07-17
**New stories:** `.docs/stories/verify-only-prove-closed-task-evidence.md`
**Scanned against:** all `.docs/stories/` (15 files matching the evidence/attribution/auto-park
seam inspected pairwise via grep for attribution / semantic-verified / Evidence: skipped /
satisfied-by / evidenceStamps / noEvidenceAttempts / cutover; the rest share no entity,
endpoint, or state with this feature)
**Result:** 1 blocking conflict found and RESOLVED (scoped amendment); 2 non-blocking
interplay notes accepted. Re-check clean.

## Conflict: Class-scoped lane arming vs #520/#581 "cutover-absent behavior is byte-identical"

**Stories involved:** "Verify-only residue dispatches the judged lane even when the global
cutover is dark" (new, Story 3) vs `judged-attribution-verdict-persistence.md` Story 4
("Given the cutover is absent (default) … behavior is byte-identical") and the #520 lane's
inert-by-default rollout invariant (attribution-lane.ts:433-437).
**Type:** contradiction (state/behavior invariant)
**Severity:** blocking — RESOLVED by scoped amendment
**Resolution:** The inert-by-default invariant is amended, not removed: with the cutover
absent, lane behavior remains byte-identical for every residue task EXCEPT those whose plan
block carries `**Verify-only:** yes` — a marker that exists in zero plans today, so the
amended invariant is vacuously identical for the entire existing corpus. The new stories
encode this explicitly (Story 3 negative path: unmarked residue + dark cutover → lane NOT
dispatched, byte-identical). A later global arming of `attribution_judge_cutover` subsumes
the class-scoped predicate (it becomes a no-op), so the #520 rollout program is unaffected.
The ADR (`adr-2026-07-17-verify-only-judged-closure.md`) records this as a deliberate
decision; the plan includes a task updating the #581 story file's Story 4 wording to carry
the carve-out so the corpus does not contain a contradicted invariant.

## Note: stamps→rows reconciliation (#526) — complementary, sequencing satisfied

`evidence-stamps-sync-to-task-status-rows-so-progre.md` makes `task-status.json` rows follow
`evidenceStamps` (stamp authoritative). This feature CREATES the stamp for a class that never
had one; that spec propagates it to rows/progress. No contradiction — new Story 3's "row
flips" assertion rides that reconciliation (and `applyDerivedCompletion`'s existing flip).
No ordering constraint: both are already on main or land independently.

## Note: auto-park contradiction check (#612) — additive, no overlap

`auto-park-decisions-must-be-contradiction-checked-.md` cross-checks the "empty/missing plan"
immediate-park against held completion evidence. New Story 4 touches the OTHER park reason
("no completion evidence after N attempts") and only ADDS named verify-only ids to the reason
string; it neither reads nor changes #612's empty-plan cross-check. The two park-reason edits
touch disjoint branches of `daemon-auto-park.ts` / conductor's park block.
