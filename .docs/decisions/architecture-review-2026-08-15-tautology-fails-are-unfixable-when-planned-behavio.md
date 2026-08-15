# Architecture Review: Verify-Only-Anchored Tautology Exception (#1579)
**Date:** 2026-08-15
**Stories reviewed:** none yet (pre-stories DECIDE review, technical track)
**Verdict:** APPROVED

## Feasibility

- **Zero new inputs:** `planBody` is already in `BuildReviewInputs` assembly
  (`build-review-inputs.ts:227`); `verifyOnlyContext` derives beside `removalContext`
  (`:253`) and joins the frozen source snapshot + digest identically. Verified.
- **Parser reuse:** `parsePlanTaskVerifyOnly` (`autoheal.ts:638`) and `parsePlanTaskPaths` are
  existing, fail-closed, exported. No new parsing machinery. Verified.
- **Maker convergence path exists without operator:** commit floor accepts plan-marker OR
  task-status `skipped` (`per-task-commit-floor.ts:72-82`); the sealed-plan constraint
  (`protected-artifact-seal.ts:20`) is respected by never requiring a mid-build plan edit.
  Verified — this was the review's load-bearing correction (see ADR).
- **Stack:** prompt text + one TS deriver + two skill edits; no new deps, no schema change to
  the reviewer-output JSON.

## Alignment

- **Deterministic-where-possible:** evidence computed engine-side; grader applies a closed
  predicate — same doctrine as `adr-2026-08-12-removal-anchored-tautology-exemption.md`.
- **Grader input isolation preserved:** anchor is planBody-derived; `task-status.json` stays
  forbidden (#773 self-report doctrine) — the skipped-status route works by removing the
  offending test from the diff, not by showing the grader maker state.
- **No parallel channel:** no new event, ledger, or sidecar; the evidence rides the existing
  grader-prompt input path (event-spine check: schema-not-file — no new observation channel).
- **Scope-check:** repo-only. The build_review grader, evidence blocks, and sealed-plan
  machinery exist only in this repository. The `tdd`/`writing-system-tests` boundary edits touch
  shipped skills (consumer-facing surface) — mirror of #1529's ask, flagged for the plan to
  handle via the normal skills-catalog placement.

## Wiring Surface

| New/changed surface | Called from (design-time commitment) |
|---|---|
| `verifyOnlyContext` on `BuildReviewInputs` | assembled in `assembleBuildReviewInputs` (`build-review-inputs.ts`), consumed by `buildGraderPrompt` |
| verify-only evidence block + exception 4 + completeness line (`build-review-prompt.ts`) | rendered into every build_review grader dispatch (existing step runner) |
| `tdd` / `writing-system-tests` "no legitimate RED" boundary | followed by every BUILD maker session (skill contract) |
| `plan` marker guidance strengthening | followed at DECIDE by /plan authoring |

Overlap scan run (advisory): `build-review-inputs.ts` overlaps dozens of stale `spec/*` branches;
no live in-flight collision — the rubric-lane work (#1600/#1605) is already merged.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Planner over-marks tasks verify-only, widening the exemption | Technical | Medium | Medium | D3 predicate is per-test and 3-condition; genuinely tautological tests still FAIL; /plan guidance restricts marker to verification-shaped tasks |
| Mid-build-discovered case still flags holistic Completeness (diff-absent unmarked task) | Technical | Medium | Medium | Stated limit in ADR; operator reseal fallback; deferred Approach B intake is the durable fix |
| Grader prompt growth degrades judgement | Knowledge | Low | Low | Block renders `(none)` when unused, mirrors removal block size |

## ADRs Created

- `adr-2026-08-15-verify-only-anchored-tautology-exemption.md` (DRAFT → requires approval before
  stories)

## Conditions

None — APPROVED, subject to ADR approval per lifecycle.
