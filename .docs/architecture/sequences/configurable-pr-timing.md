# Sequence: early-draft push/PR timing (both flows)

**Last updated:** 2026-07-03
**Scope:** Timeline of `pr_timing: early-draft` for a daemon build and an engineer spec
authoring run. `finish` mode is not diagrammed — it is exactly today's behavior.

## Daemon build, early-draft

```mermaid
sequenceDiagram
  participant D as Daemon Conductor
  participant P as PrPublisher
  participant GH as origin + GitHub
  participant F as /finish skill

  D->>D: resolvePrTiming = early-draft
  D->>P: publish at build start
  P->>GH: git push -u origin feat/«slug»
  P->>GH: findOrCreatePr draft:true
  Note over GH: draft PR visible remotely, CI starts

  loop each completed loopGate step
    D->>P: refresh
    P->>GH: git push (fast-forward)
  end

  D->>D: native rebase step rewrites history
  D->>P: refresh after rebase
  P->>GH: git push --force-with-lease

  D->>F: finish step (auto mode)
  F->>GH: reuse existing PR via gh pr view
  F->>P: markReadyForReview
  P->>GH: gh pr ready
  Note over GH: same PR, now ready for review

  Note over D,GH: any early push/PR failure logs loudly and never halts the build
```

## Engineer spec flow, early-draft

```mermaid
sequenceDiagram
  participant E as Engineer session
  participant P as PrPublisher
  participant GH as origin + GitHub

  E->>E: resolvePrTiming = early-draft
  loop each DECIDE skill boundary
    E->>E: checkpoint commit of new .docs artifacts
    E->>P: refresh
    P->>GH: push spec/«slug», findOrCreatePr draft:true on first push
  end
  Note over GH: draft spec PR shows authoring progress from a phone

  E->>E: engineer land — guards run, authoritative .docs commit
  E->>P: handoff
  P->>GH: push + markReadyForReview
  Note over GH: spec PR ready — operator merges, daemon builds
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial generation | DECIDE for configurable-pr-timing (ai-conductor#199) |
