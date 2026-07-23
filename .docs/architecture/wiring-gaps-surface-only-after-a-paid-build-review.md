# Architecture: cheap-gate-first BUILD tail (#879)

**Date:** 2026-07-23
**Scope:** BUILD-phase gate topology + conductor step dispatch. C4 Level 3 (component).

## C3 — Component view: BUILD tail, today

```mermaid
flowchart LR
  subgraph engine["conductor engine (src/conductor/src/engine)"]
    SEL["selector<br/>(ALL_STEPS order + prerequisites)"]
    DISPATCH["Conductor step loop<br/>conductor.ts:3247-3271<br/>engine-native bypass:<br/>complexity | worktree | rebase"]
    PRED["completion predicates<br/>artifacts.ts"]
  end
  SEL --> DISPATCH --> PRED --> SEL

  BUILD["build<br/>(/pipeline session)"]
  BR["build_review<br/>LLM grader, one-shot session<br/>median 141s"]
  WC["wiring_check<br/>predicate = deterministic probe,<br/>BUT still dispatched as a session<br/>median 118-135s, max 1157s"]
  MT["manual_test"]

  BUILD -->|prereq| BR -->|prereq| WC -->|prereq| MT
  WC -.->|kickback: gaps found| BUILD
  BR -.->|kickback: FAIL| BUILD

  PROBE["wiring-probe.ts<br/>computeWiringEvidence()<br/>git diff + TS import graph"]
  PRED -->|ctx.wiringProbe| PROBE
  PROBE --> EV[".pipeline/wiring-evidence.json<br/>(gitignored, stamps head SHA)"]

  style BR fill:#f9d5d5
  style WC fill:#f9d5d5
```

Two defects are visible in this view:

1. **`wiring_check` is dispatched.** Its `StepDefinition` carries no `skillName`, its
   `STEP_PROMPTS` entry is documented as a display sentinel, and its verdict is computed by
   `PRED` via `ctx.wiringProbe` — yet `DISPATCH`'s bypass list omits it, so the engine spawns
   a session on the `/conduct wiring-check` prompt before the predicate ever runs. That
   session can commit, which moves HEAD and invalidates the head-stamped evidence
   (22 observed `is stale` retries).
2. **The expensive gate is upstream of the cheap one.** `BR` is unconditionally paid before
   `WC` can speak, so a wiring-broken HEAD always buys a grader verdict it then discards.

## C3 — Component view: target

```mermaid
flowchart LR
  subgraph engine["conductor engine"]
    SEL2["selector"]
    DISPATCH2["Conductor step loop<br/>engine-native bypass:<br/>complexity | worktree | rebase | <b>wiring_check</b>"]
    PRED2["completion predicates"]
  end
  SEL2 --> DISPATCH2 --> PRED2 --> SEL2

  BUILD2["build"]
  WC2["wiring_check<br/><b>engine-native, no session</b><br/>seconds, zero tokens"]
  BR2["build_review<br/>LLM grader (unchanged)"]
  MT2["manual_test"]

  BUILD2 -->|prereq| WC2 -->|prereq| BR2 -->|prereq| MT2
  WC2 -.->|kickback: gaps found<br/>before any grader spend| BUILD2
  BR2 -.->|kickback: FAIL| BUILD2

  style WC2 fill:#d5f9d5
  style BR2 fill:#fff2cc
```

## Sequence — wiring-broken HEAD, before vs after

```mermaid
sequenceDiagram
  participant L as step loop
  participant G as build_review grader (LLM)
  participant P as wiring probe (deterministic)
  participant B as build

  Note over L,B: TODAY
  L->>G: dispatch (~141s, tokens)
  G-->>L: PASS
  L->>P: dispatch session (~120s, tokens) + predicate
  P-->>L: gaps found
  L->>B: kickback (grader verdict discarded)

  Note over L,B: TARGET
  L->>P: predicate only (no dispatch, ~seconds)
  P-->>L: gaps found
  L->>B: kickback (zero grader spend, zero wiring spend)
```

## Invariants preserved

- Step **state keys and linear indices** are per-step-name; swapping two adjacent entries in
  `ALL_STEPS` changes their indices but not the key namespace or any group membership.
- `VALIDATION_GROUP` members are `manual_test, prd_audit, architecture_review_as_built`
  (`steps.ts:310-313`). Neither reordered step is a member, and no runtime contiguity/anchor
  assertion exists (`getGroupForStep` is a plain map lookup) — so group engagement,
  `resolveGroupMembership`, and the width-1 degrade are untouched.
- `GATE_SURFACE` (`gate-invalidation.ts:44-52`) is a keyed record, order-free — the
  preserve/invalidate classification is unchanged by the swap.
- Both gates remain `enforcement: 'gating'`, `loopGate: true`, `phase: 'BUILD'`,
  `skippableForTiers: []`, and both remain strictly between `build` and `manual_test`.
