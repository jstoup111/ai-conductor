# Track: Re-kick resume gate invalidation regression coverage

Track: technical

Source: jstoup111/ai-conductor#2046

Scope boundary: Complete the four regression-coverage outcomes in #2046 using the existing daemon re-kick resume entry point. Deliver tests for existing invalidation, preservation, and mechanical re-verification telemetry, including sensitivity to loss of the resume emission. No runtime policy, event schema, emitter, or sink change.

The operator authorized complete, unambiguous Small DECIDE specifications and pushed spec PRs on 2026-09-05; pause if implementation decisions become ambiguous. This is test coverage for an existing internal engine behavior, not a new product capability.

## Explore outcome

Selected: extend the real-local-Git resume fixture already in `src/conductor/test/engine/daemon-rekick.test.ts`. It directly invokes `resumeRebaseFirst`, retains real rebase classification and event emission, and stops when resume returns. Estimated effort: S, approximately one hour. Impact: dropping resume-path gate telemetry becomes a regression failure.

Alternative: adapt the in-loop integration fixture in `src/conductor/test/integration/rebase-loop.test.ts`. Estimated effort: S, approximately one to two hours. Impact: equivalent coverage, but requires replacing its in-loop driver and introduces unnecessary fixture duplication. The existing direct resume fixture makes this unnecessary.

Alternative: mock the rebase result and emission helper. Estimated effort: S, under one hour. Impact: checks call wiring but cannot prove that a real file-changing rebase reaches the correct event classifications; insufficient for the issue's stated outcome.

## Verified context and assumptions

- Verified: #2046 is open, assigned to jstoup111, priority medium, size S, has no comments and no GitHub blocked-by dependencies on 2026-09-05. No PR found by issue search.
- Verified: `resumeRebaseFirst` calls `applyRebaseVerdicts`, emits mechanical re-verification records, and invokes `emitGateInvalidationEvents` on its actual rebase outcome.
- Verified: existing resume tests assert a budget-preserved `test_suite` event and a mechanically reverified `test_suite` event; no resume test asserts `rebase_gate_invalidated`. Those existing tests do not satisfy the missing per-gate coverage.
- Verified: the approved delta-aware invalidation design and current `GATE_SURFACE` provide the existing behavior; this work changes no decision or gate policy.
- No unconfirmed load-bearing assumptions. Verify-claims: CLEAR.

Operator decision 2026-09-05: approve testing the existing preservation payload (option A), with a separate intake follow-up for any inaccurate PRD-audit preservation metadata. That follow-up is not a prerequisite for this regression coverage and does not authorize runtime payload edits here.

Scope check: audience harness-repo-only (daemon regression coverage); catalog n/a; provider agnostic. Registration: none. Event spine: no added channel; observe the existing ConductorEventEmitter variants.
