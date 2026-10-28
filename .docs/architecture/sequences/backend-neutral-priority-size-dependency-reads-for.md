# Sequence: Backlog Ordering Read Through the Ordering Port (#851)

**Last updated:** 2026-10-10
**Scope:** One daemon discovery pass. The pass resolves priority bands and blocker verdicts for a
backlog that mixes a GitHub-linked item and a Jira-linked item. The intake claim, the overlap scan, and
the coherence-check consumers follow the same port path.

## Diagram

```mermaid
sequenceDiagram
    participant D as Daemon discovery pass
    participant P as createPriorityResolver
    participant B as BlockerResolver
    participant O as OrderingSource
    participant G as GitHub ordering source
    participant T as tracker-client
    participant E as Event spine

    D->>P: resolve(items, refresh)
    P->>O: readFacts([owner/repo#N, PROJ-123])
    O->>G: readFacts([owner/repo#N])
    G->>T: runTrackerRepositoryRead issue.read
    T-->>G: labels JSON
    G-->>O: owner/repo#N → band high, size M
    O->>E: tracker_backend_unavailable (backend jira, reason no-adapter)
    O-->>P: owner/repo#N facts, PROJ-123 → unavailable
    P-->>D: banded: high, unlabeled (unchanged cache and outage rules)

    D->>B: resolve(owner/repo#N)
    B->>O: readBlockers(owner/repo#N)
    O->>G: readBlockers(owner/repo#N)
    G->>T: runTrackerRepositoryRead blocked_by
    T-->>G: blocked_by JSON
    G-->>O: open blockers as canonical refs
    O-->>B: [owner/repo#M]
    B->>B: walk chain, memo per walk, detect cycle
    B-->>D: BlockerVerdict (unblocked, blocked, cycle, or indeterminate)

    D->>B: resolve(PROJ-123)
    B->>O: readBlockers(PROJ-123)
    O-->>B: unavailable (no-adapter)
    B-->>D: indeterminate («no-adapter detail»)
```

## Legend

- **OrderingSource** dispatches each reference by its parsed kind. GitHub references take exactly
  today's `gh` reads. A Jira key returns `unavailable` without a network call.
- **Priority:** an `unavailable` reference bands as `unlabeled`, the same band a not-found reference
  gets today, so ordering is unchanged. The difference is that the gap is now reported on the event
  spine.
- **Blockers:** an `unavailable` reference yields an `indeterminate` verdict. That verdict already
  exists in the closed `BlockerVerdict` union, and every caller handles it today.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Initial generation | #851 DECIDE: backend-neutral ordering reads |
