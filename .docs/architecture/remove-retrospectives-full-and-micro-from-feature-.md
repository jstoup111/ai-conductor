# Architecture: Remove Retrospectives (Full and Micro) from Feature Delivery

**Last updated:** 2026-08-26
**Scope:** The SHIP-tail step graph, daemon-completion narrative path, and batch-boundary closeout obligations, before and after the retro purge. Source: jstoup111/ai-conductor#1905.

## Diagram: SHIP tail — before and after

```mermaid
graph TD
    subgraph BEFORE
        A1[architecture_review_as_built] --> R1[retro<br/>advisory, skip tier S,<br/>daemon-mode hard skip]
        R1 --> B1[rebase]
        B1 --> F1[finish]
    end
    subgraph AFTER
        A2[architecture_review_as_built] --> B2[rebase]
        B2 --> F2[finish]
    end
```

The `rebase → retro` prerequisite edge was introduced deliberately to serialize the ship tail
(#922, `.memory/decisions/serial-ship-tail-922.md`). Re-pointing `rebase.prerequisites` to
`architecture_review_as_built` preserves that fence: rebase still waits for the last review
step before publication; only the retro hop disappears.

## Diagram: daemon-completion narrative path — before and after

```mermaid
graph LR
    subgraph BEFORE_completion
        D1[daemon-runner<br/>emitDaemonSignal] --> T1{halted?}
        T1 -- yes --> H1[renderHaltNarrative<br/>no provider call]
        T1 -- no --> T2{tier-skipped retro?}
        T2 -- yes --> N1[no narrative]
        T2 -- no --> P1[provider call<br/>step key retro<br/>buildRetroPrompt]
        H1 --> S1[engineer store signal]
        P1 --> S1
        N1 --> S1
    end
    subgraph AFTER_completion
        D2[daemon-runner<br/>emitDaemonSignal] --> T3{halted?}
        T3 -- yes --> H2[renderHaltNarrative<br/>no provider call]
        T3 -- no --> N2[no narrative]
        H2 --> S2[engineer store signal]
        N2 --> S2
    end
```

Halt narratives are diagnostic, not retrospective — they stay. The completion-time retro
provider call (`engineer-store.produceNarrative`, `buildRetroPrompt`, the `retro` routing key,
`tierSkippedRetro` threading, `daemon-runner.retroTierSkipped` event scan) is removed.

## Diagram: batch-boundary closeout — before and after

```mermaid
graph LR
    subgraph BEFORE_closeout
        BB1[BUILD batch boundary] --> SIM1[simplify]
        BB1 --> MR1[micro-retro<br/>batch-N-retro.md +<br/>closeout-event micro-retro]
        BB1 --> OTH1[other closeout obligations]
    end
    subgraph AFTER_closeout
        BB2[BUILD batch boundary] --> SIM2[simplify]
        BB2 --> OTH2[other closeout obligations]
    end
```

`micro-retro` leaves the `pipeline_closeout.obligation` event union and the
`CLOSEOUT_OBLIGATIONS` CLI allowlist in the same change (a lockstep pair under `satisfies`).
All downstream consumers (rollup, build-tail CLI, OTel, renderers) are obligation-generic
and need no change.

## Removal surface map (components deleted vs edited)

```mermaid
graph TD
    subgraph DELETED
        SK[skills/retro/]
        SD[engine steps.ts retro StepDefinition]
        UN[types/steps.ts StepName member retro]
        NP[engineer-store narrative provider path]
        MO[micro-retro obligation]
        BC[bin/conduct retro step]
    end
    subgraph EDITED
        RB[rebase prerequisites rewire]
        EX[10 exhaustive StepName records<br/>config, models, efforts, retries,<br/>review, rationale, dispatch, artifacts]
        RT[runtime string lists:<br/>complete-verifier SHIP_GATING_STEPS,<br/>step-runners oneShotSteps,<br/>phase-marker DOCS_WRITE_ALLOWLIST]
        DS[conductor daemon-mode retro skip branch]
        SKR[~40 skill/doc/template references]
        MT[HARNESS.md model table regenerated]
    end
    UN --> EX
    SD --> RB
```

## Legend

- BEFORE/AFTER subgraphs show the same surface pre- and post-purge.
- DELETED = code/files that cease to exist; EDITED = surviving files losing their retro entries.
- Historical `.docs/retros/` reports and retro-era spec artifacts remain as records.
- Recovery anchor: git tag `retro-last` on the last pre-removal main commit.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1905 retro purge |
