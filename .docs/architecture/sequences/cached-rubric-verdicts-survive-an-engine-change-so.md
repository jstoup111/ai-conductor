# Sequence: cached verdict discarded after an engine change (#1759)

**Last updated:** 2026-08-21
**Scope:** A warm feature's first build_review dispatch after the daemon restarts onto a new engine dist. Planned state (approach C).

## Diagram

```mermaid
sequenceDiagram
  participant D as daemon «new dist»
  participant SR as step-runners
  participant CO as coordinator
  participant C as cache «rubric».json
  participant M as grader model
  participant E as event spine

  D->>SR: dispatch build_review
  SR->>SR: engineIdentity = engineVersionId + sha256(SKILL.md) per rubric
  SR->>CO: coordinate(lookup incl. engineIdentity)
  CO->>C: read entry
  C-->>CO: entry (old engineVersionId)
  CO->>CO: classify → miss: engine-version-mismatch
  CO->>E: build_review_cache_discarded «rubric, reason»
  CO->>M: dispatch rubric
  M-->>CO: judged result
  CO->>C: write entry with current engineIdentity
  Note over C: next dispatch on the same dist and projection is a hit again
```

## Legend

- Same flow applies when only the rubric's SKILL.md changed (installed skills symlink to the live checkout); the miss reason is then `skill-digest-mismatch`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-21 | Initial generation | DECIDE for #1759, engineer loop |
| 2026-08-21 | Plan update: unreadable SKILL.md settles as existing `cache-read-failed` (no new reason); identity resolved in step-runners and injected | /plan for #1759 |
