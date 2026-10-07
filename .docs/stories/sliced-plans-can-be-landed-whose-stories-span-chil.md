**Status:** Accepted

# Stories: Sliced plans — story ownership and stack eligibility (#2941)

Technical track (no PRD). Source: the scope boundary in
`.docs/track/sliced-plans-can-be-landed-whose-stories-span-chil.md` (items 1–7) and
`adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility` (decisions 1–7).

Terms used below:
- **Stacked candidate:** a plan carrying a valid `## Slices` manifest in a project whose config
  resolves `stacked_prs.enabled: true`.
- **Eligible baseline:** a stacked candidate whose complexity artifact has `Tier: L` and
  `Stacked-Delivery: approved`, that has 2 slices with `stacked_prs.max_slices: 2`, that has no
  custom step in the per-child region, and in which every story is cited by tasks of only one slice
  on single-id `**Story:**` lines.

## Story 1: Land refuses a story whose tasks span children

**Requirement:** Scope item 1; ADR decisions 2 and 5

As an operator, I want land to refuse a stacked candidate in which one story's tasks sit in more
than one child, so that every child can turn its own stories green.

### Acceptance Criteria

#### Happy Path
- Given an eligible baseline whose story `1` is cited only by tasks in slice 1 and story `2` only by
  tasks in slice 2, when `ai-conductor compose land` runs, then the spec commits and land reports no
  `stacked-delivery` violation.
- Given an eligible baseline in which a task with no `**Story:**` line, and a task whose Story line is
  `n/a`, sit in slice 2 while story `1` is owned by slice 1, when land runs, then the spec commits:
  infrastructure tasks may sit in any child.

#### Negative Paths
- Given an eligible baseline except that story `2` is cited by task `T3` in slice 1 and task `T5` in
  slice 2, when land runs, then land fails with gate `stacked-delivery`, and the message names story
  `2` and child positions `1` and `2`. No commit is created.
- Given a stacked candidate in which stories `2` and `3` each span slices 1 and 3, when land runs,
  then one refusal names both stories, each with its child positions, rather than only the first.
- Given an eligible baseline in which an engine-appended remediation task cites story `1` from slice 2,
  when ownership is evaluated, then that task is ignored and no `story-spans-children` violation is
  reported.

### Done When
- [ ] A land-spec test with a story spanning slices 1 and 2 asserts `landGateError` identifier
      `stacked-delivery` and a message containing the story id and both positions.
- [ ] A predicate test returns the map `{ "1": 1, "2": 2 }` for the passing baseline.
- [ ] A predicate test with two spanning stories returns two `story-spans-children` violations.

## Story 2: Land refuses a multi-id Story line in a stacked candidate

**Requirement:** Scope item 2; ADR decision 2

As an operator, I want land to refuse a `**Story:**` line that lists several ids in a stacked
candidate, so that ownership is never computed from a truncated citation.

### Acceptance Criteria

#### Happy Path
- Given an eligible baseline whose every `**Story:**` line carries exactly one id (with or without a
  `Story ` prefix), when land runs, then the spec commits.

#### Negative Paths
- Given an eligible baseline except that task `T2` carries `**Story:** 1, 2`, when land runs, then
  land fails with gate `stacked-delivery`, and the message names task `T2` and the line text. Story
  `2` is not silently dropped.
- Given an eligible baseline except that task `T4` carries `**Story:** FR-1 and FR-2`, when land runs,
  then the same `multi-story-line` refusal names task `T4`.
- Given an **unsliced** plan whose task carries `**Story:** FR-1, FR-2, FR-3`, when land runs, then no
  multi-story-line refusal is raised and `parsePlanTaskStoryIds` still returns `["FR-1"]` for that
  task, as it does today.

### Done When
- [ ] The new Story-line reader returns `["1","2"]` for `**Story:** 1, 2` and `["1"]` for
      `**Story:** Story 1`.
- [ ] A land-spec test asserts the `multi-story-line` refusal message names the task and line.
- [ ] The existing `parsePlanTaskStoryIds` tests pass unchanged.

## Story 3: Unsliced and flag-off plans land exactly as today

**Requirement:** Scope boundary; ADR decision 1

As an operator, I want plans outside stacked delivery to be unaffected, so that the 131 existing
plans and every flag-off project behave as before.

### Acceptance Criteria

#### Happy Path
- Given an unsliced plan in a project with `stacked_prs.enabled: true`, when land runs, then no
  `stacked-delivery` check runs, and land's outcome equals the outcome before this change.
- Given a sliced plan with the flag off (or no `stacked_prs` block) whose story spans two slices,
  whose tier is `S`, and that has no sign-off, when land runs, then it commits. Only the existing
  `plan-slices` grammar rung applies.

#### Negative Paths
- Given a sliced plan with the flag off that is malformed under the existing grammar (a task in no
  slice), when land runs, then it still fails with the existing gate `plan-slices` and not with
  `stacked-delivery`.
