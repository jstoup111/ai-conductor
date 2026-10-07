# Track: sliced-plans-can-be-landed-whose-stories-span-chil

Track: technical

Scope boundary: The full child-plan DECIDE/land ticket of the stacked child-plans chain
(jstoup111/ai-conductor#2941; chain design in #2940 section 4.1; foundation shipped via #3019).
Every new gate engages only when a plan carries a `## Slices` manifest AND the target project sets
`stacked_prs.enabled: true`; unsliced plans and flag-off plans land exactly as today.

1. **Story ownership.** One derived predicate, extending `validatePlanSlices`, maps each story to
   exactly one child from task `**Story:**` citations plus manifest membership. Land refuses a story
   whose tasks span more than one child, naming the story and the children. Tasks that cite no story
   (infrastructure) may sit in any child.
2. **Multi-id Story lines.** Refused at land in sliced plans only, instead of silently keeping the
   first id. Unsliced plans keep today's behavior (82 of 131 existing plans use multi-id lines).
3. **Tier and sign-off.** Stacked delivery is accepted only at Medium or Large tier and only with an
   operator sign-off recorded during DECIDE; otherwise land refuses with the reason. `/plan` proposes
   slices for Large features, and the operator can decline.
4. **Custom steps.** When project config places a custom step inside the per-child BUILD region, land
   refuses stacked delivery for that plan, naming the step. Custom DECIDE steps and custom steps after
   the loop are unaffected.
5. **Stack eligibility re-checked at build entry.** Tier, sign-off, flag and custom-step placement
   form one stack-eligibility verdict evaluated at land and again when `coverage_binding` runs, so
   config drift after merge fails closed rather than building an ineligible stack.
6. **Coverage binding stays feature-scoped.** It consumes the same ownership predicate, runs once
   before the first child and re-runs only on its existing invalidation triggers; an explicit
   contract (tested at the predicate level) forbids a child projection from resetting the
   whole-feature baseline, for ticket 3 (per-child BUILD region) to honor.

7. **Configurable stacking bound (owed by `adr-2026-10-03-stacked-child-plans-identity-and-state`
   decision 5).** Add `stacked_prs.max_slices` (default 1; 1–9 accepted, warning above 5,
   `validation_error` at 10 or more). Bound split, operator-confirmed: the flag-independent
   `plan-slices` grammar ceiling becomes `MAX_CHILD_ID` (9), replacing `MAX_PLAN_SLICES` = 5; the
   configured `max_slices` is enforced only in stack eligibility, so a sliced plan above it (or with
   a position above 9) is refused for stacked delivery; a drift test keeps the bound no greater than
   `MAX_CHILD_ID`.

Excluded: the per-child BUILD region itself (ticket 3), restack, leaf gates and fix routing,
publication, per-child custom steps, and any change to unsliced or flag-off land behavior.

Internal harness gating with no end-user product capability; acceptance criteria live in stories.
