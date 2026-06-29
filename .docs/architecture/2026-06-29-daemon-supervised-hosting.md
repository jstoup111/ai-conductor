# Architecture: Daemon Supervised Hosting

**Last updated:** 2026-06-29
**Scope:** How the per-repo build daemon is **hosted and managed** in `src/conductor` —
inverting the detached `stdio:'ignore'` spawn into a foreground daemon hosted behind a
swappable **Supervisor port** (tmux adapter now). Shows the management plane vs. the build
plane, the operator-vs-automation authority split (preserving ADR-005/ADR-010), and the
intake/execute seam. Current-state + additions. New elements marked **[NEW]**.

## Diagram 1 — Containers: management plane vs. build plane

```mermaid
flowchart TD
  operator([Operator · human]) -->|"start/stop/restart/connect/debug/status"| verbs
  engineer([Engineer automation]) -->|"ensure-running (start-only, fire-and-forget)"| ensure

  subgraph mgmt["[NEW] Management plane (additive, never required to build)"]
    verbs["daemon &lt;verb&gt; routing<br/>(index.ts → detectDaemonSupervisorCommand)"]
    ensure["ensureRunning<br/>(daemon-lock.ts)"]
    port{{"[NEW] Supervisor port<br/>start·stop·restart·attach·logs·exec·isUp"}}
    tmux["[NEW] tmux adapter<br/>(daemon-tmux.ts)"]
    k8s["kubectl adapter<br/>(future — not built)"]
    verbs --> port
    ensure -->|"isUp? → start"| port
    port --> tmux
    port -.-> k8s
  end

  subgraph host["Daemon host (per repo)"]
    session["[NEW] session cc-daemon-&lt;slug&gt;-&lt;pathhash&gt;<br/>owns the PTY → attachable in color"]
    fg["foreground process:<br/>conduct-ts daemon --continuous"]
    tmux -->|"new-session -d / attach[-r] / capture-pane"| session
    session --> fg
  end

  subgraph build["Build plane (unchanged core — bare-run capable)"]
    lock["holdLock → .daemon/daemon.pid<br/>(ADR-010 single-owner)"]
    loop["serial run loop<br/>(concurrency clamped to 1)"]
    work["[NEW] injected work-source seam<br/>(local = discoverBacklog inline)"]
    fg --> lock
    fg --> loop
    loop --> work
  end

  classDef new fill:#e6ffe6,stroke:#2a2;
```

## Diagram 2 — `daemon start` decision (idempotent, two-layer)

```mermaid
flowchart TD
  s([daemon start]) --> pre{"[NEW] tmux present?"}
  pre -- "no" --> err["[NEW] actionable error<br/>(install tmux) — FR-8.<br/>Core build path NOT blocked — FR-14"]
  pre -- "yes" --> has{"[NEW] hasSession<br/>cc-daemon-&lt;slug&gt;? (FR-2)"}
  has -- "yes" --> noop["no-op (idempotent)<br/>operator's session undisturbed — FR-12"]
  has -- "no" --> new["[NEW] new-session -d<br/>'conduct-ts daemon --continuous'"]
  new --> inner["inner daemon → holdLock<br/>(pidfile race still arbitrated — ADR-010)"]
```

## Diagram 3 — Authority split (the ADR-005 invariant, preserved)

```mermaid
flowchart LR
  subgraph human["Operator (human) — full lifecycle"]
    h1["start · stop · restart"]
    h2["connect (read-only) · debug (r/w)"]
  end
  subgraph auto["Engineer automation — launch-only (ADR-005)"]
    a1["ensure-running = isUp? → start"]
    a2["state check = capturePane (read), NOT attach"]
  end
  h1 -. "operator may restart/stop" .-> note1["lifecycle ownership is a HUMAN capability"]
  a1 -. "never restart/stop/health-manage" .-> note2["non-autonomy invariant holds (ADR-005/010)"]
```

## Notes

- **Bare-run invariant (FR-14):** the build plane has no dependency on the management plane.
  `conduct-ts daemon --continuous` runs standalone with no tmux present; tmux is purely the
  attach/manage layer. This is also the container/k8s entrypoint contract.
- **Single-owner preserved (ADR-010):** the foreground daemon still calls `holdLock`, so the
  pidfile remains the source of truth for inner 1-per-repo ownership; the session layer is an
  outer idempotency check, not a replacement.
- **Session naming:** `cc-daemon-<slug>-<pathhash>` — tmux sessions are a per-user global
  namespace, so the path hash prevents two same-named repos from colliding (FR-11).
- **Seam (not split):** the run loop consumes `BacklogItem`s from an injected work-source;
  the local adapter is today's inline `discoverBacklog`. A future intake/execute process split
  is an adapter swap, not built here.
