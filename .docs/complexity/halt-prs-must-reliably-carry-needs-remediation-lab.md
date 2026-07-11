# Complexity: Halt PRs must reliably carry needs-remediation label + draft status

Tier: M

## Rationale

**Medium**, not Small or Large.

Signals pushing above Small:
- Adds a new **verify-after-write + bounded-retry** layer over the gh seam (`pr-labels.ts`).
- Adds a new **reconciliation sweep** subsystem wired into daemon startup and the periodic tick.
- Changes the escalation path: durable body marker + draft conversion on the PR-reuse path.
- Multiple **negative/adversarial paths**: label write fails first attempt, rate-limited draft
  conversion, reused ready PR, sweep encountering a PR missing only one of {label, draft}.
- Integration behavior against GitHub (gh CLI/REST) requiring injected-runner test coverage.

Signals keeping it below Large:
- No new persistent data model, schema, or migration.
- No new auth/identity or trust boundary.
- No new external service or cross-repo protocol; scoped to one existing seam plus one sweep.
- No complex multi-state machine — convergent "re-assert desired state" idempotent logic.

Estimated story count: ~6–9 (escalation verify+retry, reuse-convert-to-draft, body-marker write,
reconciliation enumeration, reconciliation re-assert, removal-on-finish verify, plus negative paths).

Medium tier ⇒ architecture-diagram + (lightweight) architecture-review + conflict-check all run.
