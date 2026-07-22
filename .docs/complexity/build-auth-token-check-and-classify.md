# Complexity: build-auth-token-check-and-classify

Tier: M

## Rationale

- **Cross-cutting behavior change:** extending auth-failure classification
  (`AUTH_FAILURE_RE` / result-flag precedence in `claude-provider.ts`) alters retry
  semantics on BOTH dispatch paths — the serial conductor loop (`conductor.ts:3096`)
  and the concurrent group core (`group-core.ts:493`) — under the park-and-poll ADR
  (never retry, never escalate). Misclassification risk is real in both directions.
- **New integration point:** token liveness verification (API probe or CLI-based
  probe) is net-new; no verification exists anywhere today. Mechanism carries an
  open assumption to resolve in architecture review.
- **Two runtimes touched:** bash (`bin/install --check`) and TypeScript (conductor);
  the token path/mode are resolved in TS config, so the check must not re-derive
  them in bash — a small seam is needed.
- **No new data models, no schema/state machines, story count est. 4-6** — which
  keeps this out of L.

M ⇒ full artifact set: architecture-diagram, lightweight architecture-review,
conflict-check, in addition to PRD/stories/plan.
