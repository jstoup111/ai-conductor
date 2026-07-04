# Sequences: Daemon Lifecycle Controls

**Last updated:** 2026-07-04
**Scope:** The two load-bearing flows of daemon-lifecycle-controls: (1) fleet pause →
drain → idle, honored durably at the dispatch boundary; (2) safe engine upgrade —
rebuild with daemons running (no crash), then restart-in-place preserving the tmux
session and pause state. Placeholders use guillemets («»).

## Sequence 1 — Fleet pause, drain, resume

```mermaid
sequenceDiagram
  actor Op as Operator
  participant CLI as daemon verb routing
  participant Fleet as fleet iterator [NEW]
  participant Reg as registry.json (mirror)
  participant RepoA as repo A .daemon/
  participant DA as daemon A (loop)

  Op->>CLI: daemon pause --all
  CLI->>Fleet: pause(all)
  Fleet->>Reg: read registered repos
  loop each repo (best-effort, FR-17)
    Fleet->>RepoA: write durable PAUSED marker [NEW]
    Fleet-->>Op: per-repo outcome (paused / already-paused / error)
  end
  Note over DA: tick boundary (fill-pool / pickEligible)
  DA->>RepoA: read PAUSED marker [NEW]
  DA->>DA: skip dispatch — no new work (FR-1)
  Note over DA: in-flight feature drains to finish or HALT-park
  DA->>DA: idle, standing by — status shows PAUSED (FR-5)

  Op->>CLI: daemon resume --all
  CLI->>Fleet: resume(all)
  Fleet->>RepoA: remove PAUSED marker
  DA->>RepoA: next tick — marker gone
  DA->>DA: dispatch eligible work, queue position intact (FR-2)
```

## Sequence 2 — Safe engine upgrade: rebuild, then restart-in-place

```mermaid
sequenceDiagram
  actor Op as Operator
  participant Build as harness build
  participant Dist as engine store [NEW]
  participant DA as daemon A (old process)
  participant Sup as supervisor (tmux adapter)
  participant Sess as tmux session cc-daemon-«slug»-«hash»
  participant DA2 as daemon A (new process)

  Op->>Build: rebuild shared engine
  Build->>Dist: emit dist-«sha»/ (new versioned dir) [NEW]
  Build->>Dist: atomic flip of current pointer [NEW]
  Note over DA: keeps executing its pinned version dir —<br/>lazy imports still resolve (FR-13, no ENOENT)

  Op->>Sup: daemon restart «repo»
  Sup->>DA: gate — no feature in flight (idle or paused, FR-9)
  Sup->>Sess: respawn daemon command INSIDE existing session [NEW]
  Note over Sess: session, scrollback, windows survive (FR-20)
  DA->>DA: old process exits, releases pidfile
  Sess->>DA2: new process starts
  DA2->>Dist: resolve engine via current pointer → dist-«sha» (FR-8/14)
  DA2->>DA2: acquire pidfile (single-owner handoff, adr-010)
  DA2->>DA2: read PAUSED marker — come up paused if set (FR-4/11)
  Sup-->>Op: restarted — version «sha», session preserved
  Op->>Dist: (later) cleanup — delete only versions no live pidfile references (FR-15)
```

## Legend

- **[NEW]** — behavior added by this feature.
- `«slug»`, `«sha»`, `«hash»`, `«repo»` — placeholders.
- "engine store" — the versioned engine layout (proposed versioned dirs + atomic
  current pointer; exact mechanism confirmed in architecture-review).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-04 | Initial sequences | DECIDE phase for daemon-lifecycle-controls (ai-conductor#215) |
| 2026-07-04 | Confirmed against implementation plan (38 tasks, 3 phases) | /plan update pass |
