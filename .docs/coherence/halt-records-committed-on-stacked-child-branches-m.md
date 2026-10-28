# Coherence: Halt records committed on stacked child branches make every restack conflict (#3451)

**Date:** 2026-10-28
**Tier:** M
**Track:** technical. The `fr` row class is omitted because there is no PRD; the stories carry the requirement layer.

Outcome rows quote the staged `.pipeline/intake-outcomes.md` bullets verbatim. Story and task rows come from the plan's `**Story:**` lines. Criterion rows carry every story criterion with its cited tasks and a verbatim `Done when` quote, and all of them passed independent coverage judgement (see Notes). The `adr` row covers the one on-main ADR amended by #3451; the plan's Architecture Obligation Coverage table dispositions its decisions.

## Outcomes

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | Writing or resolving a halt record on a stacked feature never creates a commit that a later restack must reconcile across children. |
| outcome | outcome-2 | story-1 | covered | A restack whose only divergence between children is halt-record bookkeeping completes without a conflict halt or a resolver call. |
| outcome | outcome-3 | story-2 | covered | The halt record a reader sees on the feature after a restack is the newest one, never an older copy replayed over it. |
| outcome | outcome-4 | story-3 | covered | Flat (non-stacked) features keep their current halt-record behavior. |

Outcome notes:

- outcome-1: Read as operator-confirmed (explore, 2026-10-28): halt commits may still exist on the active child, but no restack conflicts on them or calls the resolver for them. Story 1 omits them from both replay paths, and Story 2 collapses their records into one newest-record commit.
- outcome-2: Story 1 happy path 1 is this outcome on the issue's incident shape: no resolver call, no HALT, no conflict event.
- outcome-3: Story 2 carries the newest record (by `Resolved at:`, else `Halted at:`) to every replayed tip on both paths.
- outcome-4: Story 3 keeps flat halt-record writing, clearing, pushing and FINISH rebase on unchanged code.

## Stories

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-2, task-3, task-5, task-6, task-7, task-9 | covered | A stacked restack never escalates halt-record bookkeeping to the resolver |
| story | story-2 | task-1, task-2, task-4, task-5, task-6 | covered | The replayed child carries the newest halt record |
| story | story-3 | task-8, task-9 | covered | Flat features and ordinary stacked commits keep today's behavior |

## Tasks

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| task | task-1 | story-2 | covered | Choose the newer of two halt records |
| task | task-2 | story-1, story-2 | covered | Classify halt-record-only commits, add the tip bookkeeping commit, map omitted commits |
| task | task-3 | story-1 | covered | Plumbing replay leaves halt-record-only commits out and pins the halt path |
| task | task-4 | story-2 | covered | Plumbing replay carries the newest halt record to the tip |
| task | task-5 | story-1, story-2 | covered | Resolver fallback never sees halt-record bookkeeping |
| task | task-6 | story-1, story-2 | covered | runRestack and journal recovery wire the bookkeeping and keep the halt path out of conflicts |
| task | task-7 | story-1 | covered | An unentered leaf at an omitted pre-region halt record still moves |
| task | task-8 | story-3 | covered | Flat features and non-bookkeeping commits keep today's behavior |
| task | task-9 | story-3, story-1 | covered | Halt-record bookkeeping never masks a replay-mismatch, FR-9 or flatten_refused refusal |

