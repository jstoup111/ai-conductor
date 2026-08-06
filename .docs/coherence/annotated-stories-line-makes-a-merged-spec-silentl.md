# Coherence: Blocked merged specs are visible, never skipped

Plan stem: `annotated-stories-line-makes-a-merged-spec-silentl`. Tier M, product track, so the
`fr` row class is present. The four outcome ids are the intake issue's Desired-outcome
bullets. FR-14 and FR-15 (the land refusal names the accepted forms, and `/plan` documents
them) are the operator's DECIDE-time addition — blocking new broken references at authoring
time as well as surfacing merged ones — and are traced through the FR, story, and task rows
rather than a fifth outcome. Outcome 4 is satisfied through `conduct-ts daemon status` only:
startup-dashboard rendering was cut from this change and is tracked by #1332.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | FR-1, FR-2, FR-3, FR-4, story-1 | covered | An annotated Stories line resolves to its path; every prior shape and refusal is pinned, so a resolving spec reaches dispatch. |
| outcome | outcome-2 | FR-5, FR-6, FR-7, FR-8, FR-9, story-2, story-3 | covered | Every content decline emits a structured blocked entry plus a warn-once line; the four existing log lines keep their wording. |
| outcome | outcome-3 | FR-3, FR-5, FR-6, FR-14, story-1, story-5 | covered | An unresolvable reference is still refused, and is now stated aloud by discovery and by the land gate. |
| outcome | outcome-4 | FR-10, FR-11, FR-12, FR-13, story-4 | covered | A per-pass snapshot plus an offline `daemon status` section with an explicit unknown state answers the question from status alone. |
| fr | FR-1 | story-1, task-1 | covered | Task 1 adds normalization; Story 1 happy paths cover all four annotated shapes. |
| fr | FR-2 | story-1, task-2 | covered | Task 2's table pins the three unannotated shapes against regression. |
| fr | FR-3 | story-1, task-2 | covered | Absolute, Windows, traversal, non-Markdown, and empty references stay refused. |
| fr | FR-4 | story-1, task-2 | covered | The no-Stories-line same-stem fallback is asserted unchanged. |
| fr | FR-5 | story-2, task-4, task-6, task-7 | covered | The typed channel plus both classification tasks replace every silent and log-only decline. |
| fr | FR-6 | story-2, task-4, task-6, task-7 | covered | Five reasons are typed and each is asserted by a test. |
| fr | FR-7 | story-3, task-5, task-8 | covered | Dedup precedes classification; the parked exclusion is asserted in discovery. |
| fr | FR-8 | story-3, task-8 | covered | Task 8 asserts the eligible set is unchanged apart from newly-resolvable plans. |
| fr | FR-9 | story-2, task-6, task-7 | covered | Existing lines asserted verbatim; two new lines added under the same warn-once dedup. |
| fr | FR-10 | story-4, task-9 | covered | Whole-file atomic rewrite per pass, asserted to replace rather than merge. |
| fr | FR-11 | story-4, task-10 | covered | The status section lists slug, reason, and remedy per repository. |
| fr | FR-12 | story-4, task-11 | covered | Missing and unparseable snapshots both render an explicit unknown state. |
| fr | FR-13 | story-4, task-10 | covered | The status test injects the repository root and asserts no git or network boundary is used. |
| fr | FR-14 | story-5, task-12, task-13 | covered | The refusal is retained; its message names the accepted forms; unrelated and traversal targets still fail. |
| fr | FR-15 | story-5, task-13 | covered | The /plan skill documents the accepted forms. |
| story | story-1 | task-1, task-2, task-12 | covered | Normalization, the refusal table, and the shared-resolver land assertion. |
| story | story-2 | task-3, task-4, task-6, task-7 | covered | Outcome split, channel typing, and both classification tasks. |
| story | story-3 | task-5, task-8 | covered | Gauntlet reorder plus the visibility-only and dedup-suppression proofs. |
| story | story-4 | task-9, task-10, task-11 | covered | Snapshot write, status section, and the fail-soft negative paths. |
| story | story-5 | task-12, task-13 | covered | Land message plus skill and documentation updates. |
| task | task-1 | story-1, FR-1 | covered | Adds the normalization step the annotated shapes need. |
| task | task-2 | story-1, FR-2, FR-3, FR-4 | covered | Pins every refusal and unannotated shape against the relaxation. |
| task | task-3 | story-2, FR-6 | covered | Separates unresolvable from missing so the remedies can differ. |
| task | task-4 | story-2, FR-5, FR-6 | covered | Types the blocked channel and its five reasons. |
| task | task-5 | story-3, FR-7 | covered | Reorders dedup ahead of classification. |
| task | task-6 | story-2, FR-5, FR-9 | covered | Replaces the silent continue with a blocked entry and a log line. |
| task | task-7 | story-2, FR-5, FR-9 | covered | Classifies the three existing content skips without altering their log wording. |
| task | task-8 | story-3, FR-8 | covered | Proves the change adds, removes, and reorders no buildable spec. |
| task | task-9 | story-4, FR-10 | covered | Persists the snapshot with replace-not-merge semantics. |
| task | task-10 | story-4, FR-11, FR-13 | covered | Renders the offline status section with a freshness label. |
| task | task-11 | story-4, FR-12 | covered | Makes unknown distinguishable from zero and both failures non-fatal. |
| task | task-12 | story-5, FR-14 | covered | Lands the annotated form and names the accepted forms on refusal. |
| task | task-13 | story-5, FR-14, FR-15 | covered | Documents the contract across the skill, guide, reference, and runbook. |

All 37 applicable rows are covered; zero gaps. Verdicts were checked against the approved PRD,
the accepted stories, and the 13-task plan in this worktree.
