# Architecture Review: Daemon cannot switch to higher-priority queued work at step boundaries

**Date:** 2026-11-07
**Mode:** Lightweight (Tier M): sections 2 and 4 only
**Inputs reviewed:** explore output and track marker
(`.docs/track/daemon-cannot-switch-to-higher-priority-queued-wor.md`, Minimal scope, Approach B),
the approved diagram (`.docs/architecture/daemon-cannot-switch-to-higher-priority-queued-wor.md`),
and intake jstoup111/ai-conductor#1929
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. Uses Node `child_process` IPC (already in use), the existing `ConductorEvent` union and the priority resolver |
| Prerequisites | None. Child executor isolation is the live default (`executor_isolation` defaults to `child` in `daemon-cli.ts`); this repo sets no override |
| Integration surface | Daemon pool, child executor (supervisor and child sides), conductor boundary gate, feature runner, event union. All of it is inside the existing daemon/executor boundary; there are no external APIs |
| Data implications | No persisted schema change. One new event variant (additive; older readers accept unknown variants, `adr-2026-10-15-per-dispatch-engine-pinned-executor` D4). One new feature status in the in-memory and IPC outcome unions |
| Performance risk | Negligible. The busy-pool pass already discovers the backlog; the trigger adds one rank comparison per pass |
| Worktree isolation | No new ports, databases or shared files. The request is in-memory per dispatch |

