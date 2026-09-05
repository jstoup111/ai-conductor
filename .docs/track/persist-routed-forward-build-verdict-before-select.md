# Track: Persist routed-forward build verdict before selection

Track: technical

Source: jstoup111/ai-conductor#2178

Scope boundary: Persist the existing authorized build route-forward verdict before the next gate selection, replacing an obsolete negative build verdict. Keep route eligibility, retry budgets, unresolved-task reporting, genuine failure behavior, selector precedence, and downstream validation authority unchanged.

The operator authorized complete Small specifications on 2026-09-05, subsequently including unassigned issues and evidence-based Small classification of larger-labeled issues. #2178 is open, unassigned, priority medium, labeled M; direct code inspection establishes the actual change as Small. GitHub blocked-by lookup and issue/PR searches show no dependencies, comments, or existing delivery.

## Explore outcome

Selected approach: write the already-created successful route-forward verdict at the existing post-step verdict persistence seam, as the adjacent finish branch does. Estimated effort: S, under two hours. Impact: the selector reads the route decision from its authoritative gate file instead of burning another build budget.

Alternative: make the selector prefer the in-memory build state or route reason over a persisted negative verdict. Estimated effort: S/M, approximately two to four hours. Impact: bypasses the specific stale record but weakens the general negative-verdict authority; conflicts with the existing selector contract.

Alternative: delete the prior build gate file when routing forward. Estimated effort: S, under two hours. Impact: allows fallback to state, but loses the authoritative reason and timestamp while duplicating an existing persistence mechanism. A positive verdict directly represents the already-made decision.

## Scope and claims

Scope check: consumer-facing engine behavior (the shared conductor tail applies to installed projects as well as this daemon); no new skill; provider agnostic. Registration: none. This changes engine correctness, not a behavioral rule requiring HARNESS.md edits. Event spine: no new channel; the existing gate verdict remains durable state and `gate_verdict` remains the event.

- Verified: `advanceTail` constructs a satisfied verdict for `step.name === 'build' && buildRoutedForward`, but only its synthetic finish verdict is passed to `writeVerdict`.
- Verified: `gateSatisfied` gives persisted verdicts precedence over done state, and stale state still overrides a positive verdict. Changing that precedence is unnecessary.
- Verified: the approved commit-movement liveness ADR authorizes routing budget-exhausted real work to subsequent validation. Its amendment leaves completeness authority with `prd_audit`; this repair does not assert completion.
- Verified: existing tests exercise clean-tree budget routing and direct `advanceTail` calls, but the reported missing-write branch remains present.
- No unconfirmed load-bearing assumptions. Verify-claims: CLEAR.
