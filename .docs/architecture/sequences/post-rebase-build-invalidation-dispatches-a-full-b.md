# Sequence: Post-rebase gate-first re-verify (#420)

**Last updated:** 2026-07-08
**Scope:** The invalidation-triggered re-entry lap after a file-changing finish-time rebase —
before (today) vs after (this feature).

## Diagram

```mermaid
sequenceDiagram
    participant R as runRebaseStep
    participant A as applyRebaseVerdicts
    participant P as mechanical predicates
    participant V as gate-verdicts
    participant L as step loop
    participant B as build agent
    participant E as events.jsonl

    Note over R: rebase outcome = changed (code/test paths)
    R->>A: invalidate downstream gates

    rect rgb(235, 235, 235)
        Note over A,E: TODAY (issue #420)
        A->>V: write satisfied:false for build, build_review, manual_test
        V->>L: selector routes back to build
        L->>B: dispatch FULL build agent (~45-60 min)
        B-->>L: done
        L->>P: post-step gate runs deriveCompletion
        P-->>L: already complete (1-2 min, zero tokens)
    end

    rect rgb(220, 240, 220)
        Note over A,E: AFTER (gate-first, build only)
        A->>P: evaluate BUILD predicate on rebased tree<br/>(deriveCompletion - git trailers survive rebase)
        alt build predicate passes
            P-->>A: satisfied
            A->>V: write fresh objective verdict for build (satisfied:true)
            A->>E: emit rebase_gate_reverified, dispatch skipped
        else build predicate fails or errors
            P-->>A: unsatisfied
            A->>V: write satisfied:false, kickback from rebase (as today)
        end
        A->>V: build_review + manual_test: ALWAYS satisfied:false<br/>(predicates not tree-attesting - never pre-verified)
        V->>L: selector routes to remaining unsatisfied gates
        L->>B: build dispatch ONLY when evidence genuinely missing
    end

    Note over A,L: review kickbacks (from build_review etc.)<br/>bypass the pre-verify entirely - rework is never swallowed
```

## Legend

- Grey block: current behavior encoded by `test/integration/rebase-loop.test.ts` (`buildRuns`
  expected 2). Green block: target behavior — the same mechanical check, moved before dispatch.
- Only `build` is pre-verified: its predicate re-derives from git evidence (tree-attesting).
  `manual_test`/`build_review` predicates check session-freshness/presence only — a
  same-session pre-rebase artifact would falsely pass — so they stay invalidated as today.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-08 | Initial generation | DECIDE phase for issue jstoup111/ai-conductor#420 |
| 2026-07-08 | Narrowed pre-verify to build only | Architecture review: manual_test/build_review predicates are not tree-attesting (false-pass risk) |
