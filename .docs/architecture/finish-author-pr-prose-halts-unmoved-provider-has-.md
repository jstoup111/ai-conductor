# Components: The Engine Owns FINISH's PR-Prose Write (#3529)

**Last updated:** 2026-10-31
**Scope:** The FINISH publication path from the coordinator's `author_pr_prose` decision, through
the provider's authoring pass, to the retained pull request's title and body. It covers the
coordinator (`finish-publication.ts` `advanceFinishPublication`, author branch and disposition
reasons), the production authoring effect (`finish-publication-production.ts` `authorProse`), the
conductor's FINISH dispatch (`conductor.ts` `runFinishPublication`, `restoreCapturedRegions`,
`resolveShipDraftPublicationDependencies`), the FINISH prompt blocks (`step-runners.ts`), the
`skills/finish` and `skills/pr` contracts, the PR-body region helpers (`pr-body-regions.ts`), the
guarded operation executor (`github-operations.ts` `executeGithubOperation`), and the
daemon-session command guard (`execution/daemon-session.ts`). Transport (`tracker-client.ts`) and
the `github-operation` CLI are unchanged.

## Diagram

```mermaid
graph TD
    subgraph Provider["Provider FINISH session (cwd = feature worktree)"]
        PROMPT["FINISH author / revision prompt<br/>step-runners.ts<br/>CHANGED: write prose to the handoff,<br/>never edit the PR"]
        JUDGE["FINISH judge prompt<br/>step-runners.ts<br/>CHANGED: verdict only, no repair write"]
        SKILLS["skills/finish + skills/pr<br/>CHANGED: one account — the engine<br/>performs every FINISH PR write"]
        HANDOFF[("worktree .pipeline/«prose handoff»<br/>NEW: title + body, versioned schema")]
    end

    subgraph Engine["Engine FINISH publication"]
        COORD["advanceFinishPublication<br/>finish-publication.ts<br/>CHANGED: specific authoring-failure reasons"]
        AUTH["authorProse effect<br/>finish-publication-production.ts<br/>CHANGED: clear stale handoff, dispatch,<br/>read + validate + publish"]
        APPLY["prose application<br/>NEW: decode handoff, re-splice<br/>ai-conductor:step regions,<br/>validate, build pull-request.edit"]
        REGIONS["pr-body-regions.ts<br/>restoreRegion / extractRegionBytes (reused)"]
        EXEC["executeGithubOperation<br/>guarded pull-request.edit (reused)"]
        OBS["observe()<br/>re-reads PR — sole authority (unchanged)"]
    end

    subgraph Guard["Daemon-session command guard"]
        DSG["evaluateDaemonSessionCommandPolicy<br/>daemon-session.ts<br/>CHANGED: missing-subcommand / --help refusal<br/>names the sanctioned subcommands"]
    end

    GH[("GitHub retained PR")]

    COORD -->|placeholder or revision| AUTH
    AUTH -->|dispatch author pass| PROMPT
    SKILLS -.->|contract| PROMPT
    PROMPT -->|write| HANDOFF
    AUTH -->|read after dispatch| HANDOFF
    AUTH --> APPLY
    APPLY --> REGIONS
    APPLY --> EXEC
    EXEC --> GH
    COORD -->|dispatch judgment| JUDGE
    JUDGE -->|verdict JSON| COORD
    COORD --> OBS
    OBS --> GH
    Provider -.->|any ai-conductor command| DSG
```

```mermaid
sequenceDiagram
    participant C as Coordinator (finish-publication.ts)
    participant A as authorProse (production)
    participant P as Provider session
    participant H as Prose handoff (.pipeline)
    participant X as executeGithubOperation
    participant G as GitHub PR
    C->>A: author_pr_prose (placeholder or revision guidance)
    A->>H: remove any stale handoff
    A->>P: dispatch FINISH author pass
    P->>H: write title + body
    P-->>A: provider attempt complete
    A->>H: read and decode
    alt handoff missing or invalid
        A-->>C: typed authoring failure (not returned / invalid + reason)
    else valid prose
        A->>G: read current body
        A->>A: re-splice step regions, validate
        A->>X: pull-request.edit «pr» title + body
        X->>G: guarded edit
        X-->>A: executed or failed
        A-->>C: done, or publication failure with error
    end
    C->>G: re-observe PR (authoritative)
    C-->>C: advance, bounded retry, or human_required with the specific reason
```

## Legend

- **NEW** marks a component or artifact this change adds; **CHANGED** marks existing behavior this
  change alters; **reused** marks an existing seam called from a new place; unmarked nodes exist
  today and are unchanged.
- `«prose handoff»` is `.pipeline/finish-pr-prose.json`, shaped `{"version":1,"title":…,"body":…}`
  (adr-2026-10-31-engine-performs-finish-pr-prose-write D1). It is decoded and applied by the new
  `finish-pr-prose-handoff.ts` module (`readPrProseHandoff`, `clearPrProseHandoff`,
  `applyAuthoredPrProse`).
- Solid arrows are calls or writes; dotted arrows are contracts or policy that apply to the
  provider session.
- Re-observation stays the only authority on whether `pr.prose` moved: a successful edit never
  advances the transition by itself.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-31 | Initial generation | #3529: move FINISH's PR title/body write from the provider to the engine |
| 2026-10-31 | Plan update: name the handoff path and the `finish-pr-prose-handoff.ts` module | Plan for #3529 fixed the handoff schema and module |
