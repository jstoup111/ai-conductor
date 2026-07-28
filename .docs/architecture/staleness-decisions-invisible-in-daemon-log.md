# Components: Staleness preserve-vs-invalidate decisions are invisible in daemon.log (#982)

**Last updated:** 2026-07-26
**Scope:** The telemetry path from a step's completion predicate to the operator's three
sinks — the `verdictFreshness` facet on the completion result (`engine/artifacts.ts`), its
translation to a `verdict_freshness` event (`engine/conductor.ts:4104-4114`), the
`ConductorEvent` union (`types/events.ts`), and the three sink registries
(`daemon-cli.ts` `renderDaemonEventUnsafe`, `engine/event-persister.ts` `ALL_EVENT_TYPES`,
`engine/audit-trail.ts` `SUBSCRIBED_EVENT_TYPES`).

**Out of scope:** the gating logic that *decides* preserve-vs-invalidate
(`engine/gate-code-validity.ts` `gateVerdictStillValid`) is untouched — only its reporting.

## Diagram

```mermaid
graph TD
    subgraph Decide["Gate decision (UNCHANGED)"]
        GCV["gateVerdictStillValid<br/>gate-code-validity.ts:82-113<br/>merge-base --is-ancestor + diff<br/>vs GATE_SURFACE"]
        MTIME["mtime floor check<br/>fileIsFreshSinceSession<br/>artifacts.ts:129-141"]
    end

    subgraph Predicates["Completion predicates — artifacts.ts"]
        BR["build_review :1942-2021"]
        PA["prd_audit :1750-1830"]
        AB["architecture_review_as_built :1847-1931"]
        MT["manual_test :1587-1681"]
    end

    subgraph Facet["Completion result facet"]
        OLD["verdictFreshness.fresh: boolean<br/>PROBLEM: preserve :1967 and<br/>real pass :2021 both emit fresh:true<br/>as_built preserve :1869 emits NOTHING"]
        NEW["NEW verdictFreshness.outcome<br/>'rewritten'<br/>'preserved_surface_miss'<br/>'stale_invalidated'<br/>populated at EVERY return site"]
    end

    subgraph Emit["Event emission"]
        EV["emitTracked verdict_freshness<br/>conductor.ts:4104-4114"]
        UNION["ConductorEvent union<br/>types/events.ts — 57 members"]
    end

    subgraph Registry["NEW: single sink registry"]
        REG["EVENT_SINKS<br/>Record&lt;ConductorEvent['type'], SinkDeclaration&gt;<br/>compile-time exhaustive —<br/>a new event type fails the build<br/>until it declares its sinks"]
        DECL["SinkDeclaration<br/>{ render, persist, audit }<br/>explicit false = reviewed,<br/>deliberately not routed"]
    end

    subgraph Sinks["Sinks — derived from the registry, not hand-listed"]
        RENDER["renderDaemonEventUnsafe<br/>daemon-cli.ts:1861-1971<br/>WAS 19/57 cases"]
        PERSIST["event-persister.ts ALL_EVENT_TYPES<br/>WAS 29/57 — name was a lie"]
        AUDIT["audit-trail.ts SUBSCRIBED_EVENT_TYPES<br/>WAS 6 types"]
    end

    subgraph Out["Operator-visible output"]
        LOG[("daemon.log<br/>distinguishes self-inflicted<br/>from genuine staleness")]
        JSONL[("events.jsonl")]
        TRAIL[("audit-trail/events.jsonl")]
    end

    GCV -->|"'preserve'"| BR
    GCV -->|"'preserve'"| PA
    GCV -->|"'preserve'"| AB
    GCV -->|"'preserve'"| MT
    MTIME --> BR
    MTIME --> PA
    MTIME --> AB
    MTIME --> MT

    BR --> OLD
    PA --> OLD
    AB --> OLD
    MT --> OLD
    OLD -.->|"REPLACED BY"| NEW
    NEW --> EV
    UNION --> REG
    EV --> REG
    REG --> DECL
    REG --> RENDER
    REG --> PERSIST
    REG --> AUDIT
    RENDER --> LOG
    PERSIST --> JSONL
    AUDIT --> TRAIL
```

## Component responsibilities

| Component | Change | Responsibility |
| --- | --- | --- |
| `types/events.ts` | Modified | `verdict_freshness` gains the discriminated `outcome`; `fresh` is either derived from it or removed |
| `engine/artifacts.ts` | Modified | Every preserve / pass / stale return site populates `outcome`; the two bare `{ done: true }` preserve returns start populating the facet |
| `engine/conductor.ts` | Modified | Passes `outcome` through when emitting; no control-flow change |
| `engine/event-sinks.ts` | **New** | The `Record<ConductorEvent['type'], SinkDeclaration>` registry — the single exhaustive source of truth |
| `engine/event-persister.ts` | Modified | Derives its subscription set from the registry instead of `ALL_EVENT_TYPES` |
| `engine/audit-trail.ts` | Modified | Derives `SUBSCRIBED_EVENT_TYPES` from the registry |
| `daemon-cli.ts` | Modified | Adds the `verdict_freshness` case; the registry's `render` flag is reconciled against the switch |
| `engine/gate-code-validity.ts` | **Unchanged** | The preserve/rerun decision itself is not in scope |

## Key seam

The registry is the only new architectural element. Its contract is that
`Record<ConductorEvent['type'], SinkDeclaration>` is **total** — TypeScript rejects a missing
key — so adding a `ConductorEvent` member cannot compile until its sinks are declared. This
replaces three independently-drifting `Array<ConductorEvent['type']>` literals, a type that
permits silent omission and currently does so for 28 of 57 members in the list literally
named `ALL_EVENT_TYPES`.

`SinkDeclaration` must make `false` a first-class, reviewable value: "emitted but deliberately
not persisted" is a legitimate declaration. Exhaustiveness forces a **decision** per event
type, not membership in every sink — that distinction is what keeps `events.jsonl` volume a
deliberate choice rather than a side effect of the refactor.

## Risk

Routing the ~28 currently-dropped types into `events.jsonl` changes that file's volume and
content, and other tooling may parse it. The per-type sink decision is therefore made
explicitly during implementation and reviewed, rather than defaulting to "persist everything".
See `adr-2026-07-26-event-sink-registry-exhaustiveness.md`.
