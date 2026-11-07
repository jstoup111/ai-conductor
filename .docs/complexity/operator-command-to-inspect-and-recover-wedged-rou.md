# Complexity: Operator command to inspect and recover wedged routed rounds

Tier: M

## Rationale

- Adds one operator CLI family, `ai-conductor stack rounds`, with a read-only inspect form and one guarded
  write form. Both are registered beside `stack land` in `cli.ts`, `cli-pre-dispatch.ts` and `index.ts`.
- The write reuses existing routing machinery: `writeRoutingTransaction`, the feature dispatch lease,
  stack-land eligibility, and the route-record outbox. It adds no new store, ref namespace or ledger field.
- It adds one routing occurrence to the `ConductorEvent` union, carried through the route-record outbox,
  so the event spine and its persister dedup are touched.
- It must compose with the unbuilt spec #3462 for #3445, which reshapes `reconcileRounds` and adds a round
  admission fence in `routing/round-admission.ts`. That interaction warrants a lightweight architecture
  review, a conflict check, and an ADR check against `adr-2026-10-12-routed-whole-feature-repair`.
- It is not Large: it adds no new subsystem, has no multi-feature rollout, and leaves the routing state
  machine unchanged. Closing an open round is already a legal `open → closed` phase transition.
