# Coherence Mapping: Remove retrospectives (full and micro) from feature delivery

Feature: remove-retrospectives-full-and-micro-from-feature- (#1905). Tier L, technical track
(no PRD — the fr row class is omitted). Outcome ids are 1-based over the staged intake bullets.
Criterion rows carry the extractor-exact criterion text, cited task, verdict, a verbatim quote
from the cited task's body, and the diff-locality disposition. The three Story 6 criteria are
`outside-diff` (their subject is GitHub issue state, mutated by `gh` at finish, not by this
feature's diff) and are waived in `.docs/coherence-waivers/remove-retrospectives-full-and-micro-from-feature-.md`.

| Row class | Cited id / criterion | Counterpart / cited task id(s) | Verdict | Notes / quote | Disposition |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-2, story-4 | covered | Retro-free completion in every tier, run mode, provider: signal path (Story 2) + delivery/config surface (Story 4) |
| outcome | outcome-2 | story-3 | covered | Batch boundaries: no micro-retro work, artifact, or closeout signal |
| outcome | outcome-3 | story-1 | covered | SHIP tail reaches rebase and finish without a retro prerequisite or synthetic skip |
| outcome | outcome-4 | story-5 | covered | Skills, config, templates, docs describe surviving behavior only |
| outcome | outcome-5 | story-1, story-3 | covered | Non-retro gate ordering and fail-closed enforcement preserved |
| outcome | outcome-6 | story-6 | covered | #717 and #939 closed or re-scoped |
| story | story-1 | task-2, task-7 | covered | Registry rewire + end-to-end tail pin |
| story | story-2 | task-1, task-6 | covered | Survivor characterization + narrative provider path deletion |
| story | story-3 | task-9 | covered | Lockstep obligation removal with CLI rejection and roster tests |
| story | story-4 | task-3, task-4, task-5, task-8, task-10, task-12 | covered | Records, runtime lists, skip branch, fail-by-name, suite triage, legacy CLI |
| story | story-5 | task-11, task-13, task-14 | covered | Skill surface, comment surfaces, completeness sweep |
| story | story-6 | task-15 | covered | External issue reconciliation at finish |
| task | task-1 | story-2 | covered | Verify-only survivor characterization |
| task | task-2 | story-1 | covered | Atomic union deletion + rebase rewire |
| task | task-3 | story-4 | covered | Compiler-enumerated record fallout |
| task | task-4 | story-4 | covered | Hand-written runtime step lists |
| task | task-5 | story-4 | covered | Daemon-mode skip branch deletion |
| task | task-6 | story-2 | covered | Narrative provider path deletion |
| task | task-7 | story-1 | covered | SHIP tail gate tests |
| task | task-8 | story-4 | covered | Fail-by-name negative tests |
| task | task-9 | story-3 | covered | micro-retro lockstep removal |
| task | task-10 | story-4 | covered | DIRECT/INCIDENTAL test triage |
| task | task-11 | story-5 | covered | Atomic skill-surface deletion (integrity checks 4/5a) |
| task | task-12 | story-4 | covered | Legacy bin/conduct removal |
| task | task-13 | story-5 | covered | Generated-hook and comment surfaces |
| task | task-14 | story-5 | covered | Completeness sweep with closed justification set |
| task | task-15 | story-6 | covered | Issue reconciliation via gh at finish |
| adr | adr-2026-08-26-remove-retrospectives-one-shot | story-1, story-2, story-3, story-4, story-5, story-6 | covered | The governing removal decision; every story implements one of its numbered clauses |
| adr | adr-002-engineer-store-and-retro-redirect | story-2 | covered | Superseded in part; Story 2 preserves the surviving store-format half and halt path |
| adr | adr-006-flywheel-lesson-selection-and-provenance | story-2 | covered | Amended: digest narrative channel shrinks to halt narratives; structured signal unchanged |
| adr | adr-2026-07-07-audit-trail-event-sink | story-5 | covered | Amended: retro skill consumer removed; sink machinery untouched by any task |
| adr | adr-2026-07-10-session-hook-task-stamping | story-5 | covered | Amended: micro-retro leaves the dispatch-template enumeration; binding rule intact |
| adr | adr-2026-07-22-phase-scoped-docs-write-guard | story-4 | covered | Amended: per-step allowlist empties (task-4); mechanism stands |
| adr | adr-2026-07-26-rebase-tail-current-branch-before-publication | story-1 | covered | Amended: edge re-pointed; serial fence preserved and pinned by task-7 |
| adr | adr-2026-08-08-pipeline-owned-closeout-timestamps | story-3 | covered | Amended: obligation roster shrinks in lockstep (task-9); fail-closed gate preserved |
| criterion | Story 1 happy: Given a non-S feature whose `architecture_review_as_built` step is `done` with a satisfied verdict, when the engine evaluates the SHIP tail, then `rebase` is runnable and, once `rebase` is `done`, `finish` becomes runnable. | task-7 | covered | "with `architecture_review_as_built` done+satisfied, `rebase` is runnable, then `finish`" | diff-local |
| criterion | Story 1 happy: Given a completed daemon run, when its executed step sequence is inspected, then the SHIP tail is exactly `architecture_review_as_built`, `rebase`, `finish` in that order. | task-7 | covered | "shows the SHIP tail as exactly architecture_review_as_built, rebase, finish" | diff-local |
| criterion | Story 1 negative: Given a feature whose `architecture_review_as_built` step is not satisfied, when the engine evaluates `rebase`, then `rebase` stays gate-blocked (the #922 serial-publication fence still holds). | task-7 | covered | "with it unsatisfied, `rebase` stays gate-blocked" | diff-local |
| criterion | Story 1 negative: Given a validation-group member fails its join, when the SHIP tail is evaluated, then `rebase` does not dispatch and the existing gate_blocked behavior is unchanged. | task-7 | covered | "a failed validation-group join still blocks `rebase`" | diff-local |
| criterion | Story 2 happy: Given a daemon feature completes `done` in any tier, when the engineer signal is emitted, then a valid store record is appended with `narrativeRef` absent and the injected provider adapter records zero invocations. | task-6 | covered | "done → zero provider invocations, `narrativeRef` absent" | diff-local |
| criterion | Story 2 happy: Given a daemon feature halts, when the engineer signal is emitted, then the halt narrative file is written and referenced by `narrativeRef` with zero provider invocations (survivor: `renderHaltNarrative`). | task-6 | covered | "halted → halt narrative referenced" | diff-local |
| criterion | Story 2 negative: Given the engineer store is unwritable, when signal emission runs, then the failure is reported best-effort without failing the completed run (existing behavior preserved). | task-1 | covered | "store-write failure is reported without failing the run" | diff-local |
| criterion | Story 2 negative: Given a malformed existing signal line, when the store is read, then the reader skips it resiliently (existing 9.1 convention preserved). | task-1 | covered | "malformed signal lines are skipped on read" | diff-local |
| criterion | Story 3 happy: Given a BUILD batch completes with all surviving closeout obligations recorded, when the batch-boundary gate evaluates, then the batch passes without any micro-retro event present. | task-9 | covered | "Batch-gate roster test passes on the surviving set" | diff-local |
| criterion | Story 3 happy: Given a build-tail rollup renders, when its obligations are listed, then only surviving obligations appear and durations aggregate correctly. | task-9 | covered | "rollup/build-tail rendering aggregates the surviving set" | diff-local |
| criterion | Story 3 negative: Given `conduct-ts closeout-event micro-retro <start> <end>` is invoked, when the obligation is validated, then the command exits non-zero naming the unknown obligation (surviving allowlist validation). | task-9 | covered | "exits non-zero naming the unknown obligation" | diff-local |
| criterion | Story 3 negative: Given a surviving obligation's event is missing, when the batch gate evaluates, then the batch still fails closed on that obligation (adr-2026-08-08 enforcement preserved). | task-9 | covered | "a missing surviving obligation still fails closed" | diff-local |
| criterion | Story 4 happy: Given an S, M, or L feature in daemon or manual mode under any supported provider, when delivery runs to completion verification, then it completes with no step dispatch for a retrospective and no new file under `.docs/retros/`. | task-10 | covered | "Full conductor suite green" | diff-local |
| criterion | Story 4 happy: Given the interactive one-shot step list and SHIP-gating re-verification list, when they are exercised, then they operate over the surviving steps only. | task-4 | covered | "interactive one-shot dispatch and stale-complete re-verification operate over the surviving steps" | diff-local |
| criterion | Story 4 negative: Given a consumer `settings.json` carrying a `steps.retro.*` key, when config resolves, then resolution fails by name identifying the unknown step (accepted breaking behavior per the ADR waiver). | task-8 | covered | "config carrying a `steps.retro` key fails resolution naming the unknown step" | diff-local |
| criterion | Story 4 negative: Given a live worktree whose `conduct-state.json` records a retro step status, when the engine loads that state, then it fails by name rather than silently stalling (no permanently-pending gate). | task-8 | covered | "loading a `conduct-state.json` recording a retro step status fails by name" | diff-local |
| criterion | Story 5 happy: Given the harness repo after the change, when `test/test_harness_integrity.sh` runs, then all checks pass, including cross-skill reference check 4 and model-table drift check 5a against the regenerated HARNESS.md. | task-11 | covered | "test/test_harness_integrity.sh fully green (checks 4 and 5a included)" | diff-local |
| criterion | Story 5 happy: Given the docs reference pages for steps, skills, models, artifacts, and CLI, when they are read, then they describe the surviving step graph, skill catalog, and obligation roster consistently. | task-14 | covered | "Enumerate remaining docs/ page hits for the documentation-upkeep pass riding this PR" | diff-local |
| criterion | Story 5 negative: Given a literal-name completeness sweep for retro symbols and paths across source, skills, docs, templates, and tests (accounting for the ugrep binary-skip caveat), when hits are reviewed, then every remaining hit is a historical record or an explicitly justified survivor listed in the plan's sweep task. | task-14 | covered | "every surviving hit carries a justification from the closed set above" | diff-local |
| criterion | Story 5 negative: Given `test/test_provider_skill_contracts.sh` runs, when the skill audit iterates, then it passes over the surviving skill set. | task-11 | covered | "test/test_provider_skill_contracts.sh green over the surviving skill set" | diff-local |
| criterion | Story 6 happy: Given issue #717, when the removal lands, then #717 is closed with a comment citing #1905 and the removal ADR as the obsoleting decision. | task-15 | covered | "The PR body carries the `Closes` line for #717 with the obsoleting rationale" | outside-diff |
| criterion | Story 6 happy: Given issue #939, when the removal lands, then #939 carries a re-scoping comment reducing it to its surviving general clause (post-BUILD story lifecycle disposition) or is closed if the operator judges the clause moot. | task-15 | covered | "#939 carries the re-scoping comment" | outside-diff |
| criterion | Story 6 negative: Given the residual accepted story file `.docs/stories/retro-followups-per-step-provider-routing-927.md`, when open work is reconciled, then its disposition (implemented, obsolete, or re-homed) is recorded in the #939 comment rather than left implicit. | task-15 | covered | "record the disposition of the 927 retro-followups residual story" | outside-diff |
