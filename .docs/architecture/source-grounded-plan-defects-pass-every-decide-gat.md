# Architecture — Source-grounded adversarial plan review before land

**Stem:** `source-grounded-plan-defects-pass-every-decide-gat` · Tier M (lightweight diagram) · 2026-10-10 · Refs #3038

**Last updated:** 2026-10-10
**Scope:** the new `plan_review` DECIDE step and its `landSpec` rung, which run at Medium/Large tier.
The step sits between `coherence_check` and land. It also covers the judge passes it replaces in
the plan and coherence-check skills.

Today every DECIDE gate reads only `.docs/` artifacts, and nothing between `/plan` and BUILD reads
the target's real source. This feature adds one review that does.

- A **deterministic candidate builder** reads the plan and the target source. It emits suspect rows
  for three defect lenses: test impact, caller reachability, and Done-when vs dependency order.
- A **fresh adversarial reviewer**, dispatched by the engine and not run in the authoring chat,
  reads the real source. It rules on those candidates and hunts for feasibility and contradiction
  defects.
- It runs on a provider other than the authoring host where one is available. Otherwise it runs in
  a fresh same-provider session, which is recorded and never blocks.
- Its findings are schema-validated into a committed artifact.
- The review is bounded to one review plus one re-check of changed rows. Then the operator decides.
- `landSpec` refuses an M/L spec with no review artifact, or with an unresolved blocking finding.

## Component / dataflow (C4 component level)

```mermaid
flowchart TD
  subgraph AUTHOR["DECIDE authoring (composer chat or interactive conduct)"]
    PLAN["/plan → .docs/plans/«stem».md<br/>§7a coverage judge KEPT<br/>§7b contradiction judge: tier S ONLY"]
    COH["/coherence-check → .docs/coherence/«stem».md<br/>§4a/§4d judge re-runs REMOVED"]
  end

  subgraph ENGINE["src/conductor engine (NEW unless marked)"]
    ENTRY["entry: compose plan-review --worktree (composer)<br/>or plan_review step runner (conduct)<br/>tier S ⇒ skipped"]
    CAND["plan-review candidate builder (deterministic)<br/>reads plan text + target source, grep-level,<br/>language-agnostic"]
    L1["lens: test impact<br/>existing tests referencing a task's Files/symbols<br/>that no task lists"]
    L2["lens: reachability<br/>Wiring Surface / new exports with no caller<br/>in source and none named in the plan"]
    L3["lens: dependency order<br/>Done-when citing what only a non-ancestor<br/>task creates (exported dependency parser)"]
    REG["builtin-llm-providers registration (NEW, shared with plugin-loader;<br/>keeps compose path free of plugin-loader)"]
    PROV["reviewer provider selection<br/>steps.plan_review.llm_provider, else first<br/>configured provider ≠ authoring host;<br/>none ⇒ fresh same-provider session + notice"]
    DISP["one-shot reviewer dispatch<br/>(existing provider-execution, read-only<br/>capability; fresh session)"]
    VAL["findings validator<br/>closed schema: severity, artifact,<br/>task/story/ADR id, file:line evidence"]
    BOUND["round bound<br/>round 1 = full review; round 2 = re-check<br/>of changed rows; then operator decision"]
  end

  REV["adversarial reviewer subagent<br/>(other provider; reads real source)<br/>rules on candidates + feasibility + contradiction"]
  ART[".docs/plan-review/«stem».md<br/>findings + rounds + reviewer provider<br/>+ reviewed-plan digest + operator dispositions"]
  OP["operator<br/>(fix artifacts, or accept a finding<br/>with a recorded reason)"]

  subgraph LAND["landSpec (engineer/land-spec.ts)"]
    RUNG["NEW rung: plan-review gate (M/L)<br/>artifact present + schema-valid,<br/>digest matches current plan,<br/>no unresolved blocking finding"]
    EXIST["existing rungs (unchanged)"]
  end

  PLAN --> COH --> ENTRY
  ENTRY --> CAND
  CAND --> L1 & L2 & L3
  L1 & L2 & L3 --> DISP
  REG --> DISP
  PROV --> DISP
  DISP --> REV
  REV --> VAL
  VAL --> BOUND
  BOUND --> ART
  ART -->|blocking rows| OP
  OP -->|edits plan/stories/ADR| ENTRY
  ART --> RUNG
  EXIST --> RUNG
```

## Sequence — review, re-check, operator, land

```mermaid
sequenceDiagram
  participant A as Authoring host (composer)
  participant E as compose plan-review (engine)
  participant C as Candidate builder
  participant R as Reviewer (other provider)
  participant O as Operator
  participant L as compose land (landSpec)

  A->>E: plan-review --worktree «path» (after coherence-check)
  E->>C: build candidates(plan, target source)
  C-->>E: suspect rows (test impact, reachability, order)
  E->>R: fresh one-shot dispatch: plan + ADRs + stories + candidates, read-only source access
  R-->>E: findings JSON (round 1)
  E->>E: validate schema, write .docs/plan-review/«stem».md
  alt no blocking findings
    E-->>A: clean ✓ (no added interaction)
  else blocking findings
    E-->>A: findings (severity, id, file:line)
    A->>A: author fixes artifacts
    A->>E: plan-review (round 2: re-check changed rows only)
    E->>R: fresh dispatch: changed rows + prior findings
    R-->>E: findings JSON (round 2)
    opt blocking findings remain
      E-->>O: bound reached — decide each remaining finding
      O-->>E: fix or accept with reason (recorded)
    end
  end
  A->>L: land --worktree «path»
  L->>L: plan-review rung: artifact valid, digest current, no unresolved blocking
  L-->>A: landed / refused (naming the finding)
```

## Legend

- **NEW unless marked:** every node in the engine subgraph is introduced by this feature. `DISP`
  reuses the existing provider-execution machinery and its read-only reviewer capability.
- **REMOVED / ONLY:** judge passes this feature retires or narrows. §7b stays for Small tier, so
  Small specs keep a contradiction check and are otherwise unaffected.
- **Bound:** at most two reviewer dispatches per spec. A third round is never dispatched; remaining
  findings go to the operator.
- **Digest:** the artifact records the plan it reviewed. A plan edited after the final review fails
  the land rung until it is re-checked, or until the operator dispositions the change within the
  bound.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Initial generation | #3038 DECIDE: source-grounded plan review |
| 2026-10-10 | Plan update: shared built-in provider registration; runner-owned provider fall-through with native-schema scratch | Source-grounded review of the plan (Tasks 12, 15, 24) |
