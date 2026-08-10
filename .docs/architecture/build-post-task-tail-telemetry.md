# Components: BUILD post-task tail telemetry

**Last updated:** 2026-08-09
**Scope:** Making the `build` step's interior legible. Today `build` is one opaque provider session (measured 6-60 min) whose only external signal is `BuildProgressWatcher` polling `.pipeline/task-status.json` plus a git HEAD probe — so task execution, kickback remediation, and closeout ceremony are indistinguishable in the ledger. This feature adds engine-side tick provenance, **pipeline-emitted closeout events on the bus**, an intra-step tail rollup over the merged ledgers, and a committed baseline. No change to gate semantics, step ordering, dispatch behavior, or the closeout obligations themselves.

**Decoupling constraint (operator direction).** The pipeline must not depend on the engine to be
instrumented. It stays runnable **inline** — invoked directly in a session with no conductor
driving it — and still produces a complete closeout timeline. The engine is therefore a
*consumer* of pipeline telemetry, never its source. This rules out the engine-side artifact
observer considered in the first draft of this diagram.

> **Original assertion (superseded):** `CONSUMERS["Existing ledger consumers<br/>daemon log /
> terminal UI / OTel export<br/>UNCHANGED - additive fields only"]` reached by
> `LEDGER --> CONSUMERS`.
>
> **Amended 2026-08-09 by #1176:** Source audit during build review showed that assertion was
> false for `pipeline_closeout`: daemon-log and terminal rendering require the render
> manifest/subscriber handlers, while OTel requires its own explicit subscription and handler.
> The corrected diagram places all three on the live bus and leaves the engine ledger
> single-writer.

## Diagram

```mermaid
graph TD
    subgraph Session["build step - one provider session (OPAQUE today)"]
        TASKS["Task execution<br/>TDD cycles, commits carry Task: trailers"]
        REMED["Kickback remediation<br/>re-entry with an already-resolved graph<br/>~197 of 202 measured tail-minutes"]
        CLOSE["Closeout obligations<br/>evaluator / simplify / arch-diagram<br/>micro-retro / memory / summary"]
    end

    subgraph PipeSide["Pipeline process - NO engine required"]
        CLIP["conduct-ts closeout-event primitive<br/>NEW - piece 2<br/>called by each closeout obligation"]
        PLEDGER[(".pipeline/pipeline-events.jsonl<br/>NEW - piece 2<br/>SINGLE WRITER - same ConductorEvent schema")]
    end

    subgraph Engine["Conductor engine - src/conductor/src/engine"]
        STATUS[(".pipeline/task-status.json")]
        HEAD["git HEAD probe<br/>rev-parse + rev-list --count"]
        WATCH["BuildProgressWatcher.tick<br/>build-progress-watcher.ts<br/>EXTENDED - piece 1 ONLY"]
    end

    BUS["ConductorEvent union<br/>types/events.ts<br/>build_progress EXTENDED - piece 1<br/>closeout event NEW - piece 2"]
    PERS["EventPersister<br/>event-persister.ts - stamps ts"]
    LEDGER[(".pipeline/events.jsonl<br/>SINGLE WRITER - EventPersister only")]
    TAILER["Sibling-ledger tail + re-emit<br/>NEW - piece 2<br/>lifecycle mirrors BuildProgressWatcher"]

    subgraph Rollups["Rollup layer"]
        TIMING["computeTimingRollup<br/>timing-rollup.ts - EXISTING<br/>STEP-level active vs provider"]
        TAIL["computeBuildTailRollup<br/>NEW - piece 3<br/>INTRA-step decomposition"]
    end

    CLI["conduct-ts reporting surface<br/>NEW - piece 3"]
    BASE[(".docs/... committed baseline<br/>NEW - piece 4")]

    DAEMON["Daemon log<br/>event-sinks render routing + daemon-cli renderer<br/>EXTENDED - closeout handler"]
    UI["Terminal UI<br/>subscriber + create-renderer<br/>EXTENDED - closeout handler"]
    OTEL["OTel visualizer<br/>explicit subscription + span event + duration metric<br/>EXTENDED - closeout handler"]

    TASKS --> STATUS
    REMED --> STATUS
    TASKS -. commits .-> HEAD
    REMED -. commits .-> HEAD
    CLOSE --> CLIP
    CLIP --> PLEDGER

    STATUS --> WATCH
    HEAD --> WATCH

    WATCH -- "build_progress + tickReason + headMoved" --> BUS
    BUS --> PERS
    PERS --> LEDGER
    LEDGER --> TIMING
    LEDGER -. "window boundaries - ENGINE-DRIVEN RUNS ONLY<br/>absent when pipeline runs inline" .-> TAIL
    PLEDGER -- "closeout timeline - merged by ts" --> TAIL
    PLEDGER --> TAILER
    TAILER -- "re-emit onto live bus" --> BUS
    BUS --> DAEMON
    BUS --> UI
    BUS --> OTEL
    TAIL --> CLI
    TAIL --> BASE
```

## Sequence: one build window, decomposed

