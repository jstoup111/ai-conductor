Waives: outcome-2

Rationale: `outcome-2` of jstoup111/ai-conductor#1425 asks that a validation-group member get a
retry allowance comparable to the serial path, or that the asymmetry be a documented decision.
That allowance is delivered by #2190, not by this spec: `.docs/stories/a-halted-feature-only-re-runs-when-a-human-clears-.md`
Story 1 ("Validation-group members get the same attempt budget as the serial path") is accepted
on main, and its build (PR #2206) already carries `runGroupBranch(…, resolved.max_retries)` in
place of the literal `1`. Conflict-check on 2026-09-06 found the overlap and the operator chose to
drop the duplicate story from this spec rather than deliver the same line twice
(`.docs/conflicts/one-transient-failure-in-a-validation-group-member.md`).

The dependency is recorded mechanically, not by prose: #1425 carries a GitHub `blocked_by` link to
#2190, which the daemon's dependency gate reads, so this spec cannot dispatch before the budget
exists. Story 3's retry criterion ("throws once and passes on its next attempt within its resolved
`max_retries` (the #2190 budget)") then exercises the delivered allowance on the re-dispatch path
this spec owns.

The corpus justification for the budget — adr-2026-07-10-concurrent-group-core D5 and
adr-2026-07-05-retry-as-escalation-ladder D4 — is recorded in this spec's architecture review so
the decision is documented either way, which is the outcome bullet's alternative form.
