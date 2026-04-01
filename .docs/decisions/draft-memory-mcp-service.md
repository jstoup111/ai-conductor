# ADR: Memory MCP Service (DRAFT — Not Implemented)

**Date:** 2026-03-29
**Status:** Proposed
**Deciders:** James Stoup

## Context

The harness stores project memory (decisions, patterns, gotchas, context) as local markdown
files in `.memory/`. This works for solo development on 1-2 projects but has scaling problems:

- **Context bloat:** `session-start-context.sh` dumps the full index into context. As projects
  mature, hundreds of entries compete for context window space. Most are irrelevant to the
  current task.
- **No semantic retrieval:** finding relevant entries requires reading everything or grepping
  by keyword. No understanding of "this gotcha about JSONB casting is relevant to my current
  database work."
- **Project-siloed:** gotchas discovered in Project A don't surface in Project B, even when
  they apply (same stack, same patterns).
- **No decay:** entries accumulate forever. Stale entries (referencing deleted files, outdated
  decisions) persist unless manually cleaned.
- **No deduplication:** similar findings from different sessions become separate entries.

## Options Considered

### Option A: Enhanced local files (status quo+)
- **How:** Better indexing in `index.md`, tags per entry, grep-based retrieval
- **Pros:** No infrastructure, works offline, zero setup
- **Cons:** Still dumps full context, no semantic matching, no cross-project, no decay

### Option B: Local MCP server with SQLite + FTS5
- **How:** Self-hosted MCP server, SQLite with full-text search, runs on localhost
- **Pros:** Semantic-ish retrieval via FTS5, on-demand recall (not dump-everything), no cloud dependency
- **Cons:** Another process to run, still project-siloed unless shared DB

### Option C: Hosted MCP service (SaaS)
- **How:** Cloud-hosted memory service, MCP protocol, per-user storage
- **Pros:** Cross-project, cross-machine, team sharing, server-side embeddings for true semantic
  retrieval, managed decay/deduplication, scales to hundreds of projects
- **Cons:** Requires internet, data leaves local machine, subscription cost, latency

## Decision

Build Option C as a standalone service, with Option B as a self-hosted fallback.

### Why

The highest-value capability is **cross-project semantic retrieval** — "has any project I've
worked on hit this problem before?" This requires a centralized store, not per-project files.
The context budget improvement alone (recall 3-5 relevant entries using ~200 tokens vs dump
everything using ~2000+) pays for itself in faster, cheaper sessions.

### Scope: Beyond Just Memory

The service could store and retrieve more than `.memory/` entries:

| Artifact | Value of Server-Side Storage |
|---|---|
| **Memory** (decisions, patterns, gotchas) | Cross-project retrieval, semantic search, decay |
| **Retro findings** | Trend analysis across projects, recurring issue detection |
| **ADRs** | Searchable architecture decisions across all projects |
| **Story patterns** | "Show me negative path patterns used in similar APIs" |
| **Evaluator findings** | Calibration data — what issues recur, what gets caught vs missed |
| **Pipeline stats** | Task completion rates, rework cycles, intervention counts over time |

### API Design (Proposed)

```
MCP Server
├── memory.store     — {category, content, project, tags, source_file}
├── memory.recall    — {query, project?, limit?, categories?} → ranked results
├── memory.related   — {file_path | topic} → related entries across projects
├── memory.expire    — {age_days?, unreferenced?} → cleaned entries
├── memory.trends    — {project?, category?} → patterns over time
└── memory.search    — {query, scope: "project" | "all"} → full-text results
```

### Harness Integration

Replace file-based memory with MCP calls:
- `session-start-context.sh` → `memory.recall(context=current_task, limit=5)`
- `save_state` for memory → `memory.store(category, content, project, tags)`
- `/retro` feedback loop → `memory.store` + `memory.trends`
- Cross-project gotcha surfacing → `memory.related(topic, scope="all")`

File-based `.memory/` becomes a local cache/fallback for offline work.

## References

- Reddit discussion on memory MCP usage patterns:
  https://www.reddit.com/r/ClaudeAI/comments/1kvot1c/genuine_question_do_you_use_any_kind_memory_mcp/
- Comparison of 9 MCP memory servers/frameworks:
  https://www.reddit.com/r/ClaudeAI/comments/1na4npm/9_mcp_memory_serversframeworks_that_actually_make/

## Consequences

### Positive
- Context budget drops from ~2000 tokens (full dump) to ~200 tokens (targeted recall)
- Cross-project learning — gotchas discovered once apply everywhere
- Trend analysis across projects and over time
- Team knowledge sharing (future)
- Managed decay eliminates stale entries automatically

### Negative
- New infrastructure to build and maintain
- Network dependency for primary path (mitigated by local cache fallback)
- Data security considerations — memory may contain code patterns, architectural details
- Migration path needed from existing `.memory/` files to the service

### Follow-up Actions
- [ ] Evaluate existing MCP memory servers from the Reddit comparison
- [ ] Design data model (entries, tags, embeddings, projects, users)
- [ ] Build MVP with SQLite + FTS5 as local server first
- [ ] Add vector embeddings for semantic retrieval (phase 2)
- [ ] Build hosted version with multi-project support (phase 3)
- [ ] Update harness memory skill to use MCP with file-based fallback
