# Components: Acceptance-specs RED evidence visibility and completion-wait discrimination (#1246)

**Last updated:** 2026-08-09
**Scope:** The `acceptance_specs` observability and evidence seam — the RED lifecycle on the
`ConductorEvent` union (`types/events.ts`), the durable RED marker
(`.pipeline/acceptance-specs-red.json`) and its validator (`artifacts.ts:1245`), the engine
self-heal runner (`acceptance-red-runner.ts`, `conductor.ts:5311-5343`), the live operator
surface (`daemon-dashboard.ts:753`), and the `/writing-system-tests` + `/remediate` skill
contracts that write and waive the evidence.

## Diagram

```mermaid
graph TD
    subgraph Authoring["DECIDE/BUILD-time contract (shipped skills)"]
        WST["skills/writing-system-tests/SKILL.md<br/>writes run contract<br/>NEW: records failing test, reason,<br/>ranAt, intentRationale"]
        REM["skills/remediate/SKILL.md<br/>NEW: declares an explicit<br/>RED exception instead of silently<br/>combining test + production changes"]
    end

    subgraph State["Durable gate state (spine exception C)"]
        CONTRACT[("acceptance-specs-run.json<br/>command, cwd, targetSpecs<br/>unchanged")]
        MARKER[("acceptance-specs-red.json<br/>counters + command + targetSpecs<br/>NEW: failingTests, ranAt,<br/>intentRationale, exception")]
        HB[("step-heartbeat<br/>step, ts — unchanged")]
    end

    subgraph Engine["acceptance_specs step path"]
        GATE["validateAcceptanceRedEvidence<br/>artifacts.ts:1245<br/>NEW: requires enriched fields;<br/>accepts failed==0 ONLY via<br/>a valid recorded exception;<br/>classes refusals shape vs outcome"]
        PRED["completion predicate<br/>artifacts.ts:2041<br/>pure read — unchanged"]
        HEAL["selfHealAcceptanceRed<br/>acceptance-red-runner.ts:195<br/>NEW: emits lifecycle, produces<br/>enriched marker fields,<br/>carries a recorded exception forward"]
        DISPATCH["step dispatch<br/>conductor.ts:5311-5343<br/>NEW: guard consumes the refusal<br/>CLASS, not the reason prose;<br/>emits required/pending,<br/>classifies working vs waiting"]
    end

    subgraph Spine["The one telemetry spine — extended, not forked"]
        EV["ConductorEvent union<br/>types/events.ts<br/>NEW: acceptance_red variant<br/>state: required | pending<br/>| satisfied | rejected"]
        EMIT["ConductorEventEmitter"]
        PERSIST["EventPersister"]
        LEDGER[("events.jsonl")]
    end

    subgraph Consumers["Existing readers — no new reader path"]
        DASH["daemon-dashboard.ts:753<br/>NEW: per-step progress line —<br/>elapsed, heartbeat age,<br/>last action, last test outcome,<br/>RED state, unresolved condition"]
        OTHER["daemon CLI, UI renderer,<br/>OTel visualizer, event sinks"]
    end

    WST --> CONTRACT
    WST --> MARKER
    REM --> MARKER
    CONTRACT --> HEAL
    HEAL --> MARKER
    MARKER --> GATE
    GATE --> PRED
    PRED -->|"reason when not done"| DISPATCH
    DISPATCH --> HEAL

    DISPATCH --> EV
    HEAL --> EV
    GATE --> EV
    EV --> EMIT --> PERSIST --> LEDGER
    LEDGER --> DASH
    LEDGER --> OTHER
    HB --> DASH
```

## Lifecycle sequence

```mermaid
sequenceDiagram
    autonumber
    participant OP as Operator (daemon status)
    participant C as conductor.ts (acceptance_specs)
    participant S as /writing-system-tests session
    participant R as selfHealAcceptanceRed
    participant M as acceptance-specs-red.json
    participant B as event spine

    C->>B: acceptance_red state=required
    C->>S: dispatch (print mode)
    S-->>C: heartbeat pulses
    OP->>B: read — status "working, heartbeat 4s"
    S->>M: write enriched marker (happy path)
    S-->>C: session exits
    C->>B: acceptance_red state=pending
    OP->>B: read — status "waiting on completion condition"

    alt marker missing or invalid
        C->>R: self-heal once per attempt
        R->>M: execute contract, write enriched marker
    end

    C->>M: validate
    alt failed>=1, enriched fields present
        C->>B: acceptance_red state=satisfied
    else already green, no valid exception
        C->>B: acceptance_red state=rejected<br/>reason "0 failed — RED not established"
    else green with a recorded remediation exception
        C->>B: acceptance_red state=satisfied<br/>viaException=true
    end
    OP->>B: read — state and exact unresolved condition
```

## Component Notes

- **No new subsystem and no second channel.** Every NEW box extends a seam that already exists.
  The lifecycle rides the `ConductorEvent` union through the existing
  emitter → persister → `events.jsonl` path, so the daemon CLI, UI renderer, OTel visualizer and
  event sinks all gain the signal without a new reader. The marker is durable gate state read by
  name (event-spine exception C), so enriching its fields is not a parallel channel — but nothing
  is stamped into it to stand in for an event.

- **The gate's pass/fail semantics do not change.** `errors==0`, `skipped==0`, `executed>=1`,
  `failed>=1` remain the RED bar. The change is that the evidence must now say *which* test failed,
  *why*, *when*, and *why that failure corresponds to the intended missing behavior* — and that the
  verdict is visible while the step runs rather than only at its end.

- **Backward compatibility is re-run, not hard-fail.** A marker written by the current runner lacks
  the enriched fields, so the validator reports it invalid. That is precisely the condition the
  existing `selfHealAcceptanceRed` path already handles: the engine re-executes the recorded run
  contract once per attempt and writes a fresh, enriched marker. No in-flight build hard-fails on a
  legacy marker; it pays one extra spec run. This is the load-bearing design decision and carries
  its own ADR.

- **`working` vs `waiting` is derived from what the spine already sees.** A step is *working* when
  the heartbeat belongs to the current dispatch (`heartbeatBelongsToDispatch`, `step-heartbeat.ts`)
  and is fresh; it is *waiting* once the dispatch has returned but the completion gate has not
  passed. In the waiting state the status line reports the completion predicate's own `reason`
  string — which the engine already computes and currently discards from the live surface. This is
  the honest, in-scope half of desired outcome 4 and all of outcome 5.

- **Child-count and cached/uncached token burn are NOT delivered here.** The provider layer
  configures subagents but never observes them (`claude-provider.ts:749-750`,
  `llm-provider.ts:226`), and the only token fields are the end-of-feature
  `feature_usage_total` aggregate (`events.ts:183-184`). Deferred to
  `jstoup111/ai-conductor#1441`; the status line must say "unknown" rather than render a count it
  cannot compute.

- **The remediation exception is recorded, not assumed.** A remediation run that legitimately
  combines test and production changes records an exception in the marker and is reported as
  `satisfied viaException=true` on the spine. An unrecorded green run stays `rejected` — the
  exception makes the waiver observable, it does not weaken the gate.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-09 | Initial generation | DECIDE for #1246, tier M, approach A |
| 2026-08-09 | Guard consumes the refusal class; self-heal carries a recorded exception forward | Conflict-check found the guard substring-matches reason prose (never reaches a refused marker) and that the self-heal's wholesale write erases a recorded waiver — see `.docs/conflicts/acceptance-specs-hide-missing-red-evidence-and-com.md` |
