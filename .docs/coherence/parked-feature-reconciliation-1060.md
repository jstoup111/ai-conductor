# Coherence: Parked-Feature Reconciliation Sweep (#1060)

Plan stem: `parked-feature-reconciliation-1060`. Tier M, technical track — `fr` row class omitted (no PRD). Outcome row class omitted (no staged intake-outcome bullets in this worktree; the intake issue's desired outcomes are traced narratively in the conflict report and ADR). Story ids `S1`–`S7` are the `## Story <id>:` headings in the stories file; task ids `1`–`17` are the plan's task tree.

| Row class | Id | Counterpart id(s) | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| story | story-S1 | task-9, task-10 | covered | Tasks 9 (outcome cache/summary suppression) and 10 (daemon dep + sweepBestEffort wiring) cite S1 |
| story | story-S2 | task-4, task-5, task-16 | covered | Tasks 4 (record-on-main), 5 (in-flight guard), 16 (end-to-end acceptance) cite S2 |
| story | story-S3 | task-1, task-11 | covered | Tasks 1 (config key) and 11 (toggle-gated binding) cite S3 |
| story | story-S4 | task-2, task-3, task-6, task-15 | covered | Tasks 2 (slug validation), 3 (ancestry re-verify), 6 (cleanup ordering), 15 (audit re-scope) cite S4 |
| story | story-S5 | task-13, task-14 | covered | Tasks 13 (verb) and 14 (bin/conduct registration) cite S5 |
| story | story-S6 | task-7, task-12, task-17 | covered | Tasks 7 (classification), 12 (dashboard), 17 (orphan acceptance) cite S6 |
| story | story-S7 | task-8 | covered | Task 8 (fail-closed external failures) cites S7 |
| task | task-1 | story-S3 | covered | Config key serving the S3 toggle |
| task | task-2 | story-S4 | covered | Helper skeleton + strict single-slug validation |
| task | task-3 | story-S4 | covered | Internal ancestry re-verification |
| task | task-4 | story-S2 | covered | Record-on-main precondition + ST-916 delegation |
| task | task-5 | story-S2 | covered | In-flight run guard |
| task | task-6 | story-S4 | covered | Cleanup ordering, unpark last, partial-failure reporting |
| task | task-7 | story-S6 | covered | Merged/orphan/normal/unclassified classification |
| task | task-8 | story-S7 | covered | Fail-closed external-failure behavior |
| task | task-9 | story-S1 | covered | Outcome cache and summary suppression |
| task | task-10 | story-S1 | covered | Daemon dep declaration + sweepBestEffort call |
| task | task-11 | story-S3 | covered | daemon-cli binding gated by the toggle |
| task | task-12 | story-S6 | covered | Dashboard annotations |
| task | task-13 | story-S5 | covered | Operator verb reconcile-parked |
| task | task-14 | story-S5 | covered | bin/conduct known-subcommand registration |
| task | task-15 | story-S4 | covered | Single-writer audit re-scope per amended FR-7 |
| task | task-16 | story-S2 | covered | Acceptance: end-to-end reconciliation flows |
| task | task-17 | story-S6 | covered | Acceptance: orphan surfacing fail-closed |

All rows covered; zero gaps. Verdicts confirmed against the stories and plan files in this worktree.
