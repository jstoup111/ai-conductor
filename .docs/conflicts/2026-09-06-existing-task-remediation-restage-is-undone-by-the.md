# Conflict Check: Existing-task remediation restage survives the Task-trailer union (#2196)

**Date:** 2026-09-06
**Stories:** `.docs/stories/existing-task-remediation-restage-is-undone-by-the.md` (Stories 1–6)
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml` `conflict_check.adr_corpus`)
**Result:** PASSED — 0 blocking conflicts remain; 1 story corrected, 1 design revision, 6 degrading dispositions accepted by the operator

## Corpus examined

- **Stories:** 60 existing files sharing a surface (task-status rows, `Task:` trailers,
  `resolveTaskIds`/`countResolvedTasks`, build completion predicate, #647 D1 guard, remediation
  restage, engine-state, `kickback` event, stall breaker, build-progress-watcher, worktree
  recreation) plus the 6 new stories; every pair tested in both directions.
- **ADRs:** all 306 ADRs read at architecture review; narrowed here to 40 whose subject overlaps
  the stories (list in the review's Alignment section plus adr-2026-07-08, adr-2026-08-05,
  adr-2026-08-19-operator-step-rewind, adr-2026-07-12-progress-aware-build-halt). All 40 are
  APPROVED; none is fully superseded. Partial supersessions retained for comparison:
  adr-2026-08-12 D2 (by adr-2026-08-18), adr-2026-07-05 H8 grandfather portion (by
  adr-2026-07-10-retire-migration-grandfather), adr-2026-07-13 D3 routing (by adr-2026-08-25 D3).
  Narrowed out: the remaining 266, none of which addresses task resolution, remediation
  routing, trailer semantics, `.pipeline`/`.daemon` state, or the kickback event.

## Conflict: Absent run-state must not converge green (resolved by design revision)

**Stories involved:** `mid-loop-pipeline-wipe-549` Story 6 vs new Story 2
**Files:** `.docs/stories/mid-loop-pipeline-wipe-549.md` vs `.docs/stories/existing-task-remediation-restage-is-undone-by-the.md`
**Type:** contradiction
**Severity:** blocking (as found) → resolved
**Existing sentence (verbatim):** "Given the loud recreate happened and run-state is genuinely gone, when the next gate (evidence/completion) evaluates, then it fails closed on the absent state (the run does not silently converge green on empty state)."
**New sentence (as first written, verbatim):** "**Given** a worktree recreated from its branch so `engine-state.json` is absent while the row still reads `pending`, **When** the fold runs, **Then** the id resolves from its trailers as it did before this change and a single warn-once diagnostic names the fail-open for that id."

**Description:** the first design kept the watermark in worktree-local `.pipeline/engine-state.json`
and failed open on loss. Verified during resolution: a recreated worktree's `seedTaskStatus`
restores every trailered task as a `completed` row (`task-seed.ts:342-358`), so after the loss no
on-disk trace of the restage remains — the reopened task would silently converge, exactly what
#549 forbids, and fail-closed was unimplementable on that carrier.

**Resolution (operator, 2026-09-06):** fail closed was chosen; implemented by moving the watermark
to `<mainRoot>/.daemon/restage-watermarks/<plan-stem>.json` via `resolveMainRepoRoot`
(`park-marker.ts`), the carrier adr-2026-07-10-park-marker-main-root-resolution established for
state that must survive worktree recreation. The lost-watermark case no longer exists; Story 2's
bullet now asserts the reopened id stays unresolved after recreation. Architecture review and
diagrams revised in place; `#549`'s file untouched.

## Conflict: Consolidated manual-test FAIL round skipped the watermark (resolved by story edit)

**Stories involved:** adr-2026-08-25-as-built-remediable-findings-bounded-build-route D9 vs new Story 4
**Type:** state-conflict · **Severity:** degrading → resolved
**ADR filename stem:** adr-2026-08-25-as-built-remediable-findings-bounded-build-route
**Story ID:** 4
**ADR opposing sentence (verbatim):** "**Every `existing-task` kickback MUST re-stage its bound task ids to `pending` in `.pipeline/task-status.json` (the same re-seed seam the appender uses) before the rewind, fail-closed**"
**Story opposing sentence (as first written, verbatim):** "**Given** a consolidated manual-test FAIL round, **When** the route runs, **Then** the D1 guard is skipped exactly as today and no watermark is recorded, because that round's dispatchable work is the FAIL itself."

