# Coherence: Sliced plans — story ownership and stack eligibility (#2941)

Date: 2026-10-07
Track: technical
Tier: M
Verdict: covered

## Mapping

This is a technical-track spec, so there is no PRD layer. The table maps:

- 10 staged intake outcomes;
- 9 stories;
- 17 plan tasks;
- 4 changed-ADR rows: the new ADR, plus three ADRs that carry additive #2941 amendment notes;
- 48 criterion rows.

**Outcome quotes** are the staged projection verbatim. Outcome 3 (multi-id Story lines) is covered for sliced plans with the flag on. That scope was confirmed by the operator during explore, because 82 of 131 existing plans use multi-id lines. Outcome 10 keeps every other plan unchanged.

**Criterion rows** are identical to the plan's `## Coverage Check` rows. Each quote is exact text from a cited task's `Done when` block.

**Independent judgements**, each run in a fresh subagent:

- **Coverage (plan §7a):** all 48 criteria are asserted after three rounds. Five were refused in round 1 and fixed in the plan: Task 9 gained the prefixed Story form, the pre-change unsliced outcome, and the absent `stacked_prs` block; claim 9 now cites Task 10; and Task 7 checks that the config validator still reports an unresolved `after`.
- **Contradiction (plan §7b, and §4d criterion-conflict and preserved-behavior sweep):** clean in both runs. One residual risk was noted: a config that fails to load at land. Task 9 now treats it as flag off.
- **Achievability (§4g):** 48 of 48 pass. Two rows were unsettled in round 1 (the region wording at land, and land/`coverage_binding` reason equality). Both were fixed through Task 11, a new Task 10 check, and added task citations.
- **Architecture obligations (§4f):** 55 of 55 rows are correct. Five rows were wrong in round 1, all fixed in the plan:
  - a missing check that a position above 9 is refused, plus missing-tier coverage (Tasks 8 and 11);
  - incomplete citations on new-ADR D1, D5 and D6, and on identity D5.

  Two rows were wrong in round 2, also fixed:
  - the `after: acceptance_specs` region case and predicate purity (Task 7);
  - non-waivable, ordered, pre-judge refusal (the new Task 17).

