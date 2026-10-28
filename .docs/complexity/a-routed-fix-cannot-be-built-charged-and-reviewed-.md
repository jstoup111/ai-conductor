# Complexity: Build, charge and review a routed fix on the child that hosts it (#3211)

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | A typed `RoundReceipt`, which replaces the opaque placeholder spec B shipped: per-gate laps, declared growth, taskless counters, a settlement id and per-host acknowledgements. Also an optional obligation `branch`, a pinned closure base on the route record, a `routedRepairCredit` child-ledger field, and a schema'd builder `blocked-by-prerequisite` return |
| External integrations | None. New git plumbing: new `writeRoutingTransaction` ops (host transition to `repairing`, the reroute transaction that moves a branch, the marker and the record together, and the `rejected/<roundId>/<n>` pin), a create-only `red/c<k>` ref in `closeChild`, a `read-tree -m -u` tree sync, and `ls-tree` and exported-symbol presence checks |
| Auth / permission surface | The commit hook gains `Round:` stamping through a new `ai-conductor round-stamp` subcommand. The `task-membership-check` hook and `task-cli` take membership from the committed `Child:` line and the execution projection |
| State machines | Host `admitted`→`repairing`, `repairing`→`reroute-moved`→`rerouted`, destination `pending`→`admitted`; receipt unsettled→settled→acknowledged. `reconcileRounds` gains the `repairing` and `reroute-moved` arms. Each needs crash recovery across a ref transaction and a worktree or ledger write |
| Story count | ~8: host region entry and the frozen append; `Round:`/`Child:` membership and seal rotation; receipt settlement and caps; taskless and FAIL-only charging; branch-bound obligations; routed review base and credit; verified prerequisite reroute; N=1 parity and the restack-journal fence over every new writer |
| Files touched | ~25–30: `conductor.ts`; new `routing/{host-region-entry,round-receipt,prerequisite-claim}.ts`; `routing/{route-types,route-record-store,round-admission,routing-events}.ts`; `remediation-append.ts`, `repair-obligations.ts`, `repair-restage.ts`, `task-progress.ts`, `autoheal.ts`, `task-seed.ts`, `kickback-ledger.ts`, `kickback-budget-cli.ts`, `as-built-projection.ts`, `child-lifecycle.ts`, `artifacts.ts`, `build-review-inputs.ts`, `child-cursor.ts`, the testQuality preflight and materialisation, `protected-artifact-seal.ts`, `git-hook-assets.ts`, the new `round-stamp-cli.ts`, `task-membership-check-cli.ts`, `task-cli.ts`, `restack/restack-recovery.ts`, `restack/stack-preflight.ts`, plus tests |
| ADR work | Implements the approved `adr-2026-10-12-routed-whole-feature-repair` decisions 5 and 9–12 and the amended decisions of other ADRs that #2944's obligation table assigns to #3211. The operator-confirmed move of the re-validation pieces to #3212 and the open findings carried from the draft need to be recorded and resolved in a full review |

## Rationale

Large. This spec owns the routing core's commit points. These are the frozen-block append and the
`repairing` transition, the receipt settlement that charges a round exactly once, and the reroute
transaction that resets a branch. Each must stay correct across a crash, a worktree recreation and
a concurrent writer. A mistake double-charges or refunds a budget, closes a repair with stale
trailers, or loses builder work on a reroute. The routing flag stays default-off, but the draft
carries open contradiction findings, and its dependencies have drifted from what spec B shipped.
Resolving both needs a full architecture review.
