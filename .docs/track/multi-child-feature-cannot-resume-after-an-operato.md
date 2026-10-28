# Track: Remove the coverage_binding step so stacked features resolve their children from the sealed plan

Track: technical

Scope boundary: delete the engine's `coverage_binding` lifecycle step and its engine code (the step
runner, the coverage-binding envelope, the reseal void, and their wiring in the step registry, gate
predicate, rebase refresh, model policy, events, and docs). Every reader of the envelope instead
derives slice topology (positions, task membership, titles, story ownership, stack eligibility)
from the feature's committed, sealed plan through `plan-slices.ts`, with the durable
`refs/conductor/<slug>/positions` ref as the authority once children exist. `reseal` refuses a plan
change that moves, adds, or removes a slice position on a feature with child state. When the stack
cursor genuinely cannot be resolved, the run writes its own HALT naming the cause and a working
recovery command instead of the daemon's generic "loop ended without DONE or HALT". Existing
`coverage_binding:` and `steps.coverage_binding` configuration keys still load and are ignored with
a warning, and leftover `coverage_binding` conduct-state, verdict, and envelope files are ignored.
Flat (N=1) features keep today's behavior. Kept: `skills/coverage-binding/SKILL.md`, which plan
authoring §7a still loads as the plan-time coverage-judge policy. Excluded: the stale in-memory
conduct state after a stacked restack (#3366's underlying class, which this removal leaves without
its observed trigger; the operator reopens it if it recurs); tasks moved between existing slices
are not checked against closed children (pre-existing gap); any change to the plan-time coverage
judge.

Fixes jstoup111/ai-conductor#3365 at its source: no step, envelope, or void remains to strand the
cursor. Removes #3366's trigger (the rebase reopen of `coverage_binding`). Engine-internal removal
plus a narrow reseal guard and halt; acceptance criteria live in stories.
