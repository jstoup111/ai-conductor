# Components: Validation-group no-verdict halt retains satisfied siblings (#1425)

**Last updated:** 2026-09-06
**Scope:** The auto-mode SHIP validation-group join in `conductor.ts` — which existing
components the retention change touches and which it deliberately leaves alone. The
per-flow view is in `sequences/one-transient-failure-in-a-validation-group-member.md`.
Only the node marked CHANGED is edited by this feature; the retry budget is delivered by
#2190 (PR #2206) and this spec is blocked by it.

## Diagram

```mermaid
graph TD
    subgraph Loop["conductor.ts run loop (auto mode)"]
        GD["dispatchGroupRound<br/>runWithConcurrency over runGroupBranch<br/>budget: resolved max_retries - delivered by #2190"]
        GV["join: computeAndWriteVerdict per passing member<br/>gateVerdicts, manualTestFailRows, branchHandshakeFailures"]
        PRED["memberSatisfiedAtJoin(idx)<br/>named per-member predicate<br/>the former inline body of allGreen"]
        NV["no-verdict halt block<br/>CHANGED: writeHaltMarker, then ONE commitStateChanges<br/>retained siblings done + synthetic keys + existing failed stamping"]
        AG["all-green join<br/>member and synthetic keys done<br/>unchanged"]
    end

    subgraph State["conduct-state.json (single writer: the join)"]
        ST["member status: done | stale | failed | skipped<br/>synthetic validation__«member» keys"]
    end

    subgraph Readers["existing readers of a member's done status (unchanged)"]
        RM["resolveGroupMembership<br/>done => not dispatchable on re-dispatch"]
        MS["markDownstreamStale<br/>kickback or rebase invalidation: done => stale"]
        FF["nonGreenFinishValidators<br/>FINISH fence re-validates every member from disk"]
    end

    GD --> GV
    GV --> PRED
    PRED -->|"every member satisfied"| AG
    PRED -->|"a branch is no-verdict"| NV
    AG --> ST
    NV --> ST
    ST --> RM
    ST --> MS
    ST --> FF
```

## Legend

- **CHANGED** — the only edited component. The halt itself, its `needs-human` class, and
  its `failed`/`last_step` stamping are byte-for-byte as today; the commit that carries
  them additionally carries `done` for every member `memberSatisfiedAtJoin` accepted.
- **memberSatisfiedAtJoin** — a refactor, not new logic: the per-index body `allGreen`
  already evaluates (pass outcome; when `verifyArtifacts`: satisfied gate verdict, no
  handshake failure, no `manual_test` FAIL rows). Both `allGreen` and the halt block call it,
  so retention can never be wider than the all-green join's own notion of satisfied.
- **Readers (unchanged)** — the three consumers that give a retained `done` its meaning and
  its limits: skipped on re-dispatch, invalidated by any kickback or rebase, and re-checked
  at FINISH.
- `«…»` — placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-06 | Initial generation | DECIDE phase for #1425 spec (land requires a top-level architecture artifact at the feature stem) |
