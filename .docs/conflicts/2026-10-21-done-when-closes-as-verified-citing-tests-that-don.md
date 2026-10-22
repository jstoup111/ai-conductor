# Conflict Report: Done-when `[test]` citations proven by provenance or judgement (#3200)

**Date:** 2026-10-21
**New stories:** `.docs/stories/done-when-closes-as-verified-citing-tests-that-don.md` (Stories 1-8)
**Result:** 4 blocking-shaped conflicts and 8 tensions or gaps found. All resolved by operator decision ("apply all"). Re-check clean.

## Corpus

**ADRs examined** (`.docs/decisions/`):
- adr-2026-08-22-done-when-evidence-at-task-close
- adr-2026-09-06-reopened-task-resolution
- adr-2026-07-23-trailer-union-build-step-routing
- adr-2026-07-21-demote-task-stamping-to-telemetry
- adr-2026-07-22-per-task-work-happened-floor
- adr-2026-07-12-progress-aware-build-halt
- adr-2026-07-05-engine-owned-task-status
- adr-2026-07-10-session-hook-task-stamping
- adr-2026-07-12-rebase-evidence-stamp-translation
- adr-2026-10-01-daemon-session-command-contracts
- adr-2026-09-20-operator-launched-sessions-retain-conductor-authority
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery
- adr-2026-07-17-verify-only-judged-closure
- adr-2026-09-06-engine-owned-test-quality-scope

**ADRs narrowed out:** every other approved ADR. None of them governs task start or close, Done-when evidence, trailer resolution, repair obligations, BUILD completion, the daemon-session guard, or judgement dispatch. No ADR was excluded as superseded.

**Stories examined** (`.docs/stories/`):
- tasks-close-with-boilerplate-done-when-evidence-mi
- remediation-halts-when-the-owning-plan-task-is-alr
- a-superseded-repair-obligation-keeps-its-task-read
- build-step-completes-with-every-plan-task-still-pe
- rebase-reopens-completed-repair-tasks-against-stal
- rebase-orphans-every-sha-anchored-evidence-citatio
- trailer-union-build-completion
- daemon-halts-a-build-that-is-making-forward-progre
- daemon-records-that-a-build-is-not-advancing-head-
- deterministic-evidence-attribution
- engine-must-invoke-task-start-done-at-subagent-dis
- engine-cannot-represent-more-than-one-branch-step-
- build-loop-cannot-complete-a-feature-child-by-chil
- sliced-plans-can-be-landed-whose-stories-span-chil
- record-task-done-completion-without-a-current-task
- prd-audit-kickback-preserves-task-status
- engine-prompts-direct-daemon-sessions-to-ai-conduc
- monitor-daemon-halts-through-a-guided-resolution-q
- build-review-re-judges-what-the-plan-architecture-
- ignore-covers-markers-inside-test-string-literals
- test-files-outside-test-style-paths-are-silently-o
- unresolved-covers-marker-on-a-changed-test-exhaust
- demote-task-stamping-to-telemetry
- verify-only-prove-closed-task-evidence
- no-diff-task-evidence-stamp

Every pair sharing a behavior, entity, field, or gate was tested in both directions.

## Conflict: Untouched tests no longer close `verified` (C1)

**Stories involved:** #2758 Story 2 and Story 3 vs new Story 2 and Story 3
**Files:** `.docs/stories/tasks-close-with-boilerplate-done-when-evidence-mi.md` vs `.docs/stories/done-when-closes-as-verified-citing-tests-that-don.md`
**Type:** contradiction
**Severity:** blocking

**Description:** #2758 Story 2 says a test "committed before the feature branch and … unchanged in the feature diff" closes `verified`. New Story 3 says such a citation closes `pending-judgement`. Both cannot hold.

**Resolution Options:**
1. Rewrite the #2758 criteria in place to the D11/D12 rule.
2. Exempt pre-branch tests from judgement.

**Recommendation and resolution:** Option 1, applied. The amendment exists to change exactly this.

## Conflict: Closed four-value source set (C2)

**Stories involved:** #2758 Story 2 Done When vs new Story 3
**Files:** `.docs/stories/tasks-close-with-boilerplate-done-when-evidence-mi.md` vs `.docs/stories/done-when-closes-as-verified-citing-tests-that-don.md`
**Type:** contradiction
**Severity:** blocking

**Description:** The four-value set becomes seven (D17).

**Resolution Options:**
1. Rewrite the Done When line in place to list all seven sources.

**Recommendation and resolution:** Option 1, applied.

## Conflict: "Completes exactly as before" with pending citations (C3)

**Stories involved:** #2758 Story 5 vs new Stories 4 and 5
**Files:** `.docs/stories/tasks-close-with-boilerplate-done-when-evidence-mi.md` vs `.docs/stories/done-when-closes-as-verified-citing-tests-that-don.md`
**Type:** overlap
**Severity:** degrading

**Description:** A pending citation can now withhold BUILD completion when every task is resolved and no check is unverified.

**Resolution Options:**
1. Scope the #2758 preamble and criterion to "no `pending-judgement` record".

**Recommendation and resolution:** Option 1, applied in place.

## Conflict: Two citation obligations on one task go stale (C4)

**Stories involved:** a-superseded-repair-obligation-keeps-its-task-read Story 2 vs new Stories 5 and 7
**Files:** `.docs/stories/a-superseded-repair-obligation-keeps-its-task-read.md` vs `.docs/stories/done-when-closes-as-verified-citing-tests-that-don.md`
**Type:** state-conflict
**Severity:** blocking
**ADR filename stem:** adr-2026-09-06-reopened-task-resolution
**Story ID:** Story 7
**ADR opposing sentence (verbatim):** "When the BUILD-boundary citation judgement refuses a check, the engine admits an obligation with source authority `done-when-citation`, a finding id digested from the task id, check index, check text, and cited reference, and the cited task id." (the text before the fix)
**Story opposing sentence (verbatim):** "then check 3's close record has source `operator-accepted` with that reason, task 24's citation reopen is resolved, and the command exits 0."

