# Coherence: Restore conflict remediation for shipped pull requests

**Date:** 2026-07-30
**Tier:** M
**Plan stem:** `autoresolve-conflict-remediation-deadlock-737`

The staged intake file declares the source reference but contains no Desired-outcome bullets, so
the `outcome` row class is not required. Every verdict below was checked against the approved PRD,
accepted stories, and the actual task tree rather than inferred from the plan's summary table.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-1 | covered | Story 1 requires next-cycle remediation for an eligible shipped watched conflict. |
| fr | fr-2 | story-1 | covered | Story 1 explicitly permits retained completed-feature evidence. |
| fr | fr-3 | story-1 | covered | Story 1 excludes draft, terminal, missing, and unwatched pull requests. |
| fr | fr-4 | story-2 | covered | Story 2 requires repository-wide and same-branch serialization. |
| fr | fr-5 | story-2 | covered | Story 2 enumerates one observable conflict disposition per cycle. |
| fr | fr-6 | story-2 | covered | Story 2 keeps transient deferrals retryable without attempt burn or escalation. |
| fr | fr-7 | story-3 | covered | Story 3 makes terminal escalation actionable before it becomes sticky. |
| fr | fr-8 | story-3 | covered | Story 3 covers unchanged-cycle and partial-failure deduplication. |
| fr | fr-9 | story-4 | covered | Story 4 requires an explicit conflict owner before CI repair defers. |
| fr | fr-10 | story-5 | covered | Story 5 gates publication on preservation, base currency, and verification. |
| fr | fr-11 | story-5 | covered | Story 5 preserves concurrent remote changes and forbids fallback overwrite. |
| fr | fr-12 | story-6 | covered | Story 6 resets successful conflict state and delays remaining CI repair. |
| fr | fr-13 | story-6 | covered | Story 6 covers cooldown, retry bounds, exhaustion, and intervention. |
| fr | fr-14 | story-7 | covered | Story 7 requires pull request, stage, and result in terminal logs. |
| fr | fr-15 | story-7 | covered | Story 7 leaves every refreshed pull request open for operator merge. |
| fr | fr-16 | story-4 | covered | Story 4 covers the once-per-startup warning and manual-resolution truthfulness. |
| story | story-1 | task-2, task-5, task-17 | covered | Eligibility, retained evidence, dispatch, and verified enrollment are implemented and tested. |
| story | story-2 | task-1, task-3, task-5, task-6 | covered | Typed outcomes, serialization, and non-consuming deferrals all have tasks. |
| story | story-3 | task-4, task-6, task-7, task-10, task-11, task-12, task-13 | covered | Terminal classification, strict comment confirmation, ordering, and retry convergence are covered. |
| story | story-4 | task-1, task-4, task-8, task-14, task-15, task-16 | covered | Lane arbitration, inactive mode, startup diagnosis, wiring, and activation are covered. |
| story | story-5 | task-16, task-18 | covered | Exact repository verification and every publication safety outcome are covered. |
| story | story-6 | task-3, task-4, task-7, task-9, task-13 | covered | Success reset, later-cycle CI, cooldown, exhaustion, and no-burn escalation retries are covered. |
| story | story-7 | task-7, task-12, task-15, task-18 | covered | Terminal outcome wiring/logging and operator-only merge are covered. |
| task | task-1 | story-2, story-4 | covered | Defines the shared typed disposition required by both arbitration stories. |
| task | task-2 | story-1 | covered | Removes the retained-worktree eligibility blocker. |
| task | task-3 | story-2, story-6 | covered | Implements transient ownership and cooldown behavior. |
| task | task-4 | story-3, story-4, story-6 | covered | Classifies sticky, exhausted, unavailable, and intentionally inactive cases. |
| task | task-5 | story-1, story-2 | covered | Dispatches one owner and persists attempt state before mutation. |
| task | task-6 | story-2, story-3 | covered | Keeps defer and already-escalated cycles mutation-free and visible. |
| task | task-7 | story-3, story-6 | covered | Routes terminal dispositions without consuming resolution attempts. |
| task | task-8 | story-4 | covered | Prevents conflicting candidates from entering normal CI repair. |
| task | task-9 | story-6 | covered | Resets successful conflict state and tests later-cycle CI handoff. |
| task | task-10 | story-3 | covered | Adds confirmation for new and existing actionable comments. |
| task | task-11 | story-3 | covered | Fails closed on indeterminate comment state without duplicate creation. |
| task | task-12 | story-3, story-7 | covered | Makes escalation comment-first, label-last, typed, and observable. |
| task | task-13 | story-3 | covered | Proves partial escalation converges without duplicates or attempt burn. |
| task | task-14 | story-4 | covered | Derives the effective once-per-startup compatibility diagnostic. |
| task | task-15 | story-1, story-2, story-3, story-4, story-7 | covered | Wires classifier, dispatch, escalation, logging, and startup behavior into production. |
| task | task-16 | story-4, story-5 | covered | Activates autoresolve with both required verification suites. |
| task | task-17 | story-1 | covered | Pins verified-ship enrollment through retained-worktree dispatch. |
| task | task-18 | story-5, story-7 | covered | Pins safe publication, terminal logs, and operator-only merge authority. |
