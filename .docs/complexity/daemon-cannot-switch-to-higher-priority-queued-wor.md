# Complexity: Daemon cannot switch to higher-priority queued work at step boundaries (#1929)

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One new executor IPC coordination message (supervisor → child `yield`), one new conductor termination kind (`preempted`), one new feature outcome status, one new `ConductorEvent` variant for the preemption boundary, and a pure preemption-rank function over resolver bands (critical > high > medium = unlabeled = no-issue > low) |
| External integrations | None. Bands come from the existing backend-neutral priority resolver, so no tracker-specific code |
| Auth / permission surface | None |
| State machines | The daemon pool gains one transition: a running feature can end `preempted` at an operator-park-safe boundary and re-enter ordinary eligibility with no marker. The conductor gains a second injected boundary predicate beside operator park at the existing pre-unit and per-attempt gate sites |
| Story count | ~4: busy-pool preemption trigger and victim choice; child yields at the next park-safe boundary with a typed termination; preempted feature resumes by backlog order with no operator action; preempted is distinguishable from operator park in log, status and events (plus negative paths: equal/lower arrivals and older pinned children never yield) |
| Files touched | ~12: `executor-protocol.ts`, `child-feature-executor.ts`, `executor-child.ts`, `executor-child-runtime.ts`, `feature-executor.ts`, `conductor-options.ts`, `conductor.ts`, `group-core.ts`, `daemon-runner.ts`, `daemon.ts`, `backlog-priority.ts`, `types/events.ts`, with daemon log rendering |
| ADR work | New preemption ADR. Likely amendments: `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` (a non-done outcome with no marker), `adr-2026-07-29-operator-park-scheduling-unit-boundary` (a second predicate at its gates), and possibly `adr-2026-10-15-per-dispatch-engine-pinned-executor` D4 (new coordination request), which open spec PR #3403 also amends |

## Rationale

Medium. The change reuses proven machinery (the operator-park boundary gates, the executor IPC
channel, and the priority resolver) and adds no new module or layer, but it crosses the
dispatcher-executor seam, adds a terminal outcome every pool consumer must handle, and carves an
exception into an approved invariant that every non-done dispatch leaves an operator lever. Those
are cross-cutting contract changes that warrant a lightweight architecture review, not a full one.
Scope is the operator-confirmed Minimal breadth: no anti-thrash guard, toggle, opt-out, or
dashboard counts.
