# Components: Base-Advance Evaluation on Halt Resume (#1245)

**Last updated:** 2026-08-11
**Scope:** The daemon's halt-resume seam — what happens between an operator clearing
`.pipeline/HALT` and the conductor dispatching a step. Covers where base-advance evaluation
is inserted relative to the halt-cleared wake, the park guards, the one-shot `.pipeline/REKICK`
sentinel, the `resumeRebaseFirst` play-forward, and the verdict-aware resume clamp.

## Problem this addresses

The rebase-first play-forward is reachable **only** through the `.pipeline/REKICK` sentinel,
and `clearMarker` (`daemon-rekick.ts:312-326`) is its only writer. `rekickSweep` — one of
`clearMarker`'s three callers — refuses halts classed `needs-human` or `unclassified` on every
sweep (`daemon-rekick.ts:180-193`), so those classes can never arm the sentinel. An operator
clearing such a halt by hand (`rm .pipeline/HALT`) reaches no caller at all: no `HALT.cleared`
sibling, no sentinel. `resumeRebaseFirst` then returns `'skipped'` at its first line
(`daemon-rekick.ts:447-448`) and the feature resumes against whatever base its worktree
already had.

## Diagram

```mermaid
graph TD
    subgraph Trigger["Clear + wake (existing)"]
        RM["operator rm .pipeline/HALT<br/>no HALT.cleared, no sentinel"]
        CM["clearMarker daemon-rekick.ts:312<br/>HALT to HALT.cleared + REKICK<br/>ONLY sentinel writer"]
        WHC["watchHaltCleared daemon-deps.ts:371<br/>chokidar unlink, attributes<br/>cause operator vs rekick"]
        WAKE["waker.wake daemon.ts:780"]
    end

    subgraph Sweeps["clearMarker callers (existing)"]
        SWEEP["rekickSweep daemon-rekick.ts:180<br/>SKIPS needs-human + unclassified"]
        EPI["episode-end sweep<br/>daemon-cli.ts:1501"]
        RESEAL["reseal --clear-halt<br/>reseal-cli.ts:146,244"]
    end

    subgraph Dispatch["Dispatch path (existing guards)"]
        PICK["pickEligible daemon.ts:130<br/>park dominant, then isHalted"]
        GDW["guardedDispatchWith daemon.ts:589<br/>re-checks park at dispatch"]
        RCW["runConductorInWorktree<br/>daemon-cli.ts:1035"]
        PARK2["isOperatorParked check<br/>daemon-cli.ts:1067<br/>preserves unconsumed sentinel"]
    end

    subgraph New["Resume-time base evaluation (NEW)"]
        FRESH["base-advance evaluator NEW<br/>feature merge-base vs origin default tip<br/>advanced / current / undeterminable"]
        DECIDE["play-forward decision NEW<br/>sentinel present OR base advanced"]
    end

    subgraph PlayFwd["Rebase-first play-forward (existing, reused)"]
        RRF["resumeRebaseFirst daemon-rekick.ts:399<br/>sentinel gate at :447 relaxed"]
        MPG["merged-PR guard"]
        PR["performRebase rebase.ts:620<br/>seal verify at :681"]
        TAR["translateAfterRebase<br/>rebase-translate.ts:437<br/>PROACTIVE seal rebaseline"]
        GRR["runGatedRebaseResolution<br/>bounded /rebase attempts"]
        ARV["applyRebaseVerdicts rebase.ts:1037<br/>gate invalidation + kickbacks"]
    end

    subgraph Loop["Conductor resume (existing)"]
        CLAMP["verdict-aware resume clamp<br/>conductor.ts:3543-3612"]
        STEP["step dispatch loop"]
    end

    RM --> WHC
    CM --> WHC
    SWEEP --> CM
    EPI --> CM
    RESEAL --> CM
    WHC --> WAKE
    WAKE --> PICK
    PICK --> GDW
    GDW --> RCW
    RCW --> PARK2
    PARK2 -->|"parked: stop,<br/>sentinel untouched"| STOP["OperatorParkedTermination"]
    PARK2 -->|"not parked"| FRESH
    FRESH --> DECIDE
    DECIDE -->|"base current AND<br/>no sentinel"| CLAMP
    DECIDE -->|"sentinel OR<br/>base advanced"| RRF
    RRF --> MPG
    MPG --> PR
    PR --> TAR
    PR --> GRR
    TAR --> ARV
    GRR --> ARV
    ARV --> CLAMP
    RRF -->|"conflict / seal reject"| HALT["writeHalt<br/>skip conductor.run"]
    CLAMP --> STEP

    style FRESH fill:#2d6a4f,color:#fff
    style DECIDE fill:#2d6a4f,color:#fff
    style RRF fill:#7a5c00,color:#fff
```

