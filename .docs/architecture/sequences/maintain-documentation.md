# Sequence: documentation gate and PR-link finalization

**Last updated:** 2026-07-25
**Scope:** One implementation run from post-rebase documentation review through verified finish, including no-op and blocking paths.

## Diagram

```mermaid
sequenceDiagram
  participant C as Conductor
  participant S as maintain-documentation skill
  participant D as Human-facing docs
  participant E as Transient evidence
  participant F as finish skill
  participant G as GitHub PR
  participant R as release workflow

  C->>S: dispatch after rebase
  S->>S: inspect implementation diff and affected contracts
  S->>S: read relevant .docs artifacts when needed
  alt documentation changes required
    S->>D: update canonical affected pages
    opt notable implementation change
      S->>D: add one-sentence changelog entry<br/>with spec PR when available<br/>and implementation-PR placeholder
    end
    S->>S: verify changed examples and commit docs
  else no documentation changes required
    S->>S: record evidence-backed no-op decision
  end
  S->>E: write review report
  alt verdict PASS
    S->>E: write fresh pass marker
    E-->>C: completion satisfied
    C->>F: dispatch finish
    F->>G: create or reuse implementation PR
    G-->>F: PR URL
    opt changelog placeholder exists
      F->>D: replace placeholder with PR link
      F->>F: commit and push final link
    end
    F->>F: complete existing shipped-record and finish-record sequence
    F-->>C: verified completion
  else verdict BLOCKED
    S-->>E: omit pass marker
    E-->>C: completion unsatisfied
    C-->>C: retry or HALT before finish
  end
  G->>R: implementation PR merges to main
  alt Unreleased contains notable content
    R->>R: rewrite changelog, bump version, tag, publish release
  else Unreleased is substantively empty
    R->>R: exit successfully without repository or release mutation
  end
```

## Legend

- `.docs/` is read-only to `maintain-documentation`; the skill writes only current human-facing documentation and transient evidence.
- The pass marker is distinct from the review report so a blocked review remains inspectable without satisfying completion.
- Projects without the custom step keep the existing `rebase → finish` sequence.
- Projects without the exact changelog placeholder keep the existing finish behavior.
- A merge without notable changelog content does not create a release or bump `VERSION`.

## Change log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial design | Define gate ordering, negative path, and project isolation |
| 2026-07-25 | Add release trigger branch | Make empty Unreleased a successful no-release outcome |
