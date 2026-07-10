# Architecture Review: Setup-before-dispatch wedge — deterministic setup-failure triage
**Date:** 2026-07-09
**Stories reviewed:** none yet (pre-stories review per adr-2026-06-29-architecture-before-stories-convergent-kickback); input = explore output + approved approach for jstoup111/ai-conductor#446
**Mode:** Lightweight (tier M — feasibility + alignment)
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Pure TypeScript engine change + git plumbing already used everywhere (`execa`, `GitRunner`). No new packages, services, or infra. |
| Prerequisites | None — all integration points exist and were verified by direct read: `makeRunFeature` prepare step (daemon-runner.ts:192–204), `prepareWorktree` throw (worktree-prepare.ts:114–117), `ensureWorktree` reuse (daemon-deps.ts:64–79), bounded-resolver dispatch shape (rebase.ts:542+, daemon-cli.ts:1216+), diagnostic HALT writer (daemon-runner.ts:359–372). |
| Integration surface | Two modified modules (`daemon-runner.ts`, `worktree-prepare.ts`), one new module (`engine/setup-triage.ts`), one new step-runner method for the fix-session. Within normal bounds. |
| Data implications | None (no schema; new git branch refs `wip/setup-quarantine-<slug>` only). |
| Performance risk | Triage runs only on setup failure — a path that today costs an operator 20–30 min; one extra setup re-run is negligible. Happy path untouched. |
| Worktree isolation | All triage git operations run inside the feature worktree; the quarantine branch ref is per-slug (no cross-worktree collision). No new ports/DBs/services. |

## Alignment

- **Deterministic-first (CLAUDE.md design principle):** stage 1 is pure machinery; the LLM
  appears only where judgement is genuinely required (authoring a code fix). The success
  contract is verified mechanically by the engine (setup exit 0 + clean tree), never trusted
  from the agent — consistent with the evidence-gate precedent.
- **Preserve-then-heal:** mirrors `leak-triage.ts` (#380/#435) — classify, preserve first,
  heal, never silently discard; preservation failure fails toward the current behavior.
- **Bounded LLM dispatch:** mirrors the gated `/rebase` resolver (injected resolver seam,
  cap, explicit give-up path) — no new pattern without precedent.
- **Pattern consistency:** new module is pure + dependency-injected like existing engine
  modules; tests can drive it without spawning agents or real npm builds (env kill-switch
  convention for any spawn).
- **State management:** triage outcomes are an explicit discriminated union
  (pass / quarantined-pass / fix-session-pass / halt) — no boolean flag soup; invalid
  states (e.g. "reset before preserve") unrepresentable by construction order.
- **Scope boundary:** daemon dispatch only; `autoresolve.ts` prepare path and manual
  `/conduct` runs unchanged. Diagrams (approved) reflect exactly this boundary.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Quarantine discards legitimate WIP | Data | Low | High | Preserve-first ordering; branch ref (GC-reachable, survives teardown); preservation failure aborts triage toward error-park; negative-path tests mandated in ADR follow-ups |
| Fix-session commits low-quality code to the feature branch | Technical | Medium | Medium | Mechanical success contract; all downstream build/review/finish gates still apply; bounded to 1 attempt per rotation |
| Transient (network) setup failures trigger triage needlessly | Technical | Low | Low | Retry-once absorbs most; worst case one wasted fix-session then HALT naming the real error |
| Quarantine branch refs accumulate | Technical | Medium | Low | Refs are tiny + named; cleanup deferred to a later sweep (noted in ADR consequences) |

## ADRs Created

- `adr-2026-07-09-setup-failure-triage.md` — DRAFT, presented for operator approval
  (decision category: cross-cutting error-handling/resilience pattern + worktree lifecycle).

## Conditions

None. (Verdict is APPROVED; the DRAFT ADR must reach APPROVED before land — lifecycle gate,
not a review condition.)