## Table

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1, story-8 | covered | **Story ownership.** In a sliced plan, every story belongs to exactly one child, and that ownership can be read back mechanically. |
| outcome | outcome-2 | story-1 | covered | Land refuses a plan in which any story's tasks span more than one child, naming the story and the children. |
| outcome | outcome-3 | story-2 | covered | Land refuses a `**Story:**` line that lists more than one id, instead of silently dropping ids. |
| outcome | outcome-4 | story-1 | covered | Tasks that cite no story (infrastructure) may sit in any child. |
| outcome | outcome-5 | story-4 | covered | **Tier and sign-off.** A sliced plan is accepted for stacked delivery only at Medium or Large tier, and only with an operator sign-off recorded during DECIDE. |
| outcome | outcome-6 | story-4 | covered | A Small-tier sliced plan, or one with no recorded sign-off, is refused at land with a message saying why. |
| outcome | outcome-7 | story-9 | covered | `/plan` proposes slices for Large features. The operator can decline. |
| outcome | outcome-8 | story-5 | covered | **Custom steps.** When project config places a custom step inside the per-child BUILD loop, land refuses stacked delivery for that plan and names the step. Custom DECIDE steps, and custom steps after the loop, are unaffected. |
| outcome | outcome-9 | story-7, story-8 | covered | **Coverage binding stays feature-scoped.** It runs once before the first child and re-runs on its existing invalidation triggers. A child projection never resets its whole-feature baseline. |
| outcome | outcome-10 | story-3 | covered | **Unsliced and flag-off plans** land exactly as today. |
| story | story-1 | task-2, task-9, task-10, task-17 | covered | Land refuses a story whose tasks span children |
| story | story-2 | task-1, task-2, task-10 | covered | Land refuses a multi-id Story line in a stacked candidate |
| story | story-3 | task-9 | covered | Unsliced and flag-off plans land exactly as today |
| story | story-4 | task-3, task-8, task-11 | covered | Stacked delivery requires Medium/Large tier and a recorded sign-off |
| story | story-5 | task-7, task-8, task-11 | covered | Stacked delivery is refused when a custom step sits in the per-child region |
| story | story-6 | task-4, task-5, task-6, task-8, task-11 | covered | `stacked_prs.max_slices` bounds stacked delivery, and the grammar ceiling is 9 |
| story | story-7 | task-12, task-17 | covered | `coverage_binding` re-checks ownership and eligibility under the current config |
| story | story-8 | task-13, task-14, task-15 | covered | Story ownership is recorded once per feature in the coverage-binding envelope |
| story | story-9 | task-16 | covered | `/plan` proposes slices for Large features and records the operator's decision |
| task | task-1 | story-2 | covered | Story-line reader returns every cited id (infrastructure) |
| task | task-2 | story-1, story-2 | covered | Story-ownership predicate (happy-path) |
| task | task-3 | story-4 | covered | Stacked-delivery sign-off parser (infrastructure) |
| task | task-4 | story-6 | covered | `stacked_prs.max_slices` config key (infrastructure) |
| task | task-5 | story-6 | covered | Consumer registry names the real readers of `stacked_prs` (infrastructure) |
| task | task-6 | story-6 | covered | Grammar ceiling becomes `MAX_CHILD_ID` (happy-path) |
| task | task-7 | story-5 | covered | Per-child-region custom-step classifier (happy-path) |
| task | task-8 | story-4, story-5, story-6 | covered | Stack-eligibility verdict (happy-path) |
| task | task-9 | story-3, story-1 | covered | Land rung `stacked-delivery`: wiring and engagement (happy-path) |
| task | task-10 | story-1, story-2 | covered | Land refuses ownership violations (negative-path) |
| task | task-11 | story-4, story-5, story-6 | covered | Land refuses ineligible stacked delivery (negative-path) |
| task | task-12 | story-7 | covered | `coverage_binding` re-checks ownership and eligibility under the current config (happy-path) |
| task | task-13 | story-8 | covered | Envelope carries optional `storyOwnership` (infrastructure) |
| task | task-14 | story-8 | covered | Runner records ownership feature-scoped, outside the judge (happy-path) |
| task | task-15 | story-8 | covered | Read-only child projection of the feature baseline (happy-path) |
| task | task-16 | story-9 | covered | `/plan` proposes slices and records the sign-off (happy-path) |
| task | task-17 | story-7, story-1 | covered | Stacked-delivery refusals are ordered, non-waivable and pre-judge (negative-path) |
| adr | adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility | story-1, story-2, story-3, story-4, story-5, story-6, story-7, story-8, story-9 | covered | New ADR. Decisions 1–7 are each mapped in the plan obligation table; independently judged correct. |
| adr | adr-2026-09-29-plan-slice-manifest | story-3, story-6, story-7, story-9 | covered | Carries additive #2941 amendment notes on D2, D3, D5, D6 and D8. Each decision is mapped in the plan obligation table and judged correct. |
| adr | adr-2026-08-31-coverage-binding-judge-step | story-7, story-8 | covered | Carries an additive #2941 amendment note on D1 (the feature-scope contract). D2–D24 are no-change for this feature, judged correct. |
| adr | adr-2026-10-03-stacked-child-plans-identity-and-state | story-6, story-8 | covered | Carries an additive #2941 amendment note on decision 5 (land behavior for the slice bound). The other decisions are no-change, judged correct. |
| criterion | Story 1 happy: Given an eligible baseline whose story `1` is cited only by tasks in slice 1 and story `2` only by tasks in slice 2, when `ai-conductor compose land` runs, then the spec commits and land reports no `stacked-delivery` violation. | 9 | covered | "commits the spec and raises no `stacked-delivery` error" | diff-local |
| criterion | Story 1 happy: Given an eligible baseline in which a task with no `**Story:**` line, and a task whose Story line is `n/a`, sit in slice 2 while story `1` is owned by slice 1, when land runs, then the spec commits: infrastructure tasks may sit in any child. | 9 | covered | "also holds a task with no Story line and a task with `**Story:** n/a`" | diff-local |
| criterion | Story 1 negative: Given an eligible baseline except that story `2` is cited by task `T3` in slice 1 and task `T5` in slice 2, when land runs, then land fails with gate `stacked-delivery`, and the message names story `2` and child positions `1` and `2`. No commit is created. | 10 | covered | "throws `landGateError` identifier `stacked-delivery` with a message naming story `2` and positions `1` and `2`, and the worktree has no new commit" | diff-local |
| criterion | Story 1 negative: Given a stacked candidate in which stories `2` and `3` each span slices 1 and 3, when land runs, then one refusal names both stories, each with its child positions, rather than only the first. | 10 | covered | "throws one `stacked-delivery` error naming both stories with their positions" | diff-local |
| criterion | Story 1 negative: Given an eligible baseline in which an engine-appended remediation task cites story `1` from slice 2, when ownership is evaluated, then that task is ignored and no `story-spans-children` violation is reported. | 2 | covered | "an engine-appended remediation task citing story 1 from slice 2 is ignored and yields no `story-spans-children` violation" | diff-local |
| criterion | Story 2 happy: Given an eligible baseline whose every `**Story:**` line carries exactly one id (with or without a `Story ` prefix), when land runs, then the spec commits. | 9 | covered | "commits the spec and raises no `stacked-delivery` error" | diff-local |
| criterion | Story 2 negative: Given an eligible baseline except that task `T2` carries `**Story:** 1, 2`, when land runs, then land fails with gate `stacked-delivery`, and the message names task `T2` and the line text. Story `2` is not silently dropped. | 10 | covered | "with `**Story:** 1, 2` on T2 throws `stacked-delivery` naming task `T2` and the line text" | diff-local |
| criterion | Story 2 negative: Given an eligible baseline except that task `T4` carries `**Story:** FR-1 and FR-2`, when land runs, then the same `multi-story-line` refusal names task `T4`. | 10 | covered | "with `**Story:** FR-1 and FR-2` on T4 throws `stacked-delivery` naming task `T4`" | diff-local |
| criterion | Story 2 negative: Given an **unsliced** plan whose task carries `**Story:** FR-1, FR-2, FR-3`, when land runs, then no multi-story-line refusal is raised and `parsePlanTaskStoryIds` still returns `["FR-1"]` for that task, as it does today. | 1, 10 | covered | "`parsePlanTaskStoryIds` still returns `["FR-1"]` for a task carrying `**Story:** FR-1, FR-2, FR-3`" | diff-local |
| criterion | Story 3 happy: Given an unsliced plan in a project with `stacked_prs.enabled: true`, when land runs, then no `stacked-delivery` check runs, and land's outcome equals the outcome before this change. | 9 | covered | "`landSpec` commits an unsliced plan with `stacked_prs.enabled: true`" | diff-local |
| criterion | Story 3 happy: Given a sliced plan with the flag off (or no `stacked_prs` block) whose story spans two slices, whose tier is `S`, and that has no sign-off, when land runs, then it commits. Only the existing `plan-slices` grammar rung applies. | 9 | covered | "commits a flag-off sliced plan whose story spans two slices, whose tier is `S` and which has no sign-off" | diff-local |
| criterion | Story 3 negative: Given a sliced plan with the flag off that is malformed under the existing grammar (a task in no slice), when land runs, then it still fails with the existing gate `plan-slices` and not with `stacked-delivery`. | 9 | covered | "a sliced plan with a task in no slice fails with identifier `plan-slices` and not `stacked-delivery`" | diff-local |
| criterion | Story 3 negative: Given the flag off and `stacked_prs.max_slices` absent, when a sliced plan with 3 slices lands, then it commits. The default `max_slices` of 1 does not refuse it, because `max_slices` applies only through stack eligibility. | 9 | covered | "a three-slice plan with no `max_slices` commits" | diff-local |
| criterion | Story 4 happy: Given an eligible baseline with `Tier: M` and `Stacked-Delivery: approved`, when land runs, then it commits. | 11 | covered | "`landSpec` on an eligible baseline with `Tier: M` commits" | diff-local |
| criterion | Story 4 happy: Given a complexity artifact containing `stacked-delivery: APPROVED` in a different letter case, when the sign-off is parsed, then it is recognized as approved. | 3 | covered | "`parseStackedDeliverySignoff` returns `approved` for `Stacked-Delivery: approved` and for `stacked-delivery: APPROVED`" | diff-local |
| criterion | Story 4 negative: Given an eligible baseline except `Tier: S`, when land runs, then land fails with gate `stacked-delivery`, and the message says stacked delivery requires tier M or L and names tier `S`. | 11 | covered | "with `Tier: S` throws `stacked-delivery` naming tier `S` and requiring tier M or L" | diff-local |
| criterion | Story 4 negative: Given an eligible baseline whose complexity artifact has no `Stacked-Delivery:` line, when land runs, then land fails, and the message says no operator stacking sign-off is recorded in `.docs/complexity/<stem>.md`. | 11 | covered | "with no `Stacked-Delivery:` line, or with `Stacked-Delivery: pending`, throws `stacked-delivery` stating no operator stacking sign-off is recorded in `.docs/complexity/<stem>.md`" | diff-local |
| criterion | Story 4 negative: Given `Stacked-Delivery: pending` (any value other than `approved`), when land runs, then it is treated as no sign-off and refused with the same message. | 11 | covered | "or with `Stacked-Delivery: pending`, throws `stacked-delivery` stating no operator stacking sign-off is recorded" | diff-local |
| criterion | Story 4 negative: Given a stacked candidate that is both tier `S` and unsigned, when land runs, then one refusal lists both reasons. | 11 | covered | "tier `S` with no sign-off throws one error listing both reasons" | diff-local |
| criterion | Story 5 happy: Given an eligible baseline whose config has a custom step `after: explore` (DECIDE), when land runs, then it commits. | 11 | covered | "customs after `explore`, `coverage_binding` or `build_review` commit" | diff-local |
| criterion | Story 5 happy: Given an eligible baseline whose config has a custom step `after: build_review`, when land runs, then it commits. | 11 | covered | "customs after `explore`, `coverage_binding` or `build_review` commit" | diff-local |
| criterion | Story 5 happy: Given an eligible baseline whose config has a custom step `after: coverage_binding` (before `acceptance_specs`), when land runs, then it commits. | 11 | covered | "customs after `explore`, `coverage_binding` or `build_review` commit" | diff-local |
| criterion | Story 5 negative: Given an eligible baseline whose config has custom step `lint_gate` with `after: test_suite`, when land runs, then land fails with gate `stacked-delivery`, and the message names `lint_gate` as inside the per-child region. | 11, 8 | covered | "`landSpec` with custom `lint_gate` `after: test_suite` throws `stacked-delivery` naming `lint_gate`" | diff-local |
| criterion | Story 5 negative: Given custom step `a` with `after: build` and custom step `b` with `after: a`, when land runs, then the refusal names both `a` and `b`. | 11 | covered | "customs `a` (`after: build`) and `b` (`after: a`) are both named" | diff-local |
| criterion | Story 5 negative: Given a custom step whose `after` target does not resolve, when eligibility is evaluated, then that step is not reported as in-region, and the existing config validator still reports the broken `after`. | 7 | covered | "a custom whose `after` target does not resolve is absent from the returned list" | diff-local |
| criterion | Story 6 happy: Given `stacked_prs: { enabled: true, max_slices: 3 }` and an otherwise eligible plan with 3 slices, when land runs, then it commits. | 11 | covered | "with `max_slices: 3` and 3 slices it commits" | diff-local |
| criterion | Story 6 happy: Given `max_slices: 7`, when config loads, then it is accepted and a warning naming `stacked_prs.max_slices` is logged for a value above 5. | 4 | covered | "accepts integers 1 through 9, emitting a warning naming `stacked_prs.max_slices` for 7" | diff-local |
| criterion | Story 6 happy: Given the flag off and a sliced plan with 7 slices, when land runs, then the `plan-slices` grammar rung accepts it (the ceiling is 9, no longer 5). | 6 | covered | "`landSpec` with the flag off commits a nine-slice plan" | diff-local |
| criterion | Story 6 negative: Given the flag on, `max_slices` absent (default 1), and an otherwise eligible plan with 2 slices, when land runs, then land fails with gate `stacked-delivery`, and the message names 2 slices against `stacked_prs.max_slices` = 1. | 11 | covered | "`landSpec` with the flag on, `max_slices` absent and 2 slices throws `stacked-delivery` naming 2 slices and `stacked_prs.max_slices` = 1" | diff-local |
| criterion | Story 6 negative: Given `max_slices: 10`, `0`, `2.5` or `"3"`, when config loads, then it is a `validation_error` naming `stacked_prs.max_slices`. | 4 | covered | "`max_slices` values 10, 0, 2.5 and the string "3" each produce a `validation_error` naming `stacked_prs.max_slices`" | diff-local |
| criterion | Story 6 negative: Given a sliced plan with 10 slices (flag on or off), when land runs, then the `plan-slices` rung refuses it and names the bound 9. | 6 | covered | "returns `invalid` for a ten-slice plan with a message containing `10` and `9`" | diff-local |
| criterion | Story 6 negative: Given an unknown sub-key under `stacked_prs`, when config loads, then the existing `validation_error` still names the key. | 4 | covered | "an unknown sub-key `max_parallel` under `stacked_prs` still produces the `Unknown key in stacked_prs` validation_error" | diff-local |
| criterion | Story 7 happy: Given a merged eligible plan whose config is unchanged since land, when `coverage_binding` runs, then its ownership/eligibility layer passes and the step continues to its judge layer. | 12 | covered | "for a merged eligible plan under unchanged config, passes the stacked-delivery layer and proceeds to its judge layer" | diff-local |
| criterion | Story 7 happy: Given an unsliced plan, or a sliced plan with the flag off, when `coverage_binding` runs, then the new layer is inert and the step's outcome equals today's. | 12 | covered | "for an unsliced plan and for a sliced plan with `stacked_prs.enabled` false, the runner's result and written envelope equal those of today's runner" | diff-local |
| criterion | Story 7 negative: Given a sliced plan that landed with the flag off and has a story spanning slices 1 and 2, when the operator then enables `stacked_prs.enabled` and `coverage_binding` runs, then the step records `refused` and ends needs-human, naming the story and both positions. No task is appended and nothing routes to `plan`. | 12 | covered | "records envelope status `refused` and returns refusal kind `needs-human` naming story `2` and positions `1` and `2`, with no task appended and no route to `plan`" | diff-local |
| criterion | Story 7 negative: Given a merged eligible plan, when the operator adds a custom step `after: test_suite` and `coverage_binding` runs, then it is refused needs-human, naming that step. | 12 | covered | "adding custom `lint_gate` with `after: test_suite` after land" | diff-local |
| criterion | Story 7 negative: Given a merged eligible plan, when the operator lowers `max_slices` below the slice count, then `coverage_binding` is refused needs-human, naming the count and the bound. | 12 | covered | "lowering `max_slices` to 1 for a 2-slice plan, each yield a `needs-human` refusal" | diff-local |
| criterion | Story 7 negative: Given a refusal at `coverage_binding`, when the halt is inspected, then the same predicate output is present that land would produce for the same plan and config (one owner). | 12, 10 | covered | "the refusal reason equals the reason list `deriveStoryOwnership` and `evaluateStackEligibility` return for the same plan and config" | diff-local |
| criterion | Story 8 happy: Given an eligible plan, when `coverage_binding` passes, then its envelope records `story id → child position` beside the slice membership. | 14 | covered | "writes `storyOwnership` `{ "1": 1, "2": 2 }` beside `sliceMembership` for an eligible plan" | diff-local |
| criterion | Story 8 happy: Given a recorded envelope, when `coverage_binding` is invalidated by an existing trigger and re-runs on an unchanged plan, then the recorded ownership is kept and is equal. | 14 | covered | "a re-run after an existing invalidation trigger on the unchanged plan reads back an equal map" | diff-local |
| criterion | Story 8 negative: Given a recorded ownership, when the judge prompt is assembled, then it contains no ownership field. | 14 | covered | "the judge dispatch payload assembled by the runner contains no `storyOwnership` data" | diff-local |
| criterion | Story 8 negative: Given a recorded ownership, when the completion status is evaluated, then ownership has no effect on it (`COVERAGE_BINDING_COMPLETION_STATUSES` is unchanged). | 13 | covered | "`COVERAGE_BINDING_COMPLETION_STATUSES` is unchanged and an envelope's completion status is identical with and without `storyOwnership`" | diff-local |
| criterion | Story 8 negative: Given a recorded whole-feature baseline, when a projection for one child is computed through the provided feature-scope seam, then the stored baseline (membership plus ownership) is byte-identical before and after. | 15 | covered | "the stored baseline (`sliceMembership` plus `storyOwnership`) serialized before and after the call is byte-identical" | diff-local |
| criterion | Story 8 negative: Given an unsliced or flag-off plan, when `coverage_binding` passes, then no ownership field is written. | 14 | covered | "for an unsliced plan and for a flag-off sliced plan the written envelope has no `storyOwnership` field" | diff-local |
| criterion | Story 9 happy: Given `skills/plan/SKILL.md`, when it is read, then it instructs proposing a `## Slices` manifest for Large features only when `stacked_prs.enabled` is on. On operator acceptance it writes `Stacked-Delivery: approved` into `.docs/complexity/<stem>.md`. It states the one-story-per-child and single-id Story-line rules. | 16 | covered | "instructs proposing a `## Slices` manifest for Large features only when `stacked_prs.enabled` is on (slicing a Medium feature only when the operator asks), writing `Stacked-Delivery: approved` into `.docs/complexity/<stem>.md` only on operator acceptance" | diff-local |
| criterion | Story 9 happy: Given the skill's documented example manifest and Story lines, when parsed by `validatePlanSlices` and the ownership predicate, then the result is `sliced` with no ownership violation. | 16 | covered | "parses the skill's example manifest and Story lines with `validatePlanSlices` and `deriveStoryOwnership` requiring `sliced` with no ownership violation" | diff-local |
| criterion | Story 9 negative: Given the skill text, when it describes an operator decline, then it instructs authoring no manifest and writing no sign-off line. | 16 | covered | "authoring no manifest and no sign-off line on decline" | diff-local |
| criterion | Story 9 negative: Given the skill's example sign-off line, when it is parsed by the sign-off parser, then it is recognized as approved. A drift test fails if the documented line and the parser disagree. | 16 | covered | "parses the skill's example sign-off line with `parseStackedDeliverySignoff` requiring `approved`" | diff-local |
