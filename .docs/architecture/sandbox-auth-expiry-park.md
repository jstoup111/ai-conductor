# Components: Sandbox auth-expiry park-and-poll

**Last updated:** 2026-07-04
**Scope:** Self-host build path — auth-failure classification and credentials
park-and-poll (ai-conductor#210). Shows the affected components and the two
detection points (pre-flight expiry check, output-signature classification)
feeding one shared park mechanism.

## Diagram

```mermaid
graph TD
    subgraph daemon["Daemon loop (daemon.ts)"]
        TICK[Idle-poll tick / pickEligible]
    end

    subgraph conductor["Conductor (conductor.ts)"]
        LOOP[Per-step retry loop]
        DISPATCH[runSelfBuildDispatch]
        PARK[Credentials park-and-poll<br/>no retry-budget burn]
        HALTW[writeHaltMarker<br/>reason names creds file + expiresAt]
    end

    subgraph sandbox["Sandbox env (sandbox-build-env.ts)"]
        PREFLIGHT[Pre-flight expiry check<br/>reads claudeAiOauth.expiresAt]
        PROVISION[provisionSandboxBuildEnv<br/>copies .credentials.json]
        REFRESH[Credentials refresh / re-provision<br/>on source-file change]
    end

    subgraph exec["Execution (claude-provider.ts)"]
        INVOKE[invoke headless claude -p]
        CLASSIFY[Output signature classification<br/>AUTH_FAILURE_RE beside<br/>MODEL_UNAVAILABLE_RE / RATE_LIMIT_RE]
    end

    CREDS[(Operator credentials<br/>~/.claude/.credentials.json)]

    TICK --> LOOP
    LOOP --> DISPATCH
    DISPATCH --> PREFLIGHT
    PREFLIGHT -- fresh --> PROVISION
    PREFLIGHT -- expired or near-expiry --> PARK
    PROVISION --> INVOKE
    INVOKE --> CLASSIFY
    CLASSIFY -- authFailure --> PARK
    CLASSIFY -- other outcomes --> LOOP
    PARK -- polls mtime + expiresAt --> CREDS
    CREDS -. refreshed by live session .-> PARK
    PARK -- changed and unexpired --> REFRESH
    REFRESH --> DISPATCH
    PARK -- timeout --> HALTW
    PREFLIGHT -. reads .-> CREDS
    PROVISION -. copies .-> CREDS
```

## Legend

- Solid arrows: control flow. Dotted arrows: file reads/writes by other actors.
- `PARK` is the single shared wait primitive both detection points funnel into;
  it consumes zero entries of the step retry budget (same contract as the
  existing rateLimited / sessionExpired paths).
- `REFRESH` re-copies credentials into the existing sandbox (or re-provisions),
  because the sandbox is provisioned once per feature run and would otherwise
  keep the stale copy across attempts.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-04 | Initial generation | DECIDE phase for sandbox-auth-expiry-park (issue #210) |
