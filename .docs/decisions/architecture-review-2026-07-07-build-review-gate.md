# Architecture Review: build_review judgement gate (build → manual_test seam)

**Date:** 2026-07-07
**Mode:** Lightweight (tier M, technical track) — feasibility + alignment
**Inputs reviewed:** intake jstoup111/ai-conductor#324; `.docs/architecture/add-a-judgement-gate-at-the-build-manual-test-seam.md`; approach decision `.memory/decisions/2026-07-07-build-review-gate-approach.md`
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Pure TypeScript engine change in `src/conductor`; no new dependencies, services, or infra. |
| Prerequisites | Both dependencies already on main: #325 fresh-session-per-step (merged PR #365, unconditional at `conductor.ts:1217-1233`); #384 engine-owned task-status (kickback-safe build re-entry). Verified. |
| Integration surface | One seam: the gate-driven tail. Touches step registry + exhaustive per-step config maps + one new predicate + one daemon self-heal block. All have verified in-repo analogs. |
| Data implications | One new gitignored run-evidence file (`.pipeline/build-review.json`); no schema, no migrations. |
| Performance | One extra model call per build iteration, **only when opted in** (default off). Grader runs the test suite once per evaluation — same cost class as existing verification steps. |
| Worktree isolation | No new ports/DBs/services; all state under the feature's own `.pipeline/`. |

## Alignment

- **Trust architecture:** extends the "agent does judgement / engine verifies evidence
  fail-closed" pattern (manual_test predicate + whitewash guard #367; as-built `Verdict:` parse).
  The grader's verdict is parsed fail-closed like `AcceptanceRedEvidence` (`artifacts.ts:346-380`).
- **Loop machinery:** reuses `MAX_KICKBACKS_PER_GATE`, `pendingRetryHints`, `navigateBack`,
  `LOOP_HALT_MARKER` — mirrors the existing manual_test self-heal block (`conductor.ts:1650-1703`).
  Deliberately does NOT add `build` to `kickbackTargets` (would move `regionStart` for all
  projects).
- **Skip semantics (verified, not assumed):** `stepSatisfied` counts `'skipped'`
  (`state.ts:105-108`) and the selector treats skipped gates as satisfied (`selector.ts:58`), so
  flag-off projects retain today's exact topology with `manual_test.prerequisites =
  ['build_review']`.
- **Config idiom:** top-level safe-by-default resolver flag (pattern: `mergeable_autoresolve`,
  self-host gates). Per-step `disable:` is correctly ruled out — built-in gating steps cannot be
  disabled (`types/config.ts:74-75`).
- **Mandate boundaries:** rubric confined to diff honesty; runtime behavior remains manual_test's
  mandate, product alignment remains prd_audit's. No overlap introduced.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Grader variance thrashes build loop | Technical | Medium | Medium | All-or-FAIL rubric, 2-kickback cap → HALT, fail-closed parse |
| Static tautology check misses subtle fakes | Knowledge | Medium | Low | Recorded as future counterfactual-execution dial; still strictly better than no gate |
| Exhaustive-map diff misses a row | Technical | Low | Low | Integrity suite + `generate-model-table` test fail the build on drift |
| Grader inherits maker context via unforeseen channel | Security | Low | High | Input assembly is structural (dispatch code), asserted by test, not prompt convention; #325 session isolation already unconditional |

The one High-impact risk is mitigated structurally and carries an explicit acceptance-criterion
test ("assert structurally, not by convention" — #324). No blocking issues.

## ADRs Created

- `adr-2026-07-07-build-review-judgement-gate.md` — the step, isolation, verdict, kickback, and
  opt-in decisions. Operator-approved 2026-07-07; Status: APPROVED.

## Conditions

None. APPROVED.
