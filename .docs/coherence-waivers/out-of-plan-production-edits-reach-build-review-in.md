Waives: outcome-1

Rationale: `outcome-1` of jstoup111/ai-conductor#1390 asks that a commit whose staged files fall
outside its attributed plan task's declared scope "does not land — the commit is refused at the
moment it is written". This spec deliberately does not deliver refusal. The decision is an explicit
operator direction given during DECIDE on 2026-08-09 and recorded in
`.docs/decisions/adr-2026-08-09-non-blocking-plan-scope-containment.md` under "Explicit departure
from intake #1390", in the stories file's scope note, and in the architecture doc. It is waived
here rather than silently re-scoped so the departure is auditable in the spec PR diff.

The reason is measured, not a scope trim. The refusal the intake asks for would be enforced against
the containment floor that exists today, and that floor is exact-or-suffix only
(`fileMatchesPlanPath`, `autoheal.ts:41-45`) with a two-entry allowlist
(`MACHINERY_AUTHORED_PATHS = ['.docs/shipped/', '.pipeline/']`, `build-review-inputs.ts:63`), both
read directly from source at `3faeca78f`. A task declaring `src/foo.ts` would therefore have its
commit refused for also staging `src/foo.test.ts`, a same-directory helper, or `CHANGELOG.md` — all
routine and all necessary. Flipping enforcement would convert one end-of-build kickback into
constant commit-time friction on the common path, which is a worse instance of the very problem
#1390 was filed about. The operator's direction was explicit that the feature must be "helpful
without obtrusive and frustrating", and that kickback friction is already the pain being addressed.

What the intake actually needed is delivered. The four kickbacks it cites did not fail because
out-of-plan paths existed; they failed because those paths reached `build_review` **unexplained**.
Every remaining outcome is met in full: outcome-2 (the advisory names the task and each offending
path), outcome-3 (a rationale is always recorded — trailer verbatim, else derived from the commit
message — so the in-band route needs no operator), outcome-4 (an unresolvable check exits 3 and is
recorded as a `ConductorEvent` visible in `.pipeline/containment-floor.json`), and outcome-5 (no
blocking surface is added anywhere, and the widened floor removes friction rather than adding it).
outcome-1 is met in the weaker form *detected at commit time, recorded durably, never silently
lost*.

Enforcement is not abandoned, only un-scheduled. `build_review.scopeContainmentEnforced` is
retained and exit code 2 is left unused and reserved specifically so a future decision can adopt
refusal without renumbering — but on evidence from the recorded-widening stream rather than on the
assumption the current hook comment encodes. Reopening it requires an ADR superseding
`adr-2026-08-09-non-blocking-plan-scope-containment`; predecessor story TI-7, which framed
report-only as phase one of a plan to enable blocking, has been amended to cancel that progression
rather than defer it, because leaving it standing would put the two specs into a non-terminating
oscillation (`.docs/conflicts/2026-08-09-out-of-plan-production-edits-reach-build-review-in.md`,
CF-2).
