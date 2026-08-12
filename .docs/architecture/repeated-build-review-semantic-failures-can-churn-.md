# Components: bounded build_review convergence and removal-aware Tautology grading

**Last updated:** 2026-08-12
**Scope:** The `build_review` kickback seam — `kickback-ledger.ts`, the conductor's
`build_review` FAIL branch, the grader prompt assembler, and the event spine. Issue #1521.

## Diagram

```mermaid
graph TD
  subgraph Engine["conduct engine (src/conductor/src/engine)"]
    BR["build_review step<br/>conductor.ts FAIL branch"]
    PROMPT["build-review-prompt.ts<br/>buildGraderPrompt"]
    INPUTS["build-review-inputs.ts<br/>BuildReviewInputs"]
    REMOVAL["NEW: removal-evidence deriver<br/>deleted files + deleted exported symbols"]
    LEDGER["kickback-ledger.ts<br/>bumpKickbackGate"]
    HALT["writeHaltMarker<br/>.pipeline/HALT + HALT.class"]
    EMIT["ConductorEventEmitter"]
  end

  subgraph State[".pipeline (per-feature, gitignored)"]
    LFILE[".pipeline/kickback-ledger.json<br/>count, treeHash, NEW cumulative"]
    VERDICT[".pipeline/build-review.json<br/>grader verdict + rubric"]
    EVENTS[".pipeline/events.jsonl"]
  end

  subgraph Grader["build_review grader session (LLM)"]
    JUDGE["four-item rubric<br/>Tautology narrowed by removal evidence"]
  end

  DIFF["git diff (base...HEAD)"] --> REMOVAL
  DIFF --> INPUTS
  REMOVAL -->|removalContext block| INPUTS
  INPUTS --> PROMPT
  PROMPT --> JUDGE
  JUDGE --> VERDICT
  VERDICT --> BR

  BR -->|consumeKickbackBudget| LEDGER
  LEDGER <--> LFILE
  LEDGER -->|"perTree exhausted OR cumulative over cap"| HALT
  LEDGER -->|"budget remains"| BUILD["navigateBack to build / remediate"]
  BR -->|"kickback event: count + NEW cumulativeCount"| EMIT
  HALT -->|loop_halt event| EMIT
  EMIT --> EVENTS
  BUILD --> DIFF

  classDef new fill:#dff5e1,stroke:#2f7d3c,stroke-width:2px;
  class REMOVAL new;
```

## Legend

- **Green / bold border** — the one genuinely new component: the deterministic removal-evidence
  deriver. Everything else is an existing seam that gains a field, an input, or a branch.
- `.pipeline/kickback-ledger.json` gains a **`cumulative`** counter on each gate entry. Unlike
  `count`, it is not reset by tree movement; only a gate PASS clears it. The two bounds are
  independent: `count` still bounds no-op laps over one tree, `cumulative` bounds total laps.
- The `kickback` event gains **`cumulativeCount`** so `.pipeline/events.jsonl` shows convergence.
  This extends the existing `ConductorEvent` union member — no parallel channel is introduced,
  per the repository's event-spine principle.
- **`removalContext`** joins `repairContext` and `acceptedWidenings` as a third engine-recorded
  evidence block on `BuildReviewInputs`. It is evidence, not an exemption the maker can assert:
  the engine computes it from the diff, and the grader checks changed tests against it.
- The `LEDGER → HALT` edge is the new terminal state. It writes `needs-human`, so the daemon's
  re-kick sweep will not recycle it on base advance.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-12 | Initial generation | Issue #1521 — build_review churned eight laps because tree movement reset the kickback budget every time, while the universal Tautology rule flagged the removal-maintenance fixture edits that each lap produced |
