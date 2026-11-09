# Components and sequences: Daemon preemption of lower-priority work at step boundaries

**Last updated:** 2026-11-07
**Scope:** To-be preemption path for jstoup111/ai-conductor#1929. Feature:
`daemon-cannot-switch-to-higher-priority-queued-wor`. Covers the daemon pool's busy-pool tick, the
child feature executor's IPC channel (adr-2026-10-15-per-dispatch-engine-pinned-executor), the
conductor's operator-park boundary gates (adr-2026-07-29-operator-park-scheduling-unit-boundary),
the feature runner's outcome mapping, and the event spine. The in-process executor is out of scope
(removed by #3403). Operator park itself is shown only to mark it unchanged.

## Component diagram

```mermaid
graph TD
  resolver["Priority resolver (backend-neutral OrderingSource; bandForSlug)"] --> rank["Preemption rank: critical > high > medium = unlabeled = no-issue > low"]
  pool["Daemon pool (daemon.ts busy-pool tick)"] -->|"discoverBacklog refresh:false"| backlog["Ordered backlog"]
  pool --> rank
  pool -->|"pool full; next eligible item outranks and precedes a running feature in backlog order"| select["Victim selection: lowest-rank candidate, tie to most recent dispatch"]
  select --> childExec["Child feature executor (supervisor side)"]
  childExec -->|"IPC yield message"| child["Executor child process"]
  child -->|"sets in-memory yield flag"| yieldPred["Yield predicate (daemon-only, injected)"]
  parkPred["Operator-park predicate (unchanged)"] --> gates["Conductor boundary gates: pre-unit and per-attempt"]
  yieldPred --> gates
  gates -->|"park wins over yield"| parkedT["operator-parked termination (unchanged)"]
  gates -->|"yield only"| preemptT["preempted termination"]
  preemptT --> event["ConductorEvent preemption boundary event"]
  event --> spine["Event spine: EventPersister to events.jsonl, IPC forward, daemon.log renderer"]
  preemptT --> runner["Feature runner (daemon-runner.ts)"]
  runner -->|"status preempted: no marker, no HALT, worktree kept"| pool
  pool -->|"ordinary eligibility by backlog order"| redispatch["Later re-dispatch resumes from persisted .pipeline state"]
  oldChild["Older pinned child (no yield support)"] -. "ignores unknown message kind; runs to DONE or HALT" .-> runner
```

## Sequence: preempting a running feature

```mermaid
sequenceDiagram
  participant Pool as Daemon pool
  participant Res as Priority resolver
  participant Sup as Child executor (supervisor)
  participant Child as Executor child
  participant Cond as Conductor gates
  participant Run as Feature runner
  Pool->>Res: rank backlog head and running slugs
  Res-->>Pool: next item outranks and precedes a running feature
  Pool->>Sup: request yield for victim «slug»
  Sup->>Child: IPC yield
  Child->>Child: set yield flag
  Note over Cond: current step or attempt drains normally
  Cond->>Cond: next boundary: park? no. yield? yes
  Cond->>Child: preempted termination with last settled unit
  Child-->>Sup: event preemption boundary and outcome
  Sup-->>Run: termination kind preempted
  Run-->>Pool: status preempted, worktree retained
  Pool->>Pool: free slot dispatches the higher-ranked arrival
  Note over Pool: «slug» stays eligible and re-dispatches when it reaches the head
```

## Legend

- Solid arrows: new or changed flow. Dotted arrow: compatibility path for an older pinned child.
- "Unchanged" nodes keep their current behavior; operator park takes precedence over yield at the
  same boundary.
- `«slug»` marks a variable feature slug.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-07 | Initial generation | DECIDE for #1929 (Approach B, IPC yield) |
| 2026-11-07 | Victim needs strictly higher rank and earlier backlog order | Conflict-check amendment to ADR decision 2; plan update |
