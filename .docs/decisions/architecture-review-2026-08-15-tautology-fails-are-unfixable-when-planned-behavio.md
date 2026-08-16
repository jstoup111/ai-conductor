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

---

# Amendment pass — 2026-08-16

**Mode:** amendment (structural gaps re-opened by `build_review` remediation, dispositions
`build_review:root-cause-symptom-displacement` and `build_review:root-cause-overbroad-boundary`)
**Tier:** Medium — §2 Feasibility and §4 Alignment only, per Lightweight Mode
**Amendment-pass verdict:** APPROVED WITH CONDITIONS

Scope of this pass is the two named structural gaps only; the 2026-08-15 design above is not
re-derived. No new ADR — `adr-2026-08-15-verify-only-anchored-tautology-exemption.md` already
governs both structural decisions, so both corrections land as additive amendment notes in it
(header input-isolation clause, D1, D4, and the Stated-limit section, which now carries **D6**).

## Gap 1 — Overbroad Completeness boundary (`root-cause-overbroad-boundary`)

`parsePlanTaskVerifyOnly` (`autoheal.ts:638-674`) returns `true` when **any** `+`-split token of a
task's `**Type:**` line is `verification`. D1 fed that one membership to both D3 (per-test
Tautology) and D4 (Completeness no-implementation-diff), so a
`**Type:** implementation+verification` task — which plans real implementation behavior — was
granted no-diff relief for its implementation half.

**Resolution (ADR D1/D4 amendments):** split the memberships. Tautology keeps the wide membership;
Completeness reads a new deterministic per-task `noImplementationPlanned` classification, true only
for `**Verify-only:** yes` or a `**Type:**` token set of exactly `{verification}`, and false for
every mixed form absent an explicit `**Verify-only:** yes`. One field on the existing evidence
entry — no second block, no second seam.

**Why D3 is deliberately not narrowed:** conditions (2) and (3) of the per-test predicate are
evaluated per changed test and already refuse any test asserting behavior this diff introduces, so
the wide membership grants nothing there that the narrow one would withhold.

## Gap 2 — Root-cause displacement in the discovered case (`root-cause-symptom-displacement`)

