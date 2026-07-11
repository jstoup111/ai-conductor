# Components: Parallel Validation Phase — one concurrent group core (#469)

**Last updated:** 2026-07-10
**Scope:** The SHIP-tail fan-out seam — a NEW concurrent group core replacing
`runParallelGroup`, the built-in validation group over
`manual_test` / `prd_audit` / `architecture_review_as_built`, the re-pointed
ADR-004 `parallel:` config DSL, and the union join into one `planRemediation`
call. Everything not marked NEW/DELETED is the existing engine.

## Diagram

```mermaid
graph TD
    subgraph Loop["conductor.ts run loop (serial walk, unchanged)"]
        BR["build_review step"]
        GB["group branch in loop<br/>precedent: old stepCfg.parallel branch"]
    end

    subgraph Core["NEW concurrent group core"]
        GC["GroupCore<br/>capped fan-out, validation_concurrency default 2<br/>fresh session id per branch<br/>per-branch skill dispatch<br/>per-branch freshness sweep"]
        RL["rate-limit episode wiring<br/>branch enters shared episode,<br/>siblings pause, later-deadline-wins"]
    end

    subgraph Consumers["Two consumers of the same core"]
        VG["built-in validation group<br/>steps.ts SHIP tail entry<br/>members shrink with tier and track skips"]
        DSL["ADR-004 parallel: config DSL<br/>schema KEPT, re-pointed<br/>3 latent bugs fixed as byproduct"]
    end

    DEAD["runParallelGroup<br/>conductor.ts:3033<br/>DELETED"]

    subgraph Branches["validation group members (write-disjoint)"]
        MT["manual_test<br/>.pipeline/manual-test-results.md<br/>only runtime-mutating member"]
        PA["prd_audit<br/>.pipeline/prd-audit.md<br/>skipped on technical track"]
        AB["architecture_review_as_built<br/>.pipeline/architecture-review-as-built.md<br/>skipped on S tier or when DECIDE review skipped"]
    end

    subgraph Join["join: verdicts join, infra fails fast"]
        JV["collect verdicts from all branches<br/>branch with NO verdict after retries<br/>fails the group - normal step-failure halt"]
        MTC["manual_test FAIL classification<br/>deterministic build kickback<br/>2026-07-06 ADR preserved, no LLM"]
        REM["ONE planRemediation call<br/>union of prd-audit + as-built gaps<br/>hintSource already multi-source"]
        WO["one consolidated work order<br/>earliest target wins, usually build<br/>manual_test FAIL rows attached as evidence"]
    end

    BR --> GB
    GB --> VG
    DSL --> GC
    VG --> GC
    GC --> RL
    GC --> MT
    GC --> PA
    GC --> AB
    MT --> JV
    PA --> JV
    AB --> JV
    JV --> MTC
    JV --> REM
    MTC --> WO
    REM --> WO
    WO -->|"all green instead"| NEXT["rebase then finish, unchanged"]
    DEAD -.->|"replaced by"| GC
```

## Legend

- **GroupCore** — the single new concurrency primitive. Both the built-in validation
  group and the config-DSL groups execute through it; there is no second executor.
- **DELETED** — `runParallelGroup` is removed, not deprecated. Its three latent bugs
  (dispatched the group name instead of each branch's skill, unbounded `Promise.all`,
  no rate-limit/retry wiring) die with it; the `when-parallel` tests are rewritten
  against the corrected semantics.
- **Write-disjoint members** — each validator writes its own stable `.pipeline/` file;
  none reads another's output (verified — only prose "after X" lines ordered them).
- **Join** — a FAIL *verdict* waits for siblings and joins the consolidated kickback;
  a branch that terminates with *no verdict* (the #385 failure shape) fails the group
  through the normal step-failure path so infra breakage stays loud.
- **manual_test FAIL classification** — stays deterministic per the APPROVED
  2026-07-06 manual-test-fail-routing ADR; remediate never re-classifies it.
- `«…»` — placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE phase for #469 spec |
| 2026-07-10 | Confirmed against implementation plan (30 tasks); auto-mode-only scoping from conflict resolution noted | /plan step 8b |
