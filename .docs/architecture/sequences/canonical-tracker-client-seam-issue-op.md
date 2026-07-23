# Sequence: Issue-side operation through the TrackerClient seam (#846)

**Last updated:** 2026-07-22
**Scope:** A representative issue-side read (claim-time label read for priority
banding) flowing through the canonical seam in the target state — production path,
test/kill-switch path, and where the deferred Jira transport (#849) would diverge.

## Diagram

```mermaid
sequenceDiagram
    participant CL as claimUnblocked (dependency-claim.ts)
    participant LR as IssueLabelReader
    participant TC as TrackerClient (seam)
    participant GHC as GitHubTrackerClient
    participant RN as canonical runner (makeProductionGh)
    participant KS as assertRealExecAllowed
    participant GH as gh CLI

    CL->>LR: resolveClaimBands(refs)
    LR->>TC: getIssueLabels(«sourceRef»)
    TC->>GHC: (backend = github — default, zero config)
    GHC->>RN: run(gh api repos/«owner»/«repo»/issues/«n»)
    RN->>KS: guard real exec
    alt AI_CONDUCTOR_NO_REAL_EXEC set (test run)
        KS-->>RN: throw — inject a fake TrackerClient instead
        Note over KS: uniform now — engineer-cli and halt-issues<br/>copies no longer bypass the guard
    else production
        KS-->>RN: allowed
        RN->>GH: execFile gh
        GH-->>GHC: stdout (labels JSON)
        GHC-->>TC: labels[]
        TC-->>LR: labels[]
        LR-->>CL: priority band
    end

    Note over TC,GHC: Deferred (#849): a JiraTrackerClient implements the same<br/>TrackerClient interface over REST (token) or MCP transport,<br/>selected by the per-project tracker config hosted by #845.
```

## Legend

- `TrackerClient` is the only seam issue-side callers see; fakes in tests implement it
  directly, so the kill-switch throw is a belt-and-suspenders backstop, not the primary
  test isolation.
- The `alt` branch shows the now-uniform `AI_CONDUCTOR_NO_REAL_EXEC` behavior — every
  real exec on the issue side passes through the single guarded factory.
- Guillemets (`«»`) mark variable parts of labels.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | DECIDE architecture step for #846 (engineer spec authoring) |
