# Architecture Review: Parallel Validation Phase (ai-conductor#469)
**Date:** 2026-07-10
**Stories reviewed:** none yet — pre-stories full pass (technical track, Tier L); input = explore output + operator-locked approach
**Verdict:** APPROVED

## Feasibility

- **Stack:** no new runtime dependencies. The concurrency cap is a hand-rolled semaphore
  (runtime deps are only `uuid` — verified in src/conductor/package.json); session
  minting reuses `uuidv4()` (existing precedent step-runners.ts:625/678/741).
- **Prerequisites:** none new. Depends on machinery already on main: unified evidence
  derivation (#456/#463 via PR #481 — merged; operator holds spec-PR merge until
  observed live), fresh-session-per-step (#325), rate-limit episode coordinator,
  `planRemediation` multi-source seam.
- **Integration surface:** confined to src/conductor (steps.ts, conductor.ts, config.ts,
  types/config.ts, step-runners.ts) + three SKILL.md prose lines + HARNESS.md/README
  docs. No external APIs, no schema/DB, no consumer-project surface change
  (`parallel:` config schema is kept byte-compatible).
- **Data implications:** none (state file gains no new key shapes; ADR-004 synthetic
  `«group»__«branch»` keys retained).
- **Performance:** goal is wall-clock reduction; burst token rate bounded by
  `validation_concurrency` default 2 + shared rate-limit episode.
- **Worktree isolation:** no new ports/DBs/services. `manual_test` keeps its existing
  port-3000 behavior; safe only because sibling branches are read-only — recorded as a
  binding constraint in adr-2026-07-10-validation-group-join.

## Complexity

**High** (state-machine depth: concurrent branches × retry ladder × rate-limit episode ×
join classification), matching the Tier L classification. Not split: the group core and
its first consumer are one cohesive seam; splitting would ship the core unexercised
(orphaned-primitive risk).

## Alignment

- **Deterministic-first (CLAUDE.md/HARNESS.md):** join classification is engine code;
  the only LLM in the loop remains the existing `/remediate` planner. manual_test FAIL
  stays deterministic (adr-2026-07-06-manual-test-fail-routing preserved).
- **ADR 004:** amended, not violated — DSL schema kept, executor corrected
  (adr-2026-07-10-concurrent-group-core, with an append-only "Amended by" note on 004).
- **Fresh-session-per-step (#325):** extended per branch; no step gains conversational
  coupling.
- **Evidence stamps (#456/#463):** validators are SHIP-tail consumers of build evidence,
  not writers; join must not race the gate-verdict writes — resolved by single-writer
  join (core writes `.pipeline/gates/*` and state).
- **Diagrams:** feature diagrams authored + syntax-checked at
  `.docs/architecture/parallel-validation-phase-fan-out-manual-test-prd-.md` (+ sequence);
  approved by operator 2026-07-10.

## Domain Integrity

- Branch outcome modeled as a discriminated union (verdict PASS/FAIL/BLOCKED vs
  no-verdict/infra), not boolean flags — invalid states (a "failed but has verdict but
  also crashed" row) unrepresentable. Binding on implementation.
- No primitive obsession introduced: `validation_concurrency` resolved+clamped once
  (`resolve*` helper precedent), never re-validated downstream.
- Exhaustive matching required on the join classification (no `default:` swallowing a
  new verdict kind).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Concurrent branches race state/gate writes | Data | Medium | High | Single-writer join: branches return outcomes; only the core writes conduct-state.json and .pipeline/gates/* |
| Rate-limit burst from concurrent sessions | Integration | Medium | Medium | Cap default 2; branches enter the shared episode (later-deadline-wins) instead of independent retries |
| Retry-budget multiplication under parallelism | Technical | Medium | High | Per-gate self-heal counters keep existing accounting; branch retries bounded by the step's own max_retries |
| when-parallel tests enshrine old buggy semantics | Technical | Certain | Medium | Rewrite suite against corrected semantics; both consumers (DSL + validation group) covered |
| conductor.ts rebase churn vs other in-flight criticals | Knowledge | Medium | Medium | Narrow seam held; spec-PR merge timed by operator; daemon finish-time rebase handles drift |
| manual_test runtime side effects beside read-only siblings | Integration | Low | Medium | Constraint recorded in join ADR: any future runtime-mutating member requires an isolation primitive first |
| Slowest validator delays join | Performance | Certain | Low | Inherent to max-of-durations; still strictly better than sum |

## ADRs Created

- `adr-2026-07-10-concurrent-group-core.md` (APPROVED, operator 2026-07-10) — amends
  004-when-parallel-workflow-dsl (append-only amendment note added)
- `adr-2026-07-10-validation-group-join.md` (APPROVED, operator 2026-07-10) — preserves
  adr-2026-07-06-manual-test-fail-routing

## Conditions

None — both ADRs operator-approved 2026-07-10; clean APPROVED.
