# Components: DECIDE-phase coherence ownership at the daemon boundary (#971)

**Last updated:** 2026-07-26
**Scope:** The phase-ownership seam between operator-led DECIDE authoring and autonomous daemon
execution — the engineer authoring sequence (`engineer/authoring.ts`), the daemon preseed constant (`daemon-cli.ts:285-296`, applied `:882-887`), the
discovery-time spec vetting loop (`daemon-backlog.ts:655-673`, tier resolved `:771`), the step
definition table (`steps.ts` / `types/steps.ts`), the conductor's tier-skip computation
(`conductor.ts:2549-2557`), and the already-existing land-time coherence gate
(`land-spec.ts:294-325` → `coherence-validator.ts`).

## Current architecture (the defect)

```mermaid
graph TD
    subgraph DECIDE["DECIDE — operator-led, /engineer"]
        PLAN["/plan<br/>.docs/plans/&lt;stem&gt;.md"]
        COH["/coherence-check<br/>.docs/coherence/&lt;stem&gt;.md<br/>M/L only"]
        LAND["conduct-ts engineer land<br/>land-spec.ts:294-325"]
        GATE["runCoherenceGate<br/>fail-closed, waivable<br/>S tier + legacy = disengaged"]
    end

    subgraph GH["Spec PR merged to default branch"]
        MERGED["spec/&lt;slug&gt; merged"]
    end

    subgraph DISCOVERY["Daemon discovery — daemon-backlog.ts"]
        SCAN["scan .docs/plans/*.md on base tree<br/>slug = planStem(file) :643"]
        VET["vetting loop :655-673<br/>reject: stories not Accepted<br/>reject: plan has no dependency tree"]
        TIER["parseComplexityTier :771<br/>.docs/complexity/&lt;slug&gt;.md"]
    end

    subgraph DISPATCH["Daemon dispatch — daemon-cli.ts"]
        PRESEED["PRESEEDED_DONE :285-296<br/>10 names, HAND-MAINTAINED<br/>coherence_check ABSENT"]
        STAMP["stamp each name = 'done' :882-887"]
    end

    subgraph BUILD["Conductor resume — build worktree"]
        RESUME["resume from first unsatisfied step"]
        RUN["EXECUTES coherence_check<br/>LLM authoring inside BUILD loop"]
        VERIFY["artifact glob '.docs/coherence/*.md'<br/>artifacts.ts:52 — NOT stem-scoped"]
    end

    PLAN --> COH --> LAND --> GATE --> MERGED
    MERGED --> SCAN --> VET --> TIER --> PRESEED --> STAMP --> RESUME
    RESUME --> RUN --> VERIFY

    RUN -.->|"observed: retries exhausted<br/>daemon.log:7906-7911"| HALT["build HALTED"]

    style RUN fill:#c62828,color:#ffffff
    style PRESEED fill:#ef6c00,color:#ffffff
    style VERIFY fill:#ef6c00,color:#ffffff
    style HALT fill:#c62828,color:#ffffff
```

**Three defects are visible in the current graph:**

1. `PRESEEDED_DONE` is hand-maintained and omits `coherence_check` — the only one of the nine
   DECIDE steps left out — so the conductor resumes straight onto a DECIDE authoring step.
2. The vetting loop at `daemon-backlog.ts:655-673` — by its own comment *"the only place specs
   are vetted before autonomous build"* — checks stories and plan but not the coherence
   artifact, even though it resolves the tier 100 lines later at `:771`.
3. The post-step verifier is the unscoped glob `.docs/coherence/*.md`, which any unrelated
   prior-feature file in the full repo checkout satisfies, so the executed step's output is
   never actually checked for *this* feature.

## Target architecture

