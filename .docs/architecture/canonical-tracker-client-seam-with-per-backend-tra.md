# Components: Canonical Tracker-Client Seam (#846)

**Last updated:** 2026-07-22
**Scope:** Target-state component view of the issue-side tracker access seam — the
canonical `TrackerClient` interface, its GitHub implementation over one guarded runner,
the per-backend transport contract (Jira implementations deferred to #849), and the
PR-side `gh` paths that intentionally stay outside the seam (#774: code remains on
GitHub). Paths are relative to `src/conductor/src/engine/`.

## Diagram

```mermaid
graph TD
    subgraph Callers["Issue-side call sites (migrate onto the seam)"]
        INTAKE["engineer/intake/github-issues.ts<br/>(intake adapter: comment, label, reads)"]
        FILE["engineer/intake/file-issue.ts<br/>(gh issue create)"]
        BACKLOG["backlog-priority.ts<br/>(label reads)"]
        BLOCKER["blocker-resolver.ts<br/>(blocked_by reads)"]
        DEPMIG["engineer/issue-dep-migration.ts<br/>(dependency links)"]
        IDENT["owner-gate/identity.ts<br/>(viewer identity)"]
        PROBE["wiring-probe.ts<br/>(issue state read)"]
        HALT["halt-issues/sweep.ts + closer.ts<br/>(was GhAbstraction)"]
    end

    subgraph Seam["NEW: canonical seam (tracker-client.ts)"]
        TC["TrackerClient interface<br/>named issue ops: labels, deps,<br/>comments, create/view/close, identity"]
        GHC["GitHubTrackerClient<br/>(gh CLI transport)"]
        RUNNER["canonical GhRunner type<br/>+ single makeProductionGh()"]
        GUARD["assertRealExecAllowed<br/>AI_CONDUCTOR_NO_REAL_EXEC<br/>(now uniform — closes bypass holes)"]
    end

    subgraph Config["Per-project tracker config CONTRACT (hosted by #845)"]
        CFG["tracker: backend github|jira<br/>transport api|mcp<br/>credentials reference"]
    end

    subgraph Future["Deferred to #849 (contract-only here)"]
        JIRA["JiraTrackerClient"]
        REST["REST transport<br/>(token auth)"]
        MCP["MCP transport<br/>(MCP server)"]
    end

    subgraph PRSide["PR-side (unchanged, stays on gh directly)"]
        PRL["pr-labels.ts (pr create/merge/edit)"]
        HAND["engineer/handoff.ts (pr create)"]
        IREF["engineer/issue-ref.ts (gh pr)"]
        DG["engineer/intake/delivery-guard.ts (gh pr)"]
    end

    INTAKE --> TC
    FILE --> TC
    BACKLOG --> TC
    BLOCKER --> TC
    DEPMIG --> TC
    IDENT --> TC
    PROBE --> TC
    HALT --> TC

    TC --> GHC
    GHC --> RUNNER
    RUNNER --> GUARD
    GUARD --> GH[("gh CLI")]

    CFG -. "selects backend + transport<br/>(composition root, #845)" .-> TC
    TC -.-> JIRA
    JIRA -.-> REST
    JIRA -.-> MCP

    PRL --> GH
    HAND --> GH
    IREF --> GH
    DG --> GH
```

## Legend

- **Solid boxes/arrows** — built by this feature: the `TrackerClient` interface, the
  GitHub implementation, the single canonical runner + guarded production factory, and
  the migration of every issue-side call site.
- **Dotted arrows / Future subgraph** — contract-only in this feature: the config key
  shape is documented for #845 to host; `JiraTrackerClient` and its REST/MCP transports
  are built in #849 against this seam.
- **PR-side subgraph** — intentionally out of scope; per #774 code hosting stays on
  GitHub, so PR machinery keeps calling `gh` directly.
- `halt-issues`' existing object-shaped `GhAbstraction` folds into `TrackerClient`
  (it is already the target shape).
- The kill-switch guard is uniform in the target state: every real `gh` exec on the
  issue side flows through the one `makeProductionGh()`, which honors
  `AI_CONDUCTOR_NO_REAL_EXEC` (today the `engineer-cli.ts:513` and
  `halt-issues-cli.ts:103` copies bypass it).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | DECIDE architecture step for #846 (engineer spec authoring) |