**Description:** the restage runs on every existing-task binding regardless of the consolidated
FAIL flag (`conductor.ts:4665`); only the D1 recheck is skipped. The story had that backwards.
**Resolution:** Story 4's bullet replaced in place — bound ids are restaged and watermarked; only
the D1 completion recheck is skipped.

## Examined, recorded as non-conflict

**adr-2026-07-23-trailer-union-build-step-routing D3 vs Story 2** — ADR sentence (verbatim):
"Rows present from operator/recovery edits or `skipped` markers still resolve — the union only
widens resolution, never narrows it." Story sentence (verbatim): "**Given** a restaged task whose
trailer count is unchanged since the watermark, **When** the fold runs on any later evaluation in
the same worktree, **Then** the id stays unresolved no matter how many pre-restage trailers
exist." Disposition (operator, 2026-09-06): non-conflict. D3's subject is rows — the sentence
guarantees operator/`skipped` rows keep resolving and that adding the trailer union never removes
a row-resolution. The watermark preserves that exactly (Story 2: a `completed` row resolves
regardless of count) and scopes only the trailer contribution for an id the engine itself
reopened. Confidence ~75%; the alternative reading (any narrowing of the fold) was weighed and
rejected because it would also forbid the row-authoritative behaviors D3 is protecting.

**adr-2026-07-05-engine-owned-task-status H6/H8 vs Stories 1–2** — H6 ("A `completed` counts only
with an engine `evidencedBy` stamp") and H8 never-demote govern the #773-deleted derivation
engine; adr-2026-07-23 D3 and adr-2026-08-22-done-when-evidence-at-task-close now define row
semantics. Stale residue, not a live decision; no action.

**adr-2026-07-08 / adr-2026-08-19 tree-attesting eligibility vs Story 2** — the build predicate
already depends on the `task-status.json` sidecar today; reading a second sidecar adds no new
class. Fails toward re-dispatch. No action.

**adr-2026-08-05-build-settle-outcome-stamp D3 vs Story 1** — a prior no-movement settle at the
same tree/verdict/rung can decline a restaged round pre-dispatch until the rung escalates.
Accepted degrading: the route still reaches `build` (Story 1 holds); the refusal is the existing
retry-as-escalation behavior and resolves on the next rung. Out of the targeted scope.

**`trailer-union-build-completion.md` Story 1 (#859) and `demote-task-stamping-to-telemetry.md`
"Stamps survive as telemetry" (#773) vs Stories 2 and 6** — both criteria are written as
identities over the fold/count; the watermark narrows them for reopened ids only, until a new
trailered commit lands. Accepted degrading; recorded in the new stories' Context; the foreign
story files are not edited from this branch (the land stem gate rejects foreign-stem story edits).

**`per-task-work-happened-floor.md` Story 2 vs Story 6** — the advisory `per-task-commit-floor.ts`
scans trailers without the watermark. Accepted degrading; deliberately not watermarked (it is
non-blocking); recorded in the new stories' Context.

**`daemon-halts-a-build-that-is-making-forward-progre.md` S3 and adr-2026-07-12-progress-aware-build-halt
D2 vs Story 6** — durable progress samples (`lastResolvedCount`, `noEvidenceAttempts`) could read
the deliberate post-restage drop as zero progress. Resolved by adding a Story 6 negative path and
Done-when requiring those samples to be refreshed post-restage.

**adr-2026-08-19-operator-step-rewind-through-the-mutation-port D4 vs Stories 2/5** — `rewind.ts`
touches neither task-status nor watermarks; a rewound feature keeps its reopened tasks reopened,
which is the correct reading. No action.

Pairs reasoned through with no conflict are listed in the review agents' records:
`plan-growth-allowance-is-spent-on-work-existing-ta`, `kickback-to-build-no-op-when-target-evidence-stamped`,
`evidence-stamps-sync-to-task-status-rows-so-progre` (mechanism deleted by #773),
`repeated-build-review-semantic-failures-can-churn-` and `build-review-flags-gate-mandated-wired-into-rewrit`
(additive `kickback` fields), `emit-intra-step-build-progress-and-stall-as-events`,
`builds-stall-when-work-lands-without-task-trailer-`, `a-kickback-restages-a-skipped-manual-test-as-stale`,
`2026-07-26-rebased-features-stale-protected-artifact-seal-976`, `daemon-mode-kickbacks-route-human-judgment-gaps-in`,
`2026-07-07-evidence-gate-task-id-grammar`, and the 29 ADRs the review lists as examined without conflict.

## Re-check

After the Story 4 edit, the Story 6 additions, and the storage revision, all six pairs above were
re-tested in both directions: 0 blocking, 6 degrading accepted.
