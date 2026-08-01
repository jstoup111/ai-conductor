# Complexity: park-reconciliation refusal observability

Tier: M

## Rationale

The change itself is narrow — split one overloaded refusal reason, add a refusal counter to an
existing summary line, and correct a governing ADR. No new models, no new integrations, no auth
surface, no new state machine. On raw implementation size alone this reads Small.

It is classified **Medium** because the work amends a *deletion-authority contract*:

- `adr-2026-07-27-ancestry-proven-park-reconciliation` §3 currently states that git ancestry is the
  ONLY deletion authority. That statement is already false in shipped code — #1185 added a second
  proof (merged-PR head identity, `isSquashMergedAtTip`) without amending the ADR. Correcting a
  governing ADR is an `/architecture-review` output, and the Small tier skips that step entirely.
- The refusal vocabulary is load-bearing for a destructive path. `not-ancestor` is currently
  asserted verbatim by the unit refusal table (`test/engine/park-reconciliation.test.ts:141-181`),
  by four squash-merge cases (`:294`, `:321`, `:349`, `:225`), and by the acceptance raced-branch
  test (`parked-feature-reconciliation.acceptance.test.ts:862`, which matches `/ancestor/i` on
  operator output). Splitting the reason touches every one of those contracts, so the story set
  needs conflict-check and a committed traceability mapping rather than a bare plan.
- Two independent call sites must stay behaviorally identical (the daemon sweep in
  `daemon-cli.ts:1706` and the operator verb `conduct daemon reconcile-parked` in
  `daemon-park-cli.ts:168-193`), plus a dashboard annotation map and a documented CLI refusal
  table in `docs/reference/cli.md:242-278`.

Estimated 5-7 stories. Medium runs `/architecture-diagram`, a lightweight `/architecture-review`
(which carries the ADR amendment), `/conflict-check`, and `/coherence-check`.
