# ADR: Sliced plans bind each story to one child and are re-checked for stack eligibility at build entry

**Date:** 2026-10-07
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer DECIDE session for jstoup111/ai-conductor#2941

<!-- Filename convention: adr-2026-10-07-<kebab-slug>.md (no sequential numbers). -->

## Context

#2941 is the DECIDE/land half of the stacked child-plans chain (#2940–#2949). The `## Slices`
manifest and `validatePlanSlices` exist (`adr-2026-09-29-plan-slice-manifest`), and child identity
and per-child state exist (`adr-2026-10-03-stacked-child-plans-identity-and-state`, shipped via
#3019). Nothing yet makes a sliced plan safe to build as independent children.

Facts this rests on (verified in this worktree at `7eb8e39566`):

- **Story citations are lossy.** `STORY_LINE` in `plan-task-parse.ts` captures one id per
  `**Story:**` line, so `FR-1, FR-2` keeps only `FR-1`. 82 of 131 plans in `.docs/plans/` use
  multi-id Story lines (411 lines), so refusing them everywhere would change land for most
  unsliced plans.
- **`validatePlanSlices(planText)` sees only plan text.** Nothing relates stories to slices.
- **The `plan-slices` land rung runs at every tier and ignores `stacked_prs.enabled`**
  (`adr-2026-09-29-plan-slice-manifest` D5, `land-spec.ts:386`).
- **Land already loads the target project config** (`land-spec.ts:479`). The `coverage_binding`
  runner already holds `HarnessConfig` and a `buildStepRegistry` result
  (`step-runners.ts:1026-1027`), and already calls `validatePlanSlices` (`step-runners.ts:4752`).
- **The tier is a line in `.docs/complexity/<stem>.md`**, parsed by `parseComplexityTier`
  (`artifacts.ts:4184`). Track and intake markers follow the same one-line parser pattern.
- **Custom steps resolve their position from `after`** (`steps.ts:588-602`). A custom step can
  therefore land between `acceptance_specs` and `build_review`, which is the per-child region in the
  chain design (#2940 §4.3).
- **The identity ADR (decision 5) assigns #2941** the `stacked_prs.max_slices` key and the land
  refusal for a manifest above the configured maximum or with a position above `MAX_CHILD_ID` (9).
- **None of the 4 plans on main that carry `## Slices`** (`grep -l '^## Slices' .docs/plans/*.md`) is
  in a project with `stacked_prs.enabled` on, so flag-gating the new rungs changes no landed plan.

## Options Considered

### Option A: Derived ownership, checked at land only
One ownership predicate in `plan-slices.ts`, derived from task Story citations plus manifest
membership, called by land. Rejected: land runs under the config that existed at land time. A flag
turned on after merge, or a custom step moved into the region, would build an ineligible stack.

### Option B: Ownership declared in a `Stories` column of the manifest
Rejected: a second source of truth that can drift from task citations. It also changes the manifest
grammar fixed by `adr-2026-09-29-plan-slice-manifest` D1 and adds authoring burden to `/plan`.

### Option C (chosen): Derived ownership plus one eligibility verdict, evaluated at land and at build entry
Option A's single owner, with tier, sign-off, flag, slice bound and custom-step placement folded
into one stack-eligibility verdict. Land and `coverage_binding` both evaluate it.

## Decision

1. **Engagement: sliced and flag on.** Every rung this ADR adds engages only when the plan carries a
   `## Slices` manifest **and** the target project resolves `stacked_prs.enabled: true`. An unsliced
   plan, or a sliced plan with the flag off, lands and binds exactly as today. The existing
   `plan-slices` grammar rung stays flag-independent (`adr-2026-09-29-plan-slice-manifest` D5).
   Decision 5 below closes the flag-turned-on-later gap that D5's flag independence guarded.

2. **Story ownership is derived by one predicate in `plan-slices.ts`.**
   - Inputs: the plan text and the `sliced` result of `validatePlanSlices`.
   - A story is owned by the child (slice position) whose tasks cite it on a `**Story:**` line.
   - A task that cites no story, or cites only the existing non-story tokens (`n/a`, `none`,
     `prerequisite`, `all`), is infrastructure. It owns nothing and may sit in any child.
   - Engine-appended remediation tasks stay exempt (`adr-2026-09-29-plan-slice-manifest` D3).
   - The result is a typed map `story id → child position`, or typed violations:
     - `story-spans-children`: the message names the story and every child position whose tasks cite it.
     - `multi-story-line`: the message names the task and the line. A `**Story:**` line with more
       than one id is refused rather than truncated.
   - `plan-task-parse.ts` stays the Story-line grammar owner. It gains a reader that returns every
     id on a line. `parsePlanTaskStoryIds` keeps its current behavior for unsliced plans.

3. **Stack eligibility is one typed verdict in `plan-slices.ts`.** It is a pure function of the
   following inputs:
   - the complexity tier, which must be `M` or `L`. A missing or `S` tier is ineligible;
   - the recorded DECIDE sign-off (decision 4). If it is absent, the plan is ineligible;
   - the slice count against `stacked_prs.max_slices`, and every position against `MAX_CHILD_ID`;
   - the resolved step order. A custom step is inside the per-child region when its resolved
     position falls after `acceptance_specs` and before `build_review` (that is, it is inserted after
     `acceptance_specs`, `build`, `test_suite`, or another in-region custom step). Such a step makes
     the plan ineligible, and the message names the step. Custom DECIDE steps, a custom step placed
     before `acceptance_specs`, and a custom step after `build_review` are unaffected.

   The verdict lists every reason, not the first.

4. **The sign-off is a line in the complexity artifact.** `.docs/complexity/<stem>.md` gains an
   optional `Stacked-Delivery: approved` line. It is parsed by a one-line parser beside
   `parseComplexityTier` that follows the same shape and is case-insensitive. Any other value or
   absence means no sign-off. `/plan` proposes slices for Large features and, only when the operator
   accepts them, writes this line. A Medium feature may be sliced only when the operator asks for it.
   The operator can decline, and then the plan carries no manifest.

5. **Both predicates run at land and again at `coverage_binding`.**
   - **Land:** a new `LandGateIdentifier` member, `stacked-delivery`, runs after `plan-slices`. Any
     ownership violation or ineligible verdict throws `landGateError('stacked-delivery', …)` with
     every reason. It is non-waivable, model-free and offline, like D5's rung.
   - **`coverage_binding`:** after the existing slice layer and before the judge, the runner
     evaluates both predicates under the **current** config and step registry. A violation or an
     ineligible verdict records `refused` and ends needs-human through the existing refusal path,
     naming every reason. It never appends a task and never routes to `plan`.

6. **Ownership is recorded, feature-scoped.** On a valid sliced, flag-on run, `coverage_binding`
   records `story id → child position` in its envelope beside the slice membership
   (`adr-2026-09-29-plan-slice-manifest` D6). It follows the same rules as that membership:
   - it is optional;
   - it is kept on invalidation;
   - it is not completion evidence;
   - it never enters the judge prompt.

   `coverage_binding` keeps one whole-feature baseline. It runs before the first child and re-runs
   only on its existing invalidation triggers (`adr-2026-08-31-coverage-binding-judge-step` decisions
   16 and 19). A child projection, which #2942 introduces, reads the recorded ownership and must never
   reset or rewrite the whole-feature baseline. A predicate-level test fixes this contract now.

7. **The slice bound splits in two.**
   - **Grammar ceiling:** the flag-independent `plan-slices` rung bound becomes `MAX_CHILD_ID` (9).
     It replaces `MAX_PLAN_SLICES` = 5. It is only looser, so no plan that lands today is refused.
   - **Stacking bound:** `stacked_prs.max_slices` is added to the `stacked_prs` block, as the
     identity ADR (decision 5) requires: default 1, values 1–9 accepted, a warning above 5, and a
     `validation_error` naming the key at 10 or more. It is enforced only through stack eligibility
     (decision 3).
   - A drift test keeps the stacking bound no greater than `MAX_CHILD_ID`.
   - The consumer registry records `stacked_prs.max_slices` as consumed by land and
     `coverage_binding`.

## Consequences

### Positive
- Every story has exactly one owning child, and that ownership can be read back from the envelope.
  This gives #2942's fix routing and per-child acceptance specs a mechanical source.
- One owner per question: land and build entry cannot disagree (the #1744 shared-predicate
  precedent).
- Config drift after merge fails closed instead of building an ineligible stack.
- Unsliced and flag-off plans are untouched, including the 82 plans with multi-id Story lines.

### Negative
- With the flag on, a sliced plan that passed land can still be refused at `coverage_binding` after a
  config change. That costs an operator round-trip, accepted because the alternative is building a
  stack that cannot be published.
- The sign-off is an authored line. It records the operator's decision but cannot prove who wrote it.
  The same holds for every DECIDE marker, and composer's operator gates are the control.
- Medium-tier slicing has no automatic proposal. It needs an explicit operator ask.

### Follow-up Actions
- [ ] #2941: implement decisions 1–7.
- [ ] #2942: consume the recorded ownership for per-child acceptance specs and fix routing, and honor
      the decision 6 baseline contract.
