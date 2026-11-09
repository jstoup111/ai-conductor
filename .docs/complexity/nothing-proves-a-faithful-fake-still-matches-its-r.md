# Complexity: Paired fake-and-real contracts for external boundaries

Tier: M

## Rationale

- Adds one reusable test mechanism. A boundary contract is written once and run in two legs: against
  the boundary's faithful fake in the default suite, and against its real adapter as an opt-in smoke
  file under the existing smoke-capability machinery.
- Extends the existing boundary registry (`test/structural/boundary-registry.ts`, #3660) with a
  structural obligation. A `ported` boundary must register a paired contract for every adapter. The
  seven pending migrations (#3043, #3633–#3639) therefore each inherit their contract mechanically.
- Ships the first contract, `llm`, across three adapters (Claude, Codex, Pi). This needs two new
  shared fakes (Claude, Pi) beside the existing `test/fixtures/codex-provider-fake.ts`.
- All changes are confined to `src/conductor/test/` and the registry's structural tests. There is no
  production surface, contract-surface, or schema change, and no new layer or dependency. It records
  one structural decision (the contract obligation on the boundary registry).
- Operator-confirmed tier: M (2026-11-08). The source issue carries `size: M`.

Per tier rules, the following run: architecture-diagram, lightweight architecture-review,
conflict-check, coherence-check, and plan-review.
