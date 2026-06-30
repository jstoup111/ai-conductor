# Architecture: Background Auto-Intake on the Conduct Loop

**Last updated:** 2026-06-30
**Scope:** The intake poll path on the autonomous loop and the human-gated DECIDE boundary for the
Background Auto-Intake feature. Consumed by `/architecture-review`.

PRD: `.docs/specs/2026-06-30-background-intake-conduct-loop.md` ·
Stories: `.docs/stories/background-intake-conduct-loop.md` ·
Conflicts: `.docs/conflicts/2026-06-30-background-intake-conduct-loop.md`

## Flow (container/component view)

```mermaid
graph TD
    subgraph LOOP["Autonomous loop · OPEN Q1: who hosts the cross-repo poll?"]
        direction TB
        TICK["Loop tick<br/>(configurable interval, FR-10)"]
        POLL["github-issues poll<br/>mechanical / zero-token (FR-9)<br/>gh issue list --assignee @me"]
        ROUTE["origin-based auto-route<br/>issue owner/repo#N → that repo (FR-3)"]
        NOTIFY["notify: push + status surface<br/>dedup per idea (FR-5/FR-12)"]
    end

    REG[("registry<br/>all registered repos (FR-1)")]
    GH[["GitHub<br/>(external)"]]

    subgraph STATE["Shared durable state · OPEN Q2: concurrency boundary"]
        LEDGER[("ledger.json<br/>sole dedup authority — ADR-012<br/>(FR-2/FR-4/FR-12)")]
        INBOX[("inbox queue<br/>(durable)")]
    end

    OP(["Operator<br/>(human gate)"])

    TICK --> POLL
    REG -. lists repos .-> POLL
    POLL <-->|gh| GH
    POLL -->|skip empty FR-6<br/>isolate failures FR-7| ROUTE
    ROUTE -->|known? dedup| LEDGER
    ROUTE -->|enqueue once| INBOX
    ROUTE --> NOTIFY
    NOTIFY -. "push (phone)" .-> OP
    NOTIFY -. status surface .-> OP

    OP ==>|claims idea + source-ref| DECIDE

    subgraph DECIDE["DECIDE — human-gated (ADR-008 honored; FR-11)"]
        ENG["interactive engineer<br/>brainstorm→…→plan"]
        LAND["land: intake marker + Refs on spec PR<br/>(FR-8)"]
        SPECPR["spec PR (source-ref threaded)"]
    end

    ENG --> LAND --> SPECPR
    SPECPR ==>|operator merges| DAEMON["build daemon<br/>(unchanged)"]
    DAEMON -->|impl PR: Closes owner/repo#N| GH
```

## Sequence (intake → notify → DECIDE → auto-close)

```mermaid
sequenceDiagram
    autonumber
    participant L as Autonomous loop [Q1]
    participant R as Registry
    participant GH as GitHub via gh
    participant LG as Ledger [sole dedup]
    participant Q as Inbox queue
    participant N as Notifier push+status
    participant OP as Operator
    participant E as Interactive engineer
    participant D as Build daemon

    Note over L: tick fires on interval [FR-1/FR-10]
    L->>R: list registered repos
    loop per repo, failure isolated [FR-7]
        L->>GH: issue list --assignee @me --state open
        GH-->>L: issues
        Note over L: skip empty [FR-6], skip handled/known
        L->>LG: check known source-ref
        alt new and non-empty
            Note over LG: Q2 - atomic vs locked write
            L->>LG: record source-ref
            L->>Q: enqueue envelope target=origin + source-ref [FR-2/FR-3]
        else already known/handled
            Note over L: no re-capture [FR-4]
        end
    end
    alt one or more newly captured
        L->>N: notify new ideas
        N-->>OP: push + status, deduped [FR-5/FR-12]
    else zero new
        Note over L,N: no notification, no spam
    end
    Note over L: loop NEVER runs DECIDE or opens PR [FR-11]

    OP->>E: claim idea, source-ref intact
    E->>E: brainstorm to plan, human-gated [ADR-008]
    E->>GH: open spec PR with Refs owner/repo#N [FR-8]
    Note over OP: operator merges spec PR
    GH-->>D: merged spec discovered
    D->>GH: open impl PR with Closes owner/repo#N
    Note over GH: merging impl PR auto-closes the issue [FR-8]
```

## Legend

- **Solid arrows** = mechanical, zero-token data flow inside the loop. **Bold `==>`** = an explicit
  human action (operator claim / merge). **Dotted arrows** = notifications / advisory reads.
- **`OPEN Q1`** (subgraph `LOOP`): which process hosts the cross-repo poll — a single
  supervisor/"brain" loop polling all registered repos, or each per-repo build daemon polling its
  own repo. Decides whether more than one ledger writer can exist.
- **`OPEN Q2`** (subgraph `STATE`): the shared-ledger concurrency boundary. Step 7 of the sequence
  (`record`) is the contended read-modify-write; its safety mechanism (single-writer by
  construction vs. file-lock + atomic write) follows directly from Q1.
- **ADR-012** = ledger is the sole dedup authority. **ADR-008** = engineer loop is interactive,
  not headless — honored because DECIDE stays human-gated. **ADR-007** = interactive routing gate,
  to be amended for origin-routing (FR-3).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-30 | Initial generation | Background Auto-Intake DECIDE phase; marks Q1/Q2 for architecture-review |
