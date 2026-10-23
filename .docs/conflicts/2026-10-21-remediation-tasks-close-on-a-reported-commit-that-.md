# Conflict Check: Remediation tasks close on a reported commit that never implemented them (#3190)

**Date:** 2026-10-23
**Stories:** `.docs/stories/remediation-tasks-close-on-a-reported-commit-that-.md` (Stories 1-7)
**Result:** 0 blocking. 9 degrading conflicts carried from the 2026-10-21 pass and 4 degrading
conflicts plus 3 internal gaps found on re-run after #3200 landed. All resolved in place, with
operator approval of the reconciled design (2026-10-23). None accepted as a compromise.

## Corpus

**ADRs examined:** adr-2026-10-21-remediation-closure-judgement (new),
adr-2026-08-22-done-when-evidence-at-task-close (D1-D19), adr-2026-09-06-reopened-task-resolution
(decisions 1-14 and the #2944 notes), adr-2026-08-22-one-owner-per-review-question,
adr-2026-10-12-routed-whole-feature-repair, adr-2026-10-07-per-child-build-region,
adr-2026-07-23-trailer-union-build-step-routing, adr-2026-07-23-commit-movement-liveness-floor,
adr-2026-07-12-progress-aware-build-halt, adr-2026-08-03-uncommitted-work-floor-under-build-completion,
adr-2026-07-10-intra-step-build-progress-events, adr-2026-09-10-portable-build-review-policy,
adr-2026-07-05-engine-owned-task-status, adr-2026-08-25-as-built-remediable-findings-bounded-build-route,
adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback,
adr-2026-07-13-kickback-build-no-op-escalation, adr-2026-07-20-post-rebase-delta-aware-invalidation,
adr-2026-07-13-retry-classify-rerun-vs-route, adr-2026-08-05-build-settle-outcome-stamp,
adr-2026-07-10-daemon-stall-remediation, adr-2026-07-22-per-task-work-happened-floor,
adr-2026-07-22-attempts-counter-on-crash-recovery, adr-2026-07-27-cold-start-within-step-retries,
adr-2026-07-17-verify-only-judged-closure, adr-2026-07-26-cross-dispatch-kickback-livelock-bound,
adr-2026-10-03-stacked-child-plans-identity-and-state, adr-2026-07-07-audit-trail-event-sink,
adr-2026-07-21-demote-task-stamping-to-telemetry.

**ADRs narrowed out:** every other approved ADR. None governs BUILD completion, task close or
status, Done-when evidence, repair obligations, stalls, retries, rebase translation, stacked BUILD
regions, provider dispatch for judgements, or the event spine. None was excluded as superseded.

**Stories examined:** remediation-tasks-close-on-a-reported-commit-that- (new),
done-when-closes-as-verified-citing-tests-that-don, build-step-completes-with-every-plan-task-still-pe,
tasks-close-with-boilerplate-done-when-evidence-mi, build-reports-step-completed-status-done-while-lea,
trailer-union-build-completion, rebase-reopens-completed-repair-tasks-against-stal,
kickback-to-build-no-op-when-target-evidence-stamped, emit-a-valid-done-when-block-on-engine-appended-re,
remediation-task-ids-are-non-numeric-by-design-but, build-loop-cannot-complete-a-feature-child-by-chil,
daemon-records-that-a-build-is-not-advancing-head-, a-superseded-repair-obligation-keeps-its-task-read.

Every pair sharing a behavior, entity, field or gate was tested in both directions. The re-run used
an independent read of the corpus in addition to this session's own.

## Carried from 2026-10-21 (resolved)

1. **All-resolved implies BUILD completes** (contradiction). `build-step-completes-with-every-plan-task-still-pe` Story 3 and `tasks-close-with-boilerplate-done-when-evidence-mi` Story 5 gain scope notes in place. `trailer-union-build-completion` Story 2 and `build-reports-step-completed-status-done-while-lea` S4 assert the completion predicate's own result, which stays pure (new ADR D1), so they need no change.
2. **Pending-task listing in the reason** (overlap). The reopen reason names each reopened task by id and title with its rationale (D1); after a reopen those are the only pending tasks, so TI-2 holds.
3. **Untestable criterion-bound task closed `unverified`** (oscillating, bounded). Close-record sources are passed to the judge and an `unverified` close is not by itself grounds for `persists` or `partial` (D3, Story 3).
4. **Close identity across rebase** (state). The identity excludes every SHA that rebase translation rewrites (D2, A7, Story 2).
5. **`adr-2026-08-22-one-owner-per-review-question` D1 map.** Amended 2026-10-23 on the *Did BUILD finish each task?* row. The new ADR's alignment sentence now names `prd_audit` as completion authority.
6. **`adr-2026-09-06-reopened-task-resolution` decision 8, "no new retry counter".** Decision 14 added; the reopen count lives in the new ADR's verdict state.
7. **09-06 #2944 stacked boundary and admission key.** Decision 14 takes `{branch, head}` on the execution child's branch at admission, keyed by close identity (Story 2).
8. **Execution child versus cursor child.** Candidates use the execution child (D2, Story 2).
9. **`adr-2026-08-22-done-when-evidence-at-task-close` D8 and placement against #3200's D13.** D19 added: the judgement runs after D13's citation judgement and before the predicate, and qualifies D8's completion sentence. `adr-2026-10-07-per-child-build-region` D6 defines the per-child task scope the predicate counts; the judgement withholds hand-off inside that scope exactly as the citation refusal does, so D6 needs no amendment.

## Found on re-run (resolved)

- **R1. Supersession across sources** (contradiction). Decision 14 said a plan-text change "supersedes it under the existing current-obligation rule". `repair-obligations.ts` supersedes only within one authority. Decision 14 now says a newer `remediation-closure` obligation supersedes an older one, and a `plan_amendment` obligation stands beside it until one fresh close resolves both.
- **R2. Dirty-tree definition** (contradiction with `adr-2026-08-03-uncommitted-work-floor-under-build-completion`: "We block on tracked modifications **and** untracked-not-ignored paths."). D1 said "uncommitted tracked changes", so an untracked file could sway a durable verdict. D1 and Story 2 now use the floor's probe.
- **R3. Reopen bound reset by worktree recreation** (state, against CLAUDE.md rule 3 and `build-step-completes-with-every-plan-task-still-pe` Story 3). Trailer-restored rows without close records are never candidates, a restored row closed again is, and an absent verdict section is an empty record whose residual cost (one re-judgement from a zero count when only `engine-state.json` is lost) D11 states (D2, D11, Story 2).
- **R4. `done-when accept` and citation settlement change the identity** (overlap with done-when D16). The identity now excludes record `source` (D2, Story 2).
- **G1. "Completed" versus "resolved".** Candidates are defined through the shared resolver, so a trailer-resolved reopen is judged again (D2, Story 2).
- **G2. "A reopen always yields a new identity".** Scoped to reopens under decision 8; a task reopened by another source keeps its identity and that source's review judges it (D2).
- **G3. "Never halts".** The one-owner amendment now says the judgement adds no halt class of its own; D11 names the existing BUILD failure for a malformed section.

Two code facts were corrected rather than conflicts: #3200's port dispatches under BUILD's provider
policy, so D4 now resolves its policy from `steps.build_review` through the
`dispatchRebaseRegradeJudgement` pattern, supervised as BUILD activity (A6, basis inferred: no existing dispatch combines a step-resolved policy with BUILD supervision); and `noEvidenceAttempts`
has no production incrementer, so the stall exemption is stated as the prefix check alone (D10, D19).

## Re-check

Clean: zero blocking conflicts, no degrading conflict accepted.
