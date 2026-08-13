# Components (L3): Base-Advance Repair Attribution

**Last updated:** 2026-08-13
**Scope:** The path by which the fact "a base advance invalidated branch work" reaches the
`build_review` grader as repair context — `rebase.ts`, `gate-verdicts.ts`,
`test-suite-remediation.ts`, `conductor.ts`, `build-review-inputs.ts`,
`build-review-prompt.ts` (intake #1535). Extends
[2026-07-20-post-rebase-delta-aware-invalidation.md](2026-07-20-post-rebase-delta-aware-invalidation.md),
which shows gate invalidation but stops before the repair-context channel.

## Diagram

```mermaid
graph TD
  subgraph advance["Base advance — rebase.ts"]
    APPLY["applyRebaseVerdicts<br/>writes satisfied:false +<br/>kickback{from:'rebase', evidence}<br/>to every invalidated gate"]:::existing
    EMIT["emits rebase_changed{changedPaths}<br/>+ rebase_gate_invalidated{gate, matchedPaths}"]:::existing
  end

  subgraph spine["Event spine — the durable carrier"]
    BUS["ConductorEventEmitter"]:::existing
    PERSIST["EventPersister"]:::existing
    JSONL[("«worktree»/.pipeline/events.jsonl<br/>append-only, per-feature")]:::store
  end

  subgraph verdicts["Gate verdicts — the TRANSIENT carrier"]
    VFILE[("«worktree»/.pipeline/gates/«step».json")]:::store
    COMPUTE["computeAndWriteVerdict<br/>rebuilds the verdict object from<br/>scratch — DROPS kickback"]:::defect
  end

  subgraph attribution["Attribution — test-suite-remediation.ts"]
    PROBE["wasInvalidatedByRebase(verdict)<br/>kickback.from === 'rebase'<br/>REPLACED"]:::defect
    JOIN["resolveBaseAdvance(failure)<br/>NEW — reads the spine, joins a<br/>failure to an advance by<br/>time-window + changed-path overlap"]:::new
    RECORD["recordGateRepair<br/>CHANGED — gate-agnostic;<br/>keyed on (advance, failure)<br/>so N repairs per advance accrue"]:::changed
    LEDGER[("«worktree»/.pipeline/<br/>build-review-rebase-repairs.json")]:::store
  end

  subgraph callers["Failure observation — conductor.ts"]
    TS["test_suite full-suite failure<br/>«:4705», «:7206»<br/>currently the ONLY producers"]:::changed
    OTHER["any other gate failure<br/>NEW — same recording path"]:::new
  end

  subgraph grading["Grader input assembly"]
    ASSEMBLE["assembleBuildReviewInputs<br/>build-review-inputs.ts"]:::changed
    PROMPT["buildGraderPrompt<br/>renders 'Engine-recorded rebase<br/>repair context' block"]:::existing
    PROV["grading provenance<br/>NEW — records whether repair<br/>context was available at grade time"]:::new
  end

  APPLY --> VFILE
  EMIT --> BUS --> PERSIST --> JSONL
  COMPUTE -- "next run of the gate<br/>overwrites the file" --> VFILE
  VFILE -. "OLD source — survives<br/>exactly one gate pass" .-> PROBE
  PROBE -. "removed" .-> RECORD

  JSONL -- "NEW source — durable,<br/>survives every re-run" --> JOIN
  TS --> RECORD
  OTHER --> RECORD
  JOIN --> RECORD
  RECORD --> LEDGER
  LEDGER --> ASSEMBLE --> PROMPT
  ASSEMBLE --> PROV
  PROV --> BUS

  classDef new fill:#cce5ff,stroke:#004085,stroke-width:2px;
  classDef changed fill:#ffe0b2,stroke:#8a4b00,stroke-width:2px;
  classDef defect fill:#f8d7da,stroke:#721c24,stroke-width:2px;
  classDef existing fill:#d4edda,stroke:#155724;
  classDef store fill:#eeeeee,stroke:#555;
```

## Legend

| Style | Meaning |
|-------|---------|
| Blue, bold | New in this change |
| Orange, bold | Existing component whose behavior changes |
| Red, bold | The defective element being removed or replaced |
| Green | Unchanged existing component |
| Grey cylinder | On-disk store |
| Dashed edge | Relationship being removed |

**The central move.** The fact "the base moved and invalidated branch work" is *durable* — it
stays true for the remainder of the feature's build. Its current carrier, the `kickback` field
on a gate verdict file, is *transient*: `computeAndWriteVerdict` rebuilds the verdict object
from `{satisfied, reason, checkedAt}` alone, so the attribution is erased the next time that
gate runs. The change re-sources attribution from `.pipeline/events.jsonl`, which is
append-only, per-feature, and already co-located with the repair ledger in the same worktree.

**Why not a new store.** Per this repository's event-spine principle, `rebase_changed` and
`rebase_gate_invalidated` already carry the advance and the paths it touched. No new channel is
introduced; the join reads what the spine already records.

**Anti-goal guard.** The join requires changed-path overlap, not just a time window. A bare
time-window join would attribute *any* post-rebase failure to the rebase and would launder
genuinely unplanned deletions — the explicit anti-goal in the intake's desired outcomes.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-13 | Initial generation | DECIDE for intake #1535 — base-advance repair attribution never reaches the grader |
