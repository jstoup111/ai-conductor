# Conflict Check: Sweep tier-2 test-only supersession judgement and cause-keyed label clear

**Date:** 2026-09-20
**Inventory:** all 470 entries under `.docs/stories/` (every title skimmed, sixteen full-content term passes, fourteen files read in full) and, under `conflict_check.adr_corpus: repo_wide`, all 592 files in `.docs/decisions/`. No PRD (technical track).
**Result:** **PASS — zero blocking conflicts remain.** Two blocking contradictions were resolved by in-place story restatement, shipped as companion PR jstoup111/ai-conductor#2613. Two degrading conflicts: one restated in the same companion PR, one accepted by the operator.

## ADR corpus

Examined and governing (amended in this spec, each with a citable D1): adr-2026-08-01-rebase-full-replay-intent-validation, adr-2026-06-29-rebase-conflict-resolution-dispatch, adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep, adr-2026-07-04-autoresolve-state-and-config. Before amendment the first three contradicted Stories 1 and 3 and the fourth contradicted Story 5; the operator approved the amendments during architecture review, so no ADR-versus-story conflict remains.

Examined and compatible: adr-2026-07-03-post-rebase-force-with-lease, adr-2026-09-11-github-operation-ownership, adr-2026-07-26-event-sink-registry-exhaustiveness, adr-2026-08-11-halt-events-ride-the-persisted-spine, adr-2026-09-11-selective-post-rebase-verification, adr-2026-07-12-rebase-evidence-stamp-translation, adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic, adr-2026-08-09-one-pr-per-branch-halt-is-a-state, adr-2026-07-05-halt-pr-presentation-reliability, adr-2026-07-03-halt-pr-rehabilitation-at-finish, adr-2026-07-07-ship-ci-feedback-loop, adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever, adr-2026-07-24-provider-aware-step-execution-fresh-session-scope, adr-2026-07-04-resolution-worktree-lifecycle, adr-2026-08-19-engine-stamped-rubric-judged-result-envelope.

Narrowed out: the remaining ADRs, whose subjects (build review rubrics, intake, release gates, telemetry export, planning artifacts, provider routing) share no behavior, entity, field, or gate with these stories. No ADR was excluded on supersession status.

## Conflict: An absolute dropped-commit rejection contradicts the declared test-only drop

**Stories involved:** "Work-preservation guards reject lossy resolutions" vs Story 3 "Only declared, replayed, test-only drops are excused"
**Files:** `.docs/stories/auto-resolve-open-pr-conflicts.md` vs `.docs/stories/mergeable-autoresolve-tier-2-escalates-every-conte.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 90% — same guard, same sweep call site. The existing criterion rejects every missing pre-rebase subject; Story 3 publishes one class of them. Satisfying either falsifies the other.

**Resolution Options:**

1. Restate the existing criterion to cover a subject missing without a qualifying declaration.
2. Keep the absolute rejection and drop the supersession outcome, leaving the #2574 class escalating.
3. Introduce a separate guard for the sweep path and leave the old criterion attached to an unused one.

**Resolution:** Option 1, operator-approved. Replaced in place in companion PR #2613.

## Conflict: "Clearing the label is the only way to re-enable" contradicts the sweep's own clear

**Stories involved:** "Sticky escalation and cooldown gate every attempt" vs Story 5 "A conflict-caused escalation label clears itself"
**Files:** `.docs/stories/auto-resolve-open-pr-conflicts.md` vs `.docs/stories/mergeable-autoresolve-tier-2-escalates-every-conte.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 85% — the existing text makes the operator the only clearer. Not an oscillation: Story 5 clears only a pull request that is no longer conflicting, and autoresolve dispatches only on a conflicting one, so a clear cannot itself trigger a re-escalation.

**Resolution Options:**

1. Restate: sticky while conflicting; a conflict-caused label clears once the pull request no longer conflicts; every other label is operator-cleared.
2. Drop Story 5 and keep the manual clear.
3. Replace the label with registry-held stickiness, which the amended adr-2026-07-04-autoresolve-state-and-config still rejects.

**Resolution:** Option 1, operator-approved. Replaced in place in companion PR #2613.

## Conflict: "Terminal until a human clears it" is no longer the only clearer

**Stories involved:** "ci-failed label lifecycle + halt-monitor-visible event" vs Story 5
**Files:** `.docs/stories/ship-ci-feedback-loop.md` vs `.docs/stories/mergeable-autoresolve-tier-2-escalates-every-conte.md`
**Type:** overlap
**Severity:** degrading
**Confidence:** 70% — the criterion's behavior holds in both directions (a labeled pull request gets no ci-fix dispatch, and Story 5 never clears a ci-fix-caused label). Only its explanatory parenthetical became false.

**Resolution:** Parenthetical restated in companion PR #2613 to name both clearers. Criterion unchanged.

## Conflict: Registry trimming can drop the recorded escalation cause

**Stories involved:** "An over-cap registry is trimmed" vs Story 5
**Files:** `.docs/stories/mergeable-watch-registry-size-cap.md` vs `.docs/stories/mergeable-autoresolve-tier-2-escalates-every-conte.md`
**Type:** state-conflict
**Severity:** degrading
**Confidence:** 75% — trimming the oldest entries removes the cause with them, after which Story 5's "no recorded cause, leave the label alone" applies and the label needs a manual clear.

**Resolution:** Accepted by the operator. It fails safe and degrades only to today's behavior.

## Gap closed in the new stories

Story 5's first draft retried a failed label removal on every tick without bound. The label helpers swallow their own errors, so a failure is observable only as the label still being present on the next read, and a permanent refusal ("Reconcile only the operator's feature PRs", `.docs/stories/enforce-ownership-across-all-harness-github-operat.md`, whose boundary is not yet on main) would have looped forever. Story 5 now bounds it: at most three removals per pull request, after which the recorded cause is cleared, one log line is written, and the label is left for the operator. Story 4's boundary-refusal criterion was dropped as untestable within this diff; its comment-failure criterion already covers the observable behavior.

## Examined and compatible

- `rebase-resolution-skill.md` "Reject a resolution that drops feature commits": finish-time callers pass no declarations and Story 3 pins their behavior as unchanged.
- `name-the-missing-feature-content-when-the-rebase-g.md` Story 1: its accept and reject verdicts are exercised with no declarations, so its boundary does not move.
- `rebase-full-replay-intent-validation.md` Stories 1 and 3: the post-continue recheck stays; the amended ADR's D1 governs supersession. The rejected "file allowlist as acceptance boundary" restricts what a resolver may write; this design gates who may judge and restricts no writes.
- `daemon-pr-labels.md` "Clear the failure signal when a re-kicked feature succeeds": a different trigger and a different signal owner.
- `finish-publication-burns-its-retry-budget-on-an-un.md` Story 4: a conflict-caused label still present at finish means the pull request is still conflicting or not yet swept, which is a genuine operator condition.
- `halt-pr-presentation-reliability.md` and `auto-opened-needs-remediation-pr-occupies-the-bran.md`: reconciliation selects on the body marker, and Story 5 refuses any pull request carrying one.
- `remediation-comment-upsert.md`: Story 4 uses the same upsert convention under its own marker.
- `auto-resolve-open-pr-conflicts.md` lease-push and suite-gate stories, `block-bare-force-pushes-inside-compound-commands.md`, `finish-force-with-lease-after-sanctioned-rebase.md`, `mergeability-first-finish.md` Story 4: reused unchanged.
