---
name: memory
description: "Use at the start of every session for recall, during work when significant decisions are made, and when context seems missing. Recall-before-act protocol with categorized persistence and staleness detection."
enforcement: gating
phase: understand
standalone: true
requires: []
---

## Purpose

Provides persistent, categorized memory across sessions. Ensures the agent starts every session
by recalling relevant context and persists significant learnings during work. Prevents repeated
questions, lost decisions, and rediscovered gotchas.

This skill is the retrieval and persistence guidance for the `local` memory provider (ADR-015/ADR-019). Recall is always performed by the agent reading `.memory/` files and judging relevance — the harness contains no search, ranking, or embedding logic (FR-3 invariant).

## Practices

### Recall Protocol (Session Start)

**This is a hard gate: every session MUST start with recall before any action.**

1. Check if `.memory/index.md` exists
   - If not: this is a fresh project — skip recall, note "no prior memory"
   - If yes: continue

2. Read `.memory/index.md` to get the summary of all memory entries

3. Identify entries relevant to the current task:
   - Match by file paths mentioned in the user's request
   - Match by feature area or domain concept
   - Match by category (always check `gotchas/` — these prevent repeat mistakes)

4. Read relevant entries in full

5. **Staleness check:** For each recalled entry:
   - If `created` date is >30 days ago, flag as potentially stale
   - If entry references specific files, check if those files still exist and match
   - If stale: surface to the user — "Memory entry X may be outdated, please verify"

6. Surface relevant memories to the user concisely:
   - "Recalled: [summary of relevant memories]"
   - "Stale: [entries that may need review]"

### Persist Protocol (During Work)

**Gate: significant decisions MUST be persisted. Don't batch — write immediately.**

After each of these events, create or update a memory entry:

| Event | Category | Example |
|-------|----------|---------|
| Architectural decision made | `decisions/` | "Chose JWT over session cookies for auth" |
| Pattern discovered | `patterns/` | "All API endpoints use service objects, not inline logic" |
| Unexpected issue hit | `gotchas/` | "PostgreSQL JSONB columns need explicit casting for array queries" |
| Domain knowledge learned | `context/` | "Premium users have different rate limits than free tier" |

### Memory Entry Format

Write each entry as a Markdown file in the appropriate `.memory/` subdirectory:

```markdown
---
created: YYYY-MM-DD
category: decisions | patterns | gotchas | context
related: [file paths, story names, or feature areas]
---

## [Descriptive Title]

[What was learned, decided, or discovered. Be specific and concrete.]

### Why

[Rationale, root cause, or circumstances that led to this knowledge.]

### Applies When

[Conditions under which this memory is relevant. Help future sessions know
when to surface this entry.]
```

**File naming:** Use kebab-case descriptive names: `chose-jwt-for-auth.md`, `jsonb-array-casting-gotcha.md`

### Index Maintenance

After creating or updating any memory entry, update `.memory/index.md`:

```markdown
# Memory Index

## Decisions
- [chose-jwt-for-auth](decisions/chose-jwt-for-auth.md) — JWT chosen over sessions for stateless API auth
- [postgres-primary-db](decisions/postgres-primary-db.md) — PostgreSQL selected as primary database

## Patterns
- [service-object-pattern](patterns/service-object-pattern.md) — All API logic flows through service objects

## Gotchas
- [jsonb-array-casting](gotchas/jsonb-array-casting.md) — JSONB arrays need explicit casting in WHERE clauses

## Context
- [premium-rate-limits](context/premium-rate-limits.md) — Premium users: 1000 req/min vs free: 100 req/min
```

Each line: `- [filename](relative-path) — one-line summary`

### Staleness Management

When a memory entry is confirmed stale:
1. Update the entry with current information, OR
2. Delete it if no longer relevant
3. Update `.memory/index.md` accordingly

When a memory entry is confirmed still valid:
- Update the `created` date to today (resets the staleness clock)

### What NOT to Remember

Do not create memory entries for:
- Things derivable from code (`git log`, `git blame`, reading files)
- Temporary task state (use tasks instead)
- Implementation details that live in the code itself
- Standard framework conventions documented elsewhere

Memory is for **non-obvious, cross-session knowledge** that would be lost between conversations.

## Verification

- [ ] Session started with recall (or noted "no prior memory" for fresh projects)
- [ ] Relevant memories surfaced to user with concise summaries
- [ ] Stale entries flagged (>30 days or referenced files changed)
- [ ] Significant decisions persisted immediately (not batched)
- [ ] `.memory/index.md` updated after every write
- [ ] Memory entries use the correct format with all required fields
- [ ] No entries created for information derivable from code
