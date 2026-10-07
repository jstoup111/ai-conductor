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
   - **Inputs:**
     - the plan text;
     - the `sliced` result of `validatePlanSlices`;
     - the set of story ids declared by `## Story <id>:` headings in the plan's stories artifact,
       read with `splitStoryBlocks`.
   - **Story-line grammar (sliced, flag-on plans only).** For each task, the value of its
     `**Story:**` line is normalized in this order:
     - (a) remove every parenthesized segment;
     - (b) remove everything after the first ` — `, ` – `, ` - ` or `: `;
     - (b2) if the remainder is exactly one non-story value (`n/a`, `none`, `prerequisite`, `all`,
       case-insensitive), the line yields no tokens; stop here;
     - (c) otherwise split the remainder on `,`, `;`, `/`, `&`, `+` and the word `and`;
     - (d) remove a leading `Story`, `Stories` or `epic` word from each token, and drop empty tokens.

     Annotations therefore never create tokens: `FR-14 (source=a, status=b)` is one token.
   - **Infrastructure.** A task owns nothing, and may sit in any child, in any of these cases:
     - it has no Story line;
     - its Story line is exactly one non-story value (`n/a`, `none`, `prerequisite`, `all`). A non-story value
       mixed with ids, as in `1, n/a`, is still a token, so that line is `multi-story-line`;
     - its `**Type:**` is `infrastructure` or `refactor` and no token is a declared story id. This
       is the supporting-purpose form that `coherence-check` allows.
   - Engine-appended remediation tasks stay exempt (`adr-2026-09-29-plan-slice-manifest` D3).
   - **Ownership.** A story is owned by the child (slice position) whose tasks cite it.
   - The result is a typed map `story id → child position`, or typed violations, all reported:
     - `story-spans-children`: the message names the story and every child position whose tasks cite it.
     - `multi-story-line`: the message names the task and the line. A Story line yielding more
       than one token is refused rather than truncated. The one exception is a supporting-purpose line
       on an infrastructure or refactor task, where no token is a declared id: it owns nothing,
       however many tokens it splits into.
     - `unknown-story-id`: the message names the task and the token. A non-infrastructure task cites
       a token that is not a declared story id. Typical causes are a range like `1-3`, a free-text
       purpose, or `US-1` against a declared `1`.
     - `story-unowned`: the message names the story. A declared story is cited by no task, so no
       child would own its acceptance specs.
   - `plan-task-parse.ts` stays the Story-line grammar owner and gains the normalizing reader.
     `parsePlanTaskStoryIds` keeps its current behavior for unsliced plans.

3. **Stack eligibility is one typed verdict in `plan-slices.ts`.** It is a pure function of the
   following inputs:
   - the complexity tier, which must be `M` or `L`. A missing or `S` tier is ineligible;
   - the recorded DECIDE sign-off (decision 4). If it is absent, the plan is ineligible;
   - the slice count against `stacked_prs.max_slices`, and every position against `MAX_CHILD_ID`;
   - the resolved step registry (`buildStepRegistry`). A custom step is **region-coupled** when
     either of these holds:
     - its resolved index lies strictly between `acceptance_specs` and `build_review` (it is inserted
       after `acceptance_specs`, `build`, `test_suite`, or another in-region custom);
     - it is a BUILD-phase step before `build_review` whose resolved definition has `loopGate` or
       `kickbackTarget` true. A per-child gate loop would then re-run it, or kick back into it.
       DECIDE-phase customs are never region-coupled, whatever their `gate` or `kickback_target`.

     A region-coupled step makes the plan ineligible. The message names the step and its coupling:
     `inside the per-child region` for the first case, `coupled to the per-child loop` for the second. Custom DECIDE
     steps, a plain custom step before `acceptance_specs`, and every custom step after
     `build_review` are unaffected. Steps after `build_review` are the whole-feature gates the chain
     runs once on the leaf (#2940 §4.4); routing their kickbacks to a child belongs to the chain's leaf-gates
     ticket (#2940 §7, ticket 5), not this verdict.

   The verdict lists every reason, not the first.

4. **The sign-off is a line in the complexity artifact.** `.docs/complexity/<stem>.md` gains an
   optional `Stacked-Delivery: approved` line. A parser beside `parseComplexityTier` reads it:
   - it is line-anchored (multiline) and case-insensitive;
   - it tolerates bold markers around the key and trailing punctuation after the value;
   - any other value, or the line's absence, means no sign-off.

   `/plan` proposes slices for Large features and writes this line only when the operator accepts
   them. A Medium feature may be sliced only when the operator asks for it. If the operator
   declines, the plan carries no manifest.

5. **Both predicates run at land and again at `coverage_binding`, from one config source.**
   - **Config source:** both points load the project config with `loadConfig(projectRoot)` at evaluation
     time, and build the registry from that result with `buildStepRegistry`. `projectRoot` is the
     repository root, never a feature worktree: land's canonical checkout, and for the runner a new
     `projectRoot` step-runner option that the daemon sets to its own project root. It defaults to
     the runner's project directory for non-daemon runs. A missing project config is the flag-off
     default. The runner does not
     reuse the daemon's start-up config for this layer. That way land and build see the same project values, user-level settings never change a
     project's pipeline (land's existing rule), and a post-merge edit is seen without a daemon
     restart.
   - **Land:** a new `LandGateIdentifier` member, `stacked-delivery`, runs after the `plan-slices`
     rung and the stories reference, approval and readability rungs. It runs before the coherence gate, so no coherence waiver can reach it.
     - Any ownership violation or ineligible verdict throws `landGateError('stacked-delivery', …)`
       with every reason. It is non-waivable, model-free and offline, like D5's rung.
     - For a sliced plan, a project config that is present but invalid also refuses, naming the
       config error. A missing config is today's flag-off default.
   - **`coverage_binding`:** after the existing slice layer and before the judge, the runner
     evaluates both predicates under the freshly loaded config and registry. The layer runs before
     any envelope write in the run. If the fresh load fails, the layer falls back to the daemon's
     start-up config, which preserves today's outcome; land has already refused a sliced plan with
     an invalid config. A violation or an
     ineligible verdict ends needs-human through the existing refusal path, naming every reason.
     - The refusal **leaves the existing envelope untouched**: no `refused` rewrite and no emptied
       entries. Whatever whole-feature baseline existed (including an `invalidated` envelope's D19
       reopen eligibility) therefore survives the refusal and the operator's fix.
     - It never appends a task and never routes to `plan`.

6. **Ownership is recorded, feature-scoped.** On a valid sliced, flag-on run, `coverage_binding`
   records `story id → child position` in its envelope beside the slice membership
   (`adr-2026-09-29-plan-slice-manifest` D6). It follows the same rules as that membership:
   - it is optional;
   - it is kept on invalidation;
   - it is not completion evidence;
   - it never enters the judge prompt.

   `coverage_binding` keeps one whole-feature baseline. It runs before the first child and re-runs
   only on its existing invalidation triggers (`adr-2026-08-31-coverage-binding-judge-step` decisions
   16 and 19). A child projection reads the recorded ownership and must never reset or rewrite the
   whole-feature baseline. The read-only projection `projectChildOwnership` is introduced here, and
   its first production caller is the existing `task … --child <k>` membership check. #2942 adds the
   per-child consumers.

   Emitting an event when a re-run re-owns a story without moving a task is deferred to #2942,
   alongside its position-immutability guard. Here a re-run simply records the current ownership.

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
