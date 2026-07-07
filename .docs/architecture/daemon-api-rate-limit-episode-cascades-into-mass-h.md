# Components & Sequence: Daemon rate-limit episode coordinator

**Last updated:** 2026-07-05
**Scope:** The in-process `RateLimitEpisode` coordinator and how it couples the per-feature
`Conductor` rate-limit branch to the daemon dispatch loop, plus the signal-responsive wait.
Source: jstoup111/ai-conductor#270.

## Component Diagram (L3)

```mermaid
graph TD
  subgraph daemonproc["Daemon process (one per repo)"]
    cli["daemon-cli.ts<br/>runConductorInWorktree<br/>(wires shared deps)"]
    episode["RateLimitEpisode<br/>(rate-limit-episode.ts, NEW)<br/>enter(untilMs) / active() / clear()<br/>escalating re-probe + cap"]
    events["ConductorEventEmitter<br/>(existing shared singleton)"]

    subgraph pool["Feature pool (N concurrent, in-process)"]
      condA["Conductor A.run()<br/>rate-limit branch<br/>(conductor.ts:1163)"]
      condB["Conductor B.run()<br/>rate-limit branch"]
    end

    loop["Daemon dispatch loop<br/>(daemon.ts:568-621)<br/>pre-dispatch gate"]
    waiter["interruptible wait<br/>(AbortSignal + SIGTERM)<br/>replaces bare setTimeout"]
    provider["ClaudeProvider<br/>rateLimited + waitSeconds<br/>(claude-provider.ts)"]
  end

  cli -->|constructs + injects| episode
  cli -->|injects existing| events
  cli -->|new Conductor per feature| condA
  cli -->|new Conductor per feature| condB

  provider -->|InvokeResult.rateLimited| condA
  provider -->|InvokeResult.rateLimited| condB

  condA -->|enter untilMs| episode
  condB -->|enter untilMs| episode
  condA -->|await| waiter
  waiter -->|shares deadline with| episode

  loop -->|active check before pickEligible| episode
  loop -.->|existing PAUSED gate unchanged| loop

  episode -->|emit rate_limit / resume| events
```

## Sequence: episode onset, coordinated backoff, resume

```mermaid
sequenceDiagram
  participant P as ClaudeProvider
  participant CA as Conductor A (in-flight)
  participant E as RateLimitEpisode
  participant L as Dispatch loop
  participant CB as Conductor B (would-be new)

  P-->>CA: InvokeResult rateLimited, waitSeconds
  CA->>E: enter(now + waitSeconds)
  Note over E: episode active, deadline set
  CA->>E: await clear()  (interruptible, SIGTERM-aware)
  L->>E: active()?
  E-->>L: true
  Note over L,CB: gate holds — feature CB is NOT dispatched
  Note over E: deadline passes → single re-probe
  E-->>CA: clear() resolves
  CA->>P: retry step (attempt unchanged, budget intact)
  alt still limited
    P-->>CA: rateLimited again
    CA->>E: enter(escalated deadline)
    Note over E: re-probe interval escalates (capped)
  else cleared
    Note over L: active() false → dispatch resumes, CB starts
  end
```

## Legend

- **NEW** node = code introduced by this feature; all others exist today.
- `RateLimitEpisode` is a pure, timer-injected module (mirrors the existing `waker.ts` shape):
  no wall-clock reads inside, `now`/timer injected for tests.
- The dispatch-loop gate sits beside the existing `checkPaused()` gate (daemon.ts:574) and only
  suppresses *new* picks; in-flight features are untouched.
- The interruptible wait shares the episode deadline; a SIGTERM aborts it promptly (today's bare
  `setTimeout` at conductor.ts:1168 has no abort path and no SIGTERM handler).
- `«untilMs»`, `«waitSeconds»` are runtime values, not literals.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-05 | Initial generation | Feature design for daemon rate-limit episode (#270) |
