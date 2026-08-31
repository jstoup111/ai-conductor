# Sequence: Verified setup repair retention (#1346)

**Last updated:** 2026-08-29
**Scope:** Proposed daemon-only flow after setup triage reaches its one bounded fix-session.

## Diagram

```mermaid
sequenceDiagram
    participant D as Daemon dispatch
    participant T as Setup triage
    participant R as Fix-session runner
    participant P as Selected provider
    participant G as Feature worktree Git
    participant S as Forced project setup
    participant E as Event spine
    participant H as Quarantine and HALT state

    D->>T: SetupFailureError after Stage 1 leaves a clean tree
    T->>G: Read original HEAD and prove porcelain is clean
    T->>R: Dispatch exactly one fresh fix-session
    R->>P: Diagnose and repair from setup output
    P-->>R: Return after repair attempt
    T->>G: NEW add all, write tree, reset index, retain candidate tree OID
    T->>S: Force a real setup verification
    S-->>T: Setup result

    alt Setup still fails
        T->>G: NEW preserve changed attempt to verified slug ref then restore original HEAD
        T->>H: Write actionable HALT evidence
        T->>E: NEW emit setup-repair rejected, setup-still-failing
        T-->>D: Park
    else Setup passes
        T->>G: NEW repeat exact snapshot and compare HEAD plus tree OID
        alt Provider made clean forward commit or commits
            T->>E: NEW emit setup-repair accepted-existing-commit
            T-->>D: Fixed-pass
        else HEAD unchanged and captured uncommitted repair is unchanged
            T->>G: NEW add -A and create engine-owned repair commit
            G-->>T: Verified original parent, candidate tree, new HEAD, clean porcelain
            T->>E: NEW emit setup-repair engine-committed
            T-->>D: Fixed-pass
        else History rewrite, mixed commit plus residue, setup drift, or commit failure
            T->>G: NEW preserve complete attempt to verified slug ref before reset
            T->>H: Write HALT evidence and keep state in place if preservation fails
            T->>E: NEW emit setup-repair rejected with closed reason
            T-->>D: Park
        end
    end

    E-->>E: Persist through ConductorEventEmitter to events.jsonl
```

## Legend

- `NEW` marks behavior introduced by this feature; the existing one-fix-session bound and forced
  setup verification remain unchanged.
- The pre-provider HEAD plus porcelain proof establishes the attribution boundary. The post-provider
  snapshot is the only uncommitted content eligible for an engine-owned repair commit. Snapshotting
  uses Git's tree object identity so edits, deletions, mode changes, and untracked additions are all
  compared exactly while the index is restored to the candidate HEAD between checks.
- Setup verification may read or write ignored operational state, but any tracked or untracked Git
  drift relative to the captured repair snapshot rejects automatic commit.
- Rejected attempts are restored only after the complete provider history and residue are reachable
  from a verified `wip/setup-quarantine-<slug>` ref. A failed preservation leaves the attempt in
  place; a failed restore keeps the verified recovery ref.
- `Event spine` uses the existing `ConductorEventEmitter` → `ConductorEvent` → `EventPersister` path.
  `HALT` and the quarantine ref remain durable recovery state, not a second telemetry channel.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-29 | Plan alignment: exact tree snapshots, commit postconditions, preserve-before-reset | Keep the diagram aligned with the accepted implementation plan |
| 2026-08-29 | Initial sequence | DECIDE architecture for jstoup111/ai-conductor#1346 |
