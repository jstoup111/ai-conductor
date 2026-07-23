# Complexity: engineer unclaim/requeue verb — stale `claimed` ledger recovery

Tier: M

## Rationale

**Medium**, not Small — the change spans several integration points and carries a
non-trivial safety trade-off, but introduces no new subsystem, data model, or auth surface.

Signals:
- **Integrations (3):** the claim-time `delivery-guard` heal pass (extend with a stale-`claimed`
  reap rule), the `Ledger` (new `claimed → pending` transition, distinct from `reopen`'s
  `done → pending`), and the `engineer` CLI (two new verbs: `unclaim`, `requeue --stale`).
- **External call:** the bulk `requeue --stale` liveness-checks each entry's GitHub issue
  (`gh`) to route closed issues to `forget` instead of re-queue (the #279 rule).
- **State machine:** a guarded ledger transition with a real correctness hazard — auto-reaping
  a `claimed` entry that a live session is still working reintroduces the #243 duplicate-claim,
  which the staleness threshold + manual-override design must bound.
- **Config:** a staleness threshold (default + `--older-than` override) is a new tunable.
- **Story count:** ~6–8 (auto-heal happy path, threshold boundary, live-session safety,
  `unclaim` happy + refuse-on-`done`, `requeue --stale` bulk, liveness→`forget`, FIFO preservation).

Not Large: no new models, no auth, no new subsystem — a bounded extension of existing
claim/ledger/CLI machinery. Architecture-review is therefore lightweight (Medium).
