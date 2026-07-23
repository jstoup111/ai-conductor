# Components: DECIDE Artifact Coherence Check

**Last updated:** 2026-07-22
**Scope:** Where the coherence check sits in the DECIDE pipeline and the `engineer land`
validation ladder. Feature: intake jstoup111/ai-conductor#539, tier M, product track.
PRD: `.docs/specs/2026-07-22-decide-artifact-coherence-check.md`.

## Diagram

```mermaid
graph TD
    subgraph capture["Engineer capture (per-idea worktree)"]
        CLAIM["engineer claim<br/>(intake issue text + Source-Ref)"]
        PERSIST["NEW: outcome staging<br/>gitignored .pipeline/ staging file<br/>Source-Ref + Desired-outcome bullets<br/>(committed marker stays land-written,<br/>plan-stem-keyed)"]
        CLAIM --> PERSIST
    end

    subgraph decide["DECIDE pipeline (skills, in-session)"]
        EXPLORE["/explore → .docs/track/"]
        CPLX["complexity → .docs/complexity/"]
        PRD["/prd → .docs/specs/ (product track)"]
        ARCH["/architecture-diagram + review<br/>.docs/architecture/ + .docs/decisions/"]
        STORIES["/stories → .docs/stories/"]
        CONFLICT["/conflict-check → .docs/conflicts/<br/>(cross-feature, unchanged)"]
        PLAN["/plan → .docs/plans/"]
        COHERE["NEW: /coherence-check (tier M/L only;<br/>skipped for S · L pins opus)<br/>authors .docs/coherence/«plan-stem».md<br/>outcome → story → task mapping,<br/>per-row verdicts (semantic judging in-session)"]
        EXPLORE --> CPLX --> PRD --> ARCH --> STORIES --> CONFLICT --> PLAN --> COHERE
    end

    subgraph land["engineer land — deterministic validation ladder (land-spec.ts)"]
        L1["existing: dirty-worktree /<br/>AuthoringGuard / C2 content /<br/>DRAFT-ADR / tier-artifact checks"]
        L2["NEW: CoherenceValidator (tier ≠ S)<br/>parse .docs/coherence/ artifact;<br/>cross-check ids vs real stories/plan/intake<br/>(reuses splitStoryBlocks,<br/>collectPlanCoverage, plan-task-parse);<br/>commits staged outcomes into<br/>.docs/intake/«plan-stem».md"]
        L3["NEW: duplicate-intake check<br/>Source-Ref already claimed by a<br/>default-branch .docs/intake marker → refuse"]
        L4["NEW: coherence waiver eval<br/>fresh-in-diff, names every gap<br/>(mirrors release-gate parseWaiver)"]
        L5["commit .docs on spec/«slug» branch"]
        L1 --> L2 --> L3 --> L4 --> L5
    end

    PERSIST -.->|"outcome bullets are the<br/>mapping's source of truth"| COHERE
    COHERE -->|"committed mapping artifact"| L2
    L4 -->|"unwaived gap"| REJECT["fail-closed reject<br/>per-gap report (FR-9)<br/>worktree kept for inspection"]
    L5 --> HANDOFF["engineer handoff → spec PR"]

    style PERSIST fill:#e6f7e6,stroke:#2d7a2d
    style COHERE fill:#e6f7e6,stroke:#2d7a2d
    style L2 fill:#e6f7e6,stroke:#2d7a2d
    style L3 fill:#e6f7e6,stroke:#2d7a2d
    style L4 fill:#e6f7e6,stroke:#2d7a2d
    style REJECT fill:#fde8e8,stroke:#b91c1c
```

## Legend

- **Green nodes** — new components introduced by this feature.
- **Red node** — fail-closed rejection path.
- **Dashed edge** — data dependency (not control flow).
- `«…»` — variable placeholder (slug, plan stem).
- The LLM contributes only inside `/coherence-check` (semantic outcome↔story judging,
  in-session). Everything at the land boundary is deterministic code — per the harness
  "deterministic where possible" principle, an authoring-session self-report can never
  pass the gate (PRD FR-14, NFR).
- Negative paths (PRD FR-10..12): technical track → mapping omits the FR layer; no-intake
  idea → mapping omits the outcome layer; S-tier spec → step skipped and validator does
  not engage; fully-coherent M/L chain → validator passes silently, no operator
  interaction.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | DECIDE-phase design for intake #539 |
| 2026-07-22 | Outcome persistence → .pipeline staging; dup scan → intake markers only; S-tier exemption; L-tier opus step-up | Conflict-check resolutions + operator ruling |
