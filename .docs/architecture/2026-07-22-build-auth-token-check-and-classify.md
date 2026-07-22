# Components: Build-Auth Token — Check and Classify

**Last updated:** 2026-07-22
**Scope:** To-be view for `build-auth-token-check-and-classify` (jstoup111/ai-conductor#498,
Tier M). Adds credential-state reporting to the install health check, a token liveness
verification seam, dispatch-time classification of rejected-credential failures on both
dispatch paths, and single-condition surfacing of a missing credential. Builds on the
2026-07-07 isolate-daemon-build-auth componentry; that diagram remains the base map.

## Diagram

```mermaid
graph TD
    subgraph CheckSurface["Install health check (bash)"]
        Check["check_installation<br/>bin/install --check"]
        CheckDelegate["build-auth check delegate<br/>(NEW — thin call into conductor,<br/>bash never re-derives path/mode)"]
        Check --> CheckDelegate
    end

    subgraph DaemonSide["Self-host daemon (src/conductor)"]
        Resolved["resolved-config<br/>buildAuthMode + buildAuthTokenPath"]
        Reader["readDaemonBuildToken<br/>(daemon-build-token.ts)<br/>ok / missing / error"]
        Verify["Token liveness verifier<br/>(NEW seam — mechanism per OQ-1 ADR)<br/>valid / invalid / unverifiable"]
        Preflight["preflightBuildAuthCheck<br/>(build-auth-preflight.ts)<br/>+ full remediation message<br/>+ single-condition surfacing (OQ-3)"]
        Classifier["Auth-failure classifier<br/>(claude-provider.ts)<br/>+ unauthorized/authentication_error<br/>recognized (OQ-2)"]
        Park["Park-and-poll on daemon credential<br/>(adr-2026-07-04 — never retry,<br/>never escalate)"]

        Reader --> Resolved
        Verify --> Reader
        Preflight --> Reader
        Classifier -- "authFailure=true" --> Park
    end

    subgraph Dispatch["Dispatch paths"]
        Serial["Serial loop<br/>(conductor.ts)"]
        Group["Concurrent group core<br/>(group-core.ts)"]
        Serial -- "consumes flags" --> Classifier
        Group -- "consumes flags<br/>(NEW: parks instead of<br/>burning retry ladder)" --> Classifier
    end

    CheckDelegate --> Reader
    CheckDelegate --> Verify
    Serial --> Preflight
    Group --> Preflight
```

## Legend

- **build-auth check delegate (NEW)** — the health check gains a build-token section by
  delegating to conductor-resolved state; the bash side only formats results. Keeps a
  single source of truth for mode/path resolution (config lives in TypeScript).
- **Token liveness verifier (NEW seam)** — answers "is this stored credential actually
  usable?" with `valid / invalid / unverifiable`. Concrete probe mechanism is OQ-1,
  decided in the architecture review ADR. Consumed by the health check; NOT run on
  every dispatch (dispatch keeps fail-fast read + classified failure).
- **Auth-failure classifier (+)** — extends the existing precedence classifier so a
  rejected credential (unauthorized / authentication_error) sets `authFailure` instead
  of falling through as a generic retryable failure. Both dispatch paths then take the
  park path; today only text like "invalid api key" is recognized.
- **Single-condition surfacing (OQ-3, resolved)** — a missing credential becomes ONE
  waiting condition for the daemon run rather than an independent HALT per queued
  feature; fail-closed semantics preserved. Decided form (plan 2026-07-22): a
  NON-BLOCKING skip-picks gate beside `checkPaused` (rate-limit-episode pattern) with
  a credential-file watcher arming the existing latched waker for auto-resume — never
  a loop-blocking wait.

## Sequence: health check reports credential state (to-be)

```mermaid
sequenceDiagram
    participant O as Operator
    participant I as bin/install --check
    participant D as Check delegate (conductor)
    participant R as Token reader
    participant V as Liveness verifier

    O->>I: run health check
    I->>D: build-auth state?
    D->>R: read credential (resolved mode + path)
    alt api-key mode
        D-->>I: mode=api-key (no token checks)
    else missing or unreadable
        D-->>I: missing / unreadable → FAIL + remediation
    else present
        D->>V: verify liveness
        alt verified usable
            V-->>I: valid → OK
        else rejected
            V-->>I: invalid (incl. expired) → FAIL
        else probe itself failed
            V-->>I: unverifiable — state unknown (never claims valid)
        end
    end
    I-->>O: token line alongside existing checks, scriptable exit code
```

## Sequence: invalid credential at dispatch (to-be)

```mermaid
sequenceDiagram
    participant D as Dispatch path (serial or group)
    participant C as headless build
    participant K as Classifier
    participant P as Park-and-poll

    D->>C: launch build with daemon credential
    C-->>D: fails — unauthorized / authentication_error
    D->>K: classify result
    K-->>D: authFailure=true (was: generic failure)
    D->>P: park on daemon credential source
    Note over D,P: zero retry attempts, zero escalation<br/>(was: full retry-escalation ladder per feature)
    P-->>D: credential changed → resume
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial to-be diagram | DECIDE phase for #498 — check-and-classify (Approach B) |
| 2026-07-22 | Legend: gate pinned as non-blocking skip-picks + waker | Plan update after conflict-check item 4 |