**Description:** One obligation per check means a second refused check on the same task supersedes the first. A superseded obligation is refused as `stale` when anything tries to close it, so accepting or demoting the older check could not resolve it.

**Resolution Options:**
1. One live `done-when-citation` obligation per task, covering every open refused check and superseding under the existing current-obligation rule.
2. Teach close to accept superseded citation obligations.

**Recommendation and resolution:** Option 1, applied to this branch's 09-06 decision 13. New Story 5 and Story 7 criteria cover it.

## Conflict: A refusal reopen against the no-progress breaker and stall (C5)

**Stories involved:** trailer-union-build-completion Story 4, daemon-halts-a-build-that-is-making-forward-progre S3, and remediation-halts-when-the-owning-plan-task-is-alr Story 6 vs new Story 5
**Files:** those three story files vs `.docs/stories/done-when-closes-as-verified-citing-tests-that-don.md`
**Type:** oscillating
**Severity:** blocking

**Description:** A refusal-withheld attempt has zero or negative resolved-count movement, so it counts toward `noEvidenceAttempts`. A reopen that BUILD ignores stays unresolved and stalls. Both contradict "a refusal never halts". The review's mitigation, which cited 09-06 decision 8, pointed the wrong way.

**Resolution Options:**
1. Exempt the refusal-caused retry from `noEvidenceAttempts`, as D8's nudge already is, and settle every refused check at the next session end: re-judge it, or demote it.
2. Charge the reopen as progress.

**Recommendation and resolution:** Option 1, applied to this branch's 08-22 D14. New Story 5 criteria cover it.

## Gap: The Claude Code session hook never records a start commit (C6)

**Stories involved:** engine-must-invoke-task-start-done-at-subagent-dis Story 3 vs new Story 1 and Story 2
**Files:** `.docs/stories/engine-must-invoke-task-start-done-at-subagent-dis.md` vs `.docs/stories/done-when-closes-as-verified-citing-tests-that-don.md`
**Type:** sequencing
**Severity:** blocking

**Description:** On Claude Code the session hook flips the row to `in_progress` directly (`session-hook-assets.ts`); `conduct task start` never runs. As written, no start commit would ever be recorded on the primary host, and every citation would go to the judge.

**Resolution Options:**
1. Every start path records HEAD, including the hook's inline `node -e` stamping (adr-2026-07-10 D6 still holds: no dist, no CLI).

**Recommendation and resolution:** Option 1, applied to this branch's 08-22 D10. A new Story 1 criterion covers it.

## Tensions resolved

- **C7, the daemon-session audit names blocked commands.** The skill text and the BUILD retry hint must not name `done-when accept` outside an operator-only region. Added to new Story 3 and Story 5 Done When.
- **C8, rebase translation.** `startHead` is mapped by the existing rebase translation, and an unmapped value fails toward judgement. Added to D10 and a Story 1 criterion.
- **C9, 09-06 decision 8 says "no new retry counter".** Decision 13 now states that the per-check refusal count belongs to 08-22 D14 and is not a repair retry counter.
- **C10, the trailer-union "no SHA reachability" constraint.** Compatible. The constraint governs the routing resolver. Provenance lives in task-close evidence, never refuses, and falls back to judgement.
- **C11, reseed and restage drop the additive field.** D10 preserves `startHead` through seeding and restaging. Added a Story 1 criterion.
- **C12, plan check text changes after a refusal.** The stale check's refusal is dropped and the plan-change reopen governs. Added to D14 and decision 13, with a Story 5 criterion.

## Re-check

The first re-check found one internal contradiction and some wording gaps left over from the resolutions. All were fixed in place:

- **A1.** A "consecutive passes" refusal pair cannot coexist, because D14 settles every refused check at the next session end. Story 5 now says "same judgement pass".
- **A2.** D16 now settles the accepted check inside the per-task obligation, which resolves once no check is still open. Story 7's single-check case says "only refused check".
- **A3.** Output missing a verdict for any pending citation is a whole failed dispatch (D13, Story 4).
- **B1, B2.** #2758 Story 5's two remaining completion lines are scoped to "no citation pending judgement". Story 2's "the check verifies" now reads "the reference passes the text checks".
- **a-superseded-repair-obligation-keeps-its-task-read Done When.** A `task done` re-close settles a citation check only when its new record is `verified`. A `pending-judgement` re-close stays open until the judgement (09-06 decision 13).
- **build-step-completes-with-every-plan-task-still-pe Story 1.** A citation obligation is not a gate remediation for decision 11, so a plan-text change drops the stale check (09-06 decision 13).
- **engine-must-invoke-task-start-done-at-subagent-dis Story 1.** Hook scripts may use `git rev-parse` to read HEAD (adr-2026-07-10 D6 still holds: no dist, no CLI).
- **rebase-orphans-every-sha-anchored-evidence-citatio Story 7.** `startHead` is a provenance hint, not an evidence citation, so an unmapped one gets no residue entry (D10).
- **Residual.** The no-progress stories (`daemon-halts-a-build-that-is-making-forward-progre` S3, `trailer-union-build-completion` Story 4, `remediation-halts-when-the-owning-plan-task-is-alr` Story 6) describe ordinary misses. D14 carves out the refusal retry at ADR level, exactly as D8's nudge already does. They need no change.

Result: zero blocking conflicts. No degrading conflict is accepted.
