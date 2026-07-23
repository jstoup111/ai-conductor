# Sequence: Jira source-ref traveling the intake → spec flow

**Last updated:** 2026-07-22
**Scope:** How a Jira ref (`PROJ-123`) flows claim → ledger → land → handoff once the
canonical tagged-ref module owns the grammar — and where GitHub-only writebacks no-op.
A GitHub ref (`owner/repo#N`) takes the identical path with the writebacks active.

## Diagram

```mermaid
sequenceDiagram
    participant OP as Operator / engineer session
    participant CL as intake claim
    participant LG as ledger (opaque key)
    participant SR as source-ref module (NEW)
    participant LD as land
    participant HO as handoff
    participant GH as gh CLI (GitHub REST)

    OP->>CL: conduct-ts engineer claim
    CL->>LG: record(source, "PROJ-123")
    Note over LG: key = source + NUL + ref<br/>never parsed — Jira-safe today
    CL-->>OP: claim JSON with sourceRef "PROJ-123"

    OP->>LD: land --source-ref PROJ-123
    LD->>SR: parseWorkRef("PROJ-123")
    SR-->>LD: kind jira, key PROJ-123
    LD->>LD: commit .docs/intake/«slug».md<br/>Source-Ref: PROJ-123 (lossless)
    LD--xGH: issue comment skipped (kind ≠ github, non-fatal)

    OP->>HO: handoff --source-ref PROJ-123
    HO->>SR: parseWorkRef("PROJ-123")
    SR-->>HO: kind jira, key PROJ-123
    HO->>SR: formatWorkRef(parsed)
    SR-->>HO: "PROJ-123" (round-trip identical)
    HO--xGH: Refs-line injection + label skipped (kind ≠ github, non-fatal)
    HO->>LG: advance(source, "PROJ-123", done)
    Note over SR: GitHub ref "acme/app#49" takes the same path<br/>but kind github activates every GH call
```

## Legend

- `--x` arrows: writeback deliberately skipped for `kind: 'jira'` — same non-fatal
  contract as today's null→no-op for malformed refs. A later Jira adapter (issue
  #774) replaces these skips with Jira API calls without touching the grammar.
- The ledger never calls the parser: its idempotency key is the opaque ref string.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | DECIDE phase for intake jstoup111/ai-conductor#847 (refs #774) |
