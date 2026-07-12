# ADR 2026-07-07: build_review — input-starved judgement gate at the build → manual_test seam

**Date:** 2026-07-07
**Status:** APPROVED — operator-approved 2026-07-07 (interactive engineer session; decisions 1–7 presented and confirmed)
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** jstoup111/ai-conductor#324 — judgement gate at the build → manual_test seam
**Related:** #325 (CLOSED — fresh session per step, merged PR #365), #384 / ADR
2026-07-05-engine-owned-task-status (kickback-safe build re-entry), #367 (manual_test whitewash
guard — the trust boundary this ADR extends)

## Context

Objective gate verdicts recompute completion from on-disk evidence and never trust agent
self-report, but they cannot judge semantic quality: a tautological test (passes with or without
the fix) satisfies `manual_test`'s predicate (`artifacts.ts:689-764` — results file exists, latest
attempt has no FAIL rows, fresh, whitewash-guarded), and a diff that refactors unrelated files
satisfies "build passes." All existing judgement gates (`architecture_review`, `prd_audit`,
`architecture_review_as_built`) sit in DECIDE or SHIP; no judgement covers the BUILD seam where
these defects enter. manual_test remains the behavior-level QA engineer (running app vs stories);
it structurally cannot see diff honesty — it never reads the diff.

## Decision

Insert a first-class loopGate step `build_review` between `build` and `manual_test`:

1. **Step registry.** Add `build_review` to the `StepName` union (`types/steps.ts:1-26`) and
   `ALL_STEPS` after `build` (`steps.ts:139`): `phase: 'BUILD'`, `enforcement: 'gating'`,
   `prerequisites: ['build']`, `loopGate: true`, `isCheckpoint: false`. `manual_test.prerequisites`
   changes `['build']` → `['build_review']`. Rows added to every exhaustive per-step map
   (`DEFAULT_STEP_MODELS/EFFORT/RETRIES/REVIEW`, `STEP_PROMPTS`, `model-table-metadata.ts`).
2. **Opt-in, default-off, via a top-level resolver flag** (`build_review.enabled`, absent → off),
   NOT the per-step `disable:` flag — built-in gating steps cannot be disabled
   (`types/config.ts:74-75`), and a guardrail step must not be silently disable-able once opted in.
   When off, the engine marks the step `skipped` (the `when_skip` idiom); a skipped step satisfies
   both the selector (`selector.ts:58`) and prerequisites (`state.ts:105-108` — verified), so
   flag-off projects run exactly today's `build → manual_test` topology.
3. **Input-starved grader.** The grader runs in a fresh one-shot session (the
   `resolveRebaseConflict` dispatch pattern, `step-runners.ts:594-610`: new uuid, `resume: false`).
   Structurally assembled inputs — enforced by construction in the dispatch code, not by prompt
   convention:
   - the diff: `git diff <merge-base(derived default branch, HEAD)>..HEAD` (full feature diff;
     stable during BUILD since the only sanctioned rebase is finish-time),
   - the approved plan (`.docs/plans/<stem>.md`) — required to judge scope; it is an
     operator-approved DECIDE artifact, not maker self-report, so it does not breach isolation,
   - raw test output: the grader runs the diff's SCOPED tests (its own/changed test files) inside
     its session and observes output firsthand — the full suite is CI's (and finish's) authoritative
     job, per #588. (This narrows the v1 dial; the verdict predicate and rubric remain unchanged.)
   The maker session's transcript, summary, and `.pipeline/task-status.json` narrative are never
   passed. Session isolation is already unconditional (#325, `conductor.ts:1217-1233`).
4. **Verdict artifact, fail-closed.** Grader writes `.pipeline/build-review.json`:
   `{ verdict: 'PASS' | 'FAIL', reasons: string[], rubric: { tautology, scope, rootCause } }` —
   validated like `AcceptanceRedEvidence` (`artifacts.ts:346-380` precedent).
   `CUSTOM_COMPLETION_PREDICATES.build_review` passes only on a parseable, fresh-since-session
   `PASS`; missing file, malformed JSON, stale mtime, or any other verdict ⇒ unsatisfied.
5. **Strict rubric (all three or FAIL, one-line reason each):** (a) every new/changed test would
   fail without the diff — judged statically from the diff's test code in v1 (counterfactual
   execution is a future dial); (b) diff scoped to the plan, no unrelated files; (c) change
   addresses the stated defect, not a symptom. The rubric judges **diff honesty only** — runtime
   behavior stays manual_test's mandate; product alignment stays prd_audit's.
6. **Kickback: mirror the manual_test self-heal block** (`conductor.ts:1650-1703`), NOT a new
   `kickbackTarget` on `build` — adding `build` to `kickbackTargets` would move `regionStart`
   (`conductor.ts:141-160`) and change selector behavior for every project. A dedicated
   `buildReviewSelfHeals` counter bounded by the existing `MAX_KICKBACKS_PER_GATE` (= 2): on FAIL
   under cap, write `{satisfied: false, kickback: {from: 'build_review', evidence}}`, seed
   `pendingRetryHints.set('build', <grader reasons>)`, `navigateBack(build)` + downstream stale;
   at cap, write `LOOP_HALT_MARKER` and emit `loop_halt`. Build re-entry is non-destructive:
   task completion is re-derived from plan + git trailers (ADR 2026-07-05).
7. **Model dial.** Default model row: session default; per-step `model:` override in config gives
   the distinct-model independence dial for free (`resolved-config.ts` precedence chain) — no new
   mechanism.

## Consequences

- (+) Tautological-test and scope-creep defects are caught before green SHIP evidence lodges;
  kickback churn is minimal (earlier-wins trade-off from #324).
- (+) Zero cost and zero behavior change for projects that don't opt in.
- (+) Every mechanism reuses a verified analog (one-shot dispatch, run-evidence JSON, self-heal
  counter, HALT marker) — no new machinery classes.
- (−) One model call per build iteration when enabled; opt-in flag is the cost gate.
- (−) Grader variance can thrash the loop; mitigated by the strict all-or-FAIL rubric, the
  2-kickback cap, and fail-closed parsing. Residual risk: a persistently wrong grader burns the
  cap and HALTs — acceptable, HALT is the designed escape.
- (−) Static tautology judgement (no counterfactual run) can miss subtle cases; recorded as a
  future dial, not scope.
- (−) `StepName` is an exhaustive union: the diff touches every per-step map + the generated model
  table (integrity-validated; regenerate via `bin/generate-model-table`).

## Alternatives considered

- **YAML custom step** (`buildStepRegistry`, `steps.ts:359-456`): no structural input isolation,
  no dedicated grader dispatch — rejected.
- **Fold rubric into manual_test:** contradictory input sets (QA needs rich context, grader needs
  starvation); catches defects post-SHIP-evidence; concentrates trust in the step with the
  whitewash history — rejected.
- **`kickbackTarget: true` on build:** moves `regionStart` for all projects — rejected in favor of
  the proven hardcoded self-heal path.