```mermaid
graph TD
    subgraph DECIDE2["DECIDE — engineer authoring"]
        PLAN2["/plan"]
        COH2["NEW: runAuthoring invokes<br/>/coherence-check after plan<br/>M/L only"]
        LAND2["engineer land<br/>runCoherenceGate<br/>deep validation, waivable"]
    end

    subgraph GH2["Spec PR merged"]
        MERGED2["spec/&lt;slug&gt; merged"]
    end

    subgraph DISCOVERY2["Daemon discovery — daemon-backlog.ts"]
        SCAN2["slug = planStem(file)"]
        TIER2["MOVED EARLIER: parseComplexityTier<br/>.docs/complexity/&lt;slug&gt;.md"]
        VET2["vetting loop — existing checks<br/>stories Accepted / plan dep-tree"]
        NEWVET["NEW: coherence presence+shape check<br/>tier != 'S' =&gt; require<br/>.docs/coherence/&lt;slug&gt;.md<br/>parseable table, &gt;=1 data row"]
        WARN["warnOnce -&gt; .daemon/warned/&lt;slug&gt;<br/>spec never enters backlog"]
    end

    subgraph DISPATCH2["Daemon dispatch — daemon-cli.ts"]
        DERIVE["NEW: PRESEEDED_DONE derived<br/>['worktree','memory', ...ALL_STEPS<br/>.filter(phase === 'DECIDE')]"]
        STAMP2["stamp per ADR-971 status rule<br/>S -&gt; 'skipped', M/L -&gt; 'done'"]
    end

    subgraph BUILD2["Conductor resume"]
        RESUME2["resume from first unsatisfied step"]
        FIRST["first executed step = acceptance_specs<br/>coherence_check NEVER executed"]
    end

    subgraph TEST["Contract tests"]
        SYNC["NEW: every DECIDE step in ALL_STEPS<br/>is preseeded — drift impossible"]
        INV["INVERTED: audit-trail-daemon-wiring<br/>expect(stepsRun).not.toContain('coherence_check')"]
    end

    PLAN2 --> COH2 --> LAND2 --> MERGED2 --> SCAN2 --> TIER2 --> VET2 --> NEWVET
    NEWVET -->|"valid or tier S"| DERIVE
    NEWVET -->|"missing/invalid"| WARN
    DERIVE --> STAMP2 --> RESUME2 --> FIRST
    SYNC -.-> DERIVE
    INV -.-> FIRST

    style NEWVET fill:#2e7d32,color:#ffffff
    style DERIVE fill:#2e7d32,color:#ffffff
    style SYNC fill:#2e7d32,color:#ffffff
    style FIRST fill:#2e7d32,color:#ffffff
```

## Component responsibilities after the change

| Component | Responsibility | Change |
|---|---|---|
| `steps.ts` / `ALL_STEPS` | Sole declaration of which phase owns each step | none (already correct) |
| `engineer/authoring.ts` `runAuthoring` | Execute the canonical DECIDE sequence and commit its artifacts | **extended** — M/L invokes `coherence_check` after `plan` and commits `.docs/coherence/<slug>.md`; S skips it |
| `daemon-cli.ts` `PRESEEDED_DONE` | Derive the preseed set from `ALL_STEPS` phase membership | **replaced** — hand-list → derivation |
| `daemon-cli.ts` stamping loop | Stamp preseeded steps with a tier-correct status | **amended** per ADR |
| `daemon-backlog.ts` vetting loop | Reject un-buildable merged specs before dispatch | **extended** with a third check |
| `coherence-validator.ts` | Deep semantic validation at authoring time | none — deliberately not reused at discovery |
| `conductor.ts:2549-2557` | Compute tier skips for steps that reach it | none |
| `artifacts.ts:52` glob | Post-step verification | none — deferred (OQ3) |

## Layering decision made explicit

Validation is deliberately **asymmetric** rather than shared:

- **Land time (authoring side)** keeps the full semantic validator — coverage layers,
  fabricated-id detection, duplicate-claim detection, waivers. It has the change set (git diff)
  that those checks require.
- **Discovery time (build side)** performs only a shallow, fail-closed **presence + parseability**
  check. Discovery reads the base-branch tree through `tree.readFile` and has no change set, so
  the deep validator is not merely expensive there — it is not computable. The shallow check is
  a backstop for specs that bypassed `land` (hand-pushed spec branches, or the gate's own
  tier-S/legacy disengagement paths), not a second copy of the gate.

This keeps a single source of semantic truth and avoids the classic failure of two divergent
validators disagreeing about the same artifact.
