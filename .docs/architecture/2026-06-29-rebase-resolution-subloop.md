# Architecture: Gated Rebase-Conflict Resolution Sub-Loop

**Last updated:** 2026-06-29
**Scope:** The resolution sub-loop inserted into `runRebaseStep` between `performRebase`'s
`conflict_halt` outcome and `writeHalt`. Extends Phase 9.0
(`2026-06-25-phase-9.0-rebase-loop-tail.md`). Modification to existing internal machinery — not a
new system. Consumed by `/architecture-review` to author the amending ADR for the ADR-001 dispatch
exception.
**Source PRD/stories:** `.docs/specs/2026-06-29-rebase-resolution-skill.md`,
`.docs/stories/rebase-resolution-skill.md`

---

## Control flow — `runRebaseStep` with resolution sub-loop

```mermaid
graph TD
    start["runRebaseStep(state)"] --> daemon{"this.daemon?"}
    daemon -->|"no (interactive)"| noop["outcome = noop<br/>(self-satisfy, no git, no dispatch)<br/>FR-10"]
    noop --> verdicts

    daemon -->|yes| perform["performRebase()<br/>rebase.ts (unchanged)"]
    perform --> outcome{"outcome.kind"}
    outcome -->|"noop / changed / changelog_resolved"| verdicts["applyRebaseVerdicts()<br/>(unchanged) — kicks back<br/>build/manual_test on 'changed'"]
    outcome -->|conflict_halt| cap{"cap > 0?<br/>(resolved-config,<br/>default 3) FR-7"}

    cap -->|"no (cap = 0)"| halt["writeHalt()<br/>immediate — today's behavior"]

    cap -->|yes| loop["resolution sub-loop<br/>attempt = 1..N"]
    loop --> dispatch["dispatch skills/rebase<br/>(scoped subagent) FR-1/FR-2"]
    dispatch --> emit1["emit rebase_resolution_attempt<br/>{index, cap} FR-11"]
    emit1 --> result{"attempt result"}

    result -->|"cannot-resolve signal"| shortcircuit["short-circuit FR-6"]
    shortcircuit --> halt

    result -->|"continued, tree clean"| guards{"acceptance guards"}
    result -->|"still conflicted / continue failed"| more{"attempt < N?"}
    more -->|yes| loop
    more -->|"no (exhausted)"| halt

    guards --> g8{"isBranchCurrent?<br/>FR-8"}
    g8 -->|no| more
    g8 -->|yes| g9{"feature commits<br/>preserved? FR-9"}
    g9 -->|"no (dropped)"| more
    g9 -->|yes| reclass["re-classify outcome<br/>(noop / changed / changelog)"]
    reclass --> verdicts

    halt --> haltv["rebase verdict: satisfied=false<br/>rebase left PAUSED<br/>HALT note records attempt count"]

    classDef new fill:#d4f4dd,stroke:#2a7,color:#000;
    classDef guard fill:#fde8c4,stroke:#c83,color:#000;
    classDef existing fill:#e8eef7,stroke:#47a,color:#000;
    class loop,dispatch,emit1,result,shortcircuit,cap,reclass new;
    class g8,g9,guards guard;
    class perform,verdicts,noop,halt,haltv existing;
```

## Legend

- **Green** — new in this feature (the gated resolution sub-loop, dispatch, events, cap).
- **Orange** — the two load-bearing acceptance guards. A resolution that claims success but fails
  `isBranchCurrent` (FR-8) or drops feature commits (FR-9) is **rejected back into the attempt
  loop**, never accepted. This is what makes "trust the suite as the net" safe.
- **Blue** — existing, unchanged machinery (`performRebase`, `applyRebaseVerdicts`, `writeHalt`,
  the interactive no-op).
- **Termination:** every path reaches either `applyRebaseVerdicts` (satisfied, possibly with a
  build/manual_test kickback) or `writeHalt` (paused for a human). The sub-loop is bounded by N.

## Relationship to ADR-001

ADR-001 (APPROVED) made the rebase step engine-native and prompt-free. This feature dispatches a
prompt **only** inside the green `conflict_halt` sub-path. Detection (`performRebase`,
`isBranchCurrent`) and the satisfied predicate stay engine-native. The amending ADR authored at
`/architecture-review` records this narrowed exception.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-29 | Initial generation | New resolution sub-loop for feat/rebase-resolution-skill |