- Given the flag off and `stacked_prs.max_slices` absent, when a sliced plan with 3 slices lands, then
  it commits. The default `max_slices` of 1 does not refuse it, because `max_slices` applies only
  through stack eligibility.

### Done When
- [ ] Land-spec tests cover an unsliced plan with the flag on, and a spanning, Small, unsigned
      sliced plan with the flag off, and both commit.
- [ ] A flag-off malformed sliced plan fails with identifier `plan-slices`.

## Story 4: Stacked delivery requires Medium/Large tier and a recorded sign-off

**Requirement:** Scope item 3; ADR decisions 3 and 4

As an operator, I want stacked delivery accepted only for M/L features that I signed off during
DECIDE, so that slicing is never applied silently or to Small work.

### Acceptance Criteria

#### Happy Path
- Given an eligible baseline with `Tier: M` and `Stacked-Delivery: approved`, when land runs, then it
  commits.
- Given a complexity artifact containing `stacked-delivery: APPROVED` in a different letter case, when
  the sign-off is parsed, then it is recognized as approved.

#### Negative Paths
- Given an eligible baseline except `Tier: S`, when land runs, then land fails with gate
  `stacked-delivery`, and the message says stacked delivery requires tier M or L and names tier `S`.
- Given an eligible baseline whose complexity artifact has no `Stacked-Delivery:` line, when land
  runs, then land fails, and the message says no operator stacking sign-off is recorded in
  `.docs/complexity/<stem>.md`.
- Given `Stacked-Delivery: pending` (any value other than `approved`), when land runs, then it is
  treated as no sign-off and refused with the same message.
- Given a stacked candidate that is both tier `S` and unsigned, when land runs, then one refusal lists
  both reasons.

### Done When
- [ ] The sign-off parser returns approved for `Stacked-Delivery: approved` (any case) and not
      approved for an absent line or any other value.
- [ ] Land-spec tests assert the tier and sign-off refusal messages, including the combined case.

## Story 5: Stacked delivery is refused when a custom step sits in the per-child region

**Requirement:** Scope item 4; ADR decision 3

As an operator, I want land to refuse stacking when project config places a custom step inside the
per-child BUILD region, so that no child runs a step the per-child loop cannot yet repeat.

### Acceptance Criteria

#### Happy Path
- Given an eligible baseline whose config has a custom step `after: explore` (DECIDE), when land runs,
  then it commits.
- Given an eligible baseline whose config has a custom step `after: build_review`, when land runs,
  then it commits.
- Given an eligible baseline whose config has a custom step `after: coverage_binding` (before
  `acceptance_specs`), when land runs, then it commits.

#### Negative Paths
- Given an eligible baseline whose config has custom step `lint_gate` with `after: test_suite`, when
  land runs, then land fails with gate `stacked-delivery`, and the message names `lint_gate` as
  inside the per-child region.
- Given custom step `a` with `after: build` and custom step `b` with `after: a`, when land runs, then
  the refusal names both `a` and `b`.
- Given a custom step whose `after` target does not resolve, when eligibility is evaluated, then that
  step is not reported as in-region, and the existing config validator still reports the broken
  `after`.

### Done When
- [ ] An eligibility predicate test covers before-region, in-region (direct and chained) and
      after-region customs, classified by the resolved step order.
- [ ] A land-spec test asserts the refusal names the in-region step.

## Story 6: `stacked_prs.max_slices` bounds stacked delivery, and the grammar ceiling is 9

**Requirement:** Scope item 7; ADR decision 7; identity ADR decision 5

As an operator, I want a configurable bound on how many children a stack may have, so that stacking
stays opt-in per project while grammar validation stays flag-independent.

### Acceptance Criteria

#### Happy Path
- Given `stacked_prs: { enabled: true, max_slices: 3 }` and an otherwise eligible plan with 3 slices,
  when land runs, then it commits.
- Given `max_slices: 7`, when config loads, then it is accepted and a warning naming
  `stacked_prs.max_slices` is logged for a value above 5.
- Given the flag off and a sliced plan with 7 slices, when land runs, then the `plan-slices` grammar
  rung accepts it (the ceiling is 9, no longer 5).

#### Negative Paths
- Given the flag on, `max_slices` absent (default 1), and an otherwise eligible plan with 2 slices,
  when land runs, then land fails with gate `stacked-delivery`, and the message names 2 slices
  against `stacked_prs.max_slices` = 1.
- Given `max_slices: 10`, `0`, `2.5` or `"3"`, when config loads, then it is a `validation_error`
  naming `stacked_prs.max_slices`.
- Given a sliced plan with 10 slices (flag on or off), when land runs, then the `plan-slices` rung
  refuses it and names the bound 9.
- Given an unknown sub-key under `stacked_prs`, when config loads, then the existing
  `validation_error` still names the key.

