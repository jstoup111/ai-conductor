# Architecture Review: Daemon stall remediation (halt-user-input-required → /remediate)
**Date:** 2026-07-10
**Mode:** Lightweight (tier M) — Technical Feasibility + Architectural Alignment
**Input reviewed:** explore output + approved architecture diagrams
(`.docs/architecture/daemon-mode-route-halt-user-input-required-through.md`,
`sequences/daemon-stall-remediation.md`); issue #459
**Verdict:** APPROVED

## Feasibility

All integration seams verified by direct code read (2026-07-10):

| Check | Finding |
|---|---|
| Stack compatibility | Pure engine TS + one SKILL.md contract edit. No new deps, services, or infra. |
| Insertion point | Stall branch at `conductor.ts:1761-1802` already isolates the `halt_marker` case; daemon gating precedent in the same block (`this.daemon`, auto-park at :1727). |
| Resume plumbing | `retryHint` is loop-local and mutable (`conductor.ts:1417, 1587`); `attempt--; continue;` no-burn idiom has three precedents (:1493, :1507, :1581). In-loop consumption avoids `navigateBack` entirely. |
| Remediation reuse | `planRemediation()` (:766-824) is trigger-agnostic — takes `dispatchContext` + `hintSource`; a `build_stall` caller needs zero changes to the function itself. Engine-side `readRemediationPlan` accepts `tasks: []` on a build gap (`artifacts.ts:1657-1667`), so answer-only dispositions flow without plan-append. |
| Fail-safe plumbing | Generic HALT writer preserves an existing specific `.pipeline/HALT` reason (:2229-2236) — writing the question-carrying HALT before `break` needs no changes to the exhausted-retries path. |
| Data implications | Two gitignored run-evidence files (`.pipeline/build-stall-question.md`, existing `remediation.json`). No schema, no migrations. |
| Worktree isolation | All state under the feature's own `.pipeline/` — per-worktree by construction. |

## Alignment

- **Deterministic-first (CLAUDE.md):** capture/persist/plumb/budget are engine code; the
  LLM judges only answerability. Compliant.
- **adr-2026-07-04-auth-failure-park-and-poll:** reuses both its patterns — no-burn
  resume and preserve-specific-HALT-reason. No conflict.
- **adr-2026-07-05-retry-as-escalation-ladder:** a deliberate resume does not advance
  the ladder (same as sessionExpired). No conflict.
- **adr-2026-07-05-engine-owned-task-status / #280:** untouched — the durable
  no-evidence counter and auto-park run before the stall branch and keep their
  semantics; `no_task_progress` explicitly out of scope.
- **adr-013-daemon-main-advance-rekick:** unchanged; this reduces how often a feature
  reaches the rekick path at all.
- **/remediate contract:** extended, not forked — the halt taxonomy stays in one place
  (the alternative, a second triage step, was rejected in explore for drift risk).
- **Model table:** `remediate` is already fable/high; the stall trigger rides the
  existing step config. No table change.
- **State management:** no new persistent state machine; the stall outcome is consumed
  within one retry-loop pass. Budget uses the existing `remediationRounds` counter.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Planner "answers" a question that genuinely needed a human → wrong build direction | Technical | Medium | Medium | /remediate's verify-claims gate + halt-on-uncertain rule already require HALT when the gap's nature is unclear; stories must assert the halt-category path |
| Ask→answer→ask loop on the same stall | Technical | Low | Medium | Shared `remediationRounds` budget (2/run); exhausted → fail-safe HALT with question |
| Stall remediation consumes budget needed by a later prd-audit gap in the same run | Technical | Low | Low | Operator-confirmed trade-off (no new counter); revisit only if observed |
| Question dropped on a dispatch crash | Technical | Low | High | Fail-safe writes the question-carrying HALT BEFORE dispatch outcome is known — stories must assert HALT content on every exit path |

No High-likelihood/High-impact risks; the one High-impact risk is mitigated by making
question-preservation unconditional (FR-level requirement, not best-effort).

## ADRs Created

- `adr-2026-07-10-daemon-stall-remediation.md` — DRAFT, presented for approval
  (cross-cutting error-handling/resilience pattern → ADR category triggered).

## Conditions

None.