## ADRs

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| adr | adr-2026-10-10-stacked-restack-journaled-replay | story-1, story-2, story-3 | covered | D2 (amended 2026-10-28: halt-record-only commits inside a range are bookkeeping, the newest record is carried at the tip, omitted commits map to a rewrite) maps to Tasks 3, 4 and 7. Their checks omit halt-only commits from the plumbing replay, carry the newer record by one `halt record: demo` commit, apply the tie and unreadable rules, and keep an unentered pre-region leaf movable. D6 (amended: the resolver todo omits halt-only commits, an environment-only merge driver keeps the side being rebuilt, FR-9 checks the todo's subjects, and the resolved tip gets the same bookkeeping) maps to Tasks 5 and 6. Their checks bound the resolver's context to `['src/a.ts']`, require `changed` on the candidate subjects, leave the repository's config and attributes byte-identical, and keep the halt path out of `restack_conflict` and HALT. D1, D3-D5 and D7-D13 are no-change: N=1 is untouched (Task 8 diff check), path ownership still judges the returned tip (Tasks 4 and 5 assert it accepts), and the journal shape, moves, preflight, verdicts, triggers, cap, leases, events and proof obligations are unchanged. |

## Criteria

| Row class | Criterion | Task id(s) | Verdict | Done when quote | Disposition |
|---|---|---|---|---|---|
| criterion | Story 1 happy: Given a two-child stacked feature where child 1 has a repair commit to `src/r.ts` followed by 3 halt-record-only commits appended past its closure, and child 2's range holds 2 halt-record-only commits with different record text plus 2 code commits that touch other paths, when a feature-repair restack carries child 1's change to child 2, then the restack is applied, no conflict halt is written, the provider resolver is never invoked, and child 2's new branch tip descends from child 1's new closure. | task-6 | covered | "runRestack returns `applied`, the counting resolver is invoked 0 times, no `restack_conflict` event is emitted, `.pipeline/HALT` is absent" | diff-local |
| criterion | Story 1 happy: Given a two-child stacked feature where child 2's range holds a code commit that conflicts with child 1's repair in `src/a.ts` and also 4 halt-record-only commits that differ from child 1's record, when the routed-exit restack falls back to the provider resolver, then the resolver's conflict context names only `src/a.ts`, never `.docs/halted/<slug>.md`, and the rebase todo it replays lists none of the 4 halt-record-only commits. | task-5, task-6 | covered | "returns candidates (the engine-written rebase todo) containing none of the 4 halt-record-only commits, and every recorded `context.conflicts` equals exactly `['src/a.ts']`" | diff-local |
| criterion | Story 1 happy: Given that same conflicted restack where the resolver resolves `src/a.ts`, when the resolved tip is checked against FR-9, then FR-9 passes and its expected subject list contains every code commit's subject and none of the omitted halt-record-only commits' subjects. | task-5 | covered | "that resolution returns outcome kind `changed` (FR-9 passed on the expectedSubjects computed from the returned candidates)" | diff-local |
| criterion | Story 1 happy: Given a kept commit in child 2's range that changes both `src/b.ts` and the halt record, while child 1's new closure also changed the halt record, when the restack replays that commit on either replay path, then `src/b.ts` is applied, the halt record does not conflict, and the commit is replayed as one commit with its original subject and body. | task-3, task-5 | covered | "the new tip has the commit's `src/b.ts` content, the parent's halt record, and one replayed commit with the original subject and body" | diff-local |
| criterion | Story 1 negative: Given a child range commit that changes `.docs/halted/<slug>.md` and `.docs/plans/<stem>.md`, when the restack classifies it, then it is kept and replayed as an ordinary commit, never omitted as bookkeeping, and its plan change is present at the new child tip. | task-3 | covered | "replayChildRange keeps a commit changing `.docs/halted/demo.md` and `.docs/plans/<stem>.md` (its plan change is present at the new tip)" | diff-local |
| criterion | Story 1 negative: Given a child range commit that changes only `.docs/halted/<other-slug>.md`, a different feature's record, when the restack classifies it, then it is kept and replayed, never omitted as this feature's bookkeeping. | task-3 | covered | "and a commit changing only `.docs/halted/other.md`" | diff-local |
| criterion | Story 1 negative: Given a merge commit in a child's range whose changes include `.docs/halted/<slug>.md`, when the restack classifies it, then it is never omitted as bookkeeping and goes through the existing merge handling (`flatten_refused` when it conflicts). | task-2, task-3, task-9 | covered | "runRestack returns `halted` with `.pipeline/HALT` naming `flatten_refused` and the merge commit's SHA, the merge commit is still reachable from child 2's branch (not omitted)" | diff-local |
| criterion | Story 1 negative: Given a resolver-fallback restack whose code conflict the resolver cannot resolve, when the restack halts needs-human, then the conflict halt names only the code paths, never `.docs/halted/<slug>.md`, and no child ref or closure ref has moved. | task-6 | covered | "the single `restack_conflict` event's paths and the `.pipeline/HALT` text name `src/a.ts` and not `.docs/halted/demo.md`" | diff-local |
| criterion | Story 1 negative: Given a resolver-fallback restack has run, when the feature worktree's `.git/config`, `.git/info/attributes` and tracked `.gitattributes` are compared with their state before the restack, then all three are byte-identical; the halt-record merge rule existed only for that rebase. | task-5 | covered | "are byte-identical to their state before the call" | diff-local |
| criterion | Story 1 negative: Given a stacked feature whose leaf is unentered and whose leaf tip is a pre-region halt-record-only commit inside child 1's range, when a base-refresh restack omits that commit from child 1's replay, then the leaf moves in the same transaction to exactly one rewritten commit on child 1's new history and the restack does not throw `cannot resolve unentered leaf`. | task-7 | covered | "runRestack returns `applied` without throwing `cannot resolve unentered leaf`, `feat/daemon-demo` equals the single commit H maps to" | diff-local |
| criterion | Story 1 negative: Given a halt-record-only commit at the end of a child's range, after its last kept commit, when the restack journals that child's rewrites, then the omitted commit maps to the child's final new tip, a halt-record-only commit between two kept commits maps to the rewrite of the kept commit before it, and a halt-record-only commit whose only earlier range commit was dropped as patch-equivalent maps to the new parent. | task-2, task-3 | covered | "the returned rewrites map a halt-record-only commit after the last kept commit to the returned tip, and one between two kept commits to the rewrite of the kept commit before it" | diff-local |
| criterion | Story 2 happy: Given child 1's new closure carries a record resolved at `2026-10-26T12:30:00.000Z` and child 2's old tip carries a record halted at `2026-10-26T11:00:00.000Z`, when the restack replays child 2, then child 2's new tip carries child 1's resolved record byte-for-byte, and no commit is added for the halt record. | task-4 | covered | "replayChildRange returns a tip carrying the parent's record byte-for-byte and adds no `halt record: demo` commit" | diff-local |
| criterion | Story 2 happy: Given child 1's new closure carries a record resolved at `2026-10-26T10:00:00.000Z` and child 2's old tip carries a record halted at `2026-10-26T12:05:00.000Z`, when the restack replays child 2 on the plumbing path, then child 2's new tip carries child 2's halted record byte-for-byte, added by exactly one commit with subject `halt record: <slug>` on top of the replayed commits. | task-4 | covered | "the tip carries the child's record byte-for-byte through exactly one top commit with subject `halt record: demo`" | diff-local |
| criterion | Story 2 happy: Given the same records and a code conflict that sends child 2 to the provider resolver, when the resolver's tip is accepted, then the accepted tip carries child 2's halted record through exactly one `halt record: <slug>` commit, and the path-ownership check accepts the tip. | task-5 | covered | "the accepted tip carries the child's record through exactly one top `halt record: demo` commit, and checkPathOwnership on that tip returns accepted" | diff-local |
| criterion | Story 2 happy: Given the restack has applied with child 2's newer halted record at its tip, when the stack preflight next reads the record at child 2's tip, then it reads `Status: halted`, the same status the newest record states. | task-6 | covered | "begins with `# Halt record` followed by `Status: halted`" | diff-local |
| criterion | Story 2 negative: Given child 1's new closure and child 2's old tip carry records with the same age, when child 2 is replayed, then child 2's new tip carries child 1's record byte-for-byte and no halt-record commit is added. | task-4 | covered | "when the two records have the same time" | diff-local |
| criterion | Story 2 negative: Given child 2's old-tip record has an unreadable `Halted at:` value and child 1's new-closure record has a readable `Resolved at:`, when child 2 is replayed, then child 1's record is kept and no halt-record commit is added. | task-4 | covered | "when only the parent's time parses (child 2's `Halted at:` unreadable)" | diff-local |
| criterion | Story 2 negative: Given child 2's old-tip record is readable and child 1's new-closure record has no readable `Resolved at:` or `Halted at:` line, when child 2 is replayed, then child 2's record is carried by one `halt record: <slug>` commit. | task-4 | covered | "adds one `halt record: demo` commit carrying the child's record byte-for-byte when only the child's time parses" | diff-local |
| criterion | Story 2 negative: Given neither record has a readable time, when child 2 is replayed, then child 2's new tip carries child 1's record byte-for-byte and no halt-record commit is added. | task-4 | covered | "and when neither time parses" | diff-local |
| criterion | Story 2 negative: Given child 1's new closure carries a record resolved at `2026-10-26T12:30:00.000Z`, and child 2's range holds a kept commit that changes `src/m.ts` and cleanly replaces the halt record with one halted at `2026-10-26T11:00:00.000Z` (child 1's record is unchanged from that commit's base), when child 2 is replayed on either replay path, then child 2's new tip carries child 1's record byte-for-byte, restored by exactly one `halt record: <slug>` commit, and `src/m.ts` carries the kept commit's change. | task-4, task-5 | covered | "replayChildRange returns a tip carrying the parent's record byte-for-byte, restored by exactly one top `halt record: demo` commit, with the kept commit's `src/m.ts` change present" | diff-local |
| criterion | Story 2 negative: Given child 2's range never changed `.docs/halted/<slug>.md`, when child 2 is replayed onto a new parent whose record is older than the one at child 2's old tip, then no halt-record commit is added, and the path-ownership check does not halt `replay-mismatch` on `.docs/halted/<slug>.md`. | task-4 | covered | "replayChildRange adds no halt-record commit, and checkPathOwnership on the returned tip returns accepted with no `.docs/halted/demo.md` path" | diff-local |
| criterion | Story 2 negative: Given child 1's new closure has no `.docs/halted/<slug>.md` and child 2's range created it, when child 2 is replayed, then child 2's new tip carries the record from child 2's old tip. | task-4 | covered | "the replayed tip carries child 2's old-tip record byte-for-byte" | diff-local |
| criterion | Story 3 happy: Given a flat (non-stacked) feature that halts needs-human and is later resolved, when the halt is written and cleared, then `.docs/halted/<slug>.md` is committed and pushed on its feature branch exactly as before, with subjects `halt record: <slug>` and `halt record resolved: <slug>`. | task-8 | covered | "so the flat commit and push of `halt record: <slug>` and `halt record resolved: <slug>` and the flat FINISH rebase run unchanged code" | diff-local |
| criterion | Story 3 happy: Given a flat feature with halt-record commits whose FINISH rebase onto the default branch conflicts on the halt record, when the rebase runs, then it follows the existing `performRebase` behavior, with no halt-record commit omitted and no halt-record bookkeeping commit added. | task-8 | covered | "the flat FINISH rebase run unchanged code with no halt-record commit omitted or added" | diff-local |
| criterion | Story 3 happy: Given a stacked restack over a child range with no halt-record commits, when it replays, then the new tip, its commits and the journal rewrites are identical to those produced before this change. | task-8 | covered | "showing that a range with no halt-record commits yields the same tip, commits and rewrites" | diff-local |
| criterion | Story 3 negative: Given a stacked restack whose child range contains a code commit that becomes empty against the new parent, when it replays, then that commit is dropped as today, and an originally-empty evidence commit in the same range is still kept. | task-8 | covered | "a newly-empty commit is still dropped while a started-empty one is kept" | diff-local |
| criterion | Story 3 negative: Given a stacked restack whose kept code commit reverts a path outside the child's owned paths, when it replays, then it still halts `replay-mismatch` naming the path, and the halt-record bookkeeping does not mask the refusal. | task-8, task-9 | covered | "`.pipeline/HALT` names reason `replay-mismatch` and the path `X`" | diff-local |
| criterion | Story 3 negative: Given a stacked restack where the resolver drops a code commit's subject, when FR-9 runs, then FR-9 still rejects the tip and names the missing code-commit subject. | task-8, task-9 | covered | "the halt text contains FR-9's rejection naming subject `C2`" | diff-local |

## Notes

- **Coverage judgement.** An independent subagent applied `skills/coverage-binding/SKILL.md` to one claim per criterion row: the criterion text plus every cited task's `Done when` checks, and nothing else.
  - Round 1: 23 of 26 asserted. Three were refused:
    - Story 2 negative 2: the check did not tie the kept record to the parent's.
    - Story 3 negatives 2 and 3: no check showed `replay-mismatch` naming the path, or FR-9 naming the subject, with bookkeeping active.
  - Fixes: Task 4's check now requires the tip record to be byte-identical to the parent's, and Task 9 adds bookkeeping-active refusal tests.
  - Round 2: all three asserted.
  - Round 3: all 28 criteria were re-judged after the cross-provider fixes below, and 26 asserted. The two refused were claims new in that round:
    - the merge negative path needed a `flatten_refused` check (added to Task 9);
    - the clean-apply negative path needed `src/m.ts` asserted on the resolver path (added to Task 5).
  - Their re-judgement asserted both.
- **Cross-provider review.** A read-only Codex source review, run after plan-review round 1 came back clean, found 2 blocking and 3 significant defects. All five were fixed in DECIDE:
  - Task 5's resolver stub must run `git rebase --continue`, because `resolveRebaseConflicts` retries while rebase state is still active.
  - A kept commit could cleanly apply an older record. The winner is now chosen between the new parent's record and the range's old-tip record, and the tip is reset when it differs (ADR D2 note, Story 2's new negative path, and Tasks 2, 4 and 5).
  - The omitted-commit mapping now uses the nearest earlier commit that actually has a rewrite.
  - The bookkeeping commit's message is exactly `halt record: <slug>` with no attribution-dependent trailer, so recovery produces the same commit.
  - Merge commits are never classified as halt-record-only (Story 1's new negative path, and Tasks 2 and 3).
  - The coverage judgement was re-run over all 28 criteria after these fixes (round 3).
  - A bounded Codex re-check confirmed all five fixes. It found two new issues, and both were fixed:
    - The winner rule now reuses `ownedPaths` from `restack-ownership.ts`, so a record a carried merge supplied automatically cannot win against ownership (new Task 2 check).
    - Task 9's step now states that path ownership judges the tip including the bookkeeping commit.
- **Achievability (§4g).** Each cited check names its mechanism:
  - `isHaltRecordOnlyCommit`, `chooseHaltRecord`, `carryNewestHaltRecord` and `mapOmittedHaltRecordCommits` in the new `halt-record-bookkeeping.ts`;
  - `replayChildRange` (plumbing skip, accumulator pin, tip bookkeeping);
  - `resolveRestackConflict` (candidate filter feeding the todo and FR-9's `expectedSubjects`, the environment-only merge driver tested with real git during architecture review, tip bookkeeping);
  - both `replayConflict` hand-off path sets, and `runRestack` / `recoverRestackJournal` as the entry points.
- **Representable outcomes.** `chooseHaltRecord` returns exactly `parent` or `range`. Every Story 2 scenario maps to one of them: newer on either side, a tie, one or both sides unreadable, a parent without a record, and a kept commit that cleanly applied an older record. A range that never touched the record skips the choice, and the parent wins.
- **Input boundary.** Record times come from the engine-rendered `Halted at:` (`halt-marker.ts`, `new Date().toISOString()`) and `Resolved at:` (`supersedeHaltRecordText`). Task 1's fixtures are built with those same renderers, so the parser is tested against the real source format.
- **Constraint sweep.** No criterion requires violating an approved decision. The amended D2 and D6 state the omission, pin, newest-record and mapping rules the criteria require. Build-region decision 11 (records on the active child, never pushed) is unchanged.
- **Superseded criteria elsewhere.** Three criteria in the shipped #2943 stories (`a-change-to-one-stacked-child-cannot-be-carried-in.md`, Story 1 and Story 6) were rewritten in place during conflict-check. Tasks 3, 6 and 7 rewrite the tests that asserted the old rules.
- **Prerequisite.** This spec builds after the in-flight #3421 (overlap in `restack-resolver.ts` and `restack-executor.ts`) and records #3421 as a land dependency.
