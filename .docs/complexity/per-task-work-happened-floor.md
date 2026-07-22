# Complexity Assessment — Per-task "work happened at all" floor

**Stem:** `per-task-work-happened-floor`
**Tier: M**
**Date:** 2026-07-22

## Signals

| Signal | Reading |
|---|---|
| New data models | None (reuses `Task:` trailers, plan markers, `task-status.json`) |
| Integrations / external systems | None (pure git + filesystem, in-process) |
| Auth / security surface | None |
| State machines | None new; hooks into the existing `build_review` step |
| New engine modules | 1 (`per-task-commit-floor.ts`) + wiring into `step-runners.ts` |
| Config surface | 1 optional additive kill-switch (`build_review.perTaskFloor`) |
| Story count | ~6 (happy + verify-only + skipped + folded-work-no-wedge + fail-soft + telemetry) |
| Design fork | 1 genuine, load-bearing (advisory vs blocking vs prompt-injection) → needs an ADR |
| Docs surface | CHANGELOG + 2 READMEs + plan SKILL.md marker note |

## Rationale

Not **Small**: there is a real architectural fork (does the floor block, advise the
LLM via prompt injection, or advise out-of-band?) with a hard guardrail ("must not
revive any deleted wedge class") that must be discharged by an ADR and a conflict-check
against the existing `build_review` grader contract and the `no_task_progress` /
`wiring_check` gates. That judgment is load-bearing and cannot be a routine call.

Not **Large**: no new models, no integrations, no auth, no state machine; the compute
inputs and both marker parsers already exist. The change is one focused deterministic
module plus a non-blocking wiring point and additive config/docs.

**Tier: M** ⇒ run `/architecture-diagram` (lightweight), `/architecture-review`
(lightweight, one ADR), `/stories`, `/conflict-check`, `/plan`. `/prd` skipped
(technical track). This tier drives the daemon's BUILD-phase step skipping; a non-Small
spec must carry conflict-check + architecture artifacts (present here).
