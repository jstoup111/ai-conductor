# Halt record

Status: halted
Slug: rebase-reopens-completed-repair-tasks-against-stal
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-rebase-reopens-completed-repair-tasks-against-stal
Head SHA: b15bd8dd2381e0d02c9060ac727bc0c9d4e1d950
Halted at: 2026-09-22T12:44:42.148Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 2 negative: Given a residue boundary where the only surviving map keys are commits at or before the boundary in first-parent order, when translation runs, then `baseline.head` is unchanged and a later task-progress check returns the existing `repair boundary <sha> is not an ancestor of HEAD` reason.
Task ids: 2
Done when checks: `selectRepairBoundaryTranslation` returns `successor` with the post-image of the earliest first-parent commit strictly after the boundary, as asserted by the squashed-boundary fixture in rebase-translate.test.ts. | The same function returns `unchanged` when every map key lies at or before the boundary, when the candidate's mapped sha is not reachable, and when the boundary is outside the pre-image list, each asserted by its own fixture. | A merge-commit fixture asserts the candidate list comes from `rev-list --first-parent` so a commit reachable only via a second parent is never selected. | A property assertion on every successor fixture shows the chosen pre-image index is strictly greater than the boundary index, so `newHead..HEAD` is a subset of `oldHead..HEAD`.
Missing assertion: The cited checks assert that the residue boundary remains unchanged when all map keys are at or before it, but do not assert that a subsequent task-progress check returns the specified non-ancestor reason.

Criterion: Story 3 happy: Given an engine-state file with two obligations, `activePlanPath`, and appended-task bookkeeping, when translation rewrites one obligation, then every other field of the file is byte-identical and the other obligation is unchanged.
Task ids: 1
Done when checks: `RepairObligationStore.rewriteBaselines` changes exactly the `baseline.head` values named in its input map and the before/after deep-equal test on the whole engine-state JSON shows no other difference. | The fake-store test observes exactly one `EngineStateStore.update` invocation for a non-empty map and zero filesystem writes to `engine-state.json` outside that store. | With no engine-state file present, `rewriteBaselines` resolves ok with an empty `rewritten` list and the file still does not exist afterwards. | The untouched-fields test asserts `baseline.tree`, `baseline.resolvedTaskIds`, `settlement`, and every per-task status are deep-equal before and after the rewrite.
Missing assertion: The checks assert deep equality of JSON values, but do not explicitly require byte-identical preservation of every other field's serialized representation.

Criterion: Story 3 negative: Given an engine-state file that does not exist, when translation runs, then no file is created and translation completes without error.
Task ids: 1
Done when checks: `RepairObligationStore.rewriteBaselines` changes exactly the `baseline.head` values named in its input map and the before/after deep-equal test on the whole engine-state JSON shows no other difference. | The fake-store test observes exactly one `EngineStateStore.update` invocation for a non-empty map and zero filesystem writes to `engine-state.json` outside that store. | With no engine-state file present, `rewriteBaselines` resolves ok with an empty `rewritten` list and the file still does not exist afterwards. | The untouched-fields test asserts `baseline.tree`, `baseline.resolvedTaskIds`, `settlement`, and every per-task status are deep-equal before and after the rewrite.
Missing assertion: The cited check covers RepairObligationStore.rewriteBaselines, but does not explicitly assert that the full translation run completes without error when engine-state.json is absent.

Criterion: Story 5 negative: Given a branch rebased by hand with no `.pipeline/rebase-rewrites.json`, when task progress evaluates an open obligation with a non-ancestor boundary, then the result is `unavailable` with the existing reason and no commits are admitted.
Task ids: 9
Done when checks: autoheal.test.ts asserts the residue-boundary case returns `unavailable` with the existing non-ancestor reason and the git-runner spy recorded zero `rev-list` calls. | autoheal.test.ts asserts `unavailable` for a non-ancestor boundary with no `rebase-rewrites.json`, and for a mapping whose target is not reachable from HEAD. | The existing direct-map fallback test still passes and `git diff` for this task touches no line of `listCommitsWithTrailersAfterRepairBoundary` or `translateRepairBoundary`.
Missing assertion: The cited checks assert the unavailable result and existing reason when no rewrite map exists, but do not explicitly assert that no commits are admitted.
```
