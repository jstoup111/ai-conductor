# Architecture Review: Operator command to inspect and recover wedged routed rounds
**Date:** 2026-10-29
**Mode:** Lightweight (Tier M): §2 Technical Feasibility and §4 Architectural Alignment
**Inputs reviewed:** explore output and track `.docs/track/operator-command-to-inspect-and-recover-wedged-rou.md`
(scope: outcome 3 of jstoup111/ai-conductor#3459 only); approved diagram
`.docs/architecture/operator-command-to-inspect-and-recover-wedged-rou.md`;
`adr-2026-10-12-routed-whole-feature-repair` as amended by #3203, #3445 and #3455; and
`adr-2026-10-24-operator-route-round-for-closed-stacked-children`.
**Verdict:** APPROVED WITH CONDITIONS

## Technical intent

1. **Inspect.** `ai-conductor stack rounds --slug <slug>` is read-only. It prints every routed round with its
   kind, phase, hosts, current host, receipt settlement state and outbox length, plus the repair marker. It
   names the wedge shape when it sees one: an open round with no active host and an unadmitted pending host,
   while the marker names another round.
2. **Close a superseded round.** `ai-conductor stack rounds --slug <slug> --close <rN> --reason <text>`
   closes one open `audit` round. It runs under the feature dispatch lease and needs an approved operator identity.
   It moves the round's `pending` hosts to `done` and writes `phase: closed` in one compare-and-swap. In the
   same transaction it places a new `routing_round_superseded` occurrence in the round's outbox.
3. **Refusals.** The close refuses, writing nothing, when any of these holds:
   - routing is off, or the feature has no durable child state;
   - the dispatch lease is held;
   - there is no approved operator identity, or the reason is empty;
   - the round is absent, unreadable or not `open`;
   - the round's kind is not `audit`. A `revalidate` round's queue entry was consumed at admission, so closing it would skip a closed child's revalidation, and an `operator` round has its own `stack land --abandon`;
   - any host is `admitted`, `repairing`, `built`, `reroute-moved`, `abandoning` or `abandoned`;
   - the record carries an in-progress `reroute`;
   - the repair marker names the round, or is unreadable;
   - no other round is non-closed.

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Pure TypeScript in the existing engine. No new package, service or ref. (verified, 98%) |
| Prerequisites | None. The CLI reuses primitives already on main: `resolveCliFeatureWorktree` and `resolveMachineOperatorIdentity` (`engine/cli-operator-authority.ts`), `acquireFeatureDispatchLease` (`engine/feature-dispatch-lease.ts`), `readRouteRecord`, `readRepairMarker` and `writeRoutingTransaction` (`engine/routing/route-record-store.ts`), and `withOutboxEvent` (`engine/routing/routing-events.ts`). (verified, 97%) |
| Integration surface | CLI registration (`cli.ts`, `cli-pre-dispatch.ts`, `index.ts`, `types/cli.ts`), one new module `engine/stack-rounds-cli.ts`, one event union member (`types/events.ts`), and persister dedup (`engine/event-persister.ts`, whose routing dedup list holds `remediation_routed`, `operator_round` and others). Advisory overlap scan over these paths: no overlap, no open blockers. |
| Data implications | `RouteRecord`, the marker blob and the kickback ledger keep their shapes. The record parser already accepts a `closed` round whose hosts are all `restacked`, `done`, `rerouted` or `abandoned` (`hasConsistentRouteLifecycle`, `route-types.ts`). The written state is therefore parseable without a parser change. (verified, 95%) |
| Budget | A round charges the ledger only when its receipt settles at the host's BUILD dispatch (`settleRoundAtDispatch`, then `applySettledReceiptToLedger` in `round-receipt.ts`). Closing a superseded round keeps any settled charge, and its unsettled charges were never applied. Taskless counts are rebuilt from every receipt, closed or not, so they are unchanged. The operator flagged this as an unknown in #3459; the close changes no accounting. (verified, 92%) |
| Performance | One `for-each-ref` plus one blob read per round, bounded by `MAX_ROUTE_ROUNDS`. |
| Worktree isolation | The CLI acts on one feature worktree resolved by slug, under that feature's dispatch lease. It touches no shared port, database or global file. |

## Alignment

- **Governing decision reuse.** Round phases and host states are governed by decision 6 of
  `adr-2026-10-12-routed-whole-feature-repair`. Writers under an operator CLI follow the #3203 amendment to
  decision 7. Spine events through the record outbox follow decision 16. No new ADR is drafted. The feature adds
  one new writer for an existing transition (`open → closed`), so it amends decisions 6, 7 and 16 in place
  (see ADRs Created).
- **Why `done`, not `abandoned`.** `reconcileRounds` (`routing/round-admission.ts`) returns `unavailable` for any
  `abandoned` or `abandoning` host on a round whose kind is not `operator`. Writing `abandoned` on an audit round
  would re-wedge the feature. `done` is a closed-round terminal state that reconciliation already skips.
  (verified, 95%)
- **Why another non-closed round is required.** `advanceRound` reaches `returnToLeaf`, which re-pends
  `prd_audit`, `architecture_review_as_built`, `manual_test` and the post-region custom gates, only when a
  settled round has no other open round. If the sole open round were closed by hand, that leaf return would
  never run. A routed repair could then reach FINISH without fresh whole-feature validation. Requiring a
  surviving non-closed round leaves the leaf return to that round's own exit. (verified, 90%)
- **Pattern consistency.** The command copies the `stack land` precedent (`engine/stack-land-cli.ts`): the
  injectable `Deps` shape, the eligibility check before any read of routing state, the lease acquired after the
  read-only refusal predicate, `refused(...)` exit code 1, and lease release in `finally`. Its parse grammar
  mirrors `detectStackLandCommand`, with `--slug` first and pairwise flags.
- **Event spine.** The supersession is an occurrence, so it is a `ConductorEvent` variant, not a field on the
  record (event-spine skill, step 2). It rides the existing transactional outbox, written in the same
  compare-and-swap as the state it reports. The engine's existing `drainRoutingOutboxes` delivers it, and it
  joins the routing dedup-by-`eventId` list. It creates no sidecar and no new ledger.
- **State representation.** `RoundId`, `ChildId` and `HostState` stay branded or closed unions. The refusal
  predicate switches exhaustively over `HostState`, using `assertNever`, so a future host state fails closed.
- **Security boundary.** The write requires `resolveMachineOperatorIdentity` and a non-empty reason, the same
  authority bar as `stack land`. Inspect needs neither, because it reads only.
- **Production DI defaults.** There is no in-memory default. Every `Deps` member defaults to the real
  git-backed store.
- **Interaction with #3445 (spec #3462, merged, not yet built).** Once built, #3445 fences admission so that new
  features rarely hold two open rounds, and drains existing two-round states automatically. This command then
  serves features whose drain stalls and escalates to a needs-human HALT naming two or more non-closed rounds,
  plus features wedged before #3445 ships. The close writes only a route record through the same compare-and-swap
  #3445 uses. It does not edit `round-admission.ts`, so the specs can build in either order.

## Wiring Surface

| Surface | Production caller (design-time) |
|---|---|
| `detectStackRoundsCommand` (`cli.ts`) | Called from `index.ts`'s pre-dispatch chain beside `detectStackLandCommand`/`detectStackOwnersCommand`; registered in `cli-pre-dispatch.ts`'s command table with `commandPath: ['stack', 'rounds']`, `helpOwner: 'router'`. |
| `dispatchStackRoundsCommand` (`engine/stack-rounds-cli.ts`) | Invoked by `index.ts` when the detector returns a dispatch; sets `process.exitCode`. |
| `StackRoundsDispatch` types (`types/cli.ts`) | Consumed by the detector and dispatcher above. |
| `routingRoundSupersededEvent` (`routing/routing-events.ts`) | Called by the close path in `stack-rounds-cli.ts` inside the `writeRoutingTransaction` record. |
| `routing_round_superseded` union member (`types/events.ts`) | Persisted by the engine's existing `drainRoutingOutboxes` on the next resume; deduplicated by `eventId` in `event-persister.ts`. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Operator closes a round whose unstarted findings were real; they are dropped | Data | Medium | Medium | Close requires a reason, inspect lists each pending host's findings first, and the event records the dropped finding ids. The surviving round's leaf return re-runs `prd_audit`/as-built, which re-raises any finding still present. |
| Close races a daemon dispatch | Data | Low | High | Feature dispatch lease is held across read and write; the CAS fails closed on any concurrent record change. |
| A HALT left by the wedge still blocks resume after close | Technical | Medium | Low | Close prints the next step (`ai-conductor halt clear`); it does not clear HALTs itself (out of scope). |
| #3445 changes `reconcileRounds` semantics before this builds | Integration | Medium | Low | Close depends only on the record parser's closed-round invariant and `writeRoutingTransaction`, neither of which #3445 changes. |

## Domain Integrity

Skipped in lightweight mode; the TDD domain reviewer owns it per cycle.

## ADRs Created

None. The governing ADR is reused and amended:

- `adr-2026-10-12-routed-whole-feature-repair` decision 6: a new `closed` writer, the operator supersession of an
  open round with no active host while another round stays non-closed. `pending` hosts are written `done`.
- Decision 7: the supersession is a CLI writer under the feature dispatch lease, like the #3203 operator round.
- Decision 16: a new member `routing_round_superseded {roundId, child, supersededBy, droppedHosts, findingIds,
  reason, operator}`, which joins the dedup list.

## Conditions

1. The refusal predicate runs before the lease is acquired and before any write, so a refused command leaves no
   lease, no park and no record change.
2. The close is a single `writeRoutingTransaction` `update-record`, carrying the state change and its outbox event
   together. No other ref is written.
3. Inspect writes nothing: no ref, no `.pipeline/` file, no lease.
4. The command does not clear, rewrite or create a HALT.
