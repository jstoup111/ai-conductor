# Components: Canonical source-ref module (GitHub + Jira)

**Last updated:** 2026-07-22
**Scope:** The work-item reference (source-ref) flow through intake, ledger, land/handoff
writebacks, intake markers, and backlog dependency resolution — showing the new canonical
tagged-ref module as the single grammar owner replacing 5 divergent parsers.

## Diagram

```mermaid
graph TD
    subgraph SR["NEW: canonical source-ref module (engine/engineer/source-ref.ts)"]
        PARSE["parseWorkRef(ref)<br/>→ kind github: repo + number<br/>→ kind jira: key<br/>→ null (malformed)"]
        FORMAT["formatWorkRef(parsed)<br/>lossless round-trip"]
    end

    subgraph INTAKE["Intake (ADR-009 port)"]
        CLAIM["claim (github-issues.ts)<br/>emits sourceRef string"]
        LEDGER["ledger.ts:80<br/>key = source + NUL + sourceRef<br/>(OPAQUE — never parses)"]
        MARKER[".docs/intake/«slug».md<br/>Source-Ref: «ref» (opaque)"]
        LABELS["label-sync.ts<br/>was: SLUG_REF_RE"]
    end

    subgraph WRITEBACK["Land / handoff writebacks (GitHub-only)"]
        ISSUEREF["issue-ref.ts<br/>was: parseSourceRef (canonical)<br/>Closes/Refs line + gh edit"]
        PRLABELS["pr-labels.ts<br/>URL parser KEPT<br/>adopts shared return type only"]
    end

    subgraph BACKLOG["Backlog / dependencies"]
        PRIORITY["backlog-priority.ts<br/>was: parseIssueRef (owner split)"]
        DEPMIG["issue-dep-migration.ts<br/>was: parseRef (copy)"]
    end

    CLAIM --> LEDGER
    CLAIM --> MARKER
    CLAIM -.->|"delegates parse"| PARSE
    LABELS -.->|"delegates parse"| PARSE
    ISSUEREF -.->|"delegates parse"| PARSE
    PRIORITY -.->|"delegates parse"| PARSE
    DEPMIG -.->|"delegates parse"| PARSE
    ISSUEREF --> FORMAT
    PARSE -->|"kind github"| GH["gh api / gh pr edit<br/>(GitHub REST)"]
    PARSE -->|"kind jira"| NOOP["no-op skip<br/>(no Jira adapter yet;<br/>matches null→no-op contract)"]

    style SR fill:#d4edda,stroke:#28a745
    style NOOP fill:#fff3cd,stroke:#ffc107
    style LEDGER fill:#e2e3e5,stroke:#6c757d
```

## Legend

- **Green (SR):** the new canonical module — sole owner of both grammars
  (`owner/repo#N` with `#` always present; Jira `PROJ-123` never contains `#`, so
  the tagged parse is unambiguous).
- **Grey (LEDGER):** deliberately untouched — the dedup key treats the ref as an
  opaque string, so Jira keys already dedupe safely.
- **Yellow (NOOP):** GitHub-only writeback sites narrow on `kind === 'github'` and
  skip Jira refs non-fatally, exactly like today's null→no-op contract for
  malformed refs.
- **Dashed arrows:** parse delegation (the "was:" annotations name the divergent
  parser each site retires).
- `pr-labels.ts` parses **github.com URLs** (a different input domain) — it keeps
  its URL parse and only adopts the shared return type.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | DECIDE phase for intake jstoup111/ai-conductor#847 (refs #774) |
