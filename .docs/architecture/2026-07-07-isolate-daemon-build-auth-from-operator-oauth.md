# Components: Isolate Daemon Build Auth from Operator OAuth

**Last updated:** 2026-07-07
**Scope:** Self-host build auth path (to-be) — daemon-owned build credential behind a
swappable auth seam, replacing the copy-operator-credentials design in
`sandbox-build-env.ts`. Feature: `isolate-daemon-build-auth-from-operator-oauth`
(jstoup111/ai-conductor#351).

## Diagram

```mermaid
graph TD
    subgraph OperatorSide["Operator interactive session"]
        OpClaude["Interactive claude session"]
        OpCreds["~/.claude/.credentials.json<br/>rotating OAuth pair"]
        OpClaude -- "reads + refreshes<br/>(rotation stays private)" --> OpCreds
    end

    subgraph DaemonSide["Self-host daemon"]
        AuthSeam["BuildAuthProvider seam<br/>(engine/self-host)"]
        DaemonCred["Daemon credential store<br/>~/.ai-conductor/build-auth<br/>long-lived setup-token"]
        ApiKeyMode["Alt mode: ANTHROPIC_API_KEY<br/>(config-selected)"]
        Preflight["Pre-flight check<br/>validates daemon token<br/>(operator-credentials.ts, retargeted)"]
        Park["Park-and-poll fallback<br/>(daemon token only)"]

        AuthSeam --> DaemonCred
        AuthSeam -. "alternate" .-> ApiKeyMode
        Preflight --> AuthSeam
        Park -. "on auth failure" .-> AuthSeam
    end

    subgraph Sandbox["Throwaway sandbox CLAUDE_CONFIG_DIR"]
        SbEnv["sandbox-build-env.ts<br/>provisioner"]
        SbAuth["Build auth material<br/>injected via seam"]
        Headless["headless claude -p build"]

        SbEnv --> SbAuth
        Headless -- "authenticates from" --> SbAuth
    end

    AuthSeam -- "provides credential" --> SbEnv
    OpCreds x-. "NO copy — link severed<br/>(was: copyIfPresent + refreshSandboxCredentials)" .-x SbEnv
```

## Legend

- **BuildAuthProvider seam** — new interface; resolves the build credential for a
  self-host sandbox. Default mode: daemon-owned long-lived token minted once via
  `claude setup-token`. Alternate mode: `ANTHROPIC_API_KEY`. Swappable later for
  platform identity (EKS direction, PR #175).
- **Daemon credential store** — daemon-side file/env source, disjoint from the
  operator's `~/.claude/.credentials.json`. Neither side can rotate the other's
  refresh token because they are separate grants.
- **`x-.NO copy.-x`** — the severed edge: sandbox provisioning no longer reads the
  operator's credentials file; `refreshSandboxCredentials` re-copy on park is retired.
- **Park-and-poll fallback** — adr-2026-07-04 machinery demoted: it now watches the
  daemon credential source (not the operator's file) and fires only when the
  daemon's own token is expired/invalid.

## Sequence: build auth on dispatch (to-be)

```mermaid
sequenceDiagram
    participant D as Daemon conductor
    participant A as BuildAuthProvider seam
    participant S as Sandbox provisioner
    participant C as headless claude -p

    D->>A: resolve build credential
    A-->>D: daemon token (or API key)
    Note over A: never reads operator<br/>~/.claude/.credentials.json
    D->>S: provision sandbox (skills/hooks links, settings, trust)
    S->>S: inject build auth via seam
    D->>C: launch build with sandbox childEnv
    C->>C: authenticate from daemon credential
    alt daemon token invalid or expired
        D->>D: park-and-poll on DAEMON credential source
        D->>D: timeout leads to credentials-specific HALT<br/>naming the daemon token, not operator OAuth
    end
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-07 | Initial to-be diagram | DECIDE phase for #351 — sever daemon/operator credential coupling |