### Done When
- [ ] Config tests cover the default 1, accepted values 1–9, a warning above 5, and refusal of
      10/0/non-integer/non-number.
- [ ] A drift test asserts the stacking bound's maximum accepted value and the grammar ceiling are
      both no greater than `MAX_CHILD_ID`.
- [ ] The consumer registry lists `stacked_prs`, `stacked_prs.enabled` and `stacked_prs.max_slices`
      with land and `coverage_binding` as consumers, replacing the `none` rows reserved for #2724.

## Story 7: `coverage_binding` re-checks ownership and eligibility under the current config

**Requirement:** Scope item 5; ADR decision 5

As an operator, I want build entry to re-evaluate the same rules land applied, using the config in
force at build time, so that a change made after merge cannot build an ineligible stack.

### Acceptance Criteria

#### Happy Path
- Given a merged eligible plan whose config is unchanged since land, when `coverage_binding` runs,
  then its ownership/eligibility layer passes and the step continues to its judge layer.
- Given an unsliced plan, or a sliced plan with the flag off, when `coverage_binding` runs, then the
  new layer is inert and the step's outcome equals today's.

#### Negative Paths
- Given a sliced plan that landed with the flag off and has a story spanning slices 1 and 2, when the
  operator then enables `stacked_prs.enabled` and `coverage_binding` runs, then the step records
  `refused` and ends needs-human, naming the story and both positions. No task is appended and
  nothing routes to `plan`.
- Given a merged eligible plan, when the operator adds a custom step `after: test_suite` and
  `coverage_binding` runs, then it is refused needs-human, naming that step.
- Given a merged eligible plan, when the operator lowers `max_slices` below the slice count, then
  `coverage_binding` is refused needs-human, naming the count and the bound.
- Given a refusal at `coverage_binding`, when the halt is inspected, then the same predicate output
  is present that land would produce for the same plan and config (one owner).

### Done When
- [ ] Runner tests cover the flag turned on after land, a custom step added after land, and
      `max_slices` lowered after land, each refused needs-human with the named reason.
- [ ] A runner test shows the layer is inert for unsliced and flag-off plans.

## Story 8: Story ownership is recorded once per feature in the coverage-binding envelope

**Requirement:** Scope item 6; ADR decision 6

As a later stacked-delivery step, I want each story's owning child recorded on one feature-scoped
baseline, so that per-child acceptance and fix routing read ownership instead of re-deriving it.

### Acceptance Criteria

#### Happy Path
- Given an eligible plan, when `coverage_binding` passes, then its envelope records
  `story id → child position` beside the slice membership.
- Given a recorded envelope, when `coverage_binding` is invalidated by an existing trigger and re-runs
  on an unchanged plan, then the recorded ownership is kept and is equal.

#### Negative Paths
- Given a recorded ownership, when the judge prompt is assembled, then it contains no ownership
  field.
- Given a recorded ownership, when the completion status is evaluated, then ownership has no effect
  on it (`COVERAGE_BINDING_COMPLETION_STATUSES` is unchanged).
- Given a recorded whole-feature baseline, when a projection for one child is computed through the
  provided feature-scope seam, then the stored baseline (membership plus ownership) is byte-identical
  before and after.
- Given an unsliced or flag-off plan, when `coverage_binding` passes, then no ownership field is
  written.

### Done When
- [ ] An envelope round-trip test reads back the recorded ownership after invalidation.
- [ ] A predicate-level test asserts that a child projection leaves the stored baseline unchanged.
- [ ] A judge-prompt test asserts the absence of ownership data.

## Story 9: `/plan` proposes slices for Large features and records the operator's decision

**Requirement:** Scope item 3; ADR decision 4

As an operator authoring a Large feature, I want `/plan` to propose slices and record my sign-off
only when I accept, so that stacking is a deliberate DECIDE choice.

### Acceptance Criteria

#### Happy Path
- Given `skills/plan/SKILL.md`, when it is read, then it instructs proposing a `## Slices` manifest
  for Large features only when `stacked_prs.enabled` is on. On operator acceptance it writes
  `Stacked-Delivery: approved` into `.docs/complexity/<stem>.md`. It states the one-story-per-child
  and single-id Story-line rules.
- Given the skill's documented example manifest and Story lines, when parsed by
  `validatePlanSlices` and the ownership predicate, then the result is `sliced` with no ownership
  violation.

#### Negative Paths
- Given the skill text, when it describes an operator decline, then it instructs authoring no
  manifest and writing no sign-off line.
- Given the skill's example sign-off line, when it is parsed by the sign-off parser, then it is
  recognized as approved. A drift test fails if the documented line and the parser disagree.

### Done When
- [ ] The drift test parses the skill example (manifest, Story lines, sign-off line) with the
      production predicates and passes.
- [ ] The skill text names the Large-only proposal, the decline path, and the two authoring rules.
