# Coherence Mapping: Project teardown hook before worktree removal

**Date:** 2026-08-07
**Tier:** M (`.docs/complexity/bin-teardown-run-a-project-supplied-teardown-hook-.md`)
**Track:** product

Every id below was confirmed against the counterpart artifact file by reading its actual headings
— `## Story N:` in the stories file and `### Task N:` in the plan — not inferred from the plan's
own Coverage Mapping table. That table was cross-checked and found accurate, with no drift.

**Outcome row class omitted:** this idea originated in chat, not from a GitHub intake issue, so
there is no staged or committed outcome bullet list. Omission is correct here, not a gap.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-1 | covered | Story 1 cites FR-1; its happy path asserts teardown runs while worktree files are still readable. |
| fr | fr-2 | story-1 | covered | Story 1 asserts CI, WORKTREE_NAMESPACE and cwd match the setup contract. |
| fr | fr-3 | story-2 | covered | Story 2 asserts the namespace survives a deleted .pipeline/ and .env, and that no new persisted artifact exists. |
| fr | fr-4 | story-3 | covered | Story 3 asserts zero log lines in default and verbose modes when no teardown script exists. |
| fr | fr-5 | story-1, story-4, story-5, story-6 | covered | The three in-scope invitation points plus the retention exclusion that bounds the set. |
| fr | fr-6 | story-7 | covered | Story 7 asserts removal proceeds and the enclosing outcome is unchanged on every failure branch. |
| fr | fr-7 | story-8 | covered | Story 8 asserts the bound is applied, configurable, and never disableable. |
| fr | fr-8 | story-7 | covered | Story 7 asserts one failure entry carrying the worktree path and a bounded output tail. |
| fr | fr-9 | story-9 | covered | Story 9 asserts one summary line by default, full echo when verbose, no line for empty output. |
| fr | fr-10 | story-10 | covered | Story 10 asserts the guard passes as shipped and fails on an unclassified or de-wired path. |
| fr | fr-11 | story-11 | covered | Story 11 asserts all four registry entries with non-empty reasons and the distinct deferred-leak reason. |
| fr | fr-12 |  | gap | fr-12 — maintainer documentation. Deliberate: the stories and plan skills both forbid storying or planning documentation. This repository instead wires maintain-documentation as a gating step (.ai-conductor/config.yml:114, after rebase, completion artifact .pipeline/maintain-documentation-pass), which enforces CLAUDE.md's same-PR documentation rule. Recorded as a gap rather than a fabricated citation; waived in .docs/coherence-waivers/bin-teardown-run-a-project-supplied-teardown-hook-.md |
| story | story-1 | task-2, task-9 | covered | Task 2 lands the environment contract; task 9 wires the reap path and asserts teardown precedes removal. |
| story | story-2 | task-3 | covered | Task 3 derives the namespace from the path and tests the missing-state and sanitization cases. |
| story | story-3 | task-1 | covered | Task 1 lands the runner skeleton with the deliberately silent absent-script path. |
| story | story-4 | task-10 | covered | Task 10 proves zero invocations for keep true at both the daemon-deps and daemon-runner levels. |
| story | story-5 | task-11, task-12 | covered | Task 11 wires the reclaim path; task 12 covers the refusal branches and exit-status invariance. |
| story | story-6 | task-13, task-14 | covered | Task 13 places the single invitation; task 14 drives the fallback branch and refusal preservation. |
| story | story-7 | task-5, task-6 | covered | Task 5 contains non-zero exits with an output tail; task 6 contains spawn failures. |
| story | story-8 | task-7, task-8 | covered | Task 7 lands the config resolver; task 8 applies the bound and reports timeouts. |
| story | story-9 | task-4 | covered | Task 4 covers summarization, verbose echo, and the empty and blank-output cases. |
| story | story-10 | task-15, task-16 | covered | Task 15 lands the AST detector; task 16 covers unclassified, de-wired and self-exclusion failures. |
| story | story-11 | task-17, task-18 | covered | Task 17 ships the four-entry registry; task 18 covers empty, stale and flattened reasons. |
| task | task-1 | story-3 | covered | Runner skeleton with the silent absent-script path. |
| task | task-2 | story-1 | covered | Execution environment matches the setup contract. |
| task | task-3 | story-2 | covered | Namespace derived from the path, no persisted state. |
| task | task-4 | story-9 | covered | Successful output summarized, echoed only when verbose. |
| task | task-5 | story-7 | covered | Non-zero exit contained and reported with an output tail. |
| task | task-6 | story-7 | covered | Spawn failures contained identically. |
| task | task-7 | story-8 | covered | Typed infrastructure, but cites a real story id, so the supporting-purpose exemption is not needed. |
| task | task-8 | story-8 | covered | Applies the bound and reports a timeout. |
| task | task-9 | story-1 | covered | Invites teardown on the daemon reap path, after the keep guard. |
| task | task-10 | story-4 | covered | Proves a retained worktree never runs teardown. |
| task | task-11 | story-5 | covered | Invites teardown on the operator reclaim path. |
| task | task-12 | story-5 | covered | Refused and empty reclaims never spawn teardown. |
| task | task-13 | story-6 | covered | Invites teardown once on the reconciliation path. |
| task | task-14 | story-6 | covered | Fallback branch covered and refusals preserved. |
| task | task-15 | story-10 | covered | Typed infrastructure, but cites a real story id. |
| task | task-16 | story-10 | covered | Guard fails an unclassified or de-wired removal path. |
| task | task-17 | story-11 | covered | Ships the exemption registry. |
| task | task-18 | story-11 | covered | Registry entries cannot rot or flatten. |

## Summary

- **FR rows:** 12 — 11 covered, 1 gap (`fr-12`, waived).
- **Story rows:** 11 — all covered. Every story is cited by at least one task.
- **Task rows:** 18 — all covered. Every task cites exactly one real story id; no task relies on
  the supporting-purpose exemption.
- **Plan Coverage Mapping drift:** none.