The accepted residue left a discovered-mid-build task's closure invisible to the grader: the
Tautology symptom was fixed while the same root cause stayed live on Completeness as a diff-absent
unmarked task. Anchoring to `.pipeline/task-status.json` was — correctly — rejected as maker
self-report (#773).

**Resolution (ADR D6):** the residue is withdrawn and replaced with an engine-derived signal read
from the reviewed `mergeBase..HEAD` range: commits carrying both a `Task: <id>` and an
`Evidence: skipped <reason>` trailer (the D5 closure form) become `skippedTaskContext`. Ids are
re-resolved assembly-side against the **sealed** `planBody`; unresolvable ids and half-stamped
commits drop fail-closed. `task-status.json` is read at no seam.

## Feasibility (§2)

| Check | Finding |
|---|---|
| Stack compatibility | No new deps. Trailer reading uses `git log` in a module that already shells to `git` for `merge-base`/`diff` (`build-review-inputs.ts:245-266`); `Task:` trailer parsing seams already exist (`autoheal.ts:511-535`). Verified. |
| Prerequisites | None. The `Evidence: skipped <reason>` form is already emitted by the `tdd` contract (`skills/tdd/SKILL.md:243,261-271`) and already accepted by the generated `commit-msg` hook (`git-hook-assets.ts:178-181`). Verified. |
| Integration surface | Same four seams the 2026-08-15 design already touches — inputs, snapshot/digest, projections, prompt/skill text. No new module boundary. |
| Data implications | Two additive fields on frozen types; both digests change by construction, which is the intended mutation-sensitivity. No persisted schema. |
| Performance risk | One extra `git log` over the reviewed range per build_review assembly; bounded by the same range already diffed. |
| Worktree isolation | No new port, service, DB, or shared path. |

## Alignment (§4)

- **Deterministic-where-possible:** both corrections move judgement *out* of the grader — a parsed
  token-set predicate and a parsed trailer pair replace a rubric-side inference. Consistent with the
  repository design principle and with `adr-2026-08-12-removal-anchored-tautology-exemption.md`.
- **Event spine / no parallel channel:** `skippedTaskContext` and `noImplementationPlanned` ride the
  existing frozen-snapshot → projection path. No new event union member, `.pipeline/*.jsonl` ledger,
  watcher, or sidecar. Schema-not-file test passes: this is a field on an existing input schema.
- **Grader input isolation:** the header clause is narrowed by amendment rather than silently
  violated. Maker self-report state (`task-status.json`) remains forbidden at every seam; what is
  admitted is engine-read history from the range already under review.
- **Invalid states unrepresentable:** `noImplementationPlanned` is a computed boolean on the same
  entry, so a Completeness-eligible task that is not Tautology-listed cannot be represented.
- **Scope-check:** repo-only for the engine/prompt seams (build_review exists only here); the
  `skills/build-review-*` and `skills/plan` edits are shipped-catalog surfaces, unchanged from the
  original pass's placement finding.
- **Convention over precedent:** the current `build-review-inputs.ts` derivation implements the
  pre-amendment D1 and is now tech debt against the amended ADR, not precedent.

## Wiring Surface (amendment pass)

| New/changed surface | Called from (design-time commitment) |
|---|---|
| `noImplementationPlanned` on `BuildReviewVerifyOnlyContext` | computed in `assembleBuildReviewInputs`; rendered by `buildGraderPrompt`'s verify-only block and by `CommonProjection` for the fan-out lane |
| `skippedTaskContext` on `BuildReviewInputs` / `BuildReviewSourceSnapshot` | derived in `assembleBuildReviewInputs` from the reviewed range; frozen into both digests; carried on `CommonProjection` |
| Skipped-task evidence block (`build-review-prompt.ts`) | rendered into every monolithic build_review grader dispatch |
| Completeness skipped-block guidance (`skills/build-review-completeness/SKILL.md`) | read by every fan-out Completeness rubric dispatch |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Maker stamps `Evidence: skipped` on a task whose outcome was genuinely not delivered | Technical | Medium | High | D6 explicitly grants absence-accounting only, never an automatic pass; Completeness still judges outcome delivery, and the reason string carries no decision authority |
| Trailer pair parsed from a commit whose id is stale or invented | Technical | Low | Medium | Assembly re-resolves every id against the sealed `planBody` and drops unresolvable entries fail-closed; the `commit-msg` hook rejects naming drift at commit time |
| `**Verify-only:** yes` used to launder a mixed task into Completeness relief | Technical | Medium | Medium | Task 11's plan-skill guidance names the over-marking prohibition explicitly; the marker is an operator-visible DECIDE-time declaration on a sealed artifact |

## Conditions (amendment pass)

1. **Operator reseal required before BUILD re-enters.** This pass amends
   `.docs/decisions/adr-2026-08-15-verify-only-anchored-tautology-exemption.md` and this review
   artifact. Neither path satisfies `namesOwnFeature`, so the protected-artifact seal
   (baseline `6ad779c8`) will refuse BUILD entry with `Protected artifact changed: <path>` until an
   operator reviews the diff and runs, from the main checkout:
   ```bash
   conduct-ts reseal --slug tautology-fails-are-unfixable-when-planned-behavio \
     --path .docs/decisions/adr-2026-08-15-verify-only-anchored-tautology-exemption.md \
     --path .docs/decisions/architecture-review-2026-08-15-tautology-fails-are-unfixable-when-planned-behavio.md \
     --reason "architecture-review amendment pass for #1579 remediation (D1/D4 boundary split, D6 skipped-task evidence)" \
     --clear-halt
   ```
   This is the documented DECIDE-amendment path
   (`docs/runbooks/stalled-or-stuck-feature.md`), not a defect of this pass.
2. **Plan realignment is binding.** The re-running `plan` step must land the task changes
   enumerated under "Required plan realignment (2026-08-16 amendments)" in the ADR. `build_review`
   checks the amended ADR, not the 2026-08-15 form.

## Out of scope for this pass

The two `build`-dispositioned remediation gaps —
`build_review:tautology-assertion-insensitive` (digest-isolation test repair) and
`build_review:completeness-incomplete-deliverable` (`skills/build-review-tautology/SKILL.md:22`
stale behavior-description claim) — are owned by BUILD and are untouched here.
