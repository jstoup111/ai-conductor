# Complexity: Carry a routed fix up the stack and re-validate the children above (#3212)

Tier: L
Stacked-Delivery: approved

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | The re-validation queue entry gains `position`, per-gate `inputIdentity` and `gates`, and the queue parser fails closed on duplicate children. The restack journal gains `routed` (route, marker and queue old/new values) and the closed-child `invalidation` set. The route record gains a recorded `leafReturn`. There are new `revalidation` and `revalidation-fix` `build_review` base kinds |
| External integrations | None. New git plumbing: the restack's own `opId` exemption from the route-record writer fence, routed and queue lines inside the restack's `applied` `update-ref --stdin` transaction, a delete-marker op, a queue compare-and-swap op, and a temporary-index union merge of appended rem blocks during replay |
| Auth / permission surface | None new. The routed-exit restack must honour the shipped `published-stack` refusal |
| State machines | Host `repairing`→`built`→`restacked` and `repairing`→`done`; round `closed`; `currentHostIndex` progression; queue generations produced, consumed and acknowledged; the `revalidate` round kind; the leaf return. The `built`, `done`, `restacked` and `rerouted` arms of `reconcileRounds` stop deferring, and the preflight gains its `built` arm. Each must recover from a crash between transactions and fail closed against a concurrent writer |
| Story count | ~5: the routed exit restack and host progression; the rem-block replay merge; re-validation queue production and consumption; leaf parking and the return to the leaf; the queue outbox, runbook and flag flip |
| Files touched | ~25: `conductor.ts`, `selector.ts`, `child-cursor.ts`, `child-lifecycle.ts`, `build-review-inputs.ts`, `artifacts.ts`, `config.ts`; `routing/{route-types,route-record-store,round-admission,host-region-entry,execution-child,routing-events,round-receipt}.ts` plus new `routing/{routed-exit,revalidation-queue,rem-block-merge}.ts`; `restack/{restack-executor,restack-recovery,restack-journal,restack-transition,restack-replay,restack-ownership,stack-preflight}.ts`; `docs/runbooks/stalled-or-stuck-feature.md`, `docs/reference/{configuration,artifacts}.md`; plus tests |
| ADR work | Implements the approved `adr-2026-10-12-routed-whole-feature-repair` decisions 13–15 and decision 16's queue outbox, and the amended decisions of other ADRs that the earlier specs' obligation tables assign to #3212. The draft's open contradiction findings, its drift from what specs A–C and #2945 shipped, and the stale D13 obligation row in spec C need a full review |

## Rationale

Large. This spec owns the last commit points of routed repair: the exit restack's `applied`
transaction, which deletes the marker, marks the host `restacked` and writes the next queue
generation in one compare-and-swap on both the normal and recovery paths; the queue acknowledgement;
and the return to the leaf. A mistake leaves a child above a fix unvalidated, parks the leaf forever,
or lets the leaf gates pass over a stack still being repaired. This spec also turns routing on by
default, so every stacked feature reaches this code. The 2026-10-12 draft cannot be taken verbatim:
none of its modules exist, the foundation shipped some of its types in a different shape, and it
misses the writer fence, the delete-marker op and host progression. Re-deriving it needs a full
architecture review.
