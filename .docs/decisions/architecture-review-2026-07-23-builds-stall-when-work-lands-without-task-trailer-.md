# Architecture Review: Builds stall when work lands without Task: trailer stamps
**Date:** 2026-07-23
**Mode:** lightweight (Tier M) — feasibility + alignment; pre-stories (input = approved
architecture doc + technical intent, per adr-2026-06-29-architecture-before-stories)
**Input:** `.docs/architecture/builds-stall-when-work-lands-without-task-trailer-.md` (operator-approved)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** no new dependencies; the floor is two string comparisons on values produced by
  `currentCommitSha` (already imported at the site). The telemetry event follows the existing
  `emitTracked` pattern. VERIFIED against `conductor.ts:3054/:3149/:3740-3778`.
- **Prerequisites:** none — no migration, no config, no schema. `build_progress_halt` config
  keys are untouched.
- **Integration surface:** single file for behavior (`conductor.ts` build-step retry loop),
  one type addition (`types/events.ts`), contract text in three docs. Well under the
  3-boundary flag threshold.
- **Signal correctness:** the naive reuse of `headShaBeforeBuild` was caught and rejected at
  design time (per-step const, outside the attempt loop — would blind wedge detection after
  one commit). The per-attempt baseline mirrors the existing `resolvedTasksBefore` rolling
  pattern — proven shape at the same loop.
- **Bounded loops:** routing on exhausted budget cannot recurse unboundedly —
  `MAX_KICKBACKS_PER_GATE` already bounds build_review FAIL→build cycles (verified consumer
  at `conductor.ts:3988`).

## Alignment

- **#773 (build_review sole authority):** strengthened — the last deterministic path that
  could terminally kill a worked build is removed; the authority judges the diff.
- **#859 (trailer-union routing ADR):** extended, not contradicted. §2's count-comparison
  freeze holds (the floor is an added conjunct); §4's no-wedge-class-reasoning bar respected
  (no SHA reachability, no diff heuristics); `detectZeroWorkProduct` stays a pinned stub.
- **#280 (progress-bypass/attempt ceiling):** untouched — bypass still keys on count
  movement; the ceiling still bounds slow-drip progress.
- **#569 (stall → /remediate):** preserved verbatim for genuine wedges; the class it routes
  simply becomes truthful (only real stalls reach it).
- **#519 (abstain-or-loud attribution):** unchallenged — the fix makes abstention harmless
  to liveness instead of trying to eliminate it.
- **Design Principle (deterministic machinery):** the fix is engine machinery at the point
  of misclassification, not prompt discipline asking agents to stamp better.

## Wiring Surface

| New surface | Production caller (design-time commitment) |
|---|---|
| Per-attempt SHA baseline + floor conjunct | Inline in the existing build-step retry loop, `conductor.ts` (`while (attempt < stepMaxRetries)` body) — no new export |
| `unattributed_progress` event | Emitted via existing `emitTracked` at the classification site; rendered by the daemon log renderer like sibling build events |
| Budget-exhaustion → build_review branch | The same step-advance seam the completion gate's `done` path takes (no second advance path) |
| Contract text | `skills/pipeline/SKILL.md`, `docs/daemon-operations.md`, `src/conductor/README.md` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Floor blinds wedge detection via wrong SHA granularity | Technical | Low (caught at design) | High | Per-attempt baseline is an explicit ADR decision + its own story with a fixture (commit once, then wedge — must still HALT) |
| Route-on-exhaustion invents a second step-advance path that drifts from the gate's | Technical | Medium | Medium | Condition C1 below: reuse the completion-gate advance seam, assert by test that both paths mark identical state |
| build_review load increases (worked-but-unresolved builds now always reach it) | Performance | Medium | Low | Bounded by retry budget + MAX_KICKBACKS_PER_GATE; review passes were already the common path for healthy builds |
| A stalled-after-one-commit build burns full budget before HALTing | Technical | Low | Low | Per-attempt baseline confines credit to the attempt that earned it; wedged attempts still count toward the budget |

## ADRs Created

- `adr-2026-07-23-commit-movement-liveness-floor.md` — **DRAFT**, presented for operator
  approval with this review. Extends #859/#773; supersedes nothing.

## Conditions

- **C1:** the budget-exhaustion routing MUST reuse the completion gate's step-advance seam;
  a test asserts the two paths produce identical step state (guards A2 from the
  architecture doc).
- **C2:** the genuine-wedge regression fixture MUST cover the "one early commit, then
  wedge" shape — the exact case the per-step SHA baseline would have missed.
- **C3:** `/stories` MUST carry a negative-path story: plan task with no corresponding work
  → build_review FAIL → kickback (routing-only never becomes always-pass).
- **C4 (conflict-check focus):** sweep the #280/#569 story files for Given/When/Then
  clauses that assume "count pinned ⇒ stall" — any found must be reconciled, not silently
  overridden.