```mermaid
sequenceDiagram
    participant P as build session
    participant C as conduct-ts closeout primitive
    participant PL as pipeline-events.jsonl
    participant T as CloseoutEventTail
    participant B as live event bus
    participant D as daemon log
    participant U as terminal UI
    participant O as OTel visualizer
    participant W as BuildProgressWatcher
    participant L as events.jsonl
    participant R as computeBuildTailRollup

    Note over W: step_started(build) - window opens
    W->>L: build_progress reason=task-delta resolved=3/18 headMoved=true commitCount=2
    W->>L: build_progress reason=task-delta resolved=18/18 headMoved=true
    Note over R: task-execution segment ends at first resolved==total tick

    alt re-entry after a gate kickback
        W->>L: build_progress reason=head-moved headMoved=true commitCount=1
        Note over R: classified REMEDIATION - real work, not waste
    end

    P->>C: closeout obligation completes - evaluator
    C->>PL: closeout ConductorEvent
    T->>PL: read complete new line
    T->>B: re-emit pipeline_closeout
    B->>D: render obligation and duration
    B->>U: render obligation and duration
    B->>O: add span event and duration metric
    P->>C: closeout obligation completes - summary
    C->>PL: closeout ConductorEvent
    W->>L: build_progress reason=heartbeat headMoved=false
    Note over P,PL: no engine required - identical when pipeline runs inline

    Note over W: step_completed(build) carries activeInterval - window closes
    PL->>R: closeout timeline
    L->>R: window boundaries (engine-driven runs only)
    R->>R: emit task / remediation / closeout split + first-pass vs re-entry
```

## Legend

- **NEW / EXTENDED** nodes are this feature; everything else exists today.
- **Closeout telemetry is on the bus, emitted from the pipeline's own process.** Each obligation calls a `conduct-ts` primitive that appends a real `ConductorEvent` — same union, same schema — to a pipeline-owned ledger. No engine, no daemon, and no IPC are required, so an inline pipeline run produces the same timeline as an engine-driven one. This is not prompt discipline: the emitting obligation is already hard-gated (the non-empty stat-check on `review.json` is an existing blocking gate), so the gate extends to require the recorded event. Precedent: `task-cli` already writes engine-consumed `.pipeline/task-status.json` from inside the build worktree.
- **One writer per ledger file.** `EventPersister` keeps `.pipeline/events.jsonl`; the pipeline owns `.pipeline/pipeline-events.jsonl`; readers merge by `ts`. This is not tidiness — `parseLedger` (`timing-rollup.ts:26-39`) returns `null` on a *single* malformed line, degrading every rollup over that ledger to `partial`, so a cross-process interleaved append would be whole-ledger corruption that stays invisible until read.
- **Tail-and-re-emit** lifts the pipeline's events onto the live bus. The daemon log is selected by `EVENT_SINKS.render` and handled by `daemon-cli.ts`; the terminal UI subscribes and renders through `ui/subscriber.ts` and `ui/create-renderer.ts`; OTel subscribes explicitly and records a span event plus a duration metric. `EVENT_SINKS.persist` remains false for `pipeline_closeout`, so re-emission cannot create a second writer for `.pipeline/events.jsonl`. The tail timer lifecycle mirrors `BuildProgressWatcher` exactly (`.unref()`'d interval, stopped in a `finally`).
- **Dotted edge from the ledger** marks the one engine-dependent input: `build` window boundaries (`step_started` / `step_completed`). Absent on an inline run, where the rollup degrades to a closeout-only timeline rather than failing.
- `build_progress` gains `tickReason` (`task-delta` | `head-moved` | `heartbeat`) and an explicit `headMoved` boolean. Today heartbeat ticks hard-code `commitCount: undefined` (`build-progress-watcher.ts:376`), so an absent `commitCount` cannot be distinguished from "HEAD did not move" after the fact — a classifier built on it under-counts real work.
- **Step-level vs intra-step.** `computeTimingRollup` (from #1101) measures whole steps and cannot see inside `build`; `computeBuildTailRollup` sits alongside it and decomposes a single `build` window. Neither replaces the other.
- **Re-entry.** A window whose *first* observed tick already reads `resolved == total` is a re-entry (the graph was complete on entry). 19 of 24 measured windows were re-entries; conflating them with first-pass windows is what makes the naive "time after tasks resolve" metric wrong.

## Decisions settled (see adr-2026-08-08-pipeline-owned-closeout-timestamps)

Two drafts of this diagram were superseded during `/architecture-review`, both by operator
direction, and the reasoning is recorded in the ADR so neither is re-proposed:

1. **Engine-side artifact observer** — rejected: an inline pipeline run with no engine would
   produce no closeout timeline, and watching a path set fails *silently* when an artifact is
   renamed.
2. **Artifact-carried timestamps read post-hoc** — rejected: closeout timing would never reach
   the bus, creating a second telemetry channel invisible to the daemon log, UI, and OTel
   exporter, and forcing a permanent reader adapter over three different timestamp conventions.
3. **Appending to the shared `events.jsonl`** — rejected on the `parseLedger` fail-closed
   behavior above; `appendFileSync` is atomic only under `PIPE_BUF` (4096 bytes) and existing
   `step_completed` records routinely exceed it.
4. **Filesystem mtime as the time source** — rejected: mtimes do not survive worktree
   recreation (issue #497) and change on copy.

## Out of scope

No parallelization of closeout obligations, no obligation pruning, no closeout receipt, no
change to the 15s evaluator cooldown, and no change to gate semantics or step ordering. Each
was evaluated against the measurement and deferred to a v1 follow-up blocked on this telemetry.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-09 | Corrected closeout live-consumer wiring | Build-review remediation found re-emission had no daemon, terminal UI, or OTel subscriber |
| 2026-08-08 | Initial generation | DECIDE phase for intake jstoup111/ai-conductor#1176 |
