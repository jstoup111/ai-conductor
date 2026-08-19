# Architecture: the gate loop re-checks before it skips

**Last updated:** 2026-08-19
**Scope:** the BUILD gate loop's dispatch boundary in `conductor.ts`, the post-rebase pre-verify in
`rebase.ts` / `daemon-rekick.ts`, the step-runner retry ladder in `conductor.ts`, and a new operator
verb over the existing `ConductStateStore` port. Covers jstoup111/ai-conductor#1729.
All line references are at worktree base `0b71bec78`.

## Diagram 1: how a feature gets stranded today (L3)

```mermaid
graph TD
  subgraph REKICK["daemon-rekick.ts — pre-loop, no conductor loop running"]
    RB["performRebase :484<br/>outcome.kind = 'changed'"]
    APPLY["applyRebaseVerdicts :540<br/>pre-verify set = {build} only"]
    WV["writeVerdict test_suite :1364<br/>satisfied:false, kickback.from='rebase'"]
  end

  subgraph LEDGERS["two records of one fact"]
    GATE["gates/test_suite.json<br/>satisfied: FALSE"]
    STATE["conduct-state.json<br/>test_suite: DONE"]
  end

  subgraph ENTRY["conductor.ts — resume entry"]
    CLAMP["earliestUnsatisfiedGateIndex :3906<br/>verdict-authoritative → test_suite"]
    START["startIndex = index(test_suite)"]
  end

  subgraph LOOP["conductor.ts — the step loop"]
    SKIP["alreadyResolved :4351<br/>state === 'done' → continue<br/>STATE-ONLY, runs FIRST"]
    DECIDECHK["predicate re-check :4443<br/>guarded step.phase === 'DECIDE'"]
    BR["build_review dispatched"]
  end

  subgraph FAIL["the dead end"]
    ASM["assembleBuildReviewInputs<br/>TestSuiteProofError :186"]
    RETRY["retry ladder :6729<br/>3 identical tries, 4 seconds"]
    HALT["needs-human HALT<br/>no CLI can clear it"]
  end

  RB --> APPLY --> WV --> GATE
  APPLY -.->|"never demotes"| STATE
  GATE --> CLAMP --> START --> SKIP
  STATE --> SKIP
  SKIP -->|"skips test_suite"| BR
  DECIDECHK -.->|"never reached for a BUILD step"| BR
  BR --> ASM --> RETRY --> ASM
  RETRY --> HALT

  style SKIP fill:#fdd,stroke:#b00
  style STATE fill:#fdd,stroke:#b00
```

The clamp is not broken — it lands `startIndex` exactly on `test_suite`. The strand is the very next
statement: `alreadyResolved` consults `conduct-state.json` alone and skips the step the clamp
selected. `scanKickbackVerdicts`, the sole owner of verdict-driven state demotion
(`adr-2026-07-11`), matches only `kickback.from === <a step that just completed in-loop>`, and no
in-loop `rebase` step runs on the re-kick path — so the red node on the right never turns.

The second observed feature inverts the ledger disagreement (`gates/test_suite.json` read
`satisfied: true` while the proof inspection returned STALE) and arrives at the identical dead end,
because `gateSatisfied` (`selector.ts:56-64`) trusts a cached verdict without re-deriving it.

## Diagram 2: the four changes (L3)

```mermaid
graph TD
  subgraph C1["Change 1 — the dispatch boundary"]
    RECHK["mechanical re-check<br/>BEFORE alreadyResolved"]
    PRED["checkStepCompletion(step)<br/>the same predicate advanceTail uses"]
    ELIG["eligible ⟺ tree-attesting predicate<br/>the adr-2026-07-08 bar"]
  end

  subgraph C2["Change 2 — post-rebase pre-verify"]
    PV["applyRebaseVerdicts pre-verify set<br/>{build} → {build, test_suite}"]
  end

  subgraph C3["Change 3 — retry classification"]
    CLS["classifyRetryDecision<br/>extended to the step-runner seam"]
    ROUTE["route, naming the step that must re-run"]
  end

  subgraph C4["Change 4 — operator lever"]
    CLI["conduct-ts rewind --to <step>"]
    PORT["ConductStateStore mutation<br/>done → stale, expected-value checked"]
  end

  RECHK --> PRED --> ELIG
  ELIG -->|"CURRENT proof"| FF["fast-forward to build_review<br/>outcome-6, no re-run"]
  ELIG -->|"STALE proof"| RUN["dispatch test_suite<br/>outcome-1, outcome-2"]
  PV -->|"content fingerprint identical"| KEEP["verdict stays satisfied<br/>no gratuitous lap"]
  PV -->|"fingerprint changed"| INV["invalidate, as today"]
  CLS --> ROUTE --> NAMED["halt names test_suite<br/>outcome-3, outcome-4"]
  CLI --> PORT --> LEVER["supported recovery<br/>outcome-5"]

  style RECHK fill:#dfd,stroke:#0a0
  style PORT fill:#dfd,stroke:#0a0
```

Changes 1 and 2 are complementary, not redundant. Change 2 keeps the *verdict* honest at the moment
of invalidation, which is where the knowledge lives and which preserves the fast path for an
unchanged tree. Change 1 keeps the *dispatch* honest regardless of how either ledger came to
disagree — including the second variant, where no rebase kickback verdict was ever written. Either
alone leaves one observed failure live.

## Component map

| Component | File | Responsibility after this change |
|---|---|---|
| Gate dispatch boundary | `conductor.ts` step loop (`:4327-4356`) | Re-check an eligible gate's mechanical predicate before honoring a `done`/`skipped` status |
| Eligibility rule | `steps.ts` `StepDefinition` | Declare which gates are tree-attesting; the set is a property of the step, not a list at the call site |
| Post-rebase pre-verify | `rebase.ts` `applyRebaseVerdicts`, `daemon-rekick.ts` `makeRekickBuildPreVerify` | Pre-verify every eligible gate, not only `build` |
| Retry classification | `retry-classify.ts`, `conductor.ts` (`:6729`) | Decide `rerun` vs `route` for a step-runner failure whose inputs cannot change |
| Operator navigation | new `rewind` CLI verb → `ConductStateStore` | Return a feature to a named earlier step as an authorized mutation |

## Boundaries this change does not cross

- The aggregate suite's execution, fingerprint, or evidence format — `adr-2026-07-25`, untouched.
- The preserve/invalidate partition — `adr-2026-07-20`, consumed and never recomputed.
- `checkGate`'s prerequisite semantics — `adr-2026-07-11` Decision item 4, still state-only.
- `build`'s retry and progress accounting — #280, and the classifier still never runs on `build`.
- Which gates a rebase invalidates — unchanged; only whether an eligible one is pre-verified first.