## Legend

- **Green nodes** — the only new elements: a per-feature base-advance evaluator and the
  decision that consumes it. Nothing else in the graph is new.
- **Amber node** — `resumeRebaseFirst`, existing and reused whole; the single change is that
  its sentinel short-circuit (`daemon-rekick.ts:447-448`) is no longer the only way in. Its
  body — merged-PR guard, rebase, seal handling, gated resolution, verdict application — is
  untouched.
- **Grey nodes** — existing components, unchanged.
- **Placement is load-bearing.** The evaluator sits *after* the `isOperatorParked` check at
  `daemon-cli.ts:1067` and *before* `resumeRebaseFirst`. Park therefore keeps strict
  precedence, and a parked worktree's unconsumed sentinel is still never touched. It sits
  before `conductor.run()` so the verdict clamp reads the verdicts
  `applyRebaseVerdicts` just wrote, rather than pre-rebase ones.
- **Why the seal needs no separate work.** `performRebase` verifies the seal before moving
  HEAD (`rebase.ts:681-698`), and `translateAfterRebase` rotates it in the same operation
  with trigger `proactive-rebase` (`rebase-translate.ts:437-476`). Routing through the
  existing play-forward is what delivers "no manual reseal" — no new authorization channel
  is introduced.

## Sequence: operator clears a needs-human HALT after main advanced

```mermaid
sequenceDiagram
    participant OP as Operator
    participant FS as Worktree .pipeline
    participant W as watchHaltCleared
    participant D as daemon loop
    participant RC as runConductorInWorktree
    participant EV as base-advance evaluator (NEW)
    participant RRF as resumeRebaseFirst
    participant G as git
    participant C as conductor.run

    OP->>FS: rm .pipeline/HALT
    Note over FS: no HALT.cleared sibling,<br/>no REKICK sentinel written
    FS-->>W: chokidar unlink
    W->>FS: append halt_cleared cause=operator
    W->>D: waker.wake()
    D->>D: pickEligible — park dominant
    D->>RC: guardedDispatchWith re-checks park
    RC->>RC: isOperatorParked (daemon-cli.ts:1067)
    RC->>EV: evaluate base currency
    EV->>G: merge-base HEAD origin/«default»
    EV->>G: rev-parse origin/«default»
    G-->>EV: merge-base behind tip
    EV-->>RC: advanced
    RC->>RRF: play forward (no sentinel required)
    RRF->>G: performRebase onto origin/«default»
    Note over G: upstream-equivalent commit<br/>dropped by rebase — never<br/>reaches the graded diff
    RRF->>FS: proactive seal rebaseline
    RRF->>FS: applyRebaseVerdicts — invalidate + kickbacks
    RRF-->>RC: rebased
    RC->>C: conductor.run resume
    C->>C: verdict clamp reads post-rebase verdicts
    C->>C: dispatch step on the advanced base
```

## Sequence: base has not advanced (the no-op path)

```mermaid
sequenceDiagram
    participant OP as Operator
    participant W as watchHaltCleared
    participant RC as runConductorInWorktree
    participant EV as base-advance evaluator (NEW)
    participant G as git
    participant C as conductor.run

    OP->>W: HALT cleared
    W->>RC: wake and dispatch
    RC->>EV: evaluate base currency
    EV->>G: merge-base HEAD origin/«default»
    G-->>EV: merge-base equals tip
    EV-->>RC: current
    Note over RC: no rebase, no seal rotation,<br/>no gate invalidation —<br/>existing evidence stays valid
    RC->>C: conductor.run resume (today's behavior)
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-11 | Initial generation | DECIDE for #1245 — halt resume must evaluate an advanced base before dispatching a judged gate |
