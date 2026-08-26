# Coherence Mapping: hard-delete-the-retired-wiring-check-step-name-fro

Tier M, technical track (no PRD — fr row class omitted). Outcomes from the staged intake bullets
(jstoup111/ai-conductor#1896); outcome-4 was operator-amended 2026-08-26 in the staged bullets
(ordinary unknown-key fail path, superseding the filed visible-signal outcome). ADR rows: the two
non-deleted amended ADRs in this change set. Consistency pass (§4d) run over every covered row —
the outcome-6/story-5 cross-layer pair (fail-closed typo guard vs lenient historical reads) was
checked in both directions: distinct surfaces (operator-supplied names vs engine-written history),
no contradiction or oscillation.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | No step listing, dashboard, model table, or step-keyed config surface presents the step; Story 1 owns the surfaces, Story 2 the pipeline shape. |
| outcome | outcome-2 | story-2 | covered | BUILD verification fans out only branches that perform work — test_suite alone gates build_review. |
| outcome | outcome-3 | story-5 | covered | Pre-deletion conduct-state resumes without a step-resolution error; recorded statuses for the removed step are ignored. |
| outcome | outcome-4 | story-6 | covered | Operator-amended bullet: leftover config key fails load through the ordinary unknown-step path, same shape as any typo. |
| outcome | outcome-5 | story-5 | covered | Historical gate verdicts, ledger entries, and parallel events naming the step remain readable. |
| outcome | outcome-6 | story-1, story-6 | covered | Typo guard not weakened: operator-supplied unknown names fail by name (Story 1 negative), and any undeclared config step fails identically (Story 6 negative). |
| adr | adr-2026-08-14-retire-build-review-wiring-rubric | story-1 | covered | The 2026-08-26 amendment lifts its deletion prohibition; Story 1 delivers the deletion the amendment authorizes. |
| adr | adr-2026-07-29-deterministic-build-verification-fanout | story-2, story-3, story-4 | covered | The 2026-08-26 amendment dissolves the group; Stories 2–4 preserve its surviving binding semantics (gating, failure classification/budget, post-repair re-verification). |
| story | story-1 | task-1, task-2, task-4, task-5, task-12 | covered | Engine excision, orphaned deprecated machinery, test sweep, model-table regeneration, fail-by-name. |
| story | story-2 | task-13 | covered | Surviving BUILD topology pinned end to end. |
| story | story-3 | task-7, task-8 | covered | Deterministic classification/budget and the infrastructure-failure class. |
| story | story-4 | task-6 | covered | Post-repair re-verification with reuse refusal. |
| story | story-5 | task-3, task-9, task-10 | covered | Rebase invalidation set, historical fixture loads, legacy event rendering. |
| story | story-6 | task-11 | covered | Ordinary custom-step config failure, both for the retired name and any undeclared step. |
| task | task-1 | story-1 | covered | Atomic compile-coupled deletion across all engine sites. |
| task | task-2 | story-1 | covered | Deprecated field, deprecated_step event, and sink key deleted together. |
| task | task-3 | story-5 | covered | Rebase invalidation set names only surviving steps. |
| task | task-4 | story-1 | covered | Test sweep to the test_suite-only topology; historical fixtures retained for task-9. |
| task | task-5 | story-1 | covered | Model table regenerated; integrity check 5a green. |
| task | task-6 | story-4 | covered | Serial-path post-repair re-verification (condition C1). |
| task | task-7 | story-3 | covered | Serial-path gate-repair record + single budget charge + cap + reset-on-progress (condition C2). |
| task | task-8 | story-3 | covered | Infrastructure failure not charged as semantic kickback. |
| task | task-9 | story-5 | covered | Fixture-pinned historical loadability (condition C3). |
| task | task-10 | story-5 | covered | Legacy member event renders as labeled fallback. |
| task | task-11 | story-6 | covered | Leftover config block fails the ordinary custom-step way. |
| task | task-12 | story-1 | covered | rewind --to unknown step fails by name, mutating nothing. |
| task | task-13 | story-2 | covered | build → test_suite → build_review with zero group events. |
| criterion | Story 1 happy: Given the engine's step registry, when the ordered step list for a BUILD-phase feature is resolved, then every listed step dispatches work and `test_suite` is the sole deterministic BUILD verification step | task-1 | covered | "prerequisites are exactly `['test_suite']` and `STEP_GROUPS` contains only the SHIP validation group" | diff-local |
| criterion | Story 1 happy: Given the model-selection table generator, when `bin/generate-model-table` runs, then its output matches the committed HARNESS.md generated section and integrity check 5a passes | task-5 | covered | "`test/test_harness_integrity.sh` passes, including check 5a" | diff-local |
| criterion | Story 1 happy: Given the daemon dashboard/status rendering of a BUILD-phase feature, when steps are rendered, then only registry steps appear | task-1 | covered | "src/conductor/src/ui/dashboard-snapshot.ts" | diff-local |
| criterion | Story 1 negative: Given a CLI invocation naming a step absent from the registry (for example `conduct-ts rewind --to wiring_check`), when it executes, then it fails by name with an error identifying the unknown step, and no state is mutated | task-12 | covered | "state file bytes are unchanged after the refused rewind" | diff-local |
| criterion | Story 1 negative: Given the integrity suite, when a step-keyed metadata table retains an entry for a step absent from the registry, then the validation suite fails naming the drifted table | task-5 | covered | "fix any 5a/5b drift it names" | diff-local |
| criterion | Story 2 happy: Given a BUILD-phase feature whose `build` step completes, when verification runs, then `test_suite` executes and, on a green result, `build_review` becomes dispatchable | task-13 | covered | "build → test_suite → build_review ordering" | diff-local |
| criterion | Story 2 happy: Given a green `test_suite`, when `build_review` dispatches, then its prerequisite set is satisfied by `test_suite` alone | task-1 | covered | "prerequisites are exactly `['test_suite']`" | diff-local |
| criterion | Story 2 negative: Given a BUILD-phase feature, when `test_suite` fails deterministically, then `build_review` is not dispatched and no review tokens are spent | task-13 | covered | "failing suite yields no build_review dispatch" | diff-local |
| criterion | Story 2 negative: Given a BUILD-phase feature mid-verification, when the engine restarts, then resume re-enters at the correct step without emitting a `parallel_started` event for a BUILD verification group | task-13 | covered | "restart mid-verification resumes without error" | diff-local |
| criterion | Story 3 happy: Given a deterministic `test_suite` failure, when the engine processes it, then a gate-repair record is written for `test_suite` and the per-gate kickback budget is charged exactly once | task-7 | covered | "single budget charge + gate-repair record per deterministic failure" | diff-local |
| criterion | Story 3 happy: Given a `test_suite` failure followed by a fixing change, when verification re-runs and passes, then the feature proceeds and the kickback ledger reflects the reset-on-progress rule | task-7 | covered | "tree-changed re-run resets the count per the ledger's made-progress rule" | diff-local |
| criterion | Story 3 negative: Given repeated identical `test_suite` failures with no tree change, when the per-gate kickback cap is reached, then the run halts with the existing cap message naming `test_suite` | task-7 | covered | "existing per-gate cap halt naming `test_suite`" | diff-local |
| criterion | Story 3 negative: Given a `test_suite` infrastructure failure (suite could not run), when the engine processes it, then it is not charged as a semantic kickback and the failure class is preserved in the halt/event output | task-8 | covered | "carries the infrastructure failure class, not the deterministic-failure class" | diff-local |
| criterion | Story 4 happy: Given a feature whose `test_suite` completed green and whose build was then repaired, when verification resumes, then `test_suite` executes again against the repaired tree before `build_review` dispatches | task-6 | covered | "repair → test_suite re-runs → build_review only after green re-run" | diff-local |
| criterion | Story 4 negative: Given a repaired build whose re-run `test_suite` fails, when the engine processes it, then `build_review` is not dispatched and the failure is classified per Story 3 | task-6 | covered | "failing re-run blocks build_review dispatch" | diff-local |
| criterion | Story 4 negative: Given a repaired build, when the engine attempts to reuse the pre-repair `test_suite` evidence, then reuse is refused because the evidence is anchored to the pre-repair tree | task-6 | covered | "pre-repair test_suite evidence is not reused after a repair" | diff-local |
| criterion | Story 5 happy: Given a `conduct-state.json` recording `wiring_check: done` and `build_verification__wiring_check: done`, when the engine resumes the feature, then resume succeeds and the stale keys are ignored without error | task-9 | covered | "resume derives its index from the registry walk without error" | diff-local |
| criterion | Story 5 happy: Given a `.pipeline/kickback-ledger.json` containing a `gates.wiring_check` entry, when the ledger loads, then loading succeeds and other gates' entries are fully honored | task-9 | covered | "ledger loads with other gates honored" | diff-local |
| criterion | Story 5 happy: Given an `events.jsonl` containing `parallel_started` branches naming `wiring_check` and execution keys of the form `parallel:wiring_check`, when the event log is read (daemon log rendering, timing rollup), then reading succeeds and the entries render without crashing | task-9 | covered | "event log renders/rolls up without crashing" | diff-local |
| criterion | Story 5 happy: Given a historical `.pipeline/gates/wiring_check.json` verdict file, when verdicts are read, then the orphan verdict is inert and affects no gate decision | task-9 | covered | "orphan verdict file affects no gate decision" | diff-local |
| criterion | Story 5 negative: Given a `conduct-state.json` whose recorded `last_step` is `wiring_check`, when the feature resumes, then the resume index is derived from the registry walk and the run continues without an unknown-step throw | task-9 | covered | "`last_step: wiring_check`" | diff-local |
| criterion | Story 5 negative: Given a persisted `build_member_evidence_reused` event naming member `wiring_check`, when the daemon log renders it, then rendering degrades to a labeled unknown member rather than crashing | task-10 | covered | "legacy member value renders as the labeled fallback string" | diff-local |
| criterion | Story 6 happy: Given a consumer config with no `steps.wiring_check` block, when config loads, then resolution succeeds and no step-keyed default for a nonexistent step is applied | task-1 | covered | "default retries/review keys" | diff-local |
| criterion | Story 6 negative: Given a consumer `.ai-conductor/config.yml` with a `steps.wiring_check:` block, when config loads, then loading fails with the existing custom-step validation error naming `wiring_check`, and the process exits non-zero | task-11 | covered | "custom-step error naming `wiring_check`, non-zero load failure" | diff-local |
| criterion | Story 6 negative: Given a consumer config naming any other undeclared step, when config loads, then the identical failure shape applies — the typo guard is not weakened | task-11 | covered | "another undeclared step name fails with the same error shape" | diff-local |

No `gap` or `fail` rows. Every `covered` verdict was confirmed against the cited artifact files in
this worktree (`.docs/stories/hard-delete-the-retired-wiring-check-step-name-fro.md`,
`.docs/plans/hard-delete-the-retired-wiring-check-step-name-fro.md`, and the two amended ADRs).
