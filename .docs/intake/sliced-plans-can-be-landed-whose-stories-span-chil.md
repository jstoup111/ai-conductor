# Intake origin: sliced-plans-can-be-landed-whose-stories-span-chil

Source-Ref: jstoup111/ai-conductor#2941
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2941 digest=63d436d3609570a1d3a46efb8776f054cefcc9752efbf7416a51fcc3093fa96d >>>
## Desired outcome

- **Story ownership.** In a sliced plan, every story belongs to exactly one child, and that ownership can be read back mechanically.
- Land refuses a plan in which any story's tasks span more than one child, naming the story and the children.
- Land refuses a `**Story:**` line that lists more than one id, instead of silently dropping ids.
- Tasks that cite no story (infrastructure) may sit in any child.
- **Tier and sign-off.** A sliced plan is accepted for stacked delivery only at Medium or Large tier, and only with an operator sign-off recorded during DECIDE.
- A Small-tier sliced plan, or one with no recorded sign-off, is refused at land with a message saying why.
- `/plan` proposes slices for Large features. The operator can decline.
- **Custom steps.** When project config places a custom step inside the per-child BUILD loop, land refuses stacked delivery for that plan and names the step. Custom DECIDE steps, and custom steps after the loop, are unaffected.
- **Coverage binding stays feature-scoped.** It runs once before the first child and re-runs on its existing invalidation triggers. A child projection never resets its whole-feature baseline.
- **Unsliced and flag-off plans** land exactly as today.
<<< END INBOUND >>>
