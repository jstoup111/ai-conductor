# Components: Observed-close — issues close on first production observation (#492)

**Last updated:** 2026-07-10
**Scope:** The post-ship issue-close path — where the observation signature is declared,
how ship-time trailer injection becomes conditional, and the new observation-watch
registry + sweep that closes the originating issue only after the fixed behavior is
observed in production (or flags a no-show).

## Diagram

```mermaid
graph TD
    subgraph SPEC["Spec time (engineer DECIDE)"]
        OBSMARKER[.docs/observation/«plan-stem».md<br/>NEW: signature + surface + window<br/>or close-on-merge + rationale]
        LANDGATE[engineer land gate<br/>MODIFIED: asserts marker exists + well-formed]
    end

    subgraph SHIP["Ship time (daemon-cli.ts post-run)"]
        RESOLVER[resolveIssueRefKeyword<br/>NEW: shared Closes-vs-Refs resolver<br/>issue-ref.ts]
        TRAILER[trailer injection site<br/>daemon-cli.ts:763-782<br/>MODIFIED: keyword from resolver]
        REHAB[halt-PR rehabilitation<br/>halt-pr-rehabilitation.ts:102<br/>MODIFIED: keyword from resolver]
        ENROLL[enrollObservationWatch<br/>NEW: append registry entry]
    end

    subgraph SWEEP["Idle-tick sweep (daemon.ts sweepBestEffort)"]
        OBSSWEEP[sweepObservationWatch<br/>NEW: per-entry state machine]
        MERGEPOLL[PR state poll<br/>reuses mergeable-sweep pattern]
        MATCHER[signature matcher<br/>NEW: scan surface since merge time]
    end

    subgraph SURFACES["Observation surfaces"]
        DLOG[(.daemon/daemon.log)]
        EVENTS[(.pipeline/events.jsonl)]
    end

    REGISTRY[(.daemon/observation-watch.jsonl<br/>NEW)]
    GH[gh CLI<br/>issue close / comment / label]
    ISSUE[originating issue «owner/repo#N»]

    OBSMARKER --> LANDGATE
    OBSMARKER -- travels with spec --> RESOLVER
    RESOLVER --> TRAILER
    RESOLVER --> REHAB
    TRAILER -- close-on-merge declared --> GH2[Closes trailer<br/>GitHub auto-close on merge<br/>UNCHANGED today-path]
    TRAILER -- signature declared --> ENROLL
    ENROLL --> REGISTRY
    OBSSWEEP --> REGISTRY
    OBSSWEEP --> MERGEPOLL
    MERGEPOLL -- MERGED --> MATCHER
    MERGEPOLL -- closed unmerged --> GH
    MATCHER --> DLOG
    MATCHER --> EVENTS
    MATCHER -- first match --> GH
    MATCHER -- window expired --> GH
    GH --> ISSUE
```

## Lifecycle

```mermaid
stateDiagram-v2
    [*] --> awaiting_merge : enrolled at ship
    awaiting_merge --> watching : impl PR MERGED
    awaiting_merge --> pruned : PR closed unmerged — comment, prune
    watching --> closed : first signature match after merge time — gh issue close + comment quoting observed line
    watching --> no_show : window expired — comment + observation no-show label, issue stays OPEN
    closed --> [*]
    no_show --> [*]
```

## Legend

- **NEW / MODIFIED** nodes are this feature; everything else exists today.
- The `Closes`-trailer path survives unchanged for fixes whose marker declares
  `close-on-merge` (mandatory declaration; legal for inherently unobservable fixes —
  docs, refactors, consumer-app behavior invisible to the daemon). Only the close
  *trigger* moves for watched fixes; PR↔issue linking (`Refs`) is kept in both cases.
- `sweepObservationWatch` is best-effort and piggybacks `sweepBestEffort` (startup +
  every idle tick) exactly like `sweepMergeableLabels` — no new loop, no new process.
- Matching counts only observations timestamped **after** the impl PR's merge time,
  closing the merged ≠ loaded ≠ exercised race (#482): a well-chosen signature is a
  line only the new code can emit, so its first post-merge appearance proves all three.
- The `no_show` terminal is deliberate: never seeing the signature inside the window is
  the green-but-unwired alarm (#462) — the issue stays open and visibly flagged.
- Registry is `.daemon/*.jsonl` file-backed (mergeable-watch precedent): durable across
  daemon restarts, per-repo, no cross-repo state.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE phase for issue #492 |
| 2026-07-10 | Added shared keyword resolver + halt-PR rehabilitation as second injection site | Conflict resolution (blocking: rehab re-injected Closes) + plan update |
