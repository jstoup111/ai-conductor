# Architecture Review: Trailer-union build completion (false no_task_progress halt, #859)

**Date:** 2026-07-23
**Mode:** Lightweight (Tier M) — feasibility + alignment; pre-stories full pass
**Inputs reviewed:** approved approach (Approach A), `.docs/architecture/trailer-union-build-completion.md`, `.docs/track/…`, `.docs/complexity/…`, `.memory/decisions/2026-07-23-trailer-union-build-completion.md`
**Verdict:** APPROVED (conditional on ADR adr-2026-07-23-trailer-union-build-step-routing reaching APPROVED)

## Feasibility

- **Stack:** pure TypeScript engine change; no new packages, services, or infrastructure. ✓
- **Prerequisites:** none — `listCommitsWithTrailers`, `canonicalTaskId`, `normalizeTasks`,
  `parsePlanTaskPaths` all exist and are already imported by `task-progress.ts` /
  `per-task-commit-floor.ts`. The extraction is a refactor of shipped logic
  (`countResolvedTasks`), not new machinery. (Verified by direct read, ~95%.)
- **Integration surface:** 3 modules (`task-progress.ts`, `artifacts.ts`, `conductor.ts`) +
  1 skill doc + user docs — within Medium bounds. Other `countResolvedTasks` consumers
  (`daemon-cli.ts:434` re-kick eligibility, `conductor.ts:1909/1932` kickback baselines)
  are value-compatible: the refactor preserves the fold, so counts are identical. ✓
- **Data implications:** none — no store schema changes; task-status.json shape untouched;
  rows remain dead (nothing new writes them). ✓
- **Performance:** `resolveTaskIds` adds one `git log` trailer scan per completion check —
  identical cost to the breaker's existing per-attempt `countResolvedTasks` call; bounded by
  branch commit count. Not a hot path. ✓
- **Worktree isolation:** operates per-worktree on that worktree's branch + sidecar; no shared
  resources. ✓

## Alignment

- **adr-2026-07-21-demote-task-stamping-to-telemetry (APPROVED):** this change completes that
  ADR's own follow-up ("preserve the #757 resolved-count … source it from Task:-trailered
  commits") by applying the same sourcing to the exit gate the follow-up missed. Rows stay
  dead; no derivation revival. ALIGNED.
- **adr-2026-07-21-completeness-as-build-review-rubric (APPROVED):** build_review remains the
  sole completion authority; this change only fixes *routing to* it. The resolver performs
  none of the forbidden wedge reasoning (no SHA reachability, pinned stamps, or path
  corroboration). ALIGNED.
- **adr-2026-07-22-per-task-work-happened-floor (APPROVED):** the floor stays a non-blocking
  advisory inside build_review; the new resolver shares primitives but the fail directions
  deliberately differ (gate fail-closed, floor fail-soft) — documented in the new ADR. ALIGNED.
- **Design Principle (CLAUDE.md/HARNESS.md):** deterministic engine fix, no prompt-discipline
  checklist; the skill-doc edit is contract-text correction, not enforcement. ALIGNED.
- **Pattern consistency:** shared-resolver extraction mirrors existing shared-parse precedent
  (`normalizeTasks` shared by count + watcher). New decision documented in
  adr-2026-07-23-trailer-union-build-step-routing (routing vs authority split). ✓

## Wiring Surface (design-time)

| New/changed surface | Production wiring |
|---|---|
| `resolveTaskIds(projectRoot, planIds)` (NEW export, `task-progress.ts`) | Called by `CUSTOM_COMPLETION_PREDICATES.build` (`artifacts.ts`) on every build completion check, and by `countResolvedTasks` (refactored onto it) — which the conductor's stall breaker (`conductor.ts` build retry loop), kickback baselines (`conductor.ts:1909/1932`), and daemon re-kick eligibility (`daemon-cli.ts:434`) already invoke. |
| `build:` predicate semantics change (`artifacts.ts`) | Invoked by `checkStepCompletion` from the engine step loop (`conductor.ts:3550`), pre-check (`conductor.ts:3077`), and build-gate recompute (`conductor.ts:1373`) — existing wiring, unchanged call sites. |
| `countResolvedTasks` internals (refactor) | Existing callers unchanged (`conductor.ts`, `daemon-cli.ts`). |
| `skills/pipeline/SKILL.md` contract text | Loaded by the /pipeline skill at build dispatch (existing skill wiring). |

Advisory overlap scan (`conduct-ts overlap-scan`) run over the four paths: 19 unmerged
`origin/spec/*` branches touch `task-progress.ts` — all are historical spec branches (their
features merged or superseded; e.g. `spec/demote-task-stamping…` shipped as #773). No active
unmerged dependent work identified. Advisory only, non-blocking.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Trailer forgery routes an incomplete build to build_review | Technical | Low | Low | build_review completeness rubric FAILs and kicks back (bounded by MAX_KICKBACKS_PER_GATE) — the #773 authority model absorbs it |
| Predicate change breaks row-only tests / legacy fallback callers | Technical | Medium | Medium | Legacy no-context fallback branch untouched; rewrite union-semantics tests; regression fixtures per ADR follow-ups |
| Refactor of countResolvedTasks perturbs breaker/re-kick counts | Technical | Low | High | Pure extraction (same fold); unit tests assert count parity before/after |
| Reverted-commit trailer still counts as resolved | Data | Low | Low | Identical to shipped breaker semantics; build_review judges the real diff |

## ADRs Created

- `adr-2026-07-23-trailer-union-build-step-routing` — DRAFT, presented for operator approval
  (routing vs authority split; one resolution definition for exit gate + breaker).

## Conditions

- The DRAFT ADR must reach `Status: APPROVED` before stories/plan proceed (engineer land gate
  also enforces no-DRAFT-ADR).
