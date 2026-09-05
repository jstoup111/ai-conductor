# Coherence: Setup fix-session repairs must converge (#1346)

**Date:** 2026-08-29
**Tier:** M
**Plan:** `bin-setup-quarantines-a-fix-session-s-repair-inste`
**Result:** PASS — every required row is covered and the consistency pass found no contradiction or oscillation.

## Applicability

- Outcome rows are omitted because `.pipeline/intake-outcomes.md` contains no Desired-outcome
  bullets.
- FR rows are omitted because this is the technical track and has no PRD.
- The ADR layer is required because the current change set modifies
  `adr-2026-07-09-setup-failure-triage.md`.

## Coherence mapping

| Row class | Cited id or criterion | Counterpart id(s) | Verdict | Notes or verbatim task quote | Diff locality |
|---|---|---|---|---|---|
| story | story-1 | task-3, task-6, task-8, task-10 | covered | Exact snapshot, engine commit, setup-drift rejection, and commit/postcondition rejection cover every Story 1 criterion. |
| story | story-2 | task-5, task-7, task-9 | covered | No-change and clean-forward successes remain accepted; setup failure, rewritten history, and mixed residue fail closed. |
| story | story-3 | task-4, task-7, task-9, task-10, task-11, task-14 | covered | Preservation precedes restore, recovery faults are non-destructive, and the existing park boundary prevents automatic redispatch. |
| story | story-4 | task-1, task-2, task-12, task-13, task-14 | covered | The closed event union, exhaustive sink, renderer, one-settlement paths, and production emitter wiring cover the signal end to end. |
| task | task-1 | story-4 | covered | The task's `**Story:**` line cites Story 4 and implements its typed event/sink contract. |
| task | task-2 | story-4 | covered | The task's `**Story:**` line cites Story 4 and implements daemon-log visibility. |
| task | task-3 | story-1 | covered | The task's `**Story:**` line cites Story 1 and supplies its exact candidate-tree mechanism. |
| task | task-4 | story-3 | covered | The task's `**Story:**` line cites Story 3 and supplies preserve-before-reset machinery. |
| task | task-5 | story-2 | covered | The task's `**Story:**` line cites Story 2 and preserves its two compatibility successes. |
| task | task-6 | story-1 | covered | The task's `**Story:**` line cites Story 1 and creates the exact verified repair commit. |
| task | task-7 | story-2, story-3 | covered | The task's `**Story:**` line cites both the still-failing no-change case and changed-attempt preservation. |
| task | task-8 | story-1 | covered | The task's `**Story:**` line cites Story 1's setup-drift negative path. |
| task | task-9 | story-2, story-3 | covered | The task's `**Story:**` line cites both unsafe-history rejection and recoverability. |
| task | task-10 | story-1, story-3 | covered | The task's `**Story:**` line cites both transaction postconditions and recoverability. |
| task | task-11 | story-3 | covered | The task's `**Story:**` line cites Story 3's preservation/ref/restoration failures. |
| task | task-12 | story-4 | covered | The task's `**Story:**` line cites Story 4's accepted terminal dispositions. |
| task | task-13 | story-4 | covered | The task's `**Story:**` line cites Story 4's closed rejected dispositions. |
| task | task-14 | story-3, story-4 | covered | The task's `**Story:**` line cites the scan/unpark bound and production event persistence. |
| adr | adr-2026-07-09-setup-failure-triage | story-1, story-2, story-3, story-4 | covered | Stories 1–2 cite amended Decision 4; Stories 3–4 cite amended Decisions 4–5. Their criteria preserve the ADR's exact-commit, preserve-before-reset, one-session, event-spine, and downstream-gate constraints. |
| criterion | Story 1 happy: Given setup triage starts the one fix-session from a clean feature HEAD, the session leaves an uncommitted Git-visible repair without moving HEAD, and the forced setup verification succeeds without changing that repair, when triage completes, then the feature branch advances by exactly one repair commit whose parent is the original HEAD and whose complete tree equals the captured repair, the worktree is clean, the outcome is `fixed-pass`, and normal build dispatch proceeds. | task-3, task-6 | covered | “The feature branch advances by one commit whose parent is the original HEAD and whose tree equals the pre-setup candidate tree.” | diff-local |
| criterion | Story 1 negative: Given the same uncommitted repair, when forced setup adds, removes, or changes any Git-visible content relative to the captured repair, then no repair commit is accepted and triage preserves the full attempt before parking with a setup-drift outcome. | task-8 | covered | “Compare the pre/post setup tree OIDs and route every mismatch through full-attempt preservation; never stage the mismatched tree as the accepted repair commit.” | diff-local |
| criterion | Story 1 negative: Given setup leaves the captured repair unchanged but the repair commit fails or its parent, tree, HEAD, or final clean-tree verification does not match the contract, when triage completes, then it does not return `fixed-pass`; it preserves the complete attempt and parks with the exact failed postcondition named. | task-10 | covered | “Parent, tree/HEAD, and porcelain mismatches each produce `repair-postcondition-failed` naming the failed check.” | diff-local |
| criterion | Story 2 happy: Given the fix-session creates one or more commits that are clean forward descendants of the original HEAD, when forced setup succeeds without moving HEAD or changing the Git tree, then triage accepts those commits, creates no extra engine repair commit, returns `fixed-pass`, and proceeds to normal build dispatch. | task-5 | covered | “A clean forward commit chain returns `fixed-pass` without an additional engine commit.” | diff-local |
| criterion | Story 2 happy: Given the fix-session changes no Git-visible content but repairs an external worktree dependency or transient environment condition, when forced setup succeeds and HEAD plus the worktree remain unchanged, then triage returns `fixed-pass` without creating an empty commit. | task-5 | covered | “No-change repair returns `fixed-pass` without an empty commit.” | diff-local |
| criterion | Story 2 negative: Given provider-created commits are not forward descendants of the original HEAD, or the provider leaves commits plus uncommitted residue, when triage evaluates the attempt, then the existing commits are not accepted as a successful repair; the complete attempt is preserved and the feature parks with `history-rewritten` or `mixed-commit-and-residue` evidence. | task-9 | covered | “Classify ancestry with `merge-base --is-ancestor` and partition clean commits from residue before prepare acceptance; send both rejected classes through full-attempt preservation.” | diff-local |
| criterion | Story 2 negative: Given a no-tree-change attempt still fails forced setup, when triage completes, then it parks with `setup-still-failing`, creates no empty commit, and does not report a successful repair. | task-7 | covered | “No-change failure creates neither an empty commit nor a quarantine ref.” | diff-local |
| criterion | Story 3 happy: Given a repair is rejected for rewritten history, mixed commits plus residue, setup drift, or a failed repair-commit postcondition, when preservation succeeds, then a slug-scoped quarantine ref reaches the complete attempted state including provider commits and uncommitted content before the feature branch is restored to its original HEAD; triage then parks with the ref, preserved paths, and closed rejection reason. | task-4, task-8, task-9, task-10 | covered | “The feature branch restores to the original HEAD only after `rev-parse --verify` proves the ref.” | diff-local |
| criterion | Story 3 happy: Given preservation itself fails before a durable quarantine ref reaches the full attempt, when triage handles the failure, then it performs no reset, leaves the attempted state in the worktree, and parks with the preservation failure named. | task-11 | covered | “Commit, ref-refresh, and ref-verification failures execute zero `reset --hard <original>` calls.” | diff-local |
| criterion | Story 3 happy: Given either rejected outcome parks the feature, when subsequent daemon scans run without an operator clear/unpark, then they dispatch zero additional setup fix-sessions for that feature. | task-14 | covered | “After a rejected repair parks, repeated backlog discovery dispatches zero new fix sessions until unpark; after unpark, at most one new attempt runs before a fresh park.” | diff-local |
| criterion | Story 3 negative: Given a quarantine ref already exists, when refreshing it for a rejected repair fails, then the prior ref is not treated as proof that the new attempt was preserved, the current attempt is not reset, and the park evidence names the refresh failure. | task-11 | covered | “Verify GREEN and assert an older ref is never reported as proof of the current attempt.” | diff-local |
| criterion | Story 3 negative: Given the quarantine ref was durably updated but restoration to the original HEAD fails, when triage parks, then the evidence names the restoration failure and the updated ref remains recoverable; the outcome never claims the feature branch is clean or restored. | task-11 | covered | “Reset failure reports `restoration-failed` and the refreshed ref still resolves to the complete attempted state.” | diff-local |
| criterion | Story 3 negative: Given an operator explicitly clears the park and re-dispatches the feature, when setup still fails, then the existing one-fix-session-per-rotation rule permits at most one new attempt; the automatic scans before that operator action do not count as a new rotation. | task-14 | covered | “After a rejected repair parks, repeated backlog discovery dispatches zero new fix sessions until unpark; after unpark, at most one new attempt runs before a fresh park.” | diff-local |
| criterion | Story 4 happy: Given a fix-session reaches a terminal outcome, when triage completes, then exactly one `setup_repair` event is emitted with one closed disposition — `engine-committed`, `accepted-existing-commit`, `verified-no-tree-change`, or `rejected` — and a rejected event carries one closed rejection reason plus its quarantine ref when preservation succeeded. | task-12, task-13 | covered | “Add one settlement helper used by every post-dispatch return; accept an optional injected feature emitter and emit `verified-no-tree-change`, `accepted-existing-commit`, or `engine-committed`.” | diff-local |
| criterion | Story 4 happy: Given that event is emitted on a daemon feature run, when the existing sinks consume it, then the same disposition is persisted in the feature's `events.jsonl` and rendered once in the daemon log; a rejected HALT additionally names the rejection reason, quarantine ref, and preserved paths (or explicitly names the preservation failure). | task-1, task-2, task-14 | covered | “The production call structurally passes its feature-scoped emitter, and one emitted event yields exactly one `events.jsonl` record plus one rendered daemon line.” | diff-local |
| criterion | Story 4 negative: Given the provider dispatch throws before changing the tree, when triage parks, then exactly one rejected event names `provider-failure`, no quarantine ref is invented, and the HALT explicitly states that no repair state was preserved because none was produced. | task-13, task-15 | covered | “Route every attempted-session rejection through the settlement helper; attach a quarantine ref and paths only after current-attempt preservation succeeds, and emit `provider-failure` without an invented ref when dispatch throws before changing state.” | diff-local |
| criterion | Story 4 negative: Given ordinary setup succeeds or setup triage resolves before the fix-session stage, when daemon dispatch proceeds, then no `setup_repair` event is emitted; the new signal does not add noise to unaffected setup paths. | task-14 | covered | “a terminal event reaches a real `EventPersister` and renderer once, and ordinary setup/stage-1-only recovery produces no `setup_repair` record.” | diff-local |
| criterion | Story 4 negative: Given a terminal repair event is declared, when type-check and event-sink contract tests run, then omission from the exhaustive sink registry or from the renderer/persister path fails verification rather than silently dropping the event. | task-1, task-2, task-14 | covered | “Verify GREEN, including that deleting the sink entry produces the compile-time missing-key failure supplied by `Record<ConductorEvent['type'], SinkDeclaration>`.” | diff-local |

## Consistency pass

- **Outcome ↔ task:** not applicable because no intake outcome bullet exists.
- **FR ↔ story:** not applicable on the technical track.
- **ADR ↔ story:** covered in both directions. Fully implementing any story preserves the amended
  ADR's exact tree, forward-history, preserve-before-reset, one-session, and event-spine contracts;
  no story requires a state another story or the ADR forbids.
- **Story ↔ task:** covered in both directions. Success tasks accept only mechanically verified
  states; rejection tasks preserve before restore and never claim success; event tasks observe the
  same terminal state instead of creating a parallel state channel.
- **Oscillation check:** none found. In particular, Story 1's engine-owned commit path and Story 2's
  no-extra-commit compatibility paths are disjoint by HEAD/tree shape, while Story 3's recovery
  actions occur only after those success shapes are rejected.
