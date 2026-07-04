# Sequence: Sandbox auth-expiry park-and-poll

**Last updated:** 2026-07-04
**Scope:** Build-step attempt on the self-host path when the operator OAuth
token is expired at dispatch time (pre-flight catch), and when an auth failure
surfaces mid-attempt (signature catch). Both paths park without burning the
step retry budget; poll timeout ends in a credentials-specific HALT.

## Diagram

```mermaid
sequenceDiagram
    participant C as Conductor step loop
    participant S as sandbox-build-env
    participant F as Creds file «~/.claude/.credentials.json»
    participant P as claude-provider
    participant H as halt-marker

    Note over C: build step attempt «n» (budget intact)
    C->>S: pre-flight expiry check
    S->>F: read claudeAiOauth.expiresAt
    alt token expired or near-expiry
        S-->>C: doomed, do not dispatch
        loop park-and-poll (no budget burn)
            C->>F: poll mtime + expiresAt
            alt changed and unexpired
                C->>S: refresh sandbox credentials
                S->>F: re-copy .credentials.json
                C->>C: resume attempt «n»
            else poll timeout exceeded
                C->>H: writeHaltMarker(reason: creds file + expiresAt)
                Note over H: operator sees auth-window HALT, not a build defect
            end
        end
    else token fresh
        C->>S: provision (copy creds into sandbox)
        C->>P: invoke headless claude -p
        P-->>C: output + authFailure flag (AUTH_FAILURE_RE matched)
        alt authFailure
            Note over C: same park-and-poll loop as above
        else other result
            Note over C: existing paths (success / retry / rate-limit / model ladder)
        end
    end
```

## Legend

- «n» — the attempt counter is unchanged by any park iteration; only genuine
  step failures decrement the retry budget.
- The signature catch covers tokens that are unexpired but invalid (rotated by
  a concurrent live session) — the pre-flight alone cannot see those.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-04 | Initial generation | DECIDE phase for sandbox-auth-expiry-park (issue #210) |
