# Complexity: Harden intake ledger durability

Tier: M

## Rationale

Medium, not Small:

- **Concurrency semantics are in scope.** The spec introduces a lease-guarded
  read-modify-write across multiple OS processes (7 one-shot CLI ledger sites in
  `engineer-cli.ts` plus the long-running `engineer/loop.ts`). Multi-process mutual
  exclusion with stale-owner recovery is a state-machine concern, not a local edit.
- **Error-contract change with a blast radius.** `loadStore` currently cannot fail;
  after this change it can. Every caller's failure behavior must be considered, and at
  least one (`engineer/loop.ts:258-267`) actively swallows errors today and must change.
- **Integration with an existing subsystem.** Reuses `conduct-state-lease.ts`, which is
  presently coupled to one consumer; generalizing it is part of the work.
- **Durability requirement with recovery semantics.** Original bytes must remain
  recoverable after a corrupt read, which adds a quarantine artifact and its naming and
  collision behavior.

Not Large: no new models, no external integrations, no auth surface, single file of
production logic plus its call sites, and a well-scoped set of stories. No cross-repo
or migration surface — the ledger file format itself is unchanged.