The issue's premise was partly stale. Concurrency is configurable (#2075) and setup cost per
re-dispatch is closed (#1930). The real gap is a full pool. The scope reflects that.

## Alignment

- **Operator park (`adr-2026-07-29-operator-park-scheduling-unit-boundary`).** Applied, not
  amended. Preemption reuses its gates (D3, D11), its typed-termination principle (D5), its
  declined-attempt semantics (D12) and its natural-failure authority (D8). Composing a second
  daemon-only predicate into the same gate does not falsify any of its decisions: D1's single
  durable park authority is unchanged, because the yield is not a park and writes nothing durable.
  Operator park wins at the same boundary.
- **Operator lever (`adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`).** Its
  invariant ("any state other than `done` must leave a marker") is literally falsified by
  `preempted`. It is amended in place with an additive note (new ADR decision 9). That ADR predates
  the assumptions ledger, so the legacy exemption in `adr-assumption-ledger-scope.ts` applies.
- **Executor seam (`adr-2026-10-15-per-dispatch-engine-pinned-executor`).** Applied, not amended.
  The `yield` request belongs to D4's existing "shutdown and stop requests" coordination class.
  The protocol addition is backward-compatible in both directions (D3), so no version bump.
  Leaving this ADR untouched avoids a competing amendment with open spec PR #3403, which amends the
  same ADR to remove the in-process executor.
- **Event spine.** The occurrence (a feature stopped for preemption) goes on the spine as a new
  `preemption_boundary` variant, not as an optional field on `operator_park_boundary`. Existing
  renderers (`daemon-cli.ts`, `report-renderer.ts`) would otherwise label a preemption as an
  operator park. The IPC request is coordination, not telemetry, which is the D4 carve-out.
- **Backlog order (amendment pass, conflict check 2026-11-07).** The preemption rank (unlabeled
  and no-issue as medium) differs from dispatch order (no-issue first, unlabeled last). Decision 2
  therefore also requires the arrival to come before the victim in backlog order, so preemption never
  reverses the dispatcher's own pick. Width-1 ordering on a static backlog stays as today.
- **Tracker neutrality.** Rank reads only the resolver's `PriorityBand`. Jira refs currently resolve
  `unlabeled` (rank medium) and pick up real priority when the Jira ordering source lands
  (#849/#850).
- **State modelling.** `preempted` is a distinct member of the termination and status unions, not a
  boolean flag on `parked`. Exhaustive switches force every consumer to decide.
- **Production DI defaults.** No stores are introduced.
- **Pattern basis (focused).** Precedent: the operator-park boundary. *Role:* the daemon-only
  injected predicate plus the typed termination plus the pool mapping. *Traits to preserve:*
  fail-toward-stop on read error; one classification point (`stopAtOperatorParkBoundary` in
  `conductor.ts`); executions closed before the boundary event; the runner keeps the worktree and
  skips escalation (`daemon-runner.ts`, the `operator-parked` branch). *Allowed variation:* the
  pool releases the claim instead of parking it, and no marker exists. *Rediscovery hints:*
  `stopAtOperatorParkBoundary`, `OperatorParkedTermination`, `operator_park_boundary`, and
  `isOperatorParked` in `executor-child-runtime.ts`.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| Preemption rank function (`backlog-priority.ts`) | The daemon pool's busy-pool pass in `daemon.ts` |
| Trigger and victim selection (`daemon.ts`) | The existing busy-pool branch of the daemon loop, which runs every pass while the pool is full |
| `requestYield(slug)` daemon dependency | Wired in `daemon-cli.ts` to the child executor; served by `createChildProcessFeatureExecutor` |
| `yield` executor message (`executor-protocol.ts`) | Sent by the child executor's `requestYield`; parsed by `executor-child.ts`'s message handler |
| Child yield flag and `preemptionRequested` conductor option | Injected by `executor-child-runtime.ts` into the conductor it constructs for every daemon dispatch |
| `preempted` termination (`conductor-options.ts`) | Returned by the conductor's boundary primitive; consumed by `daemon-runner.ts` |
| `preempted` feature status (`feature-executor.ts`, `daemon.ts`) | Produced by `daemon-runner.ts`; consumed by the daemon's outcome collection and the executor ledger mapping in `child-feature-executor.ts` |
| `preemption_boundary` event (`types/events.ts`) | Emitted by the conductor's boundary primitive; rendered by the daemon.log feature renderer in `daemon-cli.ts` |

**Early overlap scan (advisory):** `ai-conductor overlap-scan` over the files above reported
overlap only on `conductor.ts`, with six open spec branches (base-moved re-kick, clean build-review
deferral, planner escalation, routed leaf acceptance, routed verify-green, stacked no-op rebase). It
reported none on the executor, daemon or protocol files. `conductor.ts` is a shared hotspot; the
change there is confined to the constructor composition and the boundary primitive.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A gate site bypasses the composed predicate or classifies its own stop, so a yield is ignored or mislabeled as operator park | Technical | Low | Medium | Decision 5 composes at the single stored predicate. A2 is approved; the plan must include a test per gate kind (pre-unit, serial attempt, group member) |
| A steady stream of higher-ranked arrivals starves a low-ranked feature | Technical | Medium | Medium | Accepted under Minimal scope; an anti-thrash guard is excluded and can be a follow-up |
| An older pinned child ignores yield, and its outstanding request blocks other preemptions until it ends | Integration | Low | Low | Only during engine upgrades; clears on the child's natural outcome |
| The yield arrives as the child finishes | Technical | Medium | Low | The request clears on outcome collection whatever the outcome; a no-op yield is harmless |
| `conductor.ts` merge contention with six open specs | Integration | Medium | Low | Edits confined to two named seams |

No High-impact risks.

## ADRs Created

- `adr-2026-11-07-daemon-step-boundary-preemption` (APPROVED 2026-11-07). New structural
  decision: a scheduler-initiated terminal outcome and its cross-process coordination.
- Amended: `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` (additive note).
- Applied unchanged: `adr-2026-07-29-operator-park-scheduling-unit-boundary`,
  `adr-2026-10-15-per-dispatch-engine-pinned-executor`.

## Conditions

1. Operator park takes precedence over yield at every boundary, proven by a test where both are
   set.
2. Each gate kind (pre-unit, serial attempt, group member) has a test showing a yield stops there
   with a `preempted` termination, not `operator-parked`.
3. An equal-or-lower rank arrival, an arrival ordered behind the victim, an unbanded backlog and a
   full pool of repair workers each request no yield.
4. A preempted feature leaves no marker or HALT, and it is re-dispatched by ordinary backlog order
   with its step still `in_progress` and its committed task progress intact.
