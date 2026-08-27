# Coherence Mapping: decide the daemon→engine rename before the v1.0 tag

Technical track (no PRD — `fr` row class omitted). Outcomes from the staged intake outcomes for
jstoup111/ai-conductor#227. Criterion-row quotes are verbatim substrings of the cited task's body;
disposition `diff-local` means the criterion is decided entirely by this feature's own diff.

| Row class | Cited id / criterion | Counterpart / task id(s) | Verdict | Notes / verbatim quote | Disposition |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-2 | covered | Decision recorded as APPROVED ADR adr-2026-08-26-music-vocabulary-player-composer-rename (option a chosen); story-2 records its posture and sequencing verbatim |
| outcome | outcome-2 | story-1, story-2 | covered | Scope enumerated (story-1) and bound to the #226 major (story-2 sequencing criterion) |
| outcome | outcome-3 | story-2 | covered | Conditional branch not taken: decision (a) rename was chosen per the ADR, so the re-defer record is vacuously satisfied; story-2 still records what proceeds before the v1.0 tag |
| outcome | outcome-4 | story-2 | covered | Sequencing recorded before the v1.0 tag; #227 closes via the implementation PR per intake flow |
| story | story-1 | task-1, task-2, task-3 | covered | Each task's Story line cites 1; confirmed in plan task tree |
| story | story-2 | task-4, task-5 | covered | Each task's Story line cites 2; confirmed in plan task tree |
| task | task-1 | story-1 | covered | Story line cites 1 |
| task | task-2 | story-1 | covered | Story line cites 1 |
| task | task-3 | story-1 | covered | Story line cites 1 |
| task | task-4 | story-2 | covered | Story line cites 2 |
| task | task-5 | story-2 | covered | Story line cites 2 |
| adr | adr-2026-08-26-music-vocabulary-player-composer-rename | story-1, story-2 | covered | Stories derive directly from ADR decisions 2, 3, 7; no opposing text found in either direction |
| criterion | Story 1 happy: Given the approved ADR, when the scope document at `docs/contributing/music-vocabulary-rename-scope.md` is read, then it enumerates each of the five surface classes — CLI subtree (`conduct daemon …` subcommands by name), engineer CLI/skill surface, config keys, `.daemon/` state-directory contents needing migration or dual-read, and the affected docs/skills file list — each with the shell command that re-derives it. | task-1, task-2, task-3 | covered | list every `conduct daemon` subcommand by name | diff-local |
| criterion | Story 1 happy: Given the scope document, when each listed re-derivation command is run at the document's recorded commit, then its output matches the counts and names the document records. | task-1 | covered | a runnable derivation command whose output at the base commit matches the listed names | diff-local |
| criterion | Story 1 happy: Given the scope document, when the live-state section is read, then every entry currently present under `.daemon/` (pid file, logs, grants, parked-restore lists, blocked/gated state, evals-raw) is classified as migrate, dual-read, or leave-in-place with a one-line reason. | task-2 | covered | classify each as migrate, dual-read, or leave-in-place with a one-line reason | diff-local |
| criterion | Story 1 negative: Given a surface class named in ADR decision 2, when the scope document lacks a section for it, then the feature's own verification checklist in the document fails that class by name and the document states it is incomplete rather than presenting partial coverage as total. | task-4 | covered | a missing surface class fails the checklist by name | diff-local |
| criterion | Story 1 negative: Given a re-derivation command whose current output no longer matches the recorded enumeration, when the document's recorded commit differs from HEAD, then the document's staleness note instructs re-running the commands rather than trusting the recorded counts. | task-1 | covered | must be re-derived by re-running the recorded commands if HEAD differs | diff-local |
| criterion | Story 1 negative: Given the event spine, when the scope document is read, then `ConductorEvent` identifiers are explicitly listed as out of scope citing the ADR's verified zero-count, so a later reader cannot infer they were forgotten. | task-3 | covered | state that `ConductorEvent` identifiers do not rename | diff-local |
| criterion | Story 2 happy: Given the scope document, when its migration section is read, then it contains a draft runnable `## Migration` fence covering config-key rename and state-directory migration, ready to travel in the #226-major PR body per the release-gate contract. | task-4 | covered | a runnable fenced bash migration block covering config-key rename mapping and state-directory migration | diff-local |
| criterion | Story 2 happy: Given the scope document, when its alias section is read, then it states the posture verbatim from the ADR: old `daemon`/`engineer` command names forward to the new names with a deprecation warning, and alias removal is deferred to a later major. | task-5 | covered | alias removal deferred to a later major | diff-local |
| criterion | Story 2 happy: Given the sequencing constraint, when the document's sequencing section is read, then it states the rename implementation lands inside the #226 major train and records the cli.ts overlap with the #552 spec branches as the reason. | task-5 | covered | record the cli.ts overlap with the #552 spec branches as the reason | diff-local |
| criterion | Story 2 negative: Given a breaking surface enumerated in Story 1, when the draft migration fence does not cover it, then the document's coverage checklist marks that surface uncovered by name instead of omitting it silently. | task-4 | covered | explicitly named as uncovered | diff-local |
| criterion | Story 2 negative: Given a reader looking for the verdict vocabulary (attacca/fermata and the wider table), when they read the document, then it states that work is out of scope and deferred to #1918, so the migration draft is not extended to cover it. | task-5 | covered | states the migration draft does not cover verdict vocabulary | diff-local |
